import { listEventsNextNDays } from '../lib/calendar';
import type { Tool } from './types';

const MAX_EVENTS = 30;
const DEFAULT_DAYS = 3;

function getDaysInput(input: unknown): number {
  if (input && typeof input === 'object' && 'days' in input) {
    const days = (input as { days?: unknown }).days;
    if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
      return Math.floor(days);
    }
  }
  return DEFAULT_DAYS;
}

function formatEvent(evt: {
  title: string;
  start: string;
  location?: string;
  isAllDay: boolean;
}): string {
  const when = evt.isAllDay ? `${evt.start.slice(0, 10)} (all day)` : evt.start;
  const loc = evt.location ? ` — ${evt.location}` : '';
  return `- ${when}: ${evt.title}${loc}`;
}

export const calendarTool: Tool = {
  def: {
    name: 'get_calendar_events',
    description:
      "Get Mitch's calendar events from today through the next N days, across all his " +
      'subscribed calendars (his work calendar is excluded automatically, if configured). ' +
      'Use this to see what his day/week looks like — meetings, travel, family commitments, ' +
      "kids' activities — so you can gauge how busy he is and reference concrete plans. " +
      'Call it once per brief; there is no need to call it more than once since the window ' +
      "covers everything you'll need.",
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: `How many days ahead to look, including today. Defaults to ${DEFAULT_DAYS} if omitted.`,
        },
      },
    },
  },
  async run(input: unknown): Promise<string> {
    const days = getDaysInput(input);
    const events = await listEventsNextNDays(days);

    if (events.length === 0) return '(no events in this window)';

    const shown = events.slice(0, MAX_EVENTS);
    const lines = shown.map(formatEvent);
    if (events.length > MAX_EVENTS) {
      lines.push(`… and ${events.length - MAX_EVENTS} more events (truncated)`);
    }
    return lines.join('\n');
  },
};
