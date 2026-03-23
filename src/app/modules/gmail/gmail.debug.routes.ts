import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import * as debugController from './gmail.debug.controller';

/**
 * Debug Routes for Gmail Parsing
 * Use these to see what's being extracted and why
 */

const router = Router();

/**
 * @route   GET /gmail/debug/extraction
 * @desc    Debug email extraction - see raw content and parsed results
 * @query   provider (optional) - Filter by provider (e.g., netflix.com)
 * @query   limit (optional) - Number of emails to debug (default: 5)
 * @access  Private
 */
router.get('/debug/extraction', authMiddleware, debugController.debugEmailExtraction);

/**
 * @route   GET /gmail/debug/email/:messageId
 * @desc    Get full raw content of a specific email
 * @param   messageId - Gmail message ID
 * @access  Private
 */
router.get('/debug/email/:messageId', authMiddleware, debugController.getRawEmailContent);

/**
 * @route   POST /gmail/debug/test-extraction
 * @desc    Test extraction on custom text (without scanning Gmail)
 * @body    { fromHeader, bodyText, pdfText, emailDate }
 * @access  Private
 */
router.post('/debug/test-extraction', authMiddleware, debugController.testExtraction);

export default router;