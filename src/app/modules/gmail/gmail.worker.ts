import { fetchGmailMessageContent } from "./gmail.scanner";
import { extractAllSubscriptionData, extractProviderName, extractSubscriptionDates, isValidSubscriptionDate } from "./gmail.parser";
import prisma from "../../config/prisma";

export async function processSubscriptionEmail(
    userId: string,
    messageId: string,
    fromHeader: string | null,
    accessToken: string,
    refreshToken: string,
    lifecycleEvent?: 'ACTIVE' | 'CANCELLED' | 'PAYMENT_FAILED',
    emailDate?: string | null
) {
    console.log('[Worker] Processing subscription email:', messageId);

    try {

        const { bodyText, pdfText } = await fetchGmailMessageContent(
            accessToken,
            refreshToken,
            messageId
        );

        const extracted = extractAllSubscriptionData(
            fromHeader,
            bodyText,
            pdfText,
            emailDate
        )

        if (!extracted.provider) {
            console.log('[Worker] Provider not Detected, skipping');
            return;
        }
        const provider = extracted.provider

        console.log('[Worker] Extracted Data:', {
            provider: extracted.provider,
            amount: extracted.amount,
            currency: extracted.currency,
            cycle: extracted.billingCycle,
            lifecycleEvent,
            startedAt: extracted.startedAt,
            renewalDate: extracted.renewalDate
        })


        // ✅ FIXED: Parse and validate email date once
        let emailDateParsed: Date | null = null;
        if (emailDate) {
            try {
                emailDateParsed = new Date(emailDate);
                if (!isValidSubscriptionDate(emailDateParsed)) {
                    console.warn('[Worker] Invalid email date, ignoring:', emailDate);
                    emailDateParsed = null;
                }
            } catch (error) {
                console.error('[Worker] Error parsing email date:', emailDate, error);
            }
        }

        // checking if subscription exists
        const existing = await prisma.subscription.findUnique({
            where: {
                /* SELECT * FROM "Subscription"
                WHERE "userId" = 'u123'
                AND "provider" = 'Netflix'
                LIMIT 1;  */
                userId_provider: {
                    userId,
                    provider: extracted.provider
                },
            },
            include: {
                // also fetching paymentcycles, descending and only taking top one( most recent payment)
                paymentCycles: {
                    orderBy: {
                        paymentDate: 'desc'
                    },
                    take: 1
                },
            },
        });

        const now = new Date();


        // if a subscription exist , we fetch details, if starting date already exists we keep that or else null, same for end date. and if life cycle was changed we replace with existing one or else keep it as it is 
        let finalStartedAt = existing?.startedAt ?? null;
        let finalEndedAt = existing?.endedAt ?? null;
        let finalStatus = lifecycleEvent ?? existing?.status ?? 'ACTIVE'

        // ✅ FIXED: Better date priority logic
        // if this subscription just became ACTIVE, and we don't already have a start date, then set one.
        if (!finalStartedAt && lifecycleEvent === 'ACTIVE') {
            // Priority: extracted date > email date > now
            if (extracted.startedAt && isValidSubscriptionDate(extracted.startedAt)) {
                finalStartedAt = extracted.startedAt;
            } else if (emailDateParsed) {
                finalStartedAt = emailDateParsed;
            } else {
                finalStartedAt = now;
            }
        }

        // if life cycle is 'cancelled' we put 'CANCELLED' and put end date as now 
        if (lifecycleEvent === 'CANCELLED' && !finalEndedAt) {
            finalStatus = 'CANCELLED';
            // Use email date if available, otherwise now
            finalEndedAt = emailDateParsed ?? now;
        }
        if (!extracted.provider) {
            console.log('[Worker] Provider not Detected, skipping');
            return;
        }

        // ✅ IMPROVED: Use transaction for atomic updates
        const subscription = await prisma.$transaction(async (tx) => {
            // upserting the data 
            const sub = await tx.subscription.upsert({
                where: {
                    userId_provider: {
                        userId,
                        provider: provider
                    },
                },
                update: {
                    status: finalStatus,
                    endedAt: finalEndedAt,
                    amount: extracted.amount ?? existing?.amount,
                    currency: extracted.currency ?? existing?.currency,
                    billingCycle: extracted.billingCycle ?? existing?.billingCycle,
                    renewalDate: extracted.renewalDate ?? existing?.renewalDate,
                    planName: extracted.planName ?? existing?.planName,
                    lastEmailDate: emailDateParsed ?? undefined,
                    needsConfirmation: true, // Always set to true when new data comes in
                },
                create: {
                    userId,
                    provider: provider,
                    status: finalStatus,
                    startedAt: finalStartedAt,
                    endedAt: finalEndedAt,
                    amount: extracted.amount,
                    currency: extracted.currency,
                    billingCycle: extracted.billingCycle,
                    renewalDate: extracted.renewalDate,
                    planName: extracted.planName,
                    lastEmailDate: emailDateParsed ?? undefined,
                    needsConfirmation: true,
                },
            });

            // if payment successful mail
            if (
                lifecycleEvent === 'ACTIVE' &&
                extracted.amount &&
                emailDateParsed
            ) {
                // ✅ FIXED: Use 3-day window instead of 24 hours
                const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

                // we find if any payment exists within 3 days window in past and future
                const existingPayment = await tx.paymentCycle.findFirst({
                    where: {
                        subscriptionId: sub.id,
                        paymentDate: {
                            gte: new Date(emailDateParsed.getTime() - threeDaysMs),
                            lte: new Date(emailDateParsed.getTime() + threeDaysMs)
                        }
                    }
                })

                // if record doesn't exist we add data
                if (!existingPayment) {
                    await tx.paymentCycle.create({
                        data: {
                            subscriptionId: sub.id,
                            amount: extracted.amount,
                            currency: extracted.currency ?? 'INR',
                            paymentDate: emailDateParsed,
                            emailMessageId: messageId,
                            status: 'SUCCESS'
                        }
                    })

                    console.log('[Worker] Payment cycle recorded:', {
                        provider: extracted.provider,
                        amount: extracted.amount,
                        date: emailDateParsed
                    })
                }
            }

            // if failed payment mail
            if (lifecycleEvent === 'PAYMENT_FAILED' && emailDateParsed) {
                await tx.paymentCycle.create({
                    data: {
                        subscriptionId: sub.id,
                        amount: extracted.amount ?? existing?.amount ?? 0,
                        currency: extracted.currency ?? existing?.currency ?? 'USD',
                        paymentDate: emailDateParsed,
                        emailMessageId: messageId,
                        status: 'FAILED',
                    }
                })
            }

            return sub;
        });

        console.log('[Worker] SUCCESSFULLY processed subscription:', {
            provider: extracted.provider,
            status: finalStatus
        })
    } catch (error) {
        console.error('[Worker] Error processing subscription email:', error);
        throw error;
    }
}


// function to update subscription based on renewal detection

export async function checkAndUpdateRenewal(
    userId: string,
    provider: string,
    newPaymentDate: Date,

) {

    const subscription = await prisma.subscription.findUnique({
        where: {
            /* SELECT * FROM "Subscription"
            WHERE "userId" = 'u123'
            AND "provider" = 'Netflix'
            LIMIT 1;  */
            userId_provider: {
                userId,
                provider
            },
        },
        include: {
            // also fetching paymentcycles, descending and only taking top one( most recent payment)
            paymentCycles: {
                orderBy: {
                    paymentDate: 'desc'
                },
                take: 1
            },
        },
    });
    if (!subscription) return;

    if (subscription.status === 'CANCELLED') {
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status: 'ACTIVE',
                endedAt: null,
                renewalDate: calculateNextRenewal(newPaymentDate, subscription.billingCycle)
            }
        })
    };
    if (subscription.status === 'ACTIVE') {
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                renewalDate: calculateNextRenewal(newPaymentDate, subscription.billingCycle),
            },
        });
    }
}

// ✅ FIXED: Safer date calculation with proper timezone handling
function calculateNextRenewal(lastPaymentDate: Date, billingCycle: string | null): Date | null {
    if (!billingCycle) return null;

    try {
        // Create new Date object to avoid mutating the original
        const nextRenewal = new Date(lastPaymentDate.getTime());

        switch (billingCycle) {
            case 'MONTHLY':
                // Get the current month and add 1
                const currentMonth = nextRenewal.getMonth();
                const currentYear = nextRenewal.getFullYear();
                const currentDay = nextRenewal.getDate();

                // Set to next month
                nextRenewal.setMonth(currentMonth + 1);

                // Handle month overflow (e.g., Jan 31 -> Feb 31 becomes Mar 3)
                // Reset to last day of intended month if overflow occurred
                if (nextRenewal.getMonth() !== (currentMonth + 1) % 12) {
                    nextRenewal.setDate(0); // Go to last day of previous month
                }
                break;

            case 'YEARLY':
                nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
                break;

            case 'QUARTERLY':
                const quarterMonth = nextRenewal.getMonth();
                nextRenewal.setMonth(quarterMonth + 3);

                // Handle month overflow
                if (nextRenewal.getMonth() !== (quarterMonth + 3) % 12) {
                    nextRenewal.setDate(0);
                }
                break;

            case 'WEEKLY':
                nextRenewal.setDate(nextRenewal.getDate() + 7);
                break;

            default:
                return null;
        }

        // Validate the calculated date
        if (isValidSubscriptionDate(nextRenewal)) {
            return nextRenewal;
        }

        console.warn('[Worker] Calculated renewal date is invalid:', nextRenewal);
        return null;

    } catch (error) {
        console.error('[Worker] Error calculating next renewal:', error);
        return null;
    }
}