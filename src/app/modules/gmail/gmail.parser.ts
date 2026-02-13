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
        'Netflix': ['netflix.com', 'netflix'],
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
        // $9.99, $99.99, $999.99
        /\$\s*(\d{1,4}(?:\.\d{2})?)/g,
        // €9.99, €99,99
        /€\s*(\d{1,4}(?:[.,]\d{2})?)/g,
        // £9.99
        /£\s*(\d{1,4}(?:\.\d{2})?)/g,
        // ₹999, ₹99.99
        /₹\s*(\d{1,5}(?:\.\d{2})?)/g,
        // USD 9.99, EUR 9.99
        /(USD|EUR|GBP|INR|CAD|AUD)\s*(\d{1,4}(?:\.\d{2})?)/gi,
        // 9.99 USD
        /(\d{1,4}(?:\.\d{2})?)\s*(USD|EUR|GBP|INR|CAD|AUD)/gi,
    ];

    const amounts: Array<{ amount: number; currency: string }> = [];

    for (const pattern of patterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            let amount: number;
            let currency: string;

            if (match[0].startsWith('$')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'USD';
            } else if (match[0].startsWith('€')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'EUR';
            } else if (match[0].startsWith('£')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'GBP';
            } else if (match[0].startsWith('₹')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'INR';
            } else if (match[2]) {
                // Currency code format
                amount = parseFloat(match[2].replace(',', '.'));
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
        MONTHLY: ['monthly', 'per month', '/month', 'billed monthly', 'every month'],
        YEARLY: ['yearly', 'annually', 'per year', '/year', 'annual', 'billed yearly', 'every year'],
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
    /(?:plan|subscription):\s*([A-Za-z0-9\s]+?)(?:\n|$|,)/i,
    /([A-Za-z\s]+?)\s+(?:plan|subscription|membership)/i,
    /(premium|pro|basic|standard|plus|family|student|individual)\s+(?:plan|subscription)?/i,
  ];

  // comparing patterns with texts 
  for (const pattern of planPatterns) {
    const match = text.match(pattern);
    
    // match[0] → "Plan: Premium Plus"
    // match[1] → "Premium Plus
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// extracting dates 

export function extractSubscriptionDates(
  body: string,
  emailDate?: string | null
): {
  startedAt: Date | null;
  renewalDate: Date | null;
  trialEndDate: Date | null;
} {
  const text = body;

  // Using chrono-node for natural language date parsing
  // mgith return:
  // start: { date: 2026-03-15 }
  const parsedDates = parseDate(text);

  let startedAt: Date | null = null;
  let renewalDate: Date | null = null;
  let trialEndDate: Date | null = null;

  // Looking for specific date contexts
  const renewalPatterns = [
    /(?:renew|renewal|next billing|will be charged)(?:\s+on|\s+date)?:?\s*([^.\n]+)/gi,
    /(?:subscription|membership)\s+(?:renews|ends)\s+(?:on\s+)?([^.\n]+)/gi,
  ];

  const trialPatterns = [
    /trial\s+ends?\s+(?:on\s+)?([^.\n]+)/gi,
    /free\s+(?:trial\s+)?(?:ends|until)\s+([^.\n]+)/gi,
  ];

  const startPatterns = [
    /(?:subscription|membership)\s+(?:started|begins|active\s+since)\s+([^.\n]+)/gi,
    /(?:plan|subscription)\s+start(?:s|ed)?\s+(?:date|on)?:?\s*([^.\n]+)/gi,
  ];

  // Extracting renewal dates
  for (const pattern of renewalPatterns) {
    // might return:["renews on March 15, 2026", "March 15, 2026"]\
    // match[0] = full matched text
    // match[1] = captured group (the date part)
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      // only parsing date part
      const parsed = parseDate(match[1]);
      if (parsed && parsed.length > 0) {

        // renewal date becomes: Date("2026-03-15")
        renewalDate = parsed[0].start.date();
        break;
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
        trialEndDate = parsed[0].start.date();
        break;
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
        startedAt = parsed[0].start.date();
        break;
      }
    }
    if (startedAt) break;
  }

  // If no specific dates found, use chrono-node on full text
  if (!renewalDate && !startedAt && parsedDates.length > 0) {
    // First date is likely start, last date is likely renewal

    // if only 1 date is found it is more likely to be renewal date 
    if (parsedDates.length === 1) {
      // using top date
      renewalDate = parsedDates[0].start.date();
    }

    // and if 2 dates are found First date is likely start, last date is likely renewal
    else if (parsedDates.length >= 2) {
      startedAt = parsedDates[0].start.date();

      // we want element at index n, so length - 1. 
      // eg. if length of array must be 3 and we want last element which must be at 2nd index position we use 3-1.
      renewalDate = parsedDates[parsedDates.length - 1].start.date();
    }
  }

  // Fallback: if no explicit start date, using email header date
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

// Main extraction function
export function extractAllSubscriptionData(
  fromHeader: string | null,
  body: string,
  pdfText: string,
  emailDate?: string | null
): ExtractedSubscriptionData {
  const fullText = `${body}\n${pdfText}`;

  /*
  if 
    return {
      a: 5,
      ...someFunction(),
      b: 30
    };

    using '...'
    {
      a: 5,
      v1: 10,
      v2: 20,
      b: 30
    }

      */

  return {
    provider: extractProviderName(fromHeader, fullText),
    ...extractAmount(fullText),
    billingCycle: extractBillingCycle(fullText),
    ...extractSubscriptionDates(fullText, emailDate),
    planName: extractPlanName(fullText),
  };
}
                                                                    