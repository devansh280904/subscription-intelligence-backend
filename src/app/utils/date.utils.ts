/**
 * Date Utilities for Subscription Intelligence
 * Handles all date-related operations with proper validation and timezone awareness
 */

/**
 * Validates if a date is within reasonable bounds for a subscription
 * @param date Date to validate
 * @returns true if date is valid and within acceptable range
 */
export function isValidSubscriptionDate(date: Date | null | undefined): boolean {
    if (!date) return false;
    
    // Check if date is actually a valid Date object
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return false;
    }
    
    const now = new Date();
    // Allow dates from 2 years ago to 5 years in future
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const fiveYearsAhead = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
    
    return date >= twoYearsAgo && date <= fiveYearsAhead;
}

/**
 * Safely parse a date string from various sources
 * @param dateString String representation of date
 * @returns Valid Date object or null
 */
export function safeDateParse(dateString: string | null | undefined): Date | null {
    if (!dateString) return null;
    
    try {
        const date = new Date(dateString);
        return isValidSubscriptionDate(date) ? date : null;
    } catch (error) {
        console.error('Error parsing date:', dateString, error);
        return null;
    }
}

/**
 * Calculate next billing date based on billing cycle
 * @param lastPaymentDate Last payment date
 * @param billingCycle Billing cycle (MONTHLY, YEARLY, etc.)
 * @returns Next billing date or null if invalid
 */
export function calculateNextBillingDate(
    lastPaymentDate: Date,
    billingCycle: 'MONTHLY' | 'YEARLY' | 'QUARTERLY' | 'WEEKLY' | null
): Date | null {
    if (!billingCycle || !isValidSubscriptionDate(lastPaymentDate)) {
        return null;
    }

    try {
        // Create new Date to avoid mutations
        const next = new Date(lastPaymentDate.getTime());
        
        switch (billingCycle) {
            case 'WEEKLY':
                next.setDate(next.getDate() + 7);
                break;
                
            case 'MONTHLY':
                const currentMonth = next.getMonth();
                const currentDay = next.getDate();
                
                next.setMonth(currentMonth + 1);
                
                // Handle month overflow (e.g., Jan 31 -> Feb 31)
                if (next.getMonth() !== (currentMonth + 1) % 12) {
                    // Set to last day of intended month
                    next.setDate(0);
                }
                break;
                
            case 'QUARTERLY':
                const quarterMonth = next.getMonth();
                next.setMonth(quarterMonth + 3);
                
                // Handle overflow
                if (next.getMonth() !== (quarterMonth + 3) % 12) {
                    next.setDate(0);
                }
                break;
                
            case 'YEARLY':
                next.setFullYear(next.getFullYear() + 1);
                break;
                
            default:
                return null;
        }
        
        return isValidSubscriptionDate(next) ? next : null;
        
    } catch (error) {
        console.error('Error calculating next billing date:', error);
        return null;
    }
}

/**
 * Check if a date is within a specific number of days from now
 * @param date Date to check
 * @param days Number of days
 * @returns true if date is within the range
 */
export function isWithinDays(date: Date | null, days: number): boolean {
    if (!isValidSubscriptionDate(date)) return false;
    
    const now = new Date();
    const diffMs = date!.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    
    return diffDays >= 0 && diffDays <= days;
}

/**
 * Check if two dates are within a certain time window of each other
 * @param date1 First date
 * @param date2 Second date
 * @param windowMs Time window in milliseconds
 * @returns true if dates are within the window
 */
export function areDatesWithinWindow(
    date1: Date | null,
    date2: Date | null,
    windowMs: number
): boolean {
    if (!isValidSubscriptionDate(date1) || !isValidSubscriptionDate(date2)) {
        return false;
    }
    
    const diffMs = Math.abs(date1!.getTime() - date2!.getTime());
    return diffMs <= windowMs;
}

/**
 * Format date for consistent display
 * @param date Date to format
 * @returns ISO string or null
 */
export function formatDateISO(date: Date | null): string | null {
    if (!isValidSubscriptionDate(date)) return null;
    return date!.toISOString();
}

/**
 * Get start of day in UTC
 * @param date Date
 * @returns Date at start of day in UTC
 */
export function getStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * Get end of day in UTC
 * @param date Date
 * @returns Date at end of day in UTC
 */
export function getEndOfDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999);
    return d;
}

/**
 * Calculate days until a future date
 * @param futureDate Future date
 * @returns Number of days (negative if in past)
 */
export function daysUntil(futureDate: Date | null): number | null {
    if (!isValidSubscriptionDate(futureDate)) return null;
    
    const now = new Date();
    const diffMs = futureDate!.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check if a subscription is due for renewal soon
 * @param renewalDate Renewal date
 * @param thresholdDays Days threshold (default 7)
 * @returns true if renewal is within threshold
 */
export function isDueForRenewal(renewalDate: Date | null, thresholdDays: number = 7): boolean {
    const days = daysUntil(renewalDate);
    return days !== null && days >= 0 && days <= thresholdDays;
}

/**
 * Constants for time calculations
 */
export const TIME_CONSTANTS = {
    ONE_DAY_MS: 24 * 60 * 60 * 1000,
    THREE_DAYS_MS: 3 * 24 * 60 * 60 * 1000,
    ONE_WEEK_MS: 7 * 24 * 60 * 60 * 1000,
    ONE_MONTH_MS: 30 * 24 * 60 * 60 * 1000, // Approximate
};