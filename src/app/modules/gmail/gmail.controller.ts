// src/app/modules/gmail/gmail.controller.ts
import { AuthRequest } from "../../middlewares/auth.middleware";
import { Response } from "express";
import { getGmailauthUrl, testGmailConnection } from "./gmail.service";
import { enqueueJob, cancelCurrentJob } from "./gmail.queue";
import { runHistoricalScan } from "./gmail.historical.scan.worker";
import prisma from '../../config/prisma';
import { fetchGmailMessageHeaders, scanGmailMessageIds } from './gmail.scanner';
import { classifySubscriptionEmail } from './gmail.classifier';
import { processSubscriptionEmail } from './gmail.worker';
import { scanState } from './gmail.historical.scan.worker';

export const connectGmail = (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const url = getGmailauthUrl(userId);
  res.redirect(url);
};

export const startHistoricalScan = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  enqueueJob(() => runHistoricalScan(userId));

  return res.json({ message: 'Historical Gmail scan started. This may take a few minutes.' });
};


export const getHistoricalScanStatus = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const state = scanState.get(userId);

  if (!state) {
    // If no active scan in memory, check the database
    const account = await prisma.gmailAccount.findUnique({ where: { userId } });
    return res.json({
      status: account?.historicalScanCompleted ? 'completed' : 'idle',
      progress: null
    });
  }

  return res.json(state);
};
/**
 * POST /gmail/historical-scan/stop
 * Sets the global stop flag so the scan worker exits after the current
 * provider finishes (graceful drain — no partial writes).
 */
export const stopHistoricalScan = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  cancelCurrentJob();

  return res.json({ message: 'Scan stop requested. Finishing current provider then stopping.' });
};

export const checkGmailConnection = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const gmailAccount = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!gmailAccount) return res.status(404).json({ message: 'Gmail not connected' });

  try {
    const profile = await testGmailConnection(gmailAccount.accessToken);
    return res.json({ message: 'Gmail connected successfully', gmailProfile: profile });
  } catch (error) {
    console.error('Gmail test failed', error);
    return res.status(500).json({ message: 'Gmail connection failed' });
  }
};

export const testGmailScan = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const gmailAccount = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!gmailAccount) return res.status(404).json({ message: 'Gmail not connected' });

  const response = await scanGmailMessageIds(
    gmailAccount.accessToken, gmailAccount.refreshToken,
    { maxResults: 20, query: `(subscription OR billing OR renewal OR membership OR invoice OR receipt OR charged OR trial)` }
  );

  if (response.messageIds.length === 0) return res.json({ message: 'No emails found', results: [] });

  const results: any[] = [];
  for (const messageId of response.messageIds) {
    const headers = await fetchGmailMessageHeaders(
      gmailAccount.accessToken, gmailAccount.refreshToken, messageId
    );
    const classification = classifySubscriptionEmail({ from: headers.from, subject: headers.subject });

    if (classification.isSubscriptionEmail && headers.messageId && headers.from) {
      enqueueJob(() =>
        processSubscriptionEmail(
          userId, headers.messageId, headers.from,
          gmailAccount.accessToken, gmailAccount.refreshToken
        )
      );
    }
    results.push({ headers, classification });
  }

  const subscriptions = results.filter(r => r.classification.isSubscriptionEmail);
  return res.json({
    scannedCount: results.length,
    detectedSubscriptions: subscriptions.length,
    subscriptions,
    message: 'Scan completed',
  });
};