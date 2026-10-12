import { DateTime } from "luxon";
import type { Block, CalendarEvent, Plan, Preferences, Task } from "./domain";

export type Interval = { start: number; end: number };
const MINUTE = 60000;
export function overlaps(a: Interval, b: Interval) {
  return a.start < b.end && b.start < a.end;
}
export function mergeIntervals(items: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const v of items
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && last.end >= v.start) last.end = Math.max(last.end, v.end);
    else out.push({ ...v });
  }
  return out;
}
export function subtractIntervals(
  available: Interval[],
  busy: Interval[],
): Interval[] {
  const result: Interval[] = [];
  for (const a of mergeIntervals(available)) {
    let cursor = a.start;
    for (const b of mergeIntervals(busy)) {
      if (b.end <= cursor || b.start >= a.end) continue;
      if (b.start > cursor)
        result.push({ start: cursor, end: Math.min(b.start, a.end) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < a.end) result.push({ start: cursor, end: a.end });
  }
  return result;
}
export function eventInterval(
  e: CalendarEvent,
  prefs: Preferences,
): Interval | null {
  if (!e.busy || (e.all_day && !prefs.all_day_busy && !e.source_id))
    return null;
  if (e.all_day)
    return {
      start: DateTime.fromISO(e.start_date!, { zone: e.timezone }).toMillis(),
      end: DateTime.fromISO(e.end_date!, { zone: e.timezone }).toMillis(),
    };
  return { start: Date.parse(e.starts_at!), end: Date.parse(e.ends_at!) };
}
export function busyIntervals(
  events: CalendarEvent[],
  prefs: Preferences,
): Interval[] {
  return events.flatMap((e) => {
    const interval = eventInterval(e, prefs);
    return interval
      ? [
          {
            start:
              interval.start -
              Math.max(
                prefs.buffer_minutes,
                e.kind === "focus" ? prefs.break_minutes : 0,
              ) *
                MINUTE,
            end:
              interval.end +
              Math.max(
                prefs.buffer_minutes,
                e.kind === "focus" ? prefs.break_minutes : 0,
              ) *
                MINUTE,
          },
        ]
      : [];
  });
}
export function availability(
  prefs: Preferences,
  start: number,
  end: number,
): Interval[] {
  const windows: Interval[] = [];
  let day = DateTime.fromMillis(start, { zone: prefs.timezone }).startOf("day");
  while (day.toMillis() < end) {
    for (const a of prefs.availability.filter((a) => a.day === day.weekday)) {
      const [sh, sm] = a.start.split(":").map(Number),
        [eh, em] = a.end.split(":").map(Number);
      const s = day.set({ hour: sh, minute: sm }),
        e = day.set({ hour: eh, minute: em });
      if (s.toFormat("HH:mm") !== a.start || e.toFormat("HH:mm") !== a.end)
        continue;
      const interval = {
        start: Math.max(start, s.toMillis()),
        end: Math.min(end, e.toMillis()),
      };
      if (interval.end > interval.start) windows.push(interval);
    }
    day = day.plus({ days: 1 });
  }
  return mergeIntervals(windows);
}

// Earliest-deadline/priority greedy allocation; retains valid flexible blocks first.
// All intervals are [start, end); durations are real elapsed minutes across DST.
export function planSchedule(
  tasks: Task[],
  events: CalendarEvent[],
  prefs: Preferences,
  start: number,
  end: number,
  replan = false,
): Plan {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 31 * 86400000
  )
    throw new Error("Invalid planning window");
  const plan: Plan = {
    blocks: [],
    remove_ids: [],
    locked_ids: events.filter((e) => e.locked).map((e) => e.id),
    unscheduled: [],
    warnings: [],
  };
  const eligible = tasks
    .filter((t) => t.status === "open" && t.remaining_minutes > 0)
    .sort(
      (a, b) =>
        (a.deadline ? Date.parse(a.deadline) : Infinity) -
          (b.deadline ? Date.parse(b.deadline) : Infinity) ||
        { high: 0, medium: 1, low: 2 }[a.priority] -
          { high: 0, medium: 1, low: 2 }[b.priority] ||
        a.id.localeCompare(b.id),
    );
  const taskMap = new Map(eligible.map((t) => [t.id, t]));
  const workHours = availability(prefs, start, end);
  const candidates = events.filter(
    (e) =>
      replan &&
      !e.source_id &&
      e.kind === "focus" &&
      !e.locked &&
      taskMap.has(e.task_id!) &&
      Date.parse(e.starts_at!) >= start &&
      Date.parse(e.ends_at!) <= end,
  );
  const fixed = events.filter((e) => !candidates.includes(e));
  const busy = busyIntervals(fixed, prefs);
  const accounted = new Map<string, number>();
  for (const e of fixed.filter(
    (e) => e.kind === "focus" && e.task_id && Date.parse(e.ends_at!) > start,
  )) {
    const t = taskMap.get(e.task_id!);
    if (t && (!t.deadline || Date.parse(e.ends_at!) <= Date.parse(t.deadline)))
      accounted.set(
        t.id,
        (accounted.get(t.id) || 0) +
          (Date.parse(e.ends_at!) - Math.max(start, Date.parse(e.starts_at!))) /
            MINUTE,
      );
    else if (t)
      plan.warnings.push(
        `${e.title} has an existing block after its deadline; adjust it explicitly.`,
      );
  }
  for (const e of candidates.sort(
    (a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!),
  )) {
    const interval = {
      start: Date.parse(e.starts_at!),
      end: Date.parse(e.ends_at!),
    };
    const t = taskMap.get(e.task_id!)!;
    const valid =
      (!t.deadline || interval.end <= Date.parse(t.deadline)) &&
      workHours.some(
        (a) => a.start <= interval.start && a.end >= interval.end,
      ) &&
      !busy.some((b) => overlaps(b, interval));
    if (valid) {
      busy.push({
        start:
          interval.start -
          Math.max(prefs.break_minutes, prefs.buffer_minutes) * MINUTE,
        end:
          interval.end +
          Math.max(prefs.break_minutes, prefs.buffer_minutes) * MINUTE,
      });
      accounted.set(
        t.id,
        (accounted.get(t.id) || 0) + (interval.end - interval.start) / MINUTE,
      );
    } else plan.remove_ids.push(e.id);
  }
  for (const task of eligible) {
    let remaining = Math.max(
      0,
      task.remaining_minutes - (accounted.get(task.id) || 0),
    );
    const deadline = Math.min(
      end,
      task.deadline ? Date.parse(task.deadline) : end,
    );
    const free = subtractIntervals(workHours, busy)
      .map((w) => ({ ...w, end: Math.min(w.end, deadline) }))
      .filter((w) => w.end > w.start);
    for (const w of free) {
      let cursor = w.start;
      while (remaining > 0 && cursor < w.end) {
        const capacity = Math.floor((w.end - cursor) / MINUTE);
        const length = task.splittable
          ? Math.min(remaining, prefs.focus_minutes, capacity)
          : remaining;
        if (length > capacity || length < Math.min(task.min_session, remaining))
          break;
        const finish = cursor + length * MINUTE;
        const block: Block = {
          title: task.title,
          task_id: task.id,
          category: task.category,
          starts_at: new Date(cursor).toISOString(),
          ends_at: new Date(finish).toISOString(),
          timezone: prefs.timezone,
          reason: `${length} minutes in your available hours${task.deadline ? ", before the deadline" : ""}; existing commitments preserved.`,
        };
        plan.blocks.push(block);
        remaining -= length;
        busy.push({
          start:
            cursor -
            Math.max(prefs.break_minutes, prefs.buffer_minutes) * MINUTE,
          end:
            finish +
            Math.max(prefs.break_minutes, prefs.buffer_minutes) * MINUTE,
        });
        cursor =
          finish + Math.max(prefs.break_minutes, prefs.buffer_minutes) * MINUTE;
      }
      if (remaining <= 0) break;
    }
    if (remaining > 0)
      plan.unscheduled.push({
        task_id: task.id,
        title: task.title,
        minutes: remaining,
        reason:
          deadline <= start
            ? "The deadline has passed. Update the deadline before planning."
            : `Not enough ${task.splittable ? "available time" : "continuous time"} before the deadline. Add availability, reduce effort explicitly, or extend the deadline.`,
      });
  }
  return plan;
}
