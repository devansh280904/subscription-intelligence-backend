import { google } from 'googleapis';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  require('pdfjs-dist/legacy/build/pdf.worker.js');

/* ============================================================
   Utility: Sleep (for exponential backoff)
============================================================ */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   Gmail Client Creator
============================================================ */
function createGmailClient(accessToken: string, refreshToken: string) {
  const oauthClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  oauthClient.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return google.gmail({ version: 'v1', auth: oauthClient });
}

/* ============================================================
   Retry Wrapper for Gmail API
============================================================ */
async function retryGmailCall<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  operationName = 'Gmail API call'
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      const retryable =
        error.code === 429 ||
        error.code === 403 ||
        error.code === 500 ||
        error.code === 503;

      if (!retryable || isLastAttempt) {
        console.error(`[Gmail] ${operationName} failed:`, error);
        throw error;
      }

      const backoffMs = Math.min(Math.pow(2, attempt - 1) * 1000, 10000);
      console.warn(
        `[Gmail] ${operationName} failed (attempt ${attempt}), retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }

  throw new Error('Unexpected retry flow');
}

/* ============================================================
   Base64 URL Decoder (Gmail uses base64url)
============================================================ */
function decodeBase64(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

/* ============================================================
   HTML Stripper (fallback when text/plain missing)
============================================================ */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ============================================================
   Scan Gmail Message IDs
============================================================ */
interface ScanOptions {
  maxResults?: number;
  query?: string;
  pageToken?: string;
}

export async function scanGmailMessageIds(
  accessToken: string,
  refreshToken: string,
  options: ScanOptions = {}
): Promise<{
  messageIds: string[];
  nextPageToken?: string;
}> {
  const gmail = createGmailClient(accessToken, refreshToken);

  const response = await retryGmailCall(
    async () =>
      gmail.users.messages.list({
        userId: 'me',
        maxResults: options.maxResults ?? 20,
        q: options.query,
        pageToken: options.pageToken,
      }),
    3,
    'scanGmailMessageIds'
  );

  return {
    messageIds:
      response.data.messages
        ?.map(m => m.id)
        .filter((id): id is string => Boolean(id)) ?? [],
    nextPageToken: response.data.nextPageToken ?? undefined,
  };
}

/* ============================================================
   Fetch Gmail Message Headers
============================================================ */
export async function fetchGmailMessageHeaders(
  accessToken: string,
  refreshToken: string,
  messageId: string
) {
  const gmail = createGmailClient(accessToken, refreshToken);

  const response = await retryGmailCall(
    async () =>
      gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      }),
    3,
    `fetchHeaders:${messageId}`
  );

  const headers = response.data.payload?.headers ?? [];

  const getHeader = (name: string) =>
    headers.find(h => h.name === name)?.value ?? null;

  return {
    messageId,
    from: getHeader('From'),
    subject: getHeader('Subject'),
    date: getHeader('Date'),
  };
}

/* ============================================================
   Fetch Full Message Content (Production Ready)
============================================================ */
export async function fetchGmailMessageContent(
  accessToken: string,
  refreshToken: string,
  messageId: string
) {
  const gmail = createGmailClient(accessToken, refreshToken);

  const response = await retryGmailCall(
    async () =>
      gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      }),
    3,
    `fetchContent:${messageId}`
  );

  const payload = response.data.payload;

  let bodyText = '';
  let htmlText = '';
  let pdfText = '';

  async function traverseParts(part: any): Promise<void> {
    if (!part) return;

    // text/plain
    if (part.mimeType === 'text/plain' && part.body?.data) {
      bodyText += decodeBase64(part.body.data);
    }

    // text/html
    if (part.mimeType === 'text/html' && part.body?.data) {
      htmlText += decodeBase64(part.body.data);
    }

    // PDF attachment
    if (
      part.mimeType === 'application/pdf' &&
      part.body?.attachmentId
    ) {
      try {
        const pdf = await fetchPdfAttachmentText(
          accessToken,
          refreshToken,
          messageId,
          part.body.attachmentId
        );
        pdfText += pdf;
      } catch (err) {
        console.error(`[Scanner] PDF parsing failed:`, err);
      }
    }

    // Nested parts
    if (part.parts && part.parts.length) {
      for (const sub of part.parts) {
        await traverseParts(sub);
      }
    }
  }

  // Handle single-part emails
  if (!payload?.parts && payload?.body?.data) {
    bodyText = decodeBase64(payload.body.data);
  } else {
    await traverseParts(payload);
  }

  // If no plain text, fallback to stripped HTML
  if (!bodyText && htmlText) {
    bodyText = stripHtml(htmlText);
  }

  return {
    bodyText,
    pdfText,
  };
}

/* ============================================================
   Fetch & Parse PDF Attachment
============================================================ */
export async function fetchPdfAttachmentText(
  accessToken: string,
  refreshToken: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const gmail = createGmailClient(accessToken, refreshToken);

  const attachment = await retryGmailCall(
    async () =>
      gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      }),
    2,
    `fetchAttachment:${attachmentId}`
  );

  try {
    const buffer = Buffer.from(attachment.data.data!, 'base64');
    const uint8Array = new Uint8Array(buffer);

    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;

    let text = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');

      text += pageText + '\n';
    }

    return text;
  } catch (error) {
    console.error('[Scanner] PDF parsing error:', error);
    return '';
  }
}
