import { AuthRequest } from '../../middlewares/auth.middleware';
import { Response } from 'express';
import prisma from '../../config/prisma';
import { 
  scanGmailMessageIds, 
  fetchGmailMessageHeaders, 
  fetchGmailMessageContent 
} from './gmail.scanner';
import { classifySubscriptionEmail } from './gmail.classifier';
import { extractAllSubscriptionData } from './gmail.parser';

/**
 * DEBUG ENDPOINT: View raw email content and extraction results
 * Compatible with your current parser
 */
export const debugEmailExtraction = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const { provider, limit = 5 } = req.query;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const gmailAccount = await prisma.gmailAccount.findUnique({
    where: { userId },
  });

  if (!gmailAccount) {
    return res.status(404).json({ message: 'Gmail not connected' });
  }

  try {
    const searchQuery = provider 
      ? `from:${provider}` 
      : `subscription OR billing OR invoice OR receipt`;

    const response = await scanGmailMessageIds(
      gmailAccount.accessToken,
      gmailAccount.refreshToken,
      {
        maxResults: parseInt(limit as string),
        query: searchQuery,
      }
    );

    const debugResults = [];

    for (const messageId of response.messageIds) {
      const headers = await fetchGmailMessageHeaders(
        gmailAccount.accessToken,
        gmailAccount.refreshToken,
        messageId
      );

      const { bodyText, pdfText } = await fetchGmailMessageContent(
        gmailAccount.accessToken,
        gmailAccount.refreshToken,
        messageId
      );

      const classification = classifySubscriptionEmail(
        {
          from: headers.from,
          subject: headers.subject,
        },
        bodyText
      );

      const extracted = extractAllSubscriptionData(
        headers.from,
        bodyText,
        pdfText,
        headers.date
      );

      debugResults.push({
        messageId,
        headers: {
          from: headers.from,
          subject: headers.subject,
          date: headers.date,
        },
        content: {
          bodyTextPreview: bodyText.substring(0, 500) + '...',
          bodyLength: bodyText.length,
          pdfTextPreview: pdfText.substring(0, 500) + '...',
          pdfLength: pdfText.length,
          hasContent: bodyText.length > 0 || pdfText.length > 0,
          fullTextPreview: (bodyText + '\n' + pdfText).substring(0, 1000),
        },
        classification: {
          isSubscription: classification.isSubscriptionCandidate,
          score: classification.score,
          reasons: classification.reasons,
          lifecycleEvent: classification.lifecycleEvent,
        },
        extracted: {
          provider: extracted.provider,
          amount: extracted.amount,
          currency: extracted.currency,
          billingCycle: extracted.billingCycle,
          renewalDate: extracted.renewalDate,
          startedAt: extracted.startedAt,
          planName: extracted.planName,
          trialEndDate: extracted.trialEndDate,
        },
        analysis: {
          hasBodyText: bodyText.length > 0,
          hasPdfText: pdfText.length > 0,
          providerDetected: extracted.provider !== null,
          amountDetected: extracted.amount !== null,
          datesDetected: extracted.renewalDate !== null || extracted.startedAt !== null,
        }
      });
    }

    return res.json({
      success: true,
      query: searchQuery,
      foundEmails: debugResults.length,
      results: debugResults,
      instructions: {
        howToUse: 'Look at content.fullTextPreview to see what the parser is reading',
        checkAnalysis: 'Check the analysis section to see what was detected',
        tips: [
          'If hasBodyText is false, emails are HTML-only - update gmail.scanner.ts',
          'If hasPdfText is false when there should be a PDF, check canvas installation',
          'If providerDetected is false, the email sender is not in the provider map',
          'If amountDetected is false, check if amount exists in fullTextPreview',
        ],
      },
    });
  } catch (error) {
    console.error('Debug extraction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Debug extraction failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * DEBUG ENDPOINT: Get raw email content (full text)
 */
export const getRawEmailContent = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  const messageId = Array.isArray(req.params.messageId) 
  ? req.params.messageId[0] 
  : req.params.messageId;  // ✅ Always returns string

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!messageId) {
    return res.status(400).json({ message: 'Message ID required' });
  }

  const gmailAccount = await prisma.gmailAccount.findUnique({
    where: { userId },
  });

  if (!gmailAccount) {
    return res.status(404).json({ message: 'Gmail not connected' });
  }

  try {
    const headers = await fetchGmailMessageHeaders(
      gmailAccount.accessToken,
      gmailAccount.refreshToken,
      messageId
    );

    const { bodyText, pdfText } = await fetchGmailMessageContent(
      gmailAccount.accessToken,
      gmailAccount.refreshToken,
      messageId
    );

    const extracted = extractAllSubscriptionData(
      headers.from,
      bodyText,
      pdfText,
      headers.date
    );

    return res.json({
      success: true,
      messageId,
      headers,
      content: {
        bodyText,
        pdfText,
        fullText: bodyText + '\n\n=== PDF CONTENT ===\n\n' + pdfText,
      },
      extracted,
      analysis: {
        bodyTextLength: bodyText.length,
        pdfTextLength: pdfText.length,
        hasBodyText: bodyText.length > 0,
        hasPdfText: pdfText.length > 0,
        totalLength: bodyText.length + pdfText.length,
        issue: bodyText.length === 0 ? 'Email is likely HTML-only. Update gmail.scanner.ts to handle HTML emails.' : null,
      },
    });
  } catch (error) {
    console.error('Get raw email error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get raw email',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * TEST ENDPOINT: Test extraction on custom text
 */
export const testExtraction = async (req: AuthRequest, res: Response) => {
  const { fromHeader, bodyText, pdfText, emailDate } = req.body;

  if (!bodyText) {
    return res.status(400).json({ 
      message: 'bodyText is required',
      example: {
        fromHeader: 'billing@netflix.com',
        bodyText: 'Your Netflix subscription of ₹649/month will renew on March 15, 2026',
        pdfText: '',
        emailDate: '2026-02-13',
      },
    });
  }

  try {
    const extracted = extractAllSubscriptionData(
      fromHeader || '',
      bodyText,
      pdfText || '',
      emailDate || new Date().toISOString()
    );

    return res.json({
      success: true,
      input: {
        fromHeader,
        bodyTextLength: bodyText.length,
        pdfTextLength: (pdfText || '').length,
        emailDate,
      },
      extracted,
      detectionStatus: {
        provider: extracted.provider ? '✅ Detected' : '❌ Not detected',
        amount: extracted.amount ? `✅ Detected: ₹${extracted.amount}` : '❌ Not detected',
        currency: extracted.currency ? `✅ Detected: ${extracted.currency}` : '❌ Not detected',
        billingCycle: extracted.billingCycle ? `✅ Detected: ${extracted.billingCycle}` : '❌ Not detected',
        renewalDate: extracted.renewalDate ? `✅ Detected: ${extracted.renewalDate}` : '❌ Not detected',
        startedAt: extracted.startedAt ? `✅ Detected: ${extracted.startedAt}` : '❌ Not detected',
      },
    });
  } catch (error) {
    console.error('Test extraction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Test extraction failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};