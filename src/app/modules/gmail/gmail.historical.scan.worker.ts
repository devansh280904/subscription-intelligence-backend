import prisma from '../../config/prisma'
import {
    scanGmailMessageIds,
    fetchGmailMessageHeaders,
    fetchGmailMessageContent,
} from './gmail.scanner'
import { classifySubscriptionEmail } from './gmail.classifier'
import { processSubscriptionEmail } from './gmail.worker'

const PAGE_SIZE = 50;
const MAX_EMAILS_TO_SCAN = 2000;
const MAX_SUBSCRIPTIONS_TO_FIND = 30;

export async function runHistoricalGmailScan(userId: string) {
    console.log('Historical scan started');

    const gmailAccount = await prisma.gmailAccount.findUnique({
        where: { userId },
    });

    if (!gmailAccount) {
        throw new Error('gmail account not found');
    }

    if (gmailAccount.historicalScanCompleted) {
        console.log('historical scan already Completed');
        return;
    }

    let scannnedCount = 0;
    let foundSubscription = 0;
    let pageToken: string | undefined;

    while (true) {
        const response = await scanGmailMessageIds(gmailAccount.accessToken,
            gmailAccount.refreshToken, {
            maxResults: PAGE_SIZE,
            pageToken,
            query: `
                subscription OR
                billing OR
                renewal OR
                membership OR
                trial OR
                "update payment" OR
                invoice OR
                receipt
            `,
        });

        const messageIds = response.messageIds;
        pageToken = response.nextPageToken;

        if (!messageIds || messageIds.length === 0) break;

        for (const messageId of messageIds) {
            scannnedCount++;
            try {

                const headers = await fetchGmailMessageHeaders(
                    gmailAccount.accessToken,
                    gmailAccount.refreshToken,
                    messageId
                );

                let classification = classifySubscriptionEmail({
                    from: headers.from,
                    subject: headers.subject,
                });

                if (classification.score >= 2 && classification.score < 6) {
                    const response = await fetchGmailMessageContent(
                        gmailAccount.accessToken,
                        gmailAccount.refreshToken,
                        messageId
                    );
                    const body = response.bodyText
                    classification = classifySubscriptionEmail(
                        {
                            from: headers.from,
                            subject: headers.subject,
                        },
                        body
                    );
                }

                if (
                    classification.isSubscriptionCandidate &&
                    classification.score >= 6 &&
                    headers.from
                ) {
                    let lifecycleEvent: 'ACTIVE' | 'CANCELLED' | 'PAYMENT_FAILED' | undefined;

                    if (classification.lifecycleEvent === 'ACTIVE') {
                        lifecycleEvent = 'ACTIVE';
                    } else if (classification.lifecycleEvent === 'CANCELLED') {
                        lifecycleEvent = 'CANCELLED';
                    } else if (classification.lifecycleEvent === 'PAYMENT_FAILED') {
                        lifecycleEvent = 'PAYMENT_FAILED';
                    }
                    await processSubscriptionEmail(
                        userId,
                        messageId,
                        headers.from,
                        gmailAccount.accessToken,
                        gmailAccount.refreshToken,
                        lifecycleEvent,
                        headers.date,
                    );
                    foundSubscription++;

                    console.log(`[Scan] Found Subscription ${foundSubscription}/${MAX_SUBSCRIPTIONS_TO_FIND}`, {
                        provider: headers.from?.split('@')[1]?.split('.')[0],
                        event: lifecycleEvent,
                    })
                }
            } catch (error) {
                console.error(`[Scan] Error processing message ${messageId}:`, error);
            }

            // chekcing if we should stop scanning
            if (
                scannnedCount >= MAX_EMAILS_TO_SCAN ||
                foundSubscription >= MAX_SUBSCRIPTIONS_TO_FIND
            ) {
                break;
            }
        }

        // checking exit conditions
        if (
            scannnedCount >= MAX_EMAILS_TO_SCAN ||
            foundSubscription >= MAX_SUBSCRIPTIONS_TO_FIND ||
            !pageToken
        ) {
            break;
        }
    }
    
    //  Move this OUTSIDE the loop
    await prisma.gmailAccount.update({
        where: { userId },
        data: {
            historicalScanCompleted: true,
            lastScannedAt: new Date(),
        },
    });

    console.log('Historical Scan Completed', {
        foundSubscription,
        scannnedCount,
    });
}
