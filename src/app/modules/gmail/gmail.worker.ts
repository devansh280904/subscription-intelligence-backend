import { fetchGmailMessageContent } from "./gmail.scanner";
import { extractAllSubscriptionData, extractProviderName, extractSubscriptionDates } from "./gmail.parser";
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

        console.log('[Worker] Extracted Data:', {
            provider: extracted.provider,
            amount: extracted.amount,
            currency: extracted.currency,
            cycle: extracted.billingCycle,
            lifecycleEvent
        })


        // chekcing if subscription exists
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

        // if this subscription just became ACTIVE, and we don’t already have a start date,then set one.
        if (!finalStartedAt && lifecycleEvent === 'ACTIVE') {
            finalStartedAt = extracted.startedAt ?? (emailDate ? new Date(emailDate) : now)
        }

        // if life cycle is 'cancelled' we put 'CANCELLED' and put end date as now 
        if (lifecycleEvent === 'CANCELLED' && !finalEndedAt) {
            finalStatus = 'CANCELLED';
            finalEndedAt = now;
        }


        // upserting the data 
        const subscription = await prisma.subscription.upsert({
            where: {
                userId_provider: {
                    userId,
                    provider: extracted.provider,
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
                lastEmailDate: emailDate ? new Date(emailDate) : undefined,
                needsConfirmation: true, // Always set to true when new data comes in
            },
            create: {
                userId,
                provider: extracted.provider,
                status: finalStatus,
                startedAt: finalStartedAt,
                endedAt: finalEndedAt,
                amount: extracted.amount,
                currency: extracted.currency,
                billingCycle: extracted.billingCycle,
                renewalDate: extracted.renewalDate,
                planName: extracted.planName,
                lastEmailDate: emailDate ? new Date(emailDate) : undefined,
                needsConfirmation: true,
            },
        });

        // if payment successfull mail
        if (
            lifecycleEvent === 'ACTIVE' &&
            extracted.amount &&
            emailDate
        ) {
            const paymentDate = new Date(emailDate);

            // we find if any payment exists withing 24 hours window in past and future
            const existingPayment = await prisma.paymentCycle.findFirst({
                where: {
                    subscriptionId: subscription.id,
                    paymentDate: {
                        gte: new Date(paymentDate.getTime() - 24 * 60 * 60 * 1000),
                        lte: new Date(paymentDate.getTime() + 24 * 60 * 60 * 1000)
                    }
                }
            })

            // if record doesnt exist we add data
            if (!existingPayment) {
                await prisma.paymentCycle.create({
                    data: {
                        subscriptionId: subscription.id,
                        amount: extracted.amount,
                        currency: extracted.currency ?? 'INR',
                        paymentDate,
                        emailMessageId: messageId,
                        status: 'SUCCESS'
                    }
                })

                console.log('[Worker] Payment cycle recorded:', {
                    provider: extracted.provider,
                    amount: extracted.amount,
                    date: paymentDate
                })
            }
        }

        // if failed payment mail
        if (lifecycleEvent === 'PAYMENT_FAILED' && emailDate) {
            await prisma.paymentCycle.create({
                data: {
                    subscriptionId: subscription.id,
                    amount: extracted.amount ?? existing?.amount ?? 0,
                    currency: extracted.currency ?? existing?.currency ?? 'USD',
                    paymentDate: new Date(emailDate),
                    emailMessageId: messageId,
                    status: 'FAILED',
                }
            })
        }
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

function calculateNextRenewal(lastPaymentDate: Date,
    billingCycle: string | null): Date | null {
    if (!billingCycle) return null;

    const nextRenewal = new Date(lastPaymentDate);

    switch (billingCycle) {
        case 'MONTHLY':
            nextRenewal.setMonth(nextRenewal.getMonth() + 1);
            break;
        case 'YEARLY':
            nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
            break;
        case 'QUARTERLY':
            nextRenewal.setMonth(nextRenewal.getMonth() + 3);
            break;
        case 'WEEKLY':
            nextRenewal.setDate(nextRenewal.getDate() + 7);
            break;
        default:
            return null;
    }

    return nextRenewal;
}