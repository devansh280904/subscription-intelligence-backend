import {
  CANCELLATION_KEYWORDS,
  CONFIRMATION_KEYWORDS,
  NEGATIVE_KEYWORDS,
  PAYMENT_FAILED_KEYWORDS,
  PLAN_LIFECYCLE_KEYWORDS,
  POSITIVE_KEYWORDS,
  SECURITY_KEYWORDS,
} from './gmail.rules';

export interface EmailHeaders {
  from: string | null;
  subject: string | null;
}

export interface ClassificationResult {
  isSubscriptionCandidate: boolean;
  score: number;
  reasons: string[];
  lifecycleEvent?: 'ACTIVE' | 'CANCELLED' | 'PAYMENT_FAILED' | 'TRIAL_ENDING';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * CRITICAL FIX: Verify email is FROM the provider, not just mentioning them
 */
function isFromProvider(fromHeader: string | null, body: string): boolean {
  if (!fromHeader) return false;
  
  const from = fromHeader.toLowerCase();
  
  // List of known subscription provider domains
  const providerDomains = [
    'netflix.com',
    'nflx.net',
    'linkedin.com',
    'spotify.com',
    'apple.com',
    'openai.com',
    'adobe.com',
    'notion.so',
    'github.com',
    'microsoft.com',
    'google.com',
    'amazon.com',
    'primevideo.com',
    'youtube.com',
    'disney',
    'hulu.com',
    'hbomax.com',
    'canva.com',
    'figma.com',
    'dropbox.com',
    'zoom.us',
  ];
  
  // Email must be FROM a provider domain
  for (const domain of providerDomains) {
    if (from.includes(domain)) {
      return true;
    }
  }
  
  return false;
}

export function classifySubscriptionEmail(
  headers: EmailHeaders,
  body?: string
): ClassificationResult {
  const from = (headers.from || '').toLowerCase();
  const subject = (headers.subject || '').toLowerCase();
  const text = `${subject} ${body || ''}`.toLowerCase();

  // 🔴 CRITICAL FIX: Reject if not from a known provider
  if (!isFromProvider(headers.from, body || '')) {
    return {
      isSubscriptionCandidate: false,
      score: -100,
      reasons: ['Email not from a known subscription provider'],
      confidence: 'HIGH',
    };
  }

  // 🟢 Confirmation detection (highest priority)
  for (const k of CONFIRMATION_KEYWORDS) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: true,
        score: 15,
        reasons: ['Subscription confirmation detected'],
        lifecycleEvent: 'ACTIVE',
        confidence: 'HIGH',
      };
    }
  }

  // 🔴 Cancellation detection
  for (const k of CANCELLATION_KEYWORDS) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: true,
        score: 12,
        reasons: ['Cancellation detected'],
        lifecycleEvent: 'CANCELLED',
        confidence: 'HIGH',
      };
    }
  }

  // 🟠 Payment failure detection
  for (const k of PAYMENT_FAILED_KEYWORDS) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: true,
        score: 10,
        reasons: ['Payment failure detected'],
        lifecycleEvent: 'PAYMENT_FAILED',
        confidence: 'HIGH',
      };
    }
  }

  // 🟡 Trial ending detection
  const trialEndingKeywords = [
    'trial ends',
    'trial ending',
    'free trial expires',
    'trial expires',
    'trial period ends',
  ];

  for (const k of trialEndingKeywords) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: true,
        score: 9,
        reasons: ['Trial ending detected'],
        lifecycleEvent: 'TRIAL_ENDING',
        confidence: 'HIGH',
      };
    }
  }

  let score = 0;
  const reasons: string[] = [];

  // ❌ Strong negatives → instant reject
  for (const k of NEGATIVE_KEYWORDS.strong) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: false,
        score: -100,
        reasons: ['Authentication or security email'],
        confidence: 'HIGH',
      };
    }
  }

  for (const k of SECURITY_KEYWORDS) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: false,
        score: -100,
        reasons: ['Security / authentication email'],
        confidence: 'HIGH',
      };
    }
  }

  for (const k of NEGATIVE_KEYWORDS.commerce) {
    if (text.includes(k)) {
      return {
        isSubscriptionCandidate: false,
        score: -50,
        reasons: ['One-time commerce / booking email'],
        confidence: 'HIGH',
      };
    }
  }

  // ✅ Plan lifecycle signals
  for (const k of PLAN_LIFECYCLE_KEYWORDS) {
    if (text.includes(k)) {
      score += 4;
      reasons.push(`Plan lifecycle signal: ${k}`);
    }
  }

  // ✅ Strong positives
  for (const k of POSITIVE_KEYWORDS.strong) {
    if (text.includes(k)) {
      score += 5;
      reasons.push(`Strong subscription signal: ${k}`);
    }
  }

  // ✅ Medium positives
  for (const k of POSITIVE_KEYWORDS.medium) {
    if (text.includes(k)) {
      score += 2;
      reasons.push(`Subscription keyword: ${k}`);
    }
  }

  // ⚠️ Weak positives
  for (const k of POSITIVE_KEYWORDS.weak) {
    if (text.includes(k)) {
      score += 1;
    }
  }

  // 🧠 Verified from known provider - already checked above
  score += 4;
  reasons.push('From verified subscription provider');

  // 💰 Currency/amount detection (good signal)
  const hasCurrency = /[₹$€£¥]\s*\d+/.test(text);
  if (hasCurrency) {
    score += 2;
    reasons.push('Contains pricing information');
  }

  // 📅 Renewal date patterns
  const hasRenewalDate =
    /renew(?:s|al)?\s+(?:on|date)/.test(text) ||
    /next\s+billing/.test(text) ||
    /(?:will\s+be\s+)?charged\s+on/.test(text);

  if (hasRenewalDate) {
    score += 3;
    reasons.push('Contains renewal date information');
  }

  const isCandidate = score >= 5;

  // Determine confidence
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 10) {
    confidence = 'HIGH';
  } else if (score >= 6) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    isSubscriptionCandidate: isCandidate,
    score,
    reasons,
    lifecycleEvent: isCandidate ? 'ACTIVE' : undefined,
    confidence,
  };
}

// Helper to determine if email needs body fetching
export function shouldFetchBody(headerClassification: ClassificationResult): boolean {
  // Always fetch body for borderline cases
  if (
    headerClassification.score >= 2 &&
    headerClassification.score < 6 &&
    headerClassification.confidence === 'LOW'
  ) {
    return true;
  }

  // Don't fetch if definitely not a subscription
  if (headerClassification.score < 0) {
    return false;
  }

  // Don't fetch if we're very confident it's a subscription
  if (headerClassification.score >= 10 && headerClassification.confidence === 'HIGH') {
    return false;
  }

  return false;
}