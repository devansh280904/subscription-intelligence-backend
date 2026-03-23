import { google } from 'googleapis';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    require('pdfjs-dist/legacy/build/pdf.worker.js');

function creategmailClient(accessToken: string, refreshToken: string) {
    const oauthclient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI);
    oauthclient.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    return google.gmail({ version: 'v1', auth: oauthclient })
}

interface ScanOptions {
    maxResults?: number;
    query?: string
    pageToken?: string;
}

export async function scanGmailMessageIds(
    accessToken: string,
    refreshToken: string,
    options: ScanOptions = {}): Promise<{
        messageIds: string[];
        nextPageToken?: string;
    }> {
    console.log('🔥 SCAN CONTROLLER FILE HIT 🔥');

    const gmail = creategmailClient(accessToken, refreshToken)

    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: options.maxResults ?? 20,
        q: options.query,
        pageToken: options.pageToken
    })

    const messages = response.data.messages ?? [];

    return {
        messageIds:
            response.data.messages?.map(m => m.id)
                .filter((id): id is string => Boolean(id)) ?? [],
        nextPageToken: response.data.nextPageToken ?? undefined,
    };
}

export async function fetchGmailMessageHeaders(
    accessToken: string,
    refreshToken: string,
    messageId: string,
) {
    const gmail = creategmailClient(accessToken, refreshToken)

    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
    })

    const headers = response.data.payload?.headers ?? [];

    const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? null;
        
    return {
        messageId,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
    };
}

/**
 * Strip HTML tags and decode HTML entities
 * This is CRITICAL - most emails are HTML-only!
 */
function stripHtmlTags(html: string): string {
    if (!html) return '';
    
    return html
        // Remove style and script tags with content
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        // Remove HTML comments
        .replace(/<!--.*?-->/gs, '')
        // Remove all HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Decode common HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .replace(/&#8377;/g, '₹')  // Rupee symbol
        .replace(/&euro;/g, '€')
        .replace(/&pound;/g, '£')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Recursively extract text from email payload parts
 * Handles both plain text AND HTML (most emails are HTML!)
 */
function extractEmailBody(payload: any): string {
    let text = '';

    // Handle direct body (single part email)
    if (payload.body?.data) {
        const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        
        if (payload.mimeType === 'text/plain') {
            text = decoded;
        } else if (payload.mimeType === 'text/html') {
            // ✅ CRITICAL: Extract text from HTML!
            text = stripHtmlTags(decoded);
        }
        
        return text;
    }

    // Handle multipart email
    if (payload.parts && Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
            // Try plain text first
            if (part.mimeType === 'text/plain' && part.body?.data) {
                text += Buffer.from(part.body.data, 'base64').toString('utf-8') + '\n';
            } 
            // If no plain text, use HTML
            else if (part.mimeType === 'text/html' && part.body?.data) {
                const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
                text += stripHtmlTags(html) + '\n';
            }
            // Recursive for nested multipart
            else if (part.parts) {
                text += extractEmailBody(part) + '\n';
            }
        }
    }

    return text.trim();
}

export async function fetchGmailMessageContent(
    accessToken: string,
    refreshToken: string,
    messageId: string) {

    const gmail = creategmailClient(accessToken, refreshToken)

    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
    })

    // ✅ NEW: Use recursive extraction that handles HTML
    const bodyText = extractEmailBody(response.data.payload!);
    
    console.log(`📧 Email ${messageId}: extracted ${bodyText.length} chars`);

    // Extract PDF attachments
    const parts = response.data.payload?.parts || [];
    let pdfText = '';

    for (const part of parts) {
        if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
            console.log(`📄 PDF attachment found in ${messageId}`);
            try {
                pdfText = await fetchPdfAttachmentText(
                    accessToken,
                    refreshToken,
                    messageId,
                    part.body.attachmentId
                );
                console.log(`📄 PDF extracted: ${pdfText.length} chars`);
            } catch (error) {
                console.error(`❌ PDF extraction failed for ${messageId}:`, error);
            }
        }
    }

    return {
        bodyText,
        pdfText
    };
}

export async function fetchPdfAttachmentText(
    accessToken: string,
    refreshToken: string,
    messageId: string,
    attachmentId: string,
): Promise<string> {
    const gmail = creategmailClient(accessToken, refreshToken)

    try {
        const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: attachmentId,
        });

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
        console.error('PDF parsing error:', error);
        return ''; // Return empty string instead of failing
    }
}