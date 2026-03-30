import prisma from '../../config/prisma';
import { scanGmailMessageIds, fetchGmailMessageHeaders, fetchGmailMessageContent } from './gmail.scanner';
import { classifySubscriptionEmail } from './gmail.classifier';
import { extractAllSubscriptionData, isValidSubscriptionDate } from './gmail.parser';
import { PROVIDER_REGISTRY, buildProviderQuery, ProviderConfig } from './gmail.providers';
import { SubscriptionStatus } from '@prisma/client';
import { isStopped } from './gmail.queue';
export const scanState = new Map<string, any>();
// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function calculateNextRenewal(from: Date, cycle: string | null): Date | null {
  if (!cycle) return null;
  const d = new Date(from.getTime());
  switch (cycle) {
    case 'MONTHLY': {
      const t = d.getMonth() + 1; d.setMonth(t);
      if (d.getMonth() !== t % 12) d.setDate(0);
      break;
    }
    case 'YEARLY':    d.setFullYear(d.getFullYear() + 1); break;
    case 'QUARTERLY': {
      const t = d.getMonth() + 3; d.setMonth(t);
      if (d.getMonth() !== t % 12) d.setDate(0);
      break;
    }
    case 'WEEKLY':    d.setDate(d.getDate() + 7); break;
    default: return null;
  }
  return isValidSubscriptionDate(d) ? d : null;
}

function mapLifecycle(event: string | null): SubscriptionStatus {
  switch (event) {
    case 'CANCELLED':      return SubscriptionStatus.CANCELLED;
    case 'PAYMENT_FAILED': return SubscriptionStatus.PAYMENT_FAILED;
    case 'TRIAL_ENDING':   return SubscriptionStatus.TRIAL;
    default:               return SubscriptionStatus.ACTIVE;
  }
}

// ─────────────────────────────────────────────────────────────────
// Fast subject-level pre-filter
// ─────────────────────────────────────────────────────────────────

/**
 * Reject obviously non-billing subjects WITHOUT fetching the email body.
 * This is the key performance fix: previously every Apple email (57 total)
 * had its full body fetched even for "Welcome to iCloud", "Password reset", etc.
 *
 * Returns true if the subject looks like it could be a billing/lifecycle email.
 */
const NON_BILLING_SUBJECT_PATTERNS = [
  /welcome to/i,
  /getting started/i,
  /your .* download/i,
  /has been (?:reset|updated|changed)/i,
  /confirm your email/i,
  /verify your email/i,
  /sign.?in (?:code|alert)/i,
  /new device/i,
  /unusual (?:sign.?in|activity)/i,
  /password (?:reset|changed)/i,
  /account (?:was used|information has been)/i,
  /storage is (?:almost )?full/i,   // "Your iCloud storage is almost full" — not a billing email
  /tips for/i,
  /here.?s how to/i,
  /what.?s new/i,
  /you might like/i,
  /has shipped/i,
  /out for delivery/i,
  /estimated delivery/i,
  /track your/i,
  /your (?:order|package|ride|food order)/i,
  /join prime/i,   // "Join Prime Lite to watch…" — marketing, not a receipt
];

const BILLING_SUBJECT_PATTERNS = [
  /receipt/i,
  /invoice/i,
  /payment/i,
  /subscription/i,
  /billing/i,
  /renewal/i,
  /charged/i,
  /membership/i,
  /plan/i,
  /confirmed/i,
  /cancelled?/i,
  /failed/i,
  /trial end/i,
];

function subjectLooksBilling(subject: string): boolean {
  // Hard reject: known non-billing patterns
  for (const p of NON_BILLING_SUBJECT_PATTERNS) {
    if (p.test(subject)) return false;
  }
  // Soft accept: known billing signals
  for (const p of BILLING_SUBJECT_PATTERNS) {
    if (p.test(subject)) return true;
  }
  // No signal either way — fetch the body to be safe
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Scan all messages for a single provider
// ─────────────────────────────────────────────────────────────────

async function scanProvider(
  userId: string,
  accessToken: string,
  refreshToken: string,
  provider: ProviderConfig,
  afterDate: string
): Promise<void> {
  const query = buildProviderQuery(provider, afterDate);
  console.log(`\n🔍 [${provider.name}] query: ${query}`);

  // Collect all message IDs for this provider
  let allIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await scanGmailMessageIds(accessToken, refreshToken, {
      maxResults: 100,
      query,
      pageToken,
    });
    allIds.push(...res.messageIds);
    pageToken = res.nextPageToken;
  } while (pageToken && allIds.length < 500);

  if (allIds.length === 0) {
    console.log(`   ⟶ No emails found`);
    return;
  }

  console.log(`   ⟶ Found ${allIds.length} emails, processing...`);

  // ── Stage 1: Fetch headers only — cheap, no body download ────────────────
  interface HeaderInfo { messageId: string; date: Date; subject: string; from: string }
  const headers: HeaderInfo[] = [];

  for (const messageId of allIds) {
    try {
      const h = await fetchGmailMessageHeaders(accessToken, refreshToken, messageId);
      headers.push({
        messageId,
        date: new Date(h.date || Date.now()),
        subject: h.subject || '',
        from: h.from || '',
      });
    } catch (e) {
      console.error(`   ❌ Header fetch failed: ${messageId}`, e);
    }
  }

  // Process oldest → newest so status transitions happen in the right order
  headers.sort((a, b) => a.date.getTime() - b.date.getTime());

  let processed = 0, skipped = 0;

  for (const { messageId, date: emailDate, subject, from } of headers) {
    // ── Stop check — respect cancelCurrentJob() ───────────────────────────
    if (isStopped()) {
      console.log(`   🛑 Stop requested — aborting ${provider.name} mid-scan`);
      const state = scanState.get(userId);
      if (state) state.status = 'stopped';
      return;
    }

    // ── Stage 2: Subject pre-filter — zero body fetches for obvious rejects ──
    if (!subjectLooksBilling(subject)) {
      const state = scanState.get(userId);
      if (state) state.progress.emailsSkipped++;
      continue;
    }

    try {
      // ── Stage 3: Fetch full body only for emails that passed subject filter ─
      const { bodyText, pdfText } = await fetchGmailMessageContent(accessToken, refreshToken, messageId);

      // ── Stage 4: Classify with body ───────────────────────────────────────
      const cls = classifySubscriptionEmail({ from, subject }, bodyText);

      if (!cls.isSubscriptionEmail) {
        console.log(`   ⏭  Skipped (${cls.reasons[0]}): "${subject.substring(0, 50)}"`);
        skipped++;
        continue;
      }

      // ── Stage 5: Extract structured data ─────────────────────────────────
      const extracted = extractAllSubscriptionData(provider, bodyText, pdfText, emailDate.toISOString());

      // ── Stage 6: Upsert subscription ─────────────────────────────────────
      await upsertSubscription(userId, extracted, cls, emailDate, messageId, provider);

      console.log(`   ✅ [${cls.lifecycleEvent}] "${subject.substring(0, 50)}" | ${extracted.amount ? `${extracted.currency} ${extracted.amount}` : 'no amount'}`);
      processed++;
      const state = scanState.get(userId);
      if (state) state.progress.emailsProcessed++;

      // Small delay to avoid Gmail rate limits
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`   ❌ Error processing ${messageId}:`, e);
    }
  }

  console.log(`   📊 ${provider.name}: ${processed} processed, ${skipped} skipped`);
}

// ─────────────────────────────────────────────────────────────────
// Upsert subscription + payment cycle
// ─────────────────────────────────────────────────────────────────

async function upsertSubscription(
  userId: string,
  extracted: ReturnType<typeof extractAllSubscriptionData>,
  cls: ReturnType<typeof classifySubscriptionEmail>,
  emailDate: Date,
  messageId: string,
  provider: ProviderConfig
): Promise<void> {
  const newStatus = mapLifecycle(cls.lifecycleEvent);

  const existing = await prisma.subscription.findFirst({
    where: { userId, provider: extracted.provider },
  });

  const effectiveCycle = extracted.billingCycle ?? existing?.billingCycle ?? null;
  const renewalDate =
    extracted.renewalDate ??
    (effectiveCycle ? calculateNextRenewal(emailDate, effectiveCycle) : null);

  if (!existing) {
    // ── Create ────────────────────────────────────────────────────────────
    const sub = await prisma.subscription.create({
      data: {
        userId,
        provider: extracted.provider,
        status: newStatus,
        startedAt: extracted.startedAt ?? emailDate,
        endedAt: newStatus === SubscriptionStatus.CANCELLED ? emailDate : null,
        amount: extracted.amount,
        currency: extracted.currency,
        billingCycle: effectiveCycle,
        renewalDate,
        planName: extracted.planName,
        lastEmailDate: emailDate,
        needsConfirmation: true,
      },
    });

    if (cls.isBillingEmail && extracted.amount && extracted.amount >= 5) {
      await createPaymentCycle(sub.id, extracted, emailDate, messageId, cls.lifecycleEvent);
    }
    return;
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const update: any = { lastEmailDate: emailDate };

  // Amount: always update from most recent email (oldest→newest processing)
  if (extracted.amount !== null && extracted.amount >= 5) {
    update.amount = extracted.amount;
    update.currency = extracted.currency;
  }

  // Billing cycle: fill if missing
  if (effectiveCycle && !existing.billingCycle) {
    update.billingCycle = effectiveCycle;
  }

  // Plan name: fill if missing
  if (extracted.planName && !existing.planName) {
    update.planName = extracted.planName;
  }

  // Renewal date: always recalculate from latest payment email
  if (renewalDate) update.renewalDate = renewalDate;

  // Status transitions
  if (newStatus === SubscriptionStatus.CANCELLED) {
    update.status  = SubscriptionStatus.CANCELLED;
    update.endedAt = emailDate;
  } else if (newStatus === SubscriptionStatus.PAYMENT_FAILED) {
    update.status = SubscriptionStatus.PAYMENT_FAILED;
  } else if (
    existing.status === SubscriptionStatus.CANCELLED &&
    cls.lifecycleEvent === 'ACTIVE'
  ) {
    update.status  = SubscriptionStatus.ACTIVE;
    update.endedAt = null;
  }

  const sub = await prisma.subscription.update({ where: { id: existing.id }, data: update });

  if (cls.isBillingEmail && extracted.amount && extracted.amount >= 5) {
    await createPaymentCycle(sub.id, extracted, emailDate, messageId, cls.lifecycleEvent);
  }
}

async function createPaymentCycle(
  subscriptionId: string,
  extracted: ReturnType<typeof extractAllSubscriptionData>,
  emailDate: Date,
  messageId: string,
  lifecycleEvent: string | null
): Promise<void> {
  // Deduplicate by emailMessageId
  const exists = await prisma.paymentCycle.findFirst({
    where: { subscriptionId, emailMessageId: messageId },
  });
  if (exists) return;

  await prisma.paymentCycle.create({
    data: {
      subscriptionId,
      amount: extracted.amount!,
      currency: extracted.currency ?? 'INR',
      paymentDate: emailDate,
      status: lifecycleEvent === 'PAYMENT_FAILED' ? 'FAILED' : 'SUCCESS',
      emailMessageId: messageId,
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Main historical scan — provider-first approach
// ─────────────────────────────────────────────────────────────────

export async function runHistoricalScan(userId: string): Promise<void> {
  const gmailAccount = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!gmailAccount) throw new Error('Gmail account not found');

  // Initialize progress for this user
  scanState.set(userId, {
    status: 'running',
    progress: {
      providersTotal: PROVIDER_REGISTRY.length,
      providersScanned: 0,
      currentProvider: '',
      emailsProcessed: 0,
      emailsSkipped: 0
    }
  });

  const afterDate = '2026/01/01'; 

  for (const provider of PROVIDER_REGISTRY) {
    // ── Stop check between providers ─────────────────────────────────────
    if (isStopped()) {
      console.log(`[HistoricalScan] Stop requested — halting before ${provider.name}`);
      const state = scanState.get(userId);
      if (state) state.status = 'stopped';
      return;
    }

    const userProgress = scanState.get(userId);
    userProgress.progress.currentProvider = provider.name;

    await scanProvider(userId, gmailAccount.accessToken, gmailAccount.refreshToken, provider, afterDate);

    userProgress.progress.providersScanned++;
    scanState.set(userId, userProgress);
  }

  await prisma.gmailAccount.update({
    where: { userId },
    data: { historicalScanCompleted: true, lastScannedAt: new Date() },
  });

  scanState.get(userId).status = 'completed';
}