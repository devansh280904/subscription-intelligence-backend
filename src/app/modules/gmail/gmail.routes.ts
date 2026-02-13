import { Router } from "express";   
import { connectGmail, startHistoricalScan } from "./gmail.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { checkGmailConnection, testGmailScan } from "./gmail.controller";
import { gmailCallback } from "./gmail.callback.controller";

const router = Router()

router.get('/connect', authMiddleware, connectGmail)
router.get('/callback', gmailCallback);
router.get('/status', authMiddleware, checkGmailConnection);
router.get('/scan/test', authMiddleware, testGmailScan)
router.post('/historical-scan', authMiddleware, startHistoricalScan)

export default router