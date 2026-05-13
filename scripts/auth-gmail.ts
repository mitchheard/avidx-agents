/**
 * One-time script to generate a Google OAuth refresh token for the morning-brief agent.
 *
 * Usage:
 *   pnpm tsx scripts/auth-gmail.ts
 *
 * Prerequisites:
 *   - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set in .env
 *   - Google Cloud project with Gmail API and Calendar API enabled
 *   - OAuth 2.0 Desktop app credential (NOT web application type)
 *   - http://localhost:8080 listed as an authorized redirect URI on the OAuth client
 *     (Desktop OAuth clients auto-allow loopback; only Web app clients need this set)
 *
 * Output:
 *   Prints GOOGLE_REFRESH_TOKEN — store it in your .env and Render env group.
 *   Refresh tokens for apps in Testing mode expire after 7 days. To avoid re-running
 *   this weekly, publish the OAuth app (unverified is fine for personal use with <100 users).
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as http from 'node:http';

const CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
const CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', REDIRECT_URI);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end(`OAuth error: ${error}`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing ?code parameter');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Auth code received. You can close this tab and return to the terminal.');
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err);
      }
    });
    server.listen(PORT, () => {
      console.log(`Listening on ${REDIRECT_URI} for OAuth callback…`);
    });
  });
}

async function main(): Promise<void> {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    // Force consent screen every time so Google returns a refresh token.
    // Without this, subsequent runs return an access token only.
    prompt: 'consent',
  });

  console.log('\n─────────────────────────────────────────────────────');
  console.log('Open this URL in your browser to authorize the app:');
  console.log('─────────────────────────────────────────────────────\n');
  console.log(authUrl);
  console.log('\n─────────────────────────────────────────────────────\n');

  const code = await waitForAuthCode();

  let tokens;
  try {
    const result = await oauth2Client.getToken(code);
    tokens = result.tokens;
  } catch (err) {
    console.error('\nFailed to exchange code for tokens:', err);
    console.error(
      '\nIf you see "redirect_uri_mismatch", add http://localhost:8080 as an authorized',
    );
    console.error('redirect URI on this OAuth client in Google Cloud Console.');
    process.exit(1);
  }

  if (!tokens.refresh_token) {
    console.error('\nNo refresh token was returned.');
    console.error(
      'This usually means the app was already authorized. Revoke access and try again:',
    );
    console.error('  https://myaccount.google.com/permissions\n');
    process.exit(1);
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log('Success! Add this to your .env and Render avidx-agents-shared env group:');
  console.log('─────────────────────────────────────────────────────\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\n─────────────────────────────────────────────────────\n');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
