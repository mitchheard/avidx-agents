import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { getOAuthClient } from './google-auth';

const BODY_MAX_CHARS = 1000;

export type GmailMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  gmailUrl: string;
};

function getGmailClient(): gmail_v1.Gmail {
  return google.gmail({ version: 'v1', auth: getOAuthClient() });
}

function extractHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function toMessage(msg: gmail_v1.Schema$Message): GmailMessage {
  const headers = msg.payload?.headers;
  return {
    id: msg.id ?? '',
    from: extractHeader(headers, 'From'),
    subject: extractHeader(headers, 'Subject'),
    snippet: msg.snippet ?? '',
    receivedAt: extractHeader(headers, 'Date'),
    gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
  };
}

async function listMessagesSince(query: string): Promise<GmailMessage[]> {
  const gmail = getGmailClient();
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) return [];

  const detailed = await Promise.all(
    messages
      .filter((m) => m.id)
      .map((m) =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        }),
      ),
  );

  return detailed.map((r) => toMessage(r.data));
}

export async function listUnreadSince(sinceISO: string): Promise<GmailMessage[]> {
  const sinceSeconds = Math.floor(new Date(sinceISO).getTime() / 1000);
  return listMessagesSince(`is:unread in:inbox -label:Newsletters after:${sinceSeconds}`);
}

export async function listByLabelSince(label: string, sinceISO: string): Promise<GmailMessage[]> {
  const sinceSeconds = Math.floor(new Date(sinceISO).getTime() / 1000);
  return listMessagesSince(`label:${label} after:${sinceSeconds}`);
}

function extractBodyFromPart(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return '';

  if (part.body?.data) {
    // Gmail uses base64url encoding
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }

  if (part.parts) {
    // Prefer text/plain in multipart messages
    for (const p of part.parts) {
      if (p.mimeType === 'text/plain') {
        const text = extractBodyFromPart(p);
        if (text) return text;
      }
    }
    // Fall back to first part with content
    for (const p of part.parts) {
      const text = extractBodyFromPart(p);
      if (text) return text;
    }
  }

  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function getMessageBody(messageId: string): Promise<string> {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const payload = res.data.payload;
  let body = extractBodyFromPart(payload);

  // If only HTML is available, strip tags to get readable text
  if (!body && payload?.body?.data) {
    body = stripHtml(Buffer.from(payload.body.data, 'base64url').toString('utf-8'));
  }

  if (!body && payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        body = stripHtml(Buffer.from(part.body.data, 'base64url').toString('utf-8'));
        break;
      }
    }
  }

  return body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}…[truncated]` : body;
}

// Per ticket spec: authenticate with an explicit refresh token.
// The agent itself uses getOAuthClient() from lib/google-auth.ts.
export function authenticate(refreshToken: string): ReturnType<typeof getOAuthClient> {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
