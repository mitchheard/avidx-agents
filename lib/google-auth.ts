import { google } from 'googleapis';
import { loadEnv } from './env';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

let _client: OAuth2Client | undefined;

export function getOAuthClient(): OAuth2Client {
  if (_client) return _client;
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Missing Google credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ' +
        'GOOGLE_REFRESH_TOKEN in .env (run scripts/auth-gmail.ts to generate the refresh token).',
    );
  }
  _client = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  _client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  return _client;
}
