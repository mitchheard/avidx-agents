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
 *
 * NOTE ON OOB DEPRECATION:
 *   Google deprecated the OOB flow (urn:ietf:wg:oauth:2.0:oob) in Oct 2022.
 *   If this script fails with "invalid_grant" or "redirect_uri_mismatch", switch to
 *   the localhost flow: change REDIRECT_URI to "http://localhost:8080", uncomment the
 *   http.createServer block below, and add http://localhost:8080 as an authorized
 *   redirect URI in your Google Cloud OAuth credential.
 *
 * Output:
 *   Prints GOOGLE_REFRESH_TOKEN — store it in your .env and Render env group.
 *   Refresh tokens for apps in Testing mode expire after 7 days. To avoid re-running
 *   this weekly, publish the OAuth app (unverified is fine for personal use with <100 users).
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as readline from 'node:readline/promises';

const CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
const CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question('Paste the authorization code shown in the browser: ');
  rl.close();

  let tokens;
  try {
    const result = await oauth2Client.getToken(code.trim());
    tokens = result.tokens;
  } catch (err) {
    console.error('\nFailed to exchange code for tokens:', err);
    console.error('\nIf you see "redirect_uri_mismatch", OOB may be deprecated for your project.');
    console.error('See the localhost fallback instructions in the comment at the top of this file.');
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
