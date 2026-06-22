import { loadEnv } from '../../lib/env';
import { callClaude } from '../../lib/claude';
import { postToChannel } from '../../lib/slack';
import { logger } from '../../lib/logger';
import { listUnreadSince, listByLabelSince, getMessageBody, type GmailMessage } from '../../lib/gmail';
import { listEventsNextNDays, type CalendarEvent } from '../../lib/calendar';
import { getAgentLastRun, setAgentLastRun } from '../../lib/notion';
import { MORNING_BRIEF_SYSTEM_PROMPT } from './prompts';
import type { IncomingWebhookSendArguments } from '@slack/webhook';

const AGENT_NAME = 'morning-brief';
const NEWSLETTER_LABEL = 'Newsletters';
const MAX_NEWSLETTERS = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

type MorningBrief = {
  date: string;
  greeting: string;
  calendar: {
    today: Array<{ time: string; title: string; location?: string }>;
    upcoming: Array<{ date: string; title: string }>;
  };
  unread_highlights: Array<{ from: string; subject: string; why_flagged?: string }>;
  unread_count_total: number;
  newsletter_summary: {
    count: number;
    one_liner: string;
    highlights: Array<{ source: string; summary: string }>;
    also_received?: string;
  };
};

// ── Payload builder ───────────────────────────────────────────────────────────

function formatEvent(evt: CalendarEvent): string {
  const time = evt.isAllDay
    ? 'All day'
    : new Date(evt.start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Chicago',
      });
  const loc = evt.location ? ` (${evt.location})` : '';
  return `- ${time}: ${evt.title}${loc}`;
}

function buildPayload(
  today: string,
  unread: GmailMessage[],
  newsletters: Array<GmailMessage & { body: string }>,
  events: CalendarEvent[],
  sinceISO: string,
): string {
  // Multi-day all-day events (e.g. "Hyatt Weekend") start before today but
  // overlap today — treat them as today events, not upcoming.
  const todayEvents = events.filter(
    (e) =>
      e.start.startsWith(today) ||
      (e.isAllDay && e.start.slice(0, 10) < today && e.end > today),
  );
  const upcomingEvents = events.filter((e) => e.start.slice(0, 10) > today);

  const sections: string[] = [
    `Today: ${today}`,
    '',
    '## Calendar: Today',
    ...(todayEvents.length ? todayEvents.map(formatEvent) : ['(no events today)']),
    '',
    '## Calendar: Upcoming (next 2 days)',
    ...(upcomingEvents.length
      ? upcomingEvents.map((e) => {
          const day = new Date(e.start.length === 10 ? e.start + 'T12:00:00' : e.start)
            .toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
          const timeStr = e.isAllDay
            ? ''
            : ` — ${new Date(e.start).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Chicago',
              })}`;
          const loc = e.location ? ` (${e.location})` : '';
          return `- ${day}: ${e.title}${timeStr}${loc}`;
        })
      : ['(nothing upcoming)']),
    '',
    `## Gmail: Unread (${unread.length} messages since ${sinceISO})`,
    ...(unread.length
      ? unread.slice(0, 30).map((m) => `- From: ${m.from} | Subject: ${m.subject}`)
      : ['(no unread messages)']),
    '',
    `## Gmail: Newsletters (${newsletters.length} since ${sinceISO})`,
  ];

  if (newsletters.length === 0) {
    sections.push('(no newsletters)');
  } else {
    for (let i = 0; i < newsletters.length; i++) {
      const n = newsletters[i]!;
      sections.push(`\n### Newsletter ${i + 1}: ${n.subject}`);
      sections.push(`From: ${n.from}`);
      sections.push(`Body:\n${n.body || '(empty body)'}`);
    }
  }

  return sections.join('\n');
}

// ── JSON parse ────────────────────────────────────────────────────────────────

function parseBrief(raw: string): MorningBrief | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const cleaned = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw.trim();
  try {
    const parsed = JSON.parse(cleaned) as MorningBrief;
    if (!parsed.date || !parsed.greeting || !parsed.calendar) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Slack Block Kit ───────────────────────────────────────────────────────────

type SlackBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji: boolean } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' };

const header = (text: string): SlackBlock => ({
  type: 'header',
  text: { type: 'plain_text', text, emoji: true },
});
const section = (text: string): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});
const divider = (): SlackBlock => ({ type: 'divider' });

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildBlocks(brief: MorningBrief): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push(header(`☀️ Morning Brief — ${formatDate(brief.date)}`));
  blocks.push(section(brief.greeting));

  // Calendar
  const calLines: string[] = ['*📅 Today*'];
  if (brief.calendar.today.length === 0) {
    calLines.push('No events today.');
  } else {
    for (const e of brief.calendar.today) {
      const loc = e.location ? ` — ${e.location}` : '';
      calLines.push(`• ${e.time}: ${e.title}${loc}`);
    }
  }
  if (brief.calendar.upcoming.length > 0) {
    calLines.push('');
    calLines.push('*Upcoming*');
    for (const e of brief.calendar.upcoming) {
      calLines.push(`• ${e.date}: ${e.title}`);
    }
  }
  blocks.push(section(calLines.join('\n')));

  // Unread
  const unreadLines = [
    `*📧 Unread (${brief.unread_count_total})*  <https://mail.google.com/mail/u/0/#inbox|Open Gmail>`,
  ];
  if (brief.unread_highlights.length === 0) {
    unreadLines.push('Inbox zero. 🎉');
  } else {
    for (const m of brief.unread_highlights) {
      const flag = m.why_flagged ? ` — _${m.why_flagged}_` : '';
      unreadLines.push(`• *${m.from}* — ${m.subject}${flag}`);
    }
  }
  blocks.push(section(unreadLines.join('\n')));

  blocks.push(divider());

  // Newsletters
  const nlLines = [
    `*📰 Newsletters (${brief.newsletter_summary.count})*`,
    brief.newsletter_summary.one_liner,
  ];
  if (brief.newsletter_summary.highlights.length > 0) {
    nlLines.push('');
    for (const h of brief.newsletter_summary.highlights) {
      nlLines.push(`• *${h.source}:* ${h.summary}`);
    }
  }
  if (brief.newsletter_summary.also_received) {
    nlLines.push('');
    nlLines.push(`_Also in: ${brief.newsletter_summary.also_received}_`);
  }
  blocks.push(section(nlLines.join('\n')));

  return blocks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const lastRun = await getAgentLastRun(AGENT_NAME);
  const sinceISO = lastRun ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ctDate = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [m, d, y] = ctDate.split('/');
  const today = `${y}-${m}-${d}`;

  logger.info(`${AGENT_NAME}: fetching data since ${sinceISO}`);

  const [unread, newsletterMeta, events] = await Promise.all([
    listUnreadSince(sinceISO),
    listByLabelSince(NEWSLETTER_LABEL, sinceISO),
    listEventsNextNDays(3),
  ]);

  // Fetch newsletter bodies (cap at MAX_NEWSLETTERS, in parallel)
  const newsletters = await Promise.all(
    newsletterMeta.slice(0, MAX_NEWSLETTERS).map(async (n) => ({
      ...n,
      body: await getMessageBody(n.id),
    })),
  );

  const payload = buildPayload(today, unread, newsletters, events, sinceISO);

  logger.info(`${AGENT_NAME}: calling Claude`);
  const raw = await callClaude([{ role: 'user', content: payload }], {
    system: MORNING_BRIEF_SYSTEM_PROMPT,
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
  });

  const brief = parseBrief(raw);

  if (!brief) {
    logger.warn(`${AGENT_NAME}: JSON parse failed — posting raw response to #inbox`);
    await postToChannel('inbox', `*Morning Brief*\n\n${raw}`);
  } else {
    const blocks = buildBlocks(brief);
    await postToChannel(
      'inbox',
      brief.greeting,
      blocks as IncomingWebhookSendArguments['blocks'],
    );
    logger.info(`${AGENT_NAME}: posted to #inbox`);
  }

  // Persist last-run timestamp (non-critical)
  try {
    await setAgentLastRun(AGENT_NAME, new Date().toISOString());
  } catch (err) {
    logger.warn(`${AGENT_NAME}: failed to update last-run in Notion (non-critical):`, err);
  }
}

main().catch(async (err: unknown) => {
  await logger.error(AGENT_NAME, err);
  process.exit(1);
});
