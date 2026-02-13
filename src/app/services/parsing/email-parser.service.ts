/**
 * Email Parser Service
 * Extracts structured data from HTML emails
 */

interface EmailSubscriptionData {
    amount?: number;
    currency?: string;
    planName?: string;
    billingCycle?: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY';
    renewalDate?: Date;
    links?: {
        invoice?: string;
        account?: string;
        manage?: string;
    };
}

/**
 * Parse HTML email content for subscription data
 * @param htmlContent HTML content of email
 * @returns Structured subscription data
 */
export function parseHTMLEmail(htmlContent: string): EmailSubscriptionData {
    const result: EmailSubscriptionData = {};

    if (!htmlContent || htmlContent.trim().length === 0) {
        return result;
    }

    // Strip HTML tags to get plain text for easier parsing
    const plainText = stripHTMLTags(htmlContent);

    // Extract amount and currency
    const amountData = extractAmount(plainText);
    if (amountData.amount) {
        result.amount = amountData.amount;
        result.currency = amountData.currency ?? 'USD';
    }

    // Extract plan name
    result.planName = extractPlanName(plainText);

    // Extract billing cycle
    result.billingCycle = extractBillingCycle(plainText);

    // Extract important links
    result.links = extractLinks(htmlContent);

    return result;
}

/**
 * Strip HTML tags and decode entities
 */
function stripHTMLTags(html: string): string {
    // Remove script and style elements
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    
    // Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
}

/**
 * Extract amount and currency from text
 */
function extractAmount(text: string): { amount: number | null; currency: string | null } {
    const patterns = [
        /\$\s*(\d{1,4}(?:\.\d{2})?)/g,
        /€\s*(\d{1,4}(?:[.,]\d{2})?)/g,
        /£\s*(\d{1,4}(?:\.\d{2})?)/g,
        /₹\s*(\d{1,5}(?:\.\d{2})?)/g,
        /(USD|EUR|GBP|INR|CAD|AUD)\s*(\d{1,4}(?:\.\d{2})?)/gi,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            let amount: number;
            let currency: string;

            if (match[0].startsWith('$')) {
                amount = parseFloat(match[1]);
                currency = 'USD';
            } else if (match[0].startsWith('€')) {
                amount = parseFloat(match[1].replace(',', '.'));
                currency = 'EUR';
            } else if (match[0].startsWith('£')) {
                amount = parseFloat(match[1]);
                currency = 'GBP';
            } else if (match[0].startsWith('₹')) {
                amount = parseFloat(match[1]);
                currency = 'INR';
            } else if (match[2]) {
                amount = parseFloat(match[2]);
                currency = match[1].toUpperCase();
            } else {
                continue;
            }

            if (amount >= 0.99 && amount <= 9999) {
                return { amount, currency };
            }
        }
    }

    return { amount: null, currency: null };
}

/**
 * Extract plan name from text
 */
function extractPlanName(text: string): string | undefined {
    const patterns = [
        /(?:plan|subscription):\s*([A-Za-z0-9\s]+?)(?:\n|$|,)/i,
        /(premium|pro|basic|standard|plus|family|student|individual)\s+(?:plan|subscription)?/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return undefined;
}

/**
 * Extract billing cycle
 */
function extractBillingCycle(text: string): 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | undefined {
    const textLower = text.toLowerCase();

    if (textLower.includes('monthly') || textLower.includes('per month') || textLower.includes('/month')) {
        return 'MONTHLY';
    }
    if (textLower.includes('yearly') || textLower.includes('annually') || textLower.includes('per year')) {
        return 'YEARLY';
    }
    if (textLower.includes('quarterly') || textLower.includes('per quarter')) {
        return 'QUARTERLY';
    }
    if (textLower.includes('weekly') || textLower.includes('per week')) {
        return 'WEEKLY';
    }

    return undefined;
}

/**
 * Extract important links from HTML
 */
function extractLinks(html: string): {
    invoice?: string;
    account?: string;
    manage?: string;
} {
    const links: {
        invoice?: string;
        account?: string;
        manage?: string;
    } = {};

    // Extract href attributes
    const hrefPattern = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi;
    const matches = [...html.matchAll(hrefPattern)];

    for (const match of matches) {
        const url = match[2];
        const textAround = html.substring(Math.max(0, match.index! - 100), match.index! + 100).toLowerCase();

        if ((textAround.includes('invoice') || textAround.includes('receipt')) && !links.invoice) {
            links.invoice = url;
        } else if ((textAround.includes('account') || textAround.includes('profile')) && !links.account) {
            links.account = url;
        } else if ((textAround.includes('manage') || textAround.includes('update') || textAround.includes('settings')) && !links.manage) {
            links.manage = url;
        }
    }

    return links;
}

/**
 * Detect email template patterns for common providers
 */
export function detectEmailProvider(htmlContent: string, from: string): string | null {
    const html = htmlContent.toLowerCase();
    const fromLower = from.toLowerCase();

    const providers = [
        { name: 'Stripe', patterns: ['stripe.com', 'stripe customer portal'] },
        { name: 'PayPal', patterns: ['paypal.com', 'paypal receipt'] },
        { name: 'Shopify', patterns: ['shopify.com', 'your shopify store'] },
        { name: 'Square', patterns: ['square.com', 'squareup.com'] },
    ];

    for (const provider of providers) {
        for (const pattern of provider.patterns) {
            if (html.includes(pattern) || fromLower.includes(pattern)) {
                return provider.name;
            }
        }
    }

    return null;
}