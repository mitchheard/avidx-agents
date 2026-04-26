// Stub. Real implementation lands with the ops-digest agent ticket.
// Notes for the next ticket:
//  - Self-hosted Umami uses session auth: POST /api/auth/login → Bearer token.
//  - Token is short-lived; re-auth on every agent run rather than caching.

export type UmamiDailyStats = {
  pageviews: number;
  visitors: number;
  visits: number;
};

export async function getDailyStats(_websiteId: string): Promise<UmamiDailyStats> {
  return { pageviews: 0, visitors: 0, visits: 0 };
}

export async function getSiteStats(
  _websiteId: string,
  _startISO: string,
  _endISO: string,
): Promise<UmamiDailyStats> {
  return { pageviews: 0, visitors: 0, visits: 0 };
}
