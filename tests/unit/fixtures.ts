import {
  defaults,
  type CalendarEvent,
  type Preferences,
  type Task,
} from "../../src/lib/domain";
export const owner = "11111111-1111-4111-a111-111111111111";
export const taskId = "22222222-2222-4222-a222-222222222222";
export const sourceId = "33333333-3333-4333-a333-333333333333";
export const prefs: Preferences = {
  ...defaults,
  owner_id: owner,
  revision: 0,
  timezone: "America/New_York",
  focus_minutes: 60,
  break_minutes: 10,
  availability: [{ day: 1, start: "09:00", end: "17:00" }],
};
export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: taskId,
    owner_id: owner,
    title: "Statistics",
    description: "",
    category: "school",
    priority: "high",
    deadline: "2026-10-12T21:00:00Z",
    estimated_minutes: 120,
    remaining_minutes: 120,
    status: "open",
    splittable: true,
    min_session: 25,
    version: 1,
    updated_at: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}
export function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "44444444-4444-4444-a444-444444444444",
    owner_id: owner,
    title: "Class",
    description: "",
    category: "school",
    kind: "commitment",
    starts_at: "2026-10-12T14:00:00Z",
    ends_at: "2026-10-12T15:00:00Z",
    start_date: null,
    end_date: null,
    timezone: "America/New_York",
    all_day: false,
    busy: true,
    locked: true,
    task_id: null,
    source_id: null,
    uid: "class@school",
    recurrence_id: "",
    version: 1,
    updated_at: "2026-10-12T00:00:00Z",
    ...overrides,
  };
}
export function ics(events: string) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Tempo//EN\r\n${events.replaceAll("\n", "\r\n")}\r\nEND:VCALENDAR\r\n`;
}
export const vevent = `BEGIN:VEVENT\nUID:class-1\nDTSTAMP:20261001T120000Z\nDTSTART;TZID=America/New_York:20261012T090000\nDTEND;TZID=America/New_York:20261012T100000\nSUMMARY:Statistics class\nEND:VEVENT`;
