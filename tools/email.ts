import { listUnreadSince, listByLabelSince, getMessageBody } from '../lib/gmail';
import type { Tool } from './types';

const NEWSLETTER_LABEL = 'Newsletters';
const MAX_UNREAD = 20;
const MAX_NEWSLETTERS = 8;
const DEFAULT_SINCE_HOURS = 24;

function getSinceHoursInput(input: unknown): number {
  if (input && typeof input === 'object' && 'since_hours' in input) {
    const hours = (input as { since_hours?: unknown }).since_hours;
    if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0) {
      return hours;
    }
  }
  return DEFAULT_SINCE_HOURS;
}

export const emailTool: Tool = {
  def: {
    name: 'get_email_summary',
    description:
      "Get Mitch's inbox activity since N hours ago: unread messages (from/subject only, " +
      'no body — good for spotting things that need action or replies) and newsletters ' +
      '(full body text, already trimmed to a readable length — use these to extract real ' +
      "information for the brief, not just list titles). Newsletters are anything Gmail has " +
      'labeled "Newsletters"; they are excluded from the unread list so you don\'t double-count ' +
      'them. Call this once per brief with a since_hours window matching how long since the ' +
      'last brief (default 24h if unsure).',
    input_schema: {
      type: 'object',
      properties: {
        since_hours: {
          type: 'number',
          description: `How many hours back to look for new mail. Defaults to ${DEFAULT_SINCE_HOURS} if omitted.`,
        },
      },
    },
  },
  async run(input: unknown): Promise<string> {
    const sinceHours = getSinceHoursInput(input);
    const sinceISO = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

    const [unread, newsletterMeta] = await Promise.all([
      listUnreadSince(sinceISO),
      listByLabelSince(NEWSLETTER_LABEL, sinceISO),
    ]);

    const sections: string[] = [`## Unread (${unread.length} messages since ${sinceISO})`];
    if (unread.length === 0) {
      sections.push('(no unread messages)');
    } else {
      const shown = unread.slice(0, MAX_UNREAD);
      sections.push(...shown.map((m) => `- From: ${m.from} | Subject: ${m.subject}`));
      if (unread.length > MAX_UNREAD) {
        sections.push(`… and ${unread.length - MAX_UNREAD} more (truncated)`);
      }
    }

    sections.push('', `## Newsletters (${newsletterMeta.length} since ${sinceISO})`);
    if (newsletterMeta.length === 0) {
      sections.push('(no newsletters)');
    } else {
      const shown = newsletterMeta.slice(0, MAX_NEWSLETTERS);
      const bodies = await Promise.all(shown.map((n) => getMessageBody(n.id)));
      shown.forEach((n, i) => {
        sections.push(`\n### ${n.subject}`);
        sections.push(`From: ${n.from}`);
        sections.push(`Body:\n${bodies[i] || '(empty body)'}`);
      });
      if (newsletterMeta.length > MAX_NEWSLETTERS) {
        sections.push(
          `\n… and ${newsletterMeta.length - MAX_NEWSLETTERS} more newsletters not shown (truncated)`,
        );
      }
    }

    return sections.join('\n');
  },
};
