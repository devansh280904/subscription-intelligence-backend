import { parse as parseDate } from 'chrono-node';

export interface ExtractedSubscriptionData {
  provider: string | null;
  amount: number | null;
  currency: string | null;
  billingCycle: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null;
  startedAt: Date | null;
  renewalDate: Date | null;
  trialEndDate: Date | null;
  planName: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  extractionNotes: string[];
}

// Known pricing for validation
const KNOWN_PRICING: Record<string, {
  minAmount: number;
  maxAmount: number;
  typical: number;
  currency: string;
  cycle: 'MONTHLY' | 'YEARLY';
}> = {
  'LinkedIn': { minAmount: 1500, maxAmount: 5000, typical: 1650, currency: 'INR', cycle: 'MONTHLY' },
  'Netflix': { minAmount: 150, maxAmount: 800, typical: 649, currency: 'INR', cycle: 'MONTHLY' },
  'ChatGPT Plus': { minAmount: 300, maxAmount: 500, typical: 399, currency: 'INR', cycle: 'MONTHLY' },
  'Spotify': { minAmount: 99, maxAmount: 200, typical: 119, currency: 'INR', cycle: 'MONTHLY' },
  'Apple': { minAmount: 99, maxAmount: 500, typical: 99, currency: 'INR', cycle: 'MONTHLY' },
  'Amazon Prime': { minAmount: 1400, maxAmount: 1600, typical: 1499, currency: 'INR', cycle: 'YEARLY' },
  'YouTube Premium': { minAmount: 100, maxAmount: 300, typical: 149, currency: 'INR', cycle: 'MONTHLY' },
  'Microsoft 365': { minAmount: 400, maxAmount: 800, typical: 489, currency: 'INR', cycle: 'MONTHLY' },
  'Canva': { minAmount: 400, maxAmount: 800, typical: 500, currency: 'INR', cycle: 'MONTHLY' },
  'Notion': { minAmount: 300, maxAmount: 600, typical: 400, currency: 'INR', cycle: 'MONTHLY' },
};

export function extractProviderName(fromHeader: string | null, body: string): string | null {
  const from = (fromHeader || '').toLowerCase();
  const bodyLower = body.toLowerCase();

  const providerMap: Record<string, string[]> = {
    'Netflix': ['netflix.com', 'netflix', '@nflx'],
    'LinkedIn': ['linkedin.com', 'linkedin'],
    'Spotify': ['spotify.com', 'spotify'],
    'Amazon Prime': ['primevideo.com', 'amazon.com/prime', 'amazon prime'],
    'Google Play': ['google play', 'play.google.com'],
    'Apple': ['apple.com', 'icloud.com', 'itunes', 'apple.com/bill'],
    'Adobe': ['adobe.com', 'adobe'],
    'Notion': ['notion.so', 'notion'],
    'GitHub': ['github.com', 'github'],
    'YouTube Premium': ['youtube.com', 'youtube premium', 'youtube music'],
    'Disney+': ['disneyplus.com', 'disney+', 'disney plus'],
    'Hulu': ['hulu.com', 'hulu'],
    'HBO Max': ['hbomax.com', 'hbo max'],
    'Canva': ['canva.com', 'canva'],
    'Figma': ['figma.com', 'figma'],
    'Dropbox': ['dropbox.com', 'dropbox'],
    'Microsoft 365': ['microsoft.com', 'microsoft 365', 'office 365'],
    'Zoom': ['zoom.us', 'zoom'],
    'ChatGPT Plus': ['openai.com', 'chatgpt', 'chat.openai.com'],
    'AWS': ['aws.amazon.com', 'amazon web services'],
    'Google Workspace': ['workspace.google.com', 'google workspace'],
    'Postman': ['postman.com', 'getpostman.com'],
  };

  for (const [provider, keywords] of Object.entries(providerMap)) {
    for (const keyword of keywords) {
      if (from.includes(keyword) || bodyLower.includes(keyword)) {
        return provider;
      }
    }
  }

  // Extract from email domain
  const emailMatch = from.match(/@([a-z0-9-]+)\./);
  if (emailMatch) {
    const domain = emailMatch[1];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  return null;
}

// Enhanced amount extraction with context awareness
export function extractAmount(text: string): { 
  amount: number | null; 
  currency: string | null;
  context: string;
} {
  const patterns = [
    // High confidence - near subscription keywords
    { 
      regex: /(?:subscription|plan|membership).*?₹\s*(\d{1,5}(?:\.\d{2})?)/gi, 
      confidence: 'HIGH',
      context: 'subscription context'
    },
    // Medium confidence - with billing keywords
    { 
      regex: /(?:total|amount|price|charged|billed).*?₹\s*(\d{1,5}(?:\.\d{2})?)/gi, 
      confidence: 'MEDIUM',
      context: 'billing context'
    },
    // With frequency
    { 
      regex: /₹\s*(\d{1,5}(?:\.\d{2})?)\s*(?:per month|\/month|monthly|per year|\/year)/gi, 
      confidence: 'HIGH',
      context: 'with frequency'
    },
    // Currency code patterns
    { 
      regex: /INR\s*(\d{1,5}(?:\.\d{2})?)/gi, 
      confidence: 'MEDIUM',
      context: 'currency code'
    },
    // Fallback - any rupee amount
    { 
      regex: /₹\s*(\d{1,5}(?:\.\d{2})?)/g, 
      confidence: 'LOW',
      context: 'generic amount'
    },
  ];

  const foundAmounts: Array<{ amount: number; context: string; confidence: string }> = [];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      const amount = parseFloat(match[1].replace(',', '.'));
      
      // Filter unrealistic amounts
      if (amount >= 1 && amount <= 10000) {
        foundAmounts.push({ 
          amount, 
          context: pattern.context,
          confidence: pattern.confidence
        });
      }
    }
  }

  // Prefer HIGH confidence amounts
  const highConf = foundAmounts.filter(a => a.confidence === 'HIGH');
  if (highConf.length > 0) {
    return { 
      amount: highConf[0].amount, 
      currency: 'INR',
      context: highConf[0].context
    };
  }

  // Then MEDIUM
  const medConf = foundAmounts.filter(a => a.confidence === 'MEDIUM');
  if (medConf.length > 0) {
    return { 
      amount: medConf[0].amount, 
      currency: 'INR',
      context: medConf[0].context
    };
  }

  // Finally LOW (but prefer higher amounts as likely subscription cost)
  if (foundAmounts.length > 0) {
    const sorted = foundAmounts.sort((a, b) => b.amount - a.amount);
    return { 
      amount: sorted[0].amount, 
      currency: 'INR',
      context: sorted[0].context
    };
  }

  return { amount: null, currency: null, context: 'none' };
}

// Enhanced billing cycle detection
export function extractBillingCycle(text: string): 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null {
  const textLower = text.toLowerCase();

  // Look for explicit patterns
  const patterns = {
    MONTHLY: [
      /(?:₹\s*\d+.*?(?:per month|\/month|monthly|month))/i,
      /(?:billed|charged|renews?)\s+(?:every\s+)?month/i,
      /monthly\s+(?:subscription|plan|membership)/i,
    ],
    YEARLY: [
      /(?:₹\s*\d+.*?(?:per year|\/year|yearly|annual))/i,
      /(?:billed|charged|renews?)\s+(?:every\s+)?year/i,
      /(?:annual|yearly)\s+(?:subscription|plan|membership)/i,
    ],
    QUARTERLY: [
      /(?:quarterly|every\s+3\s+months|per quarter)/i,
    ],
    WEEKLY: [
      /(?:weekly|per week|every week)/i,
    ],
  };

  for (const [cycle, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      if (regex.test(textLower)) {
        return cycle as 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY';
      }
    }
  }

  return null;
}

// Enhanced date extraction
export function extractSubscriptionDates(
  body: string,
  emailDate?: string | null
): {
  startedAt: Date | null;
  renewalDate: Date | null;
  trialEndDate: Date | null;
} {
  const text = body;

  // Enhanced renewal patterns
  const renewalPatterns = [
    /(?:renew|renewal|next billing|will be charged|next charge)(?:\s+on|\s+date)?:?\s*([^.\n]{5,30})/gi,
    /(?:subscription|membership)\s+(?:renews|ends|expires)\s+(?:on\s+)?([^.\n]{5,30})/gi,
    /(?:billed|charged)\s+(?:on|next|again)\s+([^.\n]{5,30})/gi,
    /(?:your next payment|next payment date).*?([^.\n]{5,30})/gi,
  ];

  const trialPatterns = [
    /trial\s+(?:ends|expires|period ends)\s+(?:on\s+)?([^.\n]{5,30})/gi,
    /free\s+(?:trial\s+)?(?:ends|until)\s+([^.\n]{5,30})/gi,
  ];

  const startPatterns = [
    /(?:subscription|membership)\s+(?:started|began|active\s+since)\s+([^.\n]{5,30})/gi,
    /(?:plan|subscription)\s+start(?:s|ed)?\s+(?:date|on)?:?\s*([^.\n]{5,30})/gi,
  ];

  let startedAt: Date | null = null;
  let renewalDate: Date | null = null;
  let trialEndDate: Date | null = null;

  // Extract renewal dates
  for (const pattern of renewalPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        renewalDate = parsed[0].start.date();
        break;
      }
    }
    if (renewalDate) break;
  }

  // Extract trial end dates
  for (const pattern of trialPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        trialEndDate = parsed[0].start.date();
        break;
      }
    }
    if (trialEndDate) break;
  }

  // Extract start dates
  for (const pattern of startPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        startedAt = parsed[0].start.date();
        break;
      }
    }
    if (startedAt) break;
  }

  // Fallback: use email date as start date
  if (!startedAt && emailDate) {
    const parsed = parseDate(emailDate);
    if (parsed && parsed.length > 0) {
      startedAt = parsed[0].start.date();
    }
  }

  return {
    startedAt,
    renewalDate,
    trialEndDate,
  };
}

// Extract plan name
export function extractPlanName(text: string): string | null {
  const planPatterns = [
    /(?:plan|subscription):\s*([A-Za-z0-9\s]+?)(?:\n|$|,|\()/i,
    /([A-Za-z\s]+?)\s+(?:plan|subscription|membership)/i,
    /(premium|pro|basic|standard|plus|family|student|individual|business|enterprise|free)\s+(?:plan|subscription)?/i,
  ];

  for (const pattern of planPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// Validate extraction against known pricing
function validateExtraction(data: Partial<ExtractedSubscriptionData>): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  if (!data.provider) {
    return { isValid: true, warnings };
  }

  const pricing = KNOWN_PRICING[data.provider];
  if (!pricing) {
    return { isValid: true, warnings };
  }

  // Validate amount
  if (data.amount) {
    if (data.amount < pricing.minAmount) {
      warnings.push(`Amount ₹${data.amount} seems too low for ${data.provider} (expected: ₹${pricing.minAmount}-${pricing.maxAmount})`);
    }
    if (data.amount > pricing.maxAmount) {
      warnings.push(`Amount ₹${data.amount} seems too high for ${data.provider} (expected: ₹${pricing.minAmount}-${pricing.maxAmount})`);
    }
  }

  // Validate billing cycle
  if (data.billingCycle && data.billingCycle !== pricing.cycle) {
    warnings.push(`Billing cycle ${data.billingCycle} differs from typical ${pricing.cycle} for ${data.provider}`);
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

// Calculate confidence score
function calculateConfidence(data: Partial<ExtractedSubscriptionData>, validation: { warnings: string[] }): 'HIGH' | 'MEDIUM' | 'LOW' {
  let score = 0;

  if (data.amount && data.currency) score += 3;
  if (data.billingCycle) score += 2;
  if (data.renewalDate) score += 2;
  if (data.startedAt) score += 1;
  if (data.planName) score += 1;

  // Deduct for warnings
  score -= validation.warnings.length;

  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  return 'LOW';
}

// Main extraction function with validation
export function extractAllSubscriptionData(
  fromHeader: string | null,
  body: string,
  pdfText: string,
  emailDate?: string | null
): ExtractedSubscriptionData {
  const fullText = `${body}\n${pdfText}`;
  const extractionNotes: string[] = [];

  const provider = extractProviderName(fromHeader, fullText);
  const { amount, currency, context } = extractAmount(fullText);
  const billingCycle = extractBillingCycle(fullText);
  const dates = extractSubscriptionDates(fullText, emailDate);
  const planName = extractPlanName(fullText);

  extractionNotes.push(`Amount found in: ${context}`);

  const partialData = {
    provider,
    amount,
    currency,
    billingCycle,
    ...dates,
    planName,
  };

  // Validate
  const validation = validateExtraction(partialData);
  extractionNotes.push(...validation.warnings);

  // Calculate confidence
  const confidence = calculateConfidence(partialData, validation);

  // If low confidence and we have known pricing, suggest it
  if (confidence === 'LOW' && provider && KNOWN_PRICING[provider]) {
    const known = KNOWN_PRICING[provider];
    extractionNotes.push(`Consider using typical ${provider} pricing: ₹${known.typical}/${known.cycle}`);
  }

  return {
    ...partialData,
    confidence,
    extractionNotes,
  };
}