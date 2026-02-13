import { 
  CANCELLATION_KEYWORDS, 
  CONFIRMATION_KEYWORDS, 
  TRIAL_ENDING_KEYWORDS,
  NEGATIVE_KEYWORDS, 
  PAYMENT_FAILED_KEYWORDS, 
  PLAN_LIFECYCLE_KEYWORDS, 
  POSITIVE_KEYWORDS, 
  SECURITY_KEYWORDS } from "./gmail.rules";

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


// expects headers to match the EmailHeaders type
// returns a value that matches the ClassificationResult type
export function classifySubscriptionEmail(
  headers: EmailHeaders,
  body?: string
): ClassificationResult {
  const from = (headers.from || '').toLowerCase();
  const subject = (headers.subject || '').toLowerCase();
  const text = `${subject} ${body || ''}`.toLowerCase();
  
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


  // tiral ending
  for (const k of TRIAL_ENDING_KEYWORDS) {
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

  // 🧠 Known subscription providers
  const knownProviders = [
    'netflix',
    'spotify',
    'google play',
    'apple',
    'adobe',
    'notion',
    'github',
    'canva',
    'figma',
    'aws',
    'azure',
    'linkedin',
    'youtube',
    'discord',
    'dropbox',
    'zoom',
    'microsoft',
    'chatgpt',
    'openai',
  ];

  if (knownProviders.some((p) => from.includes(p) || text.includes(p))) {
    score += 4;
    reasons.push('Known subscription provider');
  }

  // 💰 Currency/amount detection (good signal)
  const hasCurrency = /[$€£¥₹]\s*\d+/.test(text);
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
