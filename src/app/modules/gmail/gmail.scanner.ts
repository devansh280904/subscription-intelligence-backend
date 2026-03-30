import { google } from 'googleapis';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  require('pdfjs-dist/legacy/build/pdf.worker.js');

function createGmailClient(accessToken: string, refreshToken: string) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth });
}

interface ScanOptions { maxResults?: number; query?: string; pageToken?: string; }

export async function scanGmailMessageIds(
  accessToken: string, refreshToken: string, options: ScanOptions = {}
): Promise<{ messageIds: string[]; nextPageToken?: string }> {
  const gmail = createGmailClient(accessToken, refreshToken);
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: options.maxResults ?? 100,
    q: options.query,
    pageToken: options.pageToken,
  });
  return {
    messageIds: res.data.messages?.map(m => m.id).filter((id): id is string => !!id) ?? [],
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

export async function fetchGmailMessageHeaders(
  accessToken: string, refreshToken: string, messageId: string
) {
  const gmail = createGmailClient(accessToken, refreshToken);
  const res = await gmail.users.messages.get({
    userId: 'me', id: messageId, format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Date'],
  });
  const hdrs = res.data.payload?.headers ?? [];
  const get = (n: string) => hdrs.find(h => h.name === n)?.value ?? null;
  return { messageId, from: get('From'), subject: get('Subject'), date: get('Date') };
}

function decodeBase64url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(?:p|div|tr|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#8377;/g, '₹').replace(/&euro;/g, '€').replace(/&pound;/g, '£')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function collectParts(payload: any): { plain: string; html: string } {
  const r = { plain: '', html: '' };
  if (!payload) return r;
  const mime = (payload.mimeType || '').toLowerCase();
  if (payload.body?.data) {
    const text = decodeBase64url(payload.body.data);
    if (mime === 'text/plain') r.plain += text + '\n';
    else if (mime === 'text/html') r.html += text + '\n';
    return r;
  }
  for (const part of (payload.parts ?? [])) {
    const c = collectParts(part);
    r.plain += c.plain; r.html += c.html;
  }
  return r;
}

function bestBodyText(payload: any): string {
  const { plain, html } = collectParts(payload);
  const cleanPlain = plain.trim();
  const cleanHtml  = html.trim() ? stripHtml(html) : '';
  if (cleanPlain.length > 100) return cleanPlain;
  if (cleanHtml.length > 50)  return cleanHtml;
  return (cleanPlain + '\n' + cleanHtml).trim();
}

function findPdfs(payload: any): Array<{ attachmentId: string }> {
  if (!payload) return [];
  const found: Array<{ attachmentId: string }> = [];
  if (payload.mimeType === 'application/pdf' && payload.body?.attachmentId) {
    found.push({ attachmentId: payload.body.attachmentId });
  }
  for (const part of (payload.parts ?? [])) found.push(...findPdfs(part));
  return found;
}

export async function fetchGmailMessageContent(
  accessToken: string, refreshToken: string, messageId: string
): Promise<{ bodyText: string; pdfText: string }> {
  const gmail = createGmailClient(accessToken, refreshToken);
  const res   = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const bodyText = bestBodyText(res.data.payload);
  console.log(`📧 ${messageId}: ${bodyText.length} chars`);

  let pdfText = '';
  for (const { attachmentId } of findPdfs(res.data.payload)) {
    try {
      const t = await fetchPdfAttachmentText(accessToken, refreshToken, messageId, attachmentId);
      pdfText += t + '\n';
    } catch (e) { console.error(`❌ PDF failed:`, e); }
  }
  return { bodyText, pdfText: pdfText.trim() };
}

export async function fetchPdfAttachmentText(
  accessToken: string, refreshToken: string, messageId: string, attachmentId: string
): Promise<string> {
  const gmail = createGmailClient(accessToken, refreshToken);
  try {
    const att  = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
    const buf  = Buffer.from(att.data.data!, 'base64');
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
    const pdf  = await task.promise;
    let text   = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg  = await pdf.getPage(i);
      const ct  = await pg.getTextContent();
      text += ct.items.map((x: any) => x.str).join(' ') + '\n';
    }
    return text;
  } catch (e) { console.error('PDF parse error:', e); return ''; }
}