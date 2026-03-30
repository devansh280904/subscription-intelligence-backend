// src/app/modules/gmail/gmail.classifier.ts
import { detectProvider, ProviderConfig } from './gmail.providers';

export interface EmailHeaders {
  from: string | null;
  subject: string | null;
}

export interface ClassificationResult {
  isSubscriptionEmail: boolean;
  isBillingEmail: boolean;
  lifecycleEvent: 'ACTIVE' | 'CANCELLED' | 'PAYMENT_FAILED' | 'TRIAL_ENDING' | 'RENEWAL_REMINDER' | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  provider: ProviderConfig | null;
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────
// Keyword lists
// ─────────────────────────────────────────────────────────────────

const SECURITY_KW = [
  'sign-in code', 'security code', 'verification code', 'one-time password',
  'otp', 'new device', 'unusual activity', 'password reset', 'login alert',
  'two-factor', '2-step', 'enter this code', 'confirm your email',
  'verify your email', 'suspicious activity', 'reset your password',
  'sign in from', 'new sign-in', 'account was used to sign in',
];

// Non-billing patterns — extended to silence Apple/Amazon marketing noise
const NON_BILLING_KW = [
  // shipping
  'your order', 'has shipped', 'out for delivery', 'delivered',
  'track your package', 'estimated delivery', 'items ordered',
  // marketing
  'new feature', "what's new", 'tips for', 'getting started',
  'you might like', 'watch now', 'limited time offer',
  // onboarding — catches most Apple non-billing emails
  'welcome to icloud', 'welcome to the app store', 'welcome to apple music',
  'welcome to apple one', 'welcome to apple tv',
  "here's how to get started", 'store, share and protect',
  // account management (not billing)
  'your account information has been updated',
  'your apple account information',
  'your recent download',
  'storage is almost full',    // storage warning ≠ billing
  'you have used over',        // storage usage warning ≠ billing
  // prime marketing (not a receipt)
  'join prime', 'join amazon prime',
  // promotional trial offers
  'start your free', 'you just got',
  'buzzworthy hits', 'explore now',
];

const BILLING_CONFIRMATION_KW = [
  'your receipt', 'payment confirmation', 'payment received',
  'payment successful', 'payment processed', 'you have been charged',
  "you've been charged", 'we charged', 'amount charged', 'total charged',
  'invoice', 'order total', 'billing confirmation', 'subscription renewed',
  'subscription confirmed', 'membership renewed', 'thank you for your payment',
  'your purchase', 'your subscription receipt', 'charge of',
  // Apple
  'your receipt from apple', 'apple id receipt',
  // Google
  'your google play receipt', 'your google play order',
  // Generic
  'subscription is confirmed', 'your subscription is active',
  'payment was successful', 'successfully charged',
  'billing summary', 'statement',
];

const CANCELLATION_KW = [
  'subscription cancelled', 'subscription canceled',
  'membership cancelled', 'membership canceled',
  'has been cancelled', 'has been canceled',
  'you have cancelled', 'you have canceled',
  "you've cancelled", "you've canceled",
  'will not renew', 'will not be renewed',
  'auto-renew turned off', 'auto-renewal turned off',
  'auto-renewal has been disabled',
  'we have canceled your', "we've canceled your",
  'your subscription has ended', 'your membership has ended',
  'cancellation confirmation', 'successfully cancelled',
  'successfully canceled', 'your plan has been cancelled',
  'your plan has been canceled',
];

const PAYMENT_FAILED_KW = [
  'payment failed', 'payment was declined', 'payment unsuccessful',
  'card declined', 'could not process payment', 'unable to process payment',
  'billing issue', 'billing problem', 'update your payment method',
  'unable to charge', 'transaction failed', 'payment not processed',
  'payment could not be completed', 'insufficient funds',
  'payment method was declined', 'retry your payment', 'past due',
];

const TRIAL_KW = [
  'trial ends', 'trial ending', 'free trial expires',
  'trial expires', 'trial period ends', 'your trial will end',
  'trial is ending', 'trial ends soon', 'days left in your trial',
];

const RENEWAL_REMINDER_KW = [
  'will renew', 'renews on', 'upcoming renewal', 'renewal reminder',
  'auto-renew', 'will be charged', 'next billing date', 'next payment',
  'your plan renews', 'subscription renews', 'billed on',
];

// ─────────────────────────────────────────────────────────────────
// Main classifier
// ─────────────────────────────────────────────────────────────────

export function classifySubscriptionEmail(
  headers: EmailHeaders,
  body?: string
): ClassificationResult {
  const subjectLower = (headers.subject || '').toLowerCase();
  const bodyLower    = (body || '').toLowerCase();
  // Give subject 3× weight — subject line is the strongest signal
  const text = `${subjectLower} ${subjectLower} ${subjectLower} ${bodyLower}`;

  // ── Step 1: Must be from a known provider ────────────────────────────────
  const provider = detectProvider(headers.from);
  if (!provider) {
    return {
      isSubscriptionEmail: false, isBillingEmail: false,
      lifecycleEvent: null, confidence: 'HIGH', provider: null,
      reasons: ['Sender not in known provider registry'],
    };
  }

  // ── Step 2: Reject security / OTP emails ─────────────────────────────────
  for (const k of SECURITY_KW) {
    if (text.includes(k)) {
      return {
        isSubscriptionEmail: false, isBillingEmail: false,
        lifecycleEvent: null, confidence: 'HIGH', provider,
        reasons: [`Security/OTP email: "${k}"`],
      };
    }
  }

  // ── Step 3: Check billing signals first, then reject non-billing ──────────
  let billingHits = 0;
  for (const k of BILLING_CONFIRMATION_KW) if (text.includes(k)) billingHits++;

  let nonBillingHits = 0;
  for (const k of NON_BILLING_KW) if (text.includes(k)) nonBillingHits++;

  // Only reject if non-billing signal present AND no billing signals override
  if (nonBillingHits >= 1 && billingHits === 0) {
    return {
      isSubscriptionEmail: false, isBillingEmail: false,
      lifecycleEvent: null, confidence: 'HIGH', provider,
      reasons: [`Marketing/onboarding/shipping email from provider`],
    };
  }

  // ── Step 4: Lifecycle detection — most specific first ────────────────────

  for (const k of CANCELLATION_KW) {
    if (text.includes(k)) {
      return {
        isSubscriptionEmail: true, isBillingEmail: false,
        lifecycleEvent: 'CANCELLED', confidence: 'HIGH', provider,
        reasons: [`Cancellation: "${k}"`],
      };
    }
  }

  for (const k of PAYMENT_FAILED_KW) {
    if (text.includes(k)) {
      return {
        isSubscriptionEmail: true, isBillingEmail: false,
        lifecycleEvent: 'PAYMENT_FAILED', confidence: 'HIGH', provider,
        reasons: [`Payment failed: "${k}"`],
      };
    }
  }

  for (const k of TRIAL_KW) {
    if (text.includes(k)) {
      return {
        isSubscriptionEmail: true, isBillingEmail: false,
        lifecycleEvent: 'TRIAL_ENDING', confidence: 'HIGH', provider,
        reasons: [`Trial ending: "${k}"`],
      };
    }
  }

  if (billingHits > 0) {
    return {
      isSubscriptionEmail: true, isBillingEmail: true,
      lifecycleEvent: 'ACTIVE', confidence: 'HIGH', provider,
      reasons: [`Billing confirmation (${billingHits} signal(s))`],
    };
  }

  for (const k of RENEWAL_REMINDER_KW) {
    if (text.includes(k)) {
      return {
        isSubscriptionEmail: true, isBillingEmail: false,
        lifecycleEvent: 'RENEWAL_REMINDER', confidence: 'MEDIUM', provider,
        reasons: [`Renewal reminder: "${k}"`],
      };
    }
  }

  // Currency in provider email = likely billing
  if (/[₹$€£¥]\s*\d/.test(text)) {
    return {
      isSubscriptionEmail: true, isBillingEmail: true,
      lifecycleEvent: 'ACTIVE', confidence: 'MEDIUM', provider,
      reasons: ['From known provider with currency amount'],
    };
  }

  // Provider email, no signal — track but LOW confidence, no payment cycles
  return {
    isSubscriptionEmail: true, isBillingEmail: false,
    lifecycleEvent: 'ACTIVE', confidence: 'LOW', provider,
    reasons: ['From known provider, no specific billing signal'],
  };
}