import { Router } from "express";   
import { connectGmail, startHistoricalScan } from "./gmail.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { checkGmailConnection, testGmailScan } from "./gmail.controller";
import { gmailCallback } from "./gmail.callback.controller";
import * as debugController from './gmail.debug.controller';

// Add these routes at the bottom:
const router = Router()

router.get('/connect', authMiddleware, connectGmail)
router.get('/callback', gmailCallback);
router.get('/status', authMiddleware, checkGmailConnection);
router.get('/scan/test', authMiddleware, testGmailScan)
router.post('/historical-scan', authMiddleware, startHistoricalScan)
router.get('/debug/extraction', authMiddleware, debugController.debugEmailExtraction);
router.get('/debug/email/:messageId', authMiddleware, debugController.getRawEmailContent);
router.post('/debug/test-extraction', authMiddleware, debugController.testExtraction);

export default router