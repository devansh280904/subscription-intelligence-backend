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

// ✅ NEW: Track scan statistics
interface ScanStats {
    scannedCount: number;
    foundSubscriptions: number;
    errors: number;
    skipped: number;
}

export async function runHistoricalGmailScan(userId: string) {
    console.log('[Scan] Historical scan started for user:', userId);

    const gmailAccount = await prisma.gmailAccount.findUnique({
        where: { userId },
    });

    if (!gmailAccount) {
        throw new Error('gmail account not found');
    }

    if (gmailAccount.historicalScanCompleted) {
        console.log('[Scan] Historical scan already completed');
        return;
    }

    const stats: ScanStats = {
        scannedCount: 0,
        foundSubscriptions: 0,
        errors: 0,
        skipped: 0,
    };

    let pageToken: string | undefined;

    try {
        while (true) {
            // ✅ IMPROVED: Better error handling for API calls
            let response;
            try {
                response = await scanGmailMessageIds(
                    gmailAccount.accessToken,
                    gmailAccount.refreshToken, 
                    {
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
                    }
                );
            } catch (error) {
                console.error('[Scan] Fatal error fetching message IDs:', error);
                // Break the loop on critical API errors
                break;
            }

            const messageIds = response.messageIds;
            pageToken = response.nextPageToken;

            if (!messageIds || messageIds.length === 0) break;

            console.log(`[Scan] Processing batch of ${messageIds.length} messages...`);

            for (const messageId of messageIds) {
                stats.scannedCount++;
                
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

                    // ✅ IMPROVED: Better classification thresholds
                    if (classification.score >= 2 && classification.score < 6) {
                        try {
                            const response = await fetchGmailMessageContent(
                                gmailAccount.accessToken,
                                gmailAccount.refreshToken,
                                messageId
                            );
                            const body = response.bodyText;
                            
                            classification = classifySubscriptionEmail(
                                {
                                    from: headers.from,
                                    subject: headers.subject,
                                },
                                body
                            );
                        } catch (error) {
                            console.error(`[Scan] Error fetching message content ${messageId}:`, error);
                            stats.errors++;
                            continue;
                        }
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
                        
                        try {
                            await processSubscriptionEmail(
                                userId,
                                messageId,
                                headers.from,
                                gmailAccount.accessToken,
                                gmailAccount.refreshToken,
                                lifecycleEvent,
                                headers.date,
                            );
                            stats.foundSubscriptions++;

                            console.log(`[Scan] ✅ Found Subscription ${stats.foundSubscriptions}/${MAX_SUBSCRIPTIONS_TO_FIND}`, {
                                provider: headers.from?.split('@')[1]?.split('.')[0],
                                event: lifecycleEvent,
                                score: classification.score,
                            });
                        } catch (error) {
                            console.error(`[Scan] Error processing subscription ${messageId}:`, error);
                            stats.errors++;
                        }
                    } else {
                        stats.skipped++;
                    }
                } catch (error) {
                    console.error(`[Scan] Error processing message ${messageId}:`, error);
                    stats.errors++;
                }

                // checking if we should stop scanning
                if (
                    stats.scannedCount >= MAX_EMAILS_TO_SCAN ||
                    stats.foundSubscriptions >= MAX_SUBSCRIPTIONS_TO_FIND
                ) {
                    console.log('[Scan] Reached scan limits, stopping...');
                    break;
                }
            }

            // checking exit conditions
            if (
                stats.scannedCount >= MAX_EMAILS_TO_SCAN ||
                stats.foundSubscriptions >= MAX_SUBSCRIPTIONS_TO_FIND ||
                !pageToken
            ) {
                break;
            }

            // ✅ NEW: Small delay between pages to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } catch (error) {
        console.error('[Scan] Critical error during scan:', error);
        throw error;
    } finally {
        // ✅ IMPROVED: Always update scan status with final stats
        await prisma.gmailAccount.update({
            where: { userId },
            data: {
                historicalScanCompleted: true,
                lastScannedAt: new Date(),
            },
        });

        console.log('[Scan] Historical Scan Completed', {
            scanned: stats.scannedCount,
            found: stats.foundSubscriptions,
            errors: stats.errors,
            skipped: stats.skipped,
        });
    }
}