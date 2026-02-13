import { parse as parseDate } from 'chrono-node'

// these are the details we require so we create an interface

export interface ExtractedSubscriptionData {
    provider: string | null;
    amount: number | null;
    currency: string | null;
    billingCycle: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null;
    startedAt: Date | null;
    renewalDate: Date | null;
    trialEndDate: Date | null;
    planName: string | null;
}


export function extractProviderName(fromHeader: string | null, body: string): string | null {
    const from = (fromHeader || '').toLowerCase();
    const bodyLower = body.toLowerCase();


    const providerMap: Record<string, string[]> = {
        'Netflix': ['netflix.com', 'netflix', '@nflx'],
        'LinkedIn': ['linkedin.com', 'linkedin'],
        'Spotify': ['spotify.com', 'spotify'],
        'Amazon Prime': ['primevideo.com', 'amazon.com/prime', 'amazon prime'],
        'Google Play': ['google play', 'play.google.com'],
        'Apple': ['apple.com', 'icloud.com', 'itunes'],
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
        'ChatGPT Plus': ['openai.com', 'chatgpt'],
        'AWS': ['aws.amazon.com', 'amazon web services'],
        'Google Workspace': ['workspace.google.com', 'google workspace'],
    };

    // we run for loop for each provider and keywords, and run 2nd for for keywords and check if from or body includes that keywords if yes we return that provider
    for (const [provider, keywords] of Object.entries(providerMap)) {
        for (const keyword of keywords) {
            if (from.includes(keyword) || bodyLower.includes(keyword)) {
                return provider;
            }
        }
    }

    // incase provider is using some other email. eg. noreply@figma.com
    const emailMatch = from.match(/@([a-z0-9-]+)\./);
    if (emailMatch) {
        const domain = emailMatch[1];

        // turning first char into uppercase and rest small
        return domain.charAt(0).toUpperCase() + domain.slice(1);
    }

    // returning null if nothing found
    return null;
}

// extracting the amount
export function extractAmount(text: string): { amount: number | null; currency: string | null } {
    const currencySymbols: Record<string, string> = {
        '$': 'USD',
        '€': 'EUR',
        '£': 'GBP',
        '₹': 'INR',
        '¥': 'JPY',
        'CA$': 'CAD',
        'A$': 'AUD',
    };

    // Patterns for different currency formats
    const patterns = [
        // ₹649, ₹999.99 (Indian rupee - prioritize this for your case)
        /₹\s*(\d{1,5}(?:\.\d{2})?)/g,
        // $9.99, $99.99, $999.99
        /\$\s*(\d{1,4}(?:\.\d{2})?)/g,
        // €9.99, €99,99
        /€\s*(\d{1,4}(?:[.,]\d{2})?)/g,
        // £9.99
        /£\s*(\d{1,4}(?:\.\d{2})?)/g,
        // USD 9.99, EUR 9.99, INR 649
        /(USD|EUR|GBP|INR|CAD|AUD)\s*(\d{1,5}(?:\.\d{2})?)/gi,
        // 9.99 USD, 649 INR
        /(\d{1,5}(?:\.\d{2})?)\s*(USD|EUR|GBP|INR|CAD|AUD)/gi,
    ];

    const amounts: Array<{ amount: number; currency: string }> = [];

    for (const pattern of patterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            let amount: number;
            let currency: string;

            if (match[0].startsWith('₹')) {
                amount = parseFloat(match[1].replace(',', ''));
                currency = 'INR';
            } else if (match[0].startsWith('$')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'USD';
            } else if (match[0].startsWith('€')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'EUR';
            } else if (match[0].startsWith('£')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'GBP';
            } else if (match[2]) {
                // Currency code format
                amount = parseFloat(match[2].replace(',', ''));
                currency = match[1].toUpperCase();
            } else {
                continue;
            }

            // Filter out unrealistic amounts (too small or too large)
            if (amount >= 0.99 && amount <= 9999) {
                amounts.push({ amount, currency });
            }
        }
    }

    // Return the most likely amount (usually the first one found)
    if (amounts.length > 0) {
        return { amount: amounts[0].amount, currency: amounts[0].currency };
    }

    return { amount: null, currency: null };
}

// Detect billing cycle
export function extractBillingCycle(text: string): 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null {
    const textLower = text.toLowerCase();

    const patterns = {
        MONTHLY: ['monthly', 'per month', '/month', 'billed monthly', 'every month', 'month-to-month'],
        YEARLY: ['yearly', 'annually', 'per year', '/year', 'annual', 'billed yearly', 'every year', 'year-to-year'],
        QUARTERLY: ['quarterly', 'per quarter', 'every 3 months', '3-month'],
        WEEKLY: ['weekly', 'per week', '/week', 'every week'],
    };
    
    // running for loop on cycle and keywords, and 2nd loop on keywords to find match and if found returning cycle
    for (const [cycle, keywords] of Object.entries(patterns)) {
        for (const keyword of keywords) {
            if (textLower.includes(keyword)) {
                return cycle as 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY';
            }
        }
    }
    return null;
}


// extracting plan name 
export function extractPlanName(text: string): string | null {
  const planPatterns = [
    // "Plan: Premium", "Subscription: Basic"
    /(?:plan|subscription):\s*([A-Za-z0-9\s]+?)(?:\n|$|,|\.|;)/i,
    // "Premium plan", "Basic subscription"
    /(premium|pro|basic|standard|plus|family|student|individual|mobile|ultra hd|hd)\s+(?:plan|subscription|membership)?/i,
    // "You're on the Premium plan"
    /on\s+the\s+([A-Za-z0-9\s]+?)\s+(?:plan|subscription)/i,
  ];

  // comparing patterns with texts 
  for (const pattern of planPatterns) {
    const match = text.match(pattern);
    
    if (match && match[1]) {
      const planName = match[1].trim();
      
      // Filter out junk matches
      if (planName.length > 2 && planName.length < 50 && !planName.includes('by Netflix')) {
        return planName;
      }
    }
  }

  return null;
}

// ✅ IMPROVED: Much stricter date validation
export function isValidSubscriptionDate(date: Date | null): boolean {
    if (!date) return false;
    
    // Check if date is actually a valid Date object
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return false;
    }
    
    const now = new Date();
    
    // ✅ CRITICAL FIX: Much tighter bounds
    // Past: Allow up to 3 years ago (longer subscription history)
    const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    
    // Future: Only allow 1 year ahead for renewals (NOT 5 years!)
    // Most subscriptions renew monthly/yearly, so 1 year is plenty
    const oneYearAhead = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    
    const isValid = date >= threeYearsAgo && date <= oneYearAhead;
    
    // ✅ DEBUG: Log rejected dates
    if (!isValid) {
        console.log('[Parser] Rejected invalid date:', {
            date: date.toISOString(),
            reason: date < threeYearsAgo ? 'too far in past' : 'too far in future',
            threeYearsAgo: threeYearsAgo.toISOString(),
            oneYearAhead: oneYearAhead.toISOString()
        });
    }
    
    return isValid;
}

// ✅ IMPROVED: Better date extraction with context awareness
export function extractSubscriptionDates(
  body: string,
  emailDate?: string | null
): {
  startedAt: Date | null;
  renewalDate: Date | null;
  trialEndDate: Date | null;
} {
  const text = body;

  let startedAt: Date | null = null;
  let renewalDate: Date | null = null;
  let trialEndDate: Date | null = null;

  // ✅ IMPROVED: More specific patterns
  const renewalPatterns = [
    /(?:next billing|next payment|will be charged|will renew)(?:\s+on|\s+date)?:?\s*([^.\n]{5,30})/gi,
    /(?:renew|renewal)\s+(?:date|on)?:?\s*([^.\n]{5,30})/gi,
    /(?:subscription|membership)\s+(?:renews|ends)\s+(?:on\s+)?([^.\n]{5,30})/gi,
  ];

  const trialPatterns = [
    /trial\s+ends?\s+(?:on\s+)?([^.\n]{5,30})/gi,
    /free\s+(?:trial\s+)?(?:ends|until)\s+([^.\n]{5,30})/gi,
  ];

  const startPatterns = [
    /(?:subscription|membership|plan)\s+(?:started|began|active\s+since)\s+([^.\n]{5,30})/gi,
    /(?:joined|subscribed|signed up)\s+(?:on\s+)?([^.\n]{5,30})/gi,
  ];

  // Extracting renewal dates
  for (const pattern of renewalPatterns) {
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        const date = parsed[0].start.date();
        
        if (isValidSubscriptionDate(date)) {
          renewalDate = date;
          console.log('[Parser] Found renewal date:', date.toISOString(), 'from:', match[1]);
          break;
        }
      }
    }
    if (renewalDate) break;
  }

  // Extracting trial end dates
  for (const pattern of trialPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        const date = parsed[0].start.date();
        
        if (isValidSubscriptionDate(date)) {
          trialEndDate = date;
          console.log('[Parser] Found trial end date:', date.toISOString(), 'from:', match[1]);
          break;
        }
      }
    }
    if (trialEndDate) break;
  }

  // Extracting start dates
  for (const pattern of startPatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {
        const date = parsed[0].start.date();
        
        if (isValidSubscriptionDate(date)) {
          startedAt = date;
          console.log('[Parser] Found start date:', date.toISOString(), 'from:', match[1]);
          break;
        }
      }
    }
    if (startedAt) break;
  }

  // ✅ CRITICAL FIX: Use email date directly (not chrono-node parsing)
  // Fallback: if no explicit start date, use email header date
  if (!startedAt && emailDate) {
    try {
      // Gmail sends dates like "Tue, 15 Jan 2025 10:30:00 GMT"
      // Direct conversion preserves timezone and is accurate
      const date = new Date(emailDate);
      
      if (isValidSubscriptionDate(date)) {
        startedAt = date;
        console.log('[Parser] Using email date as start date:', date.toISOString());
      } else {
        console.warn('[Parser] Email date is invalid:', emailDate, '→', date.toISOString());
      }
    } catch (error) {
      console.error('[Parser] Error parsing email date:', emailDate, error);
    }
  }

  return {
    startedAt,
    renewalDate,
    trialEndDate,
  };
}

// Main extraction function
export function extractAllSubscriptionData(
  fromHeader: string | null,
  body: string,
  pdfText: string,
  emailDate?: string | null
): ExtractedSubscriptionData {
  const fullText = `${body}\n${pdfText}`;

  console.log('[Parser] Extracting data from email dated:', emailDate);
  
  const extracted = {
    provider: extractProviderName(fromHeader, fullText),
    ...extractAmount(fullText),
    billingCycle: extractBillingCycle(fullText),
    ...extractSubscriptionDates(fullText, emailDate),
    planName: extractPlanName(fullText),
  };
  
  console.log('[Parser] Extraction complete:', {
    provider: extracted.provider,
    amount: extracted.amount,
    currency: extracted.currency,
    billingCycle: extracted.billingCycle,
    planName: extracted.planName,
    startedAt: extracted.startedAt?.toISOString(),
    renewalDate: extracted.renewalDate?.toISOString(),
  });
  
  return extracted;
}