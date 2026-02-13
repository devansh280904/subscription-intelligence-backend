/**
 * PDF Parser Service
 * Extracts structured subscription data from PDF invoices
 */

interface PDFSubscriptionData {
    amount?: number;
    currency?: string | null;
    invoiceDate?: Date;
    dueDate?: Date;
    billingPeriod?: string;
    invoiceNumber?: string;
}

/**
 * Extract subscription data from PDF text
 * @param pdfText Extracted text from PDF
 * @returns Structured subscription data
 */
export function parsePDFInvoice(pdfText: string): PDFSubscriptionData {
    const result: PDFSubscriptionData = {};

    if (!pdfText || pdfText.trim().length === 0) {
        return result;
    }

    // Extract amount and currency
    const amountData = extractAmountFromPDF(pdfText);
    if (amountData.amount) {
        result.amount = amountData.amount;
        result.currency = amountData.currency ?? undefined;
    }

    // Extract dates
    const dates = extractDatesFromPDF(pdfText);
    if (dates.invoiceDate) result.invoiceDate = dates.invoiceDate;
    if (dates.dueDate) result.dueDate = dates.dueDate;

    // Extract invoice number
    result.invoiceNumber = extractInvoiceNumber(pdfText);

    // Extract billing period
    result.billingPeriod = extractBillingPeriod(pdfText);

    return result;
}

/**
 * Extract amount and currency from PDF text
 */
function extractAmountFromPDF(text: string): { amount: number | null; currency: string | null } {
    // Look for common invoice amount patterns
    const patterns = [
        // "Total: $99.99", "Amount Due: $99.99"
        /(?:total|amount due|balance due|amount|due):\s*[$€£₹¥]\s*(\d{1,6}(?:[.,]\d{2})?)/gi,
        // "$99.99 USD", "99.99 USD"
        /\$?\s*(\d{1,6}(?:[.,]\d{2})?)\s+(USD|EUR|GBP|INR|CAD|AUD)/gi,
        // Just a prominent number with currency symbol
        /[$€£₹¥]\s*(\d{1,6}(?:[.,]\d{2})?)/g,
    ];

    const amounts: Array<{ amount: number; currency: string }> = [];

    for (const pattern of patterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            let amount: number;
            let currency: string = 'USD'; // Default

            if (match[2]) {
                // Has explicit currency code
                amount = parseFloat(match[1].replace(',', '.'));
                currency = match[2].toUpperCase();
            } else if (match[1]) {
                amount = parseFloat(match[1].replace(',', '.'));
                // Try to infer currency from symbols in match[0]
                if (match[0].includes('€')) currency = 'EUR';
                else if (match[0].includes('£')) currency = 'GBP';
                else if (match[0].includes('₹')) currency = 'INR';
                else if (match[0].includes('¥')) currency = 'JPY';
            } else {
                continue;
            }

            // Filter realistic amounts
            if (amount >= 0.99 && amount <= 99999) {
                amounts.push({ amount, currency });
            }
        }
    }

    // Return the largest amount found (usually the total)
    if (amounts.length > 0) {
        const largest = amounts.reduce((max, curr) => 
            curr.amount > max.amount ? curr : max
        );
        return { amount: largest.amount, currency: largest.currency };
    }

    return { amount: null, currency: null };
}

/**
 * Extract dates from PDF text
 */
function extractDatesFromPDF(text: string): { 
    invoiceDate: Date | null; 
    dueDate: Date | null;
} {
    const result = {
        invoiceDate: null as Date | null,
        dueDate: null as Date | null,
    };

    // Common date patterns in invoices
    const datePatterns = [
        // Invoice Date: 01/15/2024
        /invoice date:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/gi,
        // Date: January 15, 2024
        /(?:date|issued):\s*([A-Za-z]+ \d{1,2},? \d{4})/gi,
        // Due Date: 02/15/2024
        /due date:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/gi,
    ];

    for (const pattern of datePatterns) {
        const matches = [...text.matchAll(pattern)];
        for (const match of matches) {
            try {
                const date = new Date(match[1]);
                if (!isNaN(date.getTime())) {
                    // Check if this is an invoice date or due date based on the match
                    if (match[0].toLowerCase().includes('due')) {
                        if (!result.dueDate) result.dueDate = date;
                    } else {
                        if (!result.invoiceDate) result.invoiceDate = date;
                    }
                }
            } catch (error) {
                // Ignore parsing errors
            }
        }
    }

    return result;
}

/**
 * Extract invoice number
 */
function extractInvoiceNumber(text: string): string | undefined {
    const patterns = [
        /invoice (?:number|#|no\.?):\s*([A-Z0-9-]+)/gi,
        /(?:invoice|receipt) #([A-Z0-9-]+)/gi,
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
 * Extract billing period
 */
function extractBillingPeriod(text: string): string | undefined {
    const patterns = [
        /billing period:\s*([^\n]+)/gi,
        /service period:\s*([^\n]+)/gi,
        /(?:for|period):\s*([A-Za-z]+ \d{1,2},? \d{4}\s*-\s*[A-Za-z]+ \d{1,2},? \d{4})/gi,
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
 * Detect if PDF is a subscription invoice
 */
export function isPDFSubscriptionInvoice(pdfText: string): boolean {
    const keywords = [
        'subscription',
        'recurring',
        'monthly',
        'annual',
        'renewal',
        'next billing',
        'billing cycle',
    ];

    const textLower = pdfText.toLowerCase();
    return keywords.some(keyword => textLower.includes(keyword));
}