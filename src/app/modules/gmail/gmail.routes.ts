// src/app/modules/gmail/gmail.routes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { connectGmail, checkGmailConnection, startHistoricalScan, testGmailScan, getHistoricalScanStatus } from './gmail.controller';
import { gmailCallback } from './gmail.callback.controller';
import { authMiddleware, AuthRequest } from '../../middlewares/auth.middleware';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
const router = Router();

const tokenFromQuery = (req: Request, res: Response, next: NextFunction) => {
  const token = req.query.token as string | undefined;
  if (!token) return res.status(401).json({ message: 'Missing token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    (req as AuthRequest).user = { userId: payload.userId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// ── Disconnect: remove stored Gmail tokens from DB ──────────────────────────
const disconnectGmail = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    await prisma.gmailAccount.delete({ where: { userId } });
    return res.json({ message: 'Gmail disconnected successfully' });
  } catch (err: any) {
    // P2025 = record not found (already disconnected)
    if (err?.code === 'P2025') {
      return res.json({ message: 'Gmail was not connected' });
    }
    console.error('[Gmail] disconnectGmail error:', err);
    return res.status(500).json({ message: 'Failed to disconnect Gmail' });
  }
};

router.get   ('/connect',          tokenFromQuery, connectGmail);
router.get   ('/callback',                         gmailCallback);
router.get   ('/status',           authMiddleware, checkGmailConnection);
router.get   ('/scan/test',        authMiddleware, testGmailScan);
router.post  ('/historical-scan',  authMiddleware, startHistoricalScan);
router.delete('/account',          authMiddleware, disconnectGmail);   // ← NEW
// Matches this.http.get(`${this.base}/historical-scan/status`)
router.get('/historical-scan/status', authMiddleware, getHistoricalScanStatus);

export default router;