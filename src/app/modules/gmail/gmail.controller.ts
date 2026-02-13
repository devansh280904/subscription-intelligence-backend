import { AuthRequest } from "../../middlewares/auth.middleware";
import { Response } from "express";
import { getGmailauthUrl, testGmailConnection } from "./gmail.service";
import { enqueueJob } from "./gmail.queue";
import { runHistoricalGmailScan } from "./gmail.historical.scan.worker";
import prisma from '../../config/prisma';
import { fetchGmailMessageContent, fetchGmailMessageHeaders, scanGmailMessageIds } from './gmail.scanner';
import { classifySubscriptionEmail } from './gmail.classifier';
import { extractProviderName } from './gmail.parser';
import { processSubscriptionEmail } from './gmail.worker';

export const connectGmail = (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({
            message: 'Unauthorized'
        })
    }
    const url = getGmailauthUrl(userId);
    res.redirect(url)
}

export const startHistoricalScan = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            message: 'Unauthorized'
        })
    }

    enqueueJob(() => runHistoricalGmailScan(userId));

    return res.json({
        message: 'historical Gmail scan started this may take a few minutes'
    })
}


/* controller answers :
“Is this user’s Gmail really connected and usable right now?”
Not:
“Did the user ever connect Gmail?”
“Do we have tokens stored?”
 */
export const checkGmailConnection = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    // check if user is logged in 
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    // finds the gmail account using find unique , if exists returns 1, or else 0
    const gmailAccount = await prisma.gmailAccount.findUnique({
        where: { userId },
    });

    // if gmail is not connected 
    if (!gmailAccount) {
        return res.status(404).json({ message: 'Gmail not connected' });
    }

    try {
        // this tests uses accesstoken and verifies if token is valid, not revoked or not expired
        const profile = await testGmailConnection(gmailAccount.accessToken);

        return res.json({
            message: 'Gmail connected successfully',
            gmailProfile: profile,
        });
    } catch (error) {
        console.error('Gmail test failed', error);
        return res.status(500).json({
            message: 'Gmail connection failed',
        });
    }
};

export const testGmailScan = async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const gmailAccount = await prisma.gmailAccount.findUnique({
        where: { userId },
    });

    if (!gmailAccount) {
        return res.status(404).json({ message: 'Gmail not connected' });
    }

    console.time('TOTAL');
    console.time('LIST');

    // 1️⃣ WIDER QUERY → let classifier decide
    const response = await scanGmailMessageIds(gmailAccount.accessToken,
        gmailAccount.refreshToken, {
        maxResults: 20,
        query: `
      (
        subscription OR
        billing OR
        renewal OR
        membership OR
        invoice OR
        receipt OR
        charged OR
        trial
      )
    `,
    });
    const messageIds = response.messageIds
    console.timeEnd('LIST');

    if (messageIds.length === 0) {
        console.timeEnd('TOTAL');
        return res.status(200).json({
            message: 'No emails found',
            results: [],
        });
    }

    const results: Array<{
        headers: any;
        classification: any;
    }> = [];

    for (const messageId of messageIds) {
        // 2️⃣ Fetch headers first (cheap)
        const headers = await fetchGmailMessageHeaders(
            gmailAccount.accessToken,
            gmailAccount.refreshToken,
            messageId
        );

        // 3️⃣ Header-only classification
        let classification = classifySubscriptionEmail({
            from: headers.from,
            subject: headers.subject,
        });

        // 4️⃣ Borderline → fetch body → reclassify
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

        // 5️⃣ Strong positive → background job
        if (
            classification.isSubscriptionCandidate &&
            classification.score >= 6 &&
            headers.messageId &&
            headers.from
        ) {
            enqueueJob(() =>
                processSubscriptionEmail(
                    userId,
                    headers.messageId,
                    headers.from,
                    gmailAccount.accessToken,
                    gmailAccount.refreshToken,
                )
            );
        }

        results.push({
            headers,
            classification,
        });
    }

    console.timeEnd('TOTAL');

    const subscriptions = results.filter(
        r => r.classification.isSubscriptionCandidate && r.classification.score >= 6
    );

    return res.json({
        scannedCount: results.length,
        detectedSubscriptions: subscriptions.length,
        subscriptions,
        message: 'Scan completed. Active subscriptions detected.',
    });

};


