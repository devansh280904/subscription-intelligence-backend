import { fetchGmailMessageContent } from './gmail.scanner';
import { extractAllSubscriptionData, isValidSubscriptionDate } from './gmail.parser';
import { classifySubscriptionEmail } from './gmail.classifier';
import { detectProvider } from './gmail.providers';
import prisma from '../../config/prisma';
import { SubscriptionStatus } from '@prisma/client';

export function calculateNextRenewal(
  lastPaymentDate: Date,
  billingCycle: string | null
): Date | null {
  if (!billingCycle) return null;

  const d = new Date(lastPaymentDate.getTime());

  try {
    switch (billingCycle) {
      case 'MONTHLY': {
        const t = d.getMonth() + 1;
        d.setMonth(t);
        if (d.getMonth() !== t % 12) d.setDate(0);
        break;
      }
      case 'YEARLY':
        d.setFullYear(d.getFullYear() + 1);
        break;
      case 'QUARTERLY': {
        const t = d.getMonth() + 3;
        d.setMonth(t);
        if (d.getMonth() !== t % 12) d.setDate(0);
        break;
      }
      case 'WEEKLY':
        d.setDate(d.getDate() + 7);
        break;
      default:
        return null;
    }

    return isValidSubscriptionDate(d) ? d : null;
  } catch {
    return null;
  }
}

export async function processSubscriptionEmail(
  userId: string,
  messageId: string,
  fromHeader: string | null,
  accessToken: string,
  refreshToken: string,
  lifecycleEvent?: SubscriptionStatus,
  emailDate?: string | null
) {
  console.log('[Worker] Processing:', messageId);

  const providerConfig = detectProvider(fromHeader);
  if (!providerConfig) {
    console.log('[Worker] Unknown provider, skipping:', fromHeader);
    return;
  }

  const { bodyText, pdfText } = await fetchGmailMessageContent(
    accessToken,
    refreshToken,
    messageId
  );

  const cls = classifySubscriptionEmail(
    { from: fromHeader, subject: null },
    bodyText
  );

  if (!cls.isSubscriptionEmail) {
    console.log('[Worker] Not subscription email:', cls.reasons[0]);
    return;
  }

  const extracted = extractAllSubscriptionData(
    providerConfig,
    bodyText,
    pdfText,
    emailDate
  );

  let emailDateParsed: Date | null = null;
  if (emailDate) {
    try {
      const d = new Date(emailDate);
      if (isValidSubscriptionDate(d)) emailDateParsed = d;
    } catch {}
  }

  const now = new Date();

  const finalLifecycle: SubscriptionStatus =
    lifecycleEvent ??
    (cls.lifecycleEvent as SubscriptionStatus) ??
    SubscriptionStatus.ACTIVE;

  const existing = await prisma.subscription.findUnique({
    where: { userId_provider: { userId, provider: extracted.provider } },
    include: {
      paymentCycles: { orderBy: { paymentDate: 'desc' }, take: 1 },
    },
  });

  let finalStartedAt = existing?.startedAt ?? null;
  if (!finalStartedAt && finalLifecycle === SubscriptionStatus.ACTIVE) {
    finalStartedAt =
      extracted.startedAt && isValidSubscriptionDate(extracted.startedAt)
        ? extracted.startedAt
        : emailDateParsed ?? now;
  }

  let finalStatus: SubscriptionStatus = finalLifecycle;
  let finalEndedAt = existing?.endedAt ?? null;

  if (
    finalLifecycle === SubscriptionStatus.CANCELLED &&
    !finalEndedAt
  ) {
    finalStatus = SubscriptionStatus.CANCELLED;
    finalEndedAt = emailDateParsed ?? now;
  }

  const finalAmount: number | null =
    extracted.amount !== null && extracted.amount >= 5
      ? extracted.amount
      : existing?.amount ?? null;

  const finalCurrency = extracted.currency ?? existing?.currency ?? null;
  const finalCycle =
    extracted.billingCycle ?? existing?.billingCycle ?? null;

  const finalRenewalDate =
    extracted.renewalDate ??
    (emailDateParsed && finalCycle
      ? calculateNextRenewal(emailDateParsed, finalCycle)
      : null) ??
    existing?.renewalDate ??
    null;

  const subscription = await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.upsert({
      where: { userId_provider: { userId, provider: extracted.provider } },
      update: {
        status: finalStatus,
        endedAt: finalEndedAt,
        amount: finalAmount,
        currency: finalCurrency,
        billingCycle: finalCycle,
        renewalDate: finalRenewalDate,
        planName: extracted.planName ?? existing?.planName,
        lastEmailDate: emailDateParsed ?? undefined,
        needsConfirmation: true,
      },
      create: {
        userId,
        provider: extracted.provider,
        status: finalStatus,
        startedAt: finalStartedAt,
        endedAt: finalEndedAt,
        amount: finalAmount,
        currency: finalCurrency,
        billingCycle: finalCycle,
        renewalDate: finalRenewalDate,
        planName: extracted.planName,
        lastEmailDate: emailDateParsed ?? undefined,
        needsConfirmation: true,
      },
    });

    if (emailDateParsed && cls.isBillingEmail) {
      const amountToSave: number =
        finalAmount ?? existing?.amount ?? 0;

      const window = 3 * 24 * 60 * 60 * 1000;

      const dupe = await tx.paymentCycle.findFirst({
        where: {
          subscriptionId: sub.id,
          paymentDate: {
            gte: new Date(emailDateParsed.getTime() - window),
            lte: new Date(emailDateParsed.getTime() + window),
          },
        },
      });

      if (!dupe) {
        await tx.paymentCycle.create({
          data: {
            subscriptionId: sub.id,
            amount: amountToSave,
            currency: finalCurrency ?? 'INR',
            paymentDate: emailDateParsed,
            emailMessageId: messageId,
            status:
              finalLifecycle === SubscriptionStatus.PAYMENT_FAILED
                ? 'FAILED'
                : 'SUCCESS',
          },
        });
      }
    }

    return sub;
  });

  console.log('[Worker] Done:', extracted.provider, finalStatus);
}

export async function checkAndUpdateRenewal(
  userId: string,
  provider: string,
  newPaymentDate: Date
) {
  const sub = await prisma.subscription.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  if (!sub) return;

  const nextRenewal = calculateNextRenewal(
    newPaymentDate,
    sub.billingCycle
  );

  const data: any = { renewalDate: nextRenewal };

  if (sub.status === SubscriptionStatus.CANCELLED) {
    data.status = SubscriptionStatus.ACTIVE;
    data.endedAt = null;
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data,
  });
}