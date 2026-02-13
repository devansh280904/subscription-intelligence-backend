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
    console.log('🔥🔥🔥 SCAN CONTROLLER FILE HIT 🔥🔥🔥');

    // gmail api client is as :
    // const gmail = google.gmail({version: 'v1', auth})

    // using access token stored for the authentication to pass as 'auth'


    const gmail = creategmailClient(accessToken, refreshToken)

    // response from google. retrieving Users message list by passing userId : 'me, and options params  
    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: options.maxResults ?? 20,
        q: options.query,
        pageToken: options.pageToken
    })

    // google could either send message as array or no messages at all ( undefined )
    // so if null or undefined use []
    const messages = response.data.messages ?? [];

    // only returning message id 
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

    // response from google. retrieving Users message list by passing userId : 'me, and options params  
    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
    })

    // If payload exists, get headers; otherwise return undefined
    // If headers are undefined or null, use an empty array
    const headers = response.data.payload?.headers ?? [];

    // Search the headers array for a header with this name. If found, return its value. If not found, return null
    // If .find() returns an object → get .value
    // If .find() returns undefined → don’t crash
    const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? null;
    return {
        messageId,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
    };
}

export async function fetchGmailMessageContent(
    accessToken: string,
    refreshToken: string,
    messageId: string) {

    const gmail = creategmailClient(accessToken, refreshToken)

    // response from google. retrieving Users message list by passing userId : 'me, and options params  
    const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
    })
    const parts = response.data.payload?.parts || [];

    let bodyText = '';
    let pdfText = '';

    for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }

        if (part.mimeType === 'application/pdf' &&
            part.body?.attachmentId
        ) {
            pdfText = await fetchPdfAttachmentText(
                accessToken,
                refreshToken,
                messageId,
                part.body.attachmentId
            );
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
}