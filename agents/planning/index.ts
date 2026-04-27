import { parseArgs } from 'node:util';
import { loadEnv } from '../../lib/env';
import { callClaude } from '../../lib/claude';
import { postToChannel } from '../../lib/slack';
import { logger } from '../../lib/logger';
import { getOpenIssues, getRecentlyCompleted, type LinearIssue } from '../../lib/linear';
import { getAvidXHub, getProductPage, updateCurrentFocus, type HubContent } from '../../lib/notion';
import { KICKOFF_SYSTEM_PROMPT, RUNWAY_SYSTEM_PROMPT } from './prompts';
import type { IncomingWebhookSendArguments } from '@slack/webhook';

// ── Types ────────────────────────────────────────────────────────────────────

type Mode = 'kickoff' | 'runway';

type PlanningDigest = {
  mode: Mode;
  date: string;
  one_liner: string;
  primary_focus: { title: string; ticket_id: string | null; body: string };
  supporting: Array<{ ticket_id: string; title: string; why: string }>;
  flags: Array<{ severity: 'red' | 'yellow'; item: string; action: string }>;
  dont_touch?: Array<{ item: string; reason: string }>;
  definition_of_done: string;
  notion_current_focus_update: string;
};

// ── Args ─────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { mode: { type: 'string' } },
  strict: false,
});

function parseMode(): Mode {
  const m = values.mode;
  if (m !== 'kickoff' && m !== 'runway') {
    console.error('Usage: tsx agents/planning/index.ts --mode=kickoff|runway');
    process.exit(1);
  }
  return m;
}

const mode: Mode = parseMode();

const AGENT_NAME = `planning-${mode}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function linearUrl(identifier: string): string {
  return `https://linear.app/avidx/issue/${identifier}`;
}

function formatIssue(issue: LinearIssue): string {
  const p = issue.priority ? ` [${issue.priorityLabel}]` : '';
  return `- ${issue.identifier} — ${issue.title}${p}`;
}

function buildPayload(
  m: Mode,
  open: LinearIssue[],
  completed: LinearIssue[],
  hub: HubContent,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lookback = m === 'kickoff' ? 3 : 5;
  const inProgress = open.filter((i) => i.stateType === 'started');
  const highBacklog = open.filter((i) => i.stateType !== 'started');

  return [
    `Today: ${today}`,
    `Mode: ${m}`,
    '',
    '## Linear: In Progress',
    ...(inProgress.length ? inProgress.map(formatIssue) : ['(none)']),
    '',
    '## Linear: High Priority Backlog',
    ...(highBacklog.length ? highBacklog.map(formatIssue) : ['(none)']),
    '',
    `## Linear: Recently Completed (last ${lookback} days)`,
    ...(completed.length ? completed.map(formatIssue) : ['(nothing completed in this window)']),
    '',
    '## Notion: Current Focus',
    hub.currentFocusMarkdown || '(empty)',
  ].join('\n');
}

function parseDigest(raw: string): PlanningDigest | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const cleaned = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw.trim();
  try {
    const parsed = JSON.parse(cleaned) as PlanningDigest;
    if (!parsed.mode || !parsed.date || !parsed.primary_focus) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Slack Block Kit ────────────────────────────────────────────────────────────

type MrkdwnSection = { type: 'section'; text: { type: 'mrkdwn'; text: string } };
type HeaderBlock = { type: 'header'; text: { type: 'plain_text'; text: string; emoji: boolean } };
type DividerBlock = { type: 'divider' };
type SlackBlock = MrkdwnSection | HeaderBlock | DividerBlock;

const header = (text: string): HeaderBlock => ({
  type: 'header',
  text: { type: 'plain_text', text, emoji: true },
});
const section = (text: string): MrkdwnSection => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});
const divider = (): DividerBlock => ({ type: 'divider' });

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function ticketLink(id: string | null, label?: string): string {
  if (!id) return '';
  return `<${linearUrl(id)}|${label ?? id}>`;
}

function buildKickoffBlocks(d: PlanningDigest): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push(header(`🗓️ Monday Kickoff — ${formatDate(d.date)}`));
  blocks.push(section(`_${d.one_liner}_`));
  blocks.push(divider());

  // Primary focus
  const focusLines = [
    '*🎯 This week\'s focus*',
    `*${d.primary_focus.title}*`,
    d.primary_focus.body,
  ];
  if (d.primary_focus.ticket_id) {
    focusLines.push(ticketLink(d.primary_focus.ticket_id, d.primary_focus.ticket_id));
  }
  blocks.push(section(focusLines.join('\n')));

  // Supporting
  if (d.supporting.length > 0) {
    const lines = [
      '*📋 Supporting tasks*',
      ...d.supporting.map((t) => `• ${ticketLink(t.ticket_id)} — ${t.title}: ${t.why}`),
    ];
    blocks.push(section(lines.join('\n')));
  }

  // Flags
  if (d.flags.length > 0) {
    const lines = [
      '*🚩 Time-sensitive flags*',
      ...d.flags.map((f) => `${f.severity === 'red' ? '🔴' : '🟡'} ${f.item} — ${f.action}`),
    ];
    blocks.push(section(lines.join('\n')));
  }

  blocks.push(divider());
  blocks.push(section(`*✅ Definition of done*\n${d.definition_of_done}`));

  return blocks;
}

function buildRunwayBlocks(d: PlanningDigest): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push(header(`🌅 Friday Runway — ${formatDate(d.date)}`));
  blocks.push(section(`_${d.one_liner}_`));

  // Weekend focus
  const focusLines = [
    '*🎯 Weekend focus*',
    `*${d.primary_focus.title}*`,
    d.primary_focus.body,
  ];
  if (d.supporting.length > 0) {
    focusLines.push('');
    for (const t of d.supporting) {
      focusLines.push(`• ${ticketLink(t.ticket_id)} — ${t.title}: ${t.why}`);
    }
  }
  blocks.push(section(focusLines.join('\n')));

  // Don't touch
  if (d.dont_touch && d.dont_touch.length > 0) {
    const lines = [
      '*❌ Don\'t touch this weekend*',
      ...d.dont_touch.map((dt) => `• *${dt.item}* — ${dt.reason}`),
    ];
    blocks.push(section(lines.join('\n')));
  }

  // Flags
  if (d.flags.length > 0) {
    const lines = [
      '*🚩 Time-sensitive*',
      ...d.flags.map((f) => `${f.severity === 'red' ? '🔴' : '🟡'} ${f.item} — ${f.action}`),
    ];
    blocks.push(section(lines.join('\n')));
  }

  blocks.push(section(`*✅ What makes this a good weekend*\n${d.definition_of_done}`));

  return blocks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const lookbackDays = mode === 'kickoff' ? 3 : 5;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  logger.info(`${AGENT_NAME}: fetching Linear + Notion data`);

  const [[open, completed], hub] = await Promise.all([
    Promise.all([getOpenIssues(), getRecentlyCompleted(since.toISOString())]),
    getAvidXHub(),
  ]);

  // Fetch referenced product pages (only what Current Focus explicitly links to)
  let extraContext = '';
  if (hub.referencedPageIds.length > 0) {
    const pages = await Promise.all(hub.referencedPageIds.map(getProductPage));
    extraContext = pages.filter(Boolean).join('\n\n---\n\n');
  }

  const payload = buildPayload(mode, open, completed, hub);
  const userMessage = extraContext ? `${payload}\n\n## Referenced product pages\n${extraContext}` : payload;

  logger.info(`${AGENT_NAME}: calling Claude`);

  const systemPrompt = mode === 'kickoff' ? KICKOFF_SYSTEM_PROMPT : RUNWAY_SYSTEM_PROMPT;
  const raw = await callClaude([{ role: 'user', content: userMessage }], {
    system: systemPrompt,
    maxTokens: 4096,
  });

  const digest = parseDigest(raw);

  if (!digest) {
    logger.warn(`${AGENT_NAME}: JSON parse failed — posting raw response to #digest`);
    await postToChannel('digest', `*Planning digest (${mode})*\n\n${raw}`);
    return;
  }

  const blocks = mode === 'kickoff' ? buildKickoffBlocks(digest) : buildRunwayBlocks(digest);
  await postToChannel(
    'digest',
    digest.one_liner,
    blocks as IncomingWebhookSendArguments['blocks'],
  );

  logger.info(`${AGENT_NAME}: posted to #digest`);

  // Update Notion Current Focus — non-critical, never fail the agent
  if (digest.notion_current_focus_update) {
    try {
      await updateCurrentFocus(digest.notion_current_focus_update);
      logger.info(`${AGENT_NAME}: updated Notion Current Focus`);
    } catch (err) {
      logger.warn(`${AGENT_NAME}: Notion update failed (non-critical):`, err);
    }
  }
}

main().catch(async (err: unknown) => {
  await logger.error(AGENT_NAME, err);
  process.exit(1);
});
