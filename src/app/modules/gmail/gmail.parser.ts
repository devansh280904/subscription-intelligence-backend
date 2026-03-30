// src/app/modules/gmail/gmail.parser.ts
import { parse as parseDate } from 'chrono-node';
import { ProviderConfig } from './gmail.providers';

export interface ExtractedSubscriptionData {
  provider: string;
  amount: number | null;
  currency: string | null;
  billingCycle: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null;
  startedAt: Date | null;
  renewalDate: Date | null;
  trialEndDate: Date | null;
  planName: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Amount extraction
// ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw numeric string to a float.
 * Handles:
 *   "699.00"   → 699    (decimal separator)
 *   "1,234.56" → 1234.56
 *   "1.234,56" → 1234.56 (European)
 *   "1.234"    → 1234   (European thousands)
 */
function parseAmountStr(raw: string): number {
  // European: 1.234,56
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(raw)) {
    return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  }
  // European thousands: 1.234
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    return parseFloat(raw.replace(/\./g, ''));
  }
  // Standard: 1,234.56 or 699.00 or 13,999
  return parseFloat(raw.replace(/,/g, ''));
}

function isRealisticAmount(n: number): boolean {
  return Number.isFinite(n) && n >= 5 && n <= 99_999;
}

/**
 * Score the context window around an amount match.
 * Higher = more likely to be the actual subscription charge.
 *
 * KEY FIX: we now also PENALISE amounts that appear next to
 * "save", "off", "discount", "was", "original price" — those are
 * savings/strike-through prices, not the charged amount.
 */
function scoreContext(text: string, pos: number): number {
  const before = text.slice(Math.max(0, pos - 200), pos).toLowerCase();
  const after  = text.slice(pos, pos + 100).toLowerCase();
  const win    = before + after;

  let s = 0;

  // Strong billing signals
  const STRONG = [
    'total', 'amount charged', 'amount due', 'billed', 'billing amount',
    'subscription', 'renewal', 'charged to', 'payment of', 'invoice total',
    'order total', 'you were charged', "you've been charged", 'receipt',
    'you have been charged', 'we charged', 'your charge',
  ];
  // Medium signals
  const MED = [
    'per month', '/month', '/mo', 'per year', '/year', 'monthly',
    'annually', 'quarterly', 'plan', 'billing cycle',
  ];
  // Negative signals — discount/saving prices are NOT the charge
  const NEG = [
    'save ', 'saving', '% off', 'discount', 'was ₹', 'was $', 'original',
    'strike', 'crossed', 'regular price', 'retail price', 'list price',
    'compare at', 'you save', 'reduced', 'promo',
  ];

  for (const k of STRONG) if (win.includes(k)) s += 3;
  for (const k of MED)    if (win.includes(k)) s += 1;
  for (const k of NEG)    if (win.includes(k)) s -= 4; // hard penalise

  return s;
}

export function extractAmount(text: string): { amount: number | null; currency: string | null } {
  const symMap: Record<string, string> = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  type Cand = { amount: number; currency: string; score: number };
  const cands: Cand[] = [];

  // Symbol + number: ₹649, ₹649.00, $9.99, ₹6,490.00
  const symBefore = /(₹|\$|€|£|¥)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)/g;
  for (const m of [...text.matchAll(symBefore)]) {
    const amt = parseAmountStr(m[2]);
    if (!isRealisticAmount(amt)) continue;
    cands.push({ amount: amt, currency: symMap[m[1]] ?? 'USD', score: scoreContext(text, m.index ?? 0) });
  }

  // Code before: INR 649, USD 9.99
  const codeBefore = /\b(USD|EUR|GBP|INR|CAD|AUD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)/gi;
  for (const m of [...text.matchAll(codeBefore)]) {
    const amt = parseAmountStr(m[2]);
    if (!isRealisticAmount(amt)) continue;
    cands.push({ amount: amt, currency: m[1].toUpperCase(), score: scoreContext(text, m.index ?? 0) });
  }

  // Code after: 649 INR, 9.99 USD
  const codeAfter = /\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)\s*(USD|EUR|GBP|INR|CAD|AUD)\b/gi;
  for (const m of [...text.matchAll(codeAfter)]) {
    const amt = parseAmountStr(m[1]);
    if (!isRealisticAmount(amt)) continue;
    cands.push({ amount: amt, currency: m[2].toUpperCase(), score: scoreContext(text, m.index ?? 0) });
  }

  if (cands.length === 0) return { amount: null, currency: null };

  // Drop candidates with strongly negative scores (discount prices, etc.)
  const positive = cands.filter(c => c.score > -2);
  const pool     = positive.length > 0 ? positive : cands;

  // Best: highest context score; ties broken by highest amount
  pool.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return { amount: pool[0].amount, currency: pool[0].currency };
}

// ─────────────────────────────────────────────────────────────────
// Billing cycle
// ─────────────────────────────────────────────────────────────────

export function extractBillingCycle(
  text: string,
  providerDefault?: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY'
): 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null {
  const t = text.toLowerCase();

  // Yearly patterns — check before monthly to catch "12-month plan"
  const yearly = [
    'yearly', 'annually', 'per year', '/year', '/yr', 'annual',
    'billed yearly', 'billed annually', 'every year', '12 months',
    'twelve months', '1 year', 'one year', 'annual plan', 'annual membership',
    '12-month', 'year subscription',
  ];
  const quarterly = ['quarterly', 'per quarter', 'every 3 months', '3-month', '3 months', 'three months'];
  const monthly   = [
    'monthly', 'per month', '/month', '/mo.', '/mo ', 'billed monthly',
    'every month', '1 month', '1-month', 'monthly plan', 'monthly membership',
    'month subscription',
  ];
  const weekly = ['weekly', 'per week', '/week', 'every week', '1 week'];

  for (const k of yearly)    if (t.includes(k)) return 'YEARLY';
  for (const k of quarterly) if (t.includes(k)) return 'QUARTERLY';
  for (const k of monthly)   if (t.includes(k)) return 'MONTHLY';
  for (const k of weekly)    if (t.includes(k)) return 'WEEKLY';

  return providerDefault ?? null;
}

// ─────────────────────────────────────────────────────────────────
// Plan name — strict whitelist
// ─────────────────────────────────────────────────────────────────

const PLAN_TIERS = [
  'premium', 'pro', 'basic', 'standard', 'plus', 'individual',
  'ultra', 'hd', 'ultra hd', '4k', 'mobile', 'essentials',
  'business', 'enterprise', 'teams', 'starter', 'lite', 'family',
  'student', 'duo', 'trio',
];

export function extractPlanName(text: string): string | null {
  // "Plan: Premium Individual" label
  const label = text.match(
    /(?:plan|subscription|membership)\s*[:\-–]\s*([A-Za-z0-9\s]{2,40}?)(?:\n|$|,|\.|;)/i
  );
  if (label) {
    const name = label[1].trim();
    if (PLAN_TIERS.some(t => name.toLowerCase().includes(t))) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  // Tier word in natural context
  const tierRx = new RegExp(
    `\\b(${PLAN_TIERS.join('|')})\\b(?:\\s+(?:plan|subscription|membership))?`, 'i'
  );
  const m = text.match(tierRx);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Date validation
// ─────────────────────────────────────────────────────────────────

export function isValidSubscriptionDate(date: Date | null): boolean {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return false;
  const now    = new Date();
  const past   = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  const future = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
  return date >= past && date <= future;
}

// ─────────────────────────────────────────────────────────────────
// Date extraction
// ─────────────────────────────────────────────────────────────────

export function extractSubscriptionDates(body: string, emailDate?: string | null) {
  let startedAt:    Date | null = null;
  let renewalDate:  Date | null = null;
  let trialEndDate: Date | null = null;

  const tryParse = (s: string): Date | null => {
    // Strip leading/trailing noise
    const cleaned = s.replace(/^(?:on|at|by)\s+/i, '').trim();
    try {
      const r = parseDate(cleaned);
      if (r?.length > 0) {
        const d = r[0].start.date();
        return isValidSubscriptionDate(d) ? d : null;
      }
    } catch { /* ignore */ }
    return null;
  };

  const renewalPats = [
    /(?:next billing|next payment|will be charged|will renew)(?:\s+on|\s+date)?:?\s*([^.\n]{5,35})/gi,
    /(?:renew|renewal)\s+(?:date|on)?:?\s*([^.\n]{5,35})/gi,
    /(?:subscription|membership)\s+(?:renews|ends)\s+(?:on\s+)?([^.\n]{5,35})/gi,
    /auto-renews?\s+on\s+([^.\n]{5,35})/gi,
    /billed\s+(?:again\s+)?on\s+([^.\n]{5,35})/gi,
    /charged\s+on\s+([^.\n]{5,35})/gi,
    /next\s+charge\s+(?:date|on)?:?\s*([^.\n]{5,35})/gi,
    /valid\s+(?:until|through)\s+([^.\n]{5,35})/gi,
  ];

  const trialPats = [
    /trial\s+ends?\s+(?:on\s+)?([^.\n]{5,35})/gi,
    /free\s+(?:trial\s+)?(?:ends|until)\s+([^.\n]{5,35})/gi,
    /trial\s+period\s+ends?\s+(?:on\s+)?([^.\n]{5,35})/gi,
  ];

  const startPats = [
    /(?:subscription|membership|plan)\s+(?:started|began|active\s+since)\s+([^.\n]{5,35})/gi,
    /(?:joined|subscribed|signed up)\s+(?:on\s+)?([^.\n]{5,35})/gi,
    /(?:start\s+date|started\s+on):?\s*([^.\n]{5,35})/gi,
  ];

  for (const p of renewalPats) {
    for (const m of [...body.matchAll(p)]) {
      const d = tryParse(m[1]);
      if (d) { renewalDate = d; break; }
    }
    if (renewalDate) break;
  }

  for (const p of trialPats) {
    for (const m of [...body.matchAll(p)]) {
      const d = tryParse(m[1]);
      if (d) { trialEndDate = d; break; }
    }
    if (trialEndDate) break;
  }

  for (const p of startPats) {
    for (const m of [...body.matchAll(p)]) {
      const d = tryParse(m[1]);
      if (d) { startedAt = d; break; }
    }
    if (startedAt) break;
  }

  // Fallback: use email date as startedAt
  if (!startedAt && emailDate) {
    try {
      const d = new Date(emailDate);
      if (isValidSubscriptionDate(d)) startedAt = d;
    } catch { /* ignore */ }
  }

  return { startedAt, renewalDate, trialEndDate };
}

// ─────────────────────────────────────────────────────────────────
// Main entry point — provider-aware
// ─────────────────────────────────────────────────────────────────

export function extractAllSubscriptionData(
  providerConfig: ProviderConfig,
  body: string,
  pdfText: string,
  emailDate?: string | null
): ExtractedSubscriptionData {
  const fullText = `${body}\n${pdfText}`;

  const { amount, currency } = extractAmount(fullText);
  const billingCycle = extractBillingCycle(fullText, providerConfig.defaultCycle);
  const { startedAt, renewalDate, trialEndDate } = extractSubscriptionDates(fullText, emailDate);
  const planName = extractPlanName(fullText);

  const result: ExtractedSubscriptionData = {
    provider: providerConfig.name,
    amount,
    currency,
    billingCycle,
    startedAt,
    renewalDate,
    trialEndDate,
    planName,
  };

  console.log('[Parser]', providerConfig.name, {
    amount, currency, billingCycle, planName,
    startedAt: startedAt?.toISOString(),
    renewalDate: renewalDate?.toISOString(),
  });

  return result;
}