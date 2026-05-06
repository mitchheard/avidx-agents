import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { getOAuthClient } from './google-auth';
import { loadEnv } from './env';

export type CalendarEvent = {
  title: string;
  start: string;
  end: string;
  location?: string;
  attendees: string[];
  isAllDay: boolean;
  calendarId: string;
};

function getCalendarClient(): calendar_v3.Calendar {
  return google.calendar({ version: 'v3', auth: getOAuthClient() });
}

function toCalendarEvent(evt: calendar_v3.Schema$Event, calendarId: string): CalendarEvent {
  const isAllDay = !!evt.start?.date;
  return {
    title: evt.summary ?? '(no title)',
    start: evt.start?.dateTime ?? evt.start?.date ?? '',
    end: evt.end?.dateTime ?? evt.end?.date ?? '',
    location: evt.location ?? undefined,
    attendees:
      evt.attendees
        ?.map((a) => a.displayName ?? a.email ?? '')
        .filter(Boolean) ?? [],
    isAllDay,
    calendarId,
  };
}

// Lists events for today through the next n days across all calendars,
// excluding the work calendar if GOOGLE_WORK_CALENDAR_ID is set.
export async function listEventsNextNDays(n: number): Promise<CalendarEvent[]> {
  const calendar = getCalendarClient();
  const env = loadEnv();
  const workCalendarId = env.GOOGLE_WORK_CALENDAR_ID;

  const now = new Date();

  // Step 1: get today's date string in CT (en-CA gives YYYY-MM-DD format)
  const ctDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(now);

  // Step 2: compute CT's current UTC offset
  const ctNowMs = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getTime();
  const ctOffsetMs = now.getTime() - ctNowMs; // ms CT is behind UTC

  // Step 3: CT midnight in UTC = midnight of ctDateStr (as UTC) + offset
  const timeMin = new Date(new Date(`${ctDateStr}T00:00:00Z`).getTime() + ctOffsetMs);
  const timeMax = new Date(timeMin.getTime());
  timeMax.setDate(timeMax.getDate() + n);

  // Enumerate all subscribed calendars
  const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
  const calendarIds = (calListRes.data.items ?? [])
    .filter((c) => c.id && c.selected !== false)
    .map((c) => c.id!)
    .filter((id) => !workCalendarId || id !== workCalendarId);

  // Fetch events from all remaining calendars in parallel.
  // Swallow errors per-calendar (e.g. a read-only shared calendar with restricted access).
  const results = await Promise.all(
    calendarIds.map((calendarId) =>
      calendar.events
        .list({
          calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 20,
        })
        .then((res) =>
          (res.data.items ?? []).map((evt) => toCalendarEvent(evt, calendarId)),
        )
        .catch(() => [] as CalendarEvent[]),
    ),
  );

  return results
    .flat()
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function listEventsToday(): Promise<CalendarEvent[]> {
  return listEventsNextNDays(1);
}
