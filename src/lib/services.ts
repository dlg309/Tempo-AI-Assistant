import "server-only";
import { DateTime } from "luxon";
import { z } from "zod";
import {
  taskInput,
  eventInput,
  preferencesInput,
  windowInput,
  type Workspace,
  type Plan,
  type CalendarEvent,
} from "./domain";
import type { DbClient } from "./supabase";
import { parseCalendar } from "./ical";
import { planSchedule, busyIntervals, overlaps, availability } from "./planner";
import { fetchFeed } from "./feed-security";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error) {
    const m = result.error.message;
    if (
      /stale|changed|conflict|no longer|already running|rate limited/i.test(m)
    )
      throw new AppError(m, 409);
    if (/denied|unavailable|authentication/i.test(m))
      throw new AppError("Record unavailable or access denied.", 403);
    console.error(
      JSON.stringify({
        event: "database_error",
        kind: m.includes("does not exist")
          ? "schema_missing"
          : "operation_failed",
      }),
    );
    throw new AppError(
      "The database could not save this request. Check migrations and try again.",
      500,
    );
  }
  return result.data as NonNullable<T>;
}
export async function rateLimit(
  db: DbClient,
  bucket: "ai" | "import" | "mutation",
  count = 60,
  seconds = 60,
) {
  if (
    !checked(
      await db.rpc("take_rate_limit", {
        bucket_name: bucket,
        max_count: count,
        seconds,
      }),
    )
  )
    throw new AppError("Too many requests. Please try again shortly.", 429);
}
export async function loadWorkspace(
  db: DbClient,
  email: string,
  start: number,
  end: number,
): Promise<Workspace> {
  if (end <= start || end - start > 31 * 86400000)
    throw new AppError("Choose a window of at most 31 days.");
  const prefs = checked(await db.rpc("ensure_preferences", {}).single());
  const results = await Promise.all([
    db
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("events")
      .select("*")
      .or(
        `and(starts_at.lt.${new Date(end).toISOString()},ends_at.gt.${new Date(start).toISOString()}),and(all_day.eq.true,start_date.lt.${new Date(end + 86400000).toISOString().slice(0, 10)},end_date.gt.${new Date(start - 86400000).toISOString().slice(0, 10)})`,
      )
      .limit(5000),
    db.from("calendar_sources").select("*").order("name"),
    db
      .from("proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("feed_tokens").select("owner_id").limit(1),
  ]);
  const tasks = checked(results[0]) || [],
    stored = checked(results[1]) || [],
    sources = checked(results[2]) || [];
  if (stored.length >= 5000)
    throw new AppError(
      "This window contains too many events. Select a smaller date range.",
      413,
    );
  const events: CalendarEvent[] = stored
    .filter(
      (e) =>
        !e.source_id || sources.some((s) => s.id === e.source_id && s.enabled),
    )
    .map((e) =>
      e.source_id && e.all_day
        ? {
            ...e,
            busy:
              sources.find((s) => s.id === e.source_id)!.all_day_busy && e.busy,
          }
        : e,
    );
  for (const src of sources.filter((s) => s.enabled && s.raw_ics)) {
    const parsed = parseCalendar(
      src.raw_ics!,
      src.id,
      src.owner_id,
      src.timezone,
      start,
      end,
      src.all_day_busy,
    );
    for (const event of parsed.events) {
      const index = events.findIndex(
        (e) =>
          e.source_id === src.id &&
          e.uid === event.uid &&
          e.recurrence_id === event.recurrence_id,
      );
      if (index < 0) events.push(event);
      else
        events[index] = {
          ...event,
          id: events[index].id,
          version: events[index].version,
          updated_at: events[index].updated_at,
        };
    }
  }
  const latest = checked(await db.from("preferences").select("*").single());
  if (latest.revision !== prefs.revision)
    throw new AppError("Schedule changed while loading. Please reload.", 409);
  return {
    tasks,
    events,
    sources: sources.map((s) => ({ ...s, url: s.url, raw_ics: null })),
    preferences: prefs,
    proposals: checked(results[3]) || [],
    messages: (checked(results[4]) || []).reverse(),
    aiConfigured: !!process.env.GEMINI_API_KEY,
    email,
    feedActive: !!checked(results[5])?.length,
  };
}
export async function saveTask(
  db: DbClient,
  raw: unknown,
  id?: string,
  version?: number,
) {
  const data = taskInput.parse(raw);
  return checked(
    await db.rpc("write_task", {
      p: data,
      ...(id ? { record_id: id, expected: version } : {}),
    }),
  );
}
export async function saveEvent(
  db: DbClient,
  raw: unknown,
  id?: string,
  version?: number,
) {
  const data = eventInput.parse(raw);
  return checked(
    await db.rpc("write_event", {
      p: data,
      ...(id ? { record_id: id, expected: version } : {}),
    }),
  );
}
export async function savePreferences(
  db: DbClient,
  raw: unknown,
  revision: number,
) {
  return checked(
    await db
      .rpc("save_preferences", {
        p: preferencesInput.parse(raw),
        expected: revision,
      })
      .single(),
  );
}

export async function proposeSchedule(
  db: DbClient,
  email: string,
  raw: unknown,
) {
  const args = windowInput.parse(raw);
  const now = Date.now();
  const start = Math.max(now, Date.parse(args.start)),
    end = Date.parse(args.end);
  if (end <= start || end > now + 31 * 86400000)
    throw new AppError("Plan future work within the next 31 days.");
  // Include surrounding days for overnight events and existing allocation.
  const state = await loadWorkspace(db, email, start, end);
  const existing =
    checked(
      await db
        .from("events")
        .select("*")
        .eq("kind", "focus")
        .is("source_id", null)
        .gt("ends_at", new Date(start).toISOString())
        .limit(5000),
    ) || [];
  for (const e of existing)
    if (!state.events.some((v) => v.id === e.id)) state.events.push(e);
  const tasks = args.task_ids
    ? state.tasks.filter((t) => args.task_ids!.includes(t.id))
    : state.tasks;
  if (args.task_ids && tasks.length !== args.task_ids.length)
    throw new AppError("One of those tasks is unavailable.", 404);
  const payload = planSchedule(
    tasks,
    state.events,
    state.preferences,
    start,
    end,
    args.replan,
  );
  for (const source of state.sources.filter(
    (s) =>
      s.enabled &&
      s.kind === "feed" &&
      (!s.last_success ||
        Date.now() - Date.parse(s.last_success) > 48 * 3600000),
  ))
    payload.warnings.push(
      `${source.name} has stale calendar data. Refresh it before relying on this plan.`,
    );
  return checked(
    await db
      .rpc("create_proposal", {
        p: payload,
        expected: state.preferences.revision,
      })
      .single(),
  );
}
export const taskChangesInput = z
  .object({
    changes: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            version: z.number().int().positive().optional(),
            data: taskInput,
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export async function proposeTaskChanges(
  db: DbClient,
  email: string,
  raw: unknown,
) {
  const args = taskChangesInput.parse(raw),
    now = Date.now(),
    state = await loadWorkspace(db, email, now, now + 7 * 86400000);
  for (const change of args.changes)
    if (
      change.id &&
      !state.tasks.some(
        (t) => t.id === change.id && t.version === change.version,
      )
    )
      throw new AppError("Task unavailable or changed. Reload it first.", 409);
  const p: Plan = {
    blocks: [],
    remove_ids: [],
    locked_ids: [],
    unscheduled: [],
    warnings: [],
    task_changes: args.changes,
  };
  return checked(
    await db
      .rpc("create_proposal", { p, expected: state.preferences.revision })
      .single(),
  );
}
export async function adjustProposal(
  db: DbClient,
  email: string,
  id: string,
  blocks: Plan["blocks"],
) {
  const proposal = checked(
    await db.from("proposals").select("*").eq("id", id).single(),
  );
  if (proposal.status !== "pending" || !proposal.payload.blocks.length)
    throw new AppError("Only pending schedule proposals can be adjusted.");
  const now = Date.now(),
    end = now + 31 * 86400000,
    state = await loadWorkspace(db, email, now, end);
  if (state.preferences.revision !== proposal.base_revision)
    throw new AppError("This proposal is stale. Generate another.", 409);
  const remove = new Set(proposal.payload.remove_ids),
    busy = busyIntervals(
      state.events.filter((e) => !remove.has(e.id)),
      state.preferences,
    );
  const original = proposal.payload.blocks;
  const available = availability(state.preferences, now, end);
  if (blocks.length !== original.length)
    throw new AppError(
      "Adjust block times without changing the required effort.",
    );
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i],
      o = original[i],
      t = state.tasks.find((t) => t.id === b.task_id),
      interval = { start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) };
    if (
      b.task_id !== o.task_id ||
      interval.end - interval.start !==
        Date.parse(o.ends_at) - Date.parse(o.starts_at) ||
      interval.start < now ||
      interval.end > end ||
      !available.some(
        (a) => a.start <= interval.start && a.end >= interval.end,
      ) ||
      !t ||
      (t.deadline && interval.end > Date.parse(t.deadline)) ||
      busy.some((e) => overlaps(e, interval))
    )
      throw new AppError(
        "Adjusted times conflict, fall outside availability, exceed a deadline, or change required effort.",
      );
    busy.push({
      start:
        interval.start -
        Math.max(
          state.preferences.break_minutes,
          state.preferences.buffer_minutes,
        ) *
          60000,
      end:
        interval.end +
        Math.max(
          state.preferences.break_minutes,
          state.preferences.buffer_minutes,
        ) *
          60000,
    });
  }
  const replacement = checked(
    await db
      .rpc("create_proposal", {
        p: { ...proposal.payload, blocks },
        expected: state.preferences.revision,
      })
      .single(),
  );
  checked(await db.rpc("reject_proposal", { proposal: id }));
  return replacement;
}
export async function refreshSource(
  db: DbClient,
  id: string,
  jobOwner?: string,
) {
  const job = jobOwner ? { job_owner: jobOwner } : {};
  const src = checked(
    await db.rpc("claim_refresh", { source: id, ...job }).single(),
  );
  try {
    const raw = await fetchFeed(src.url!),
      now = Date.now();
    const parsed = parseCalendar(
      raw,
      src.id,
      src.owner_id,
      src.timezone,
      now - 31 * 86400000,
      now + 90 * 86400000,
      src.all_day_busy,
    );
    checked(
      await db.rpc("reconcile_source", {
        source: id,
        raw,
        entries: parsed.events,
        canceled: parsed.canceled,
        expected: src.version,
        ...job,
      }),
    );
    return { count: parsed.events.length, warnings: parsed.warnings };
  } catch {
    checked(await db.rpc("fail_refresh", { source: id, ...job }));
    throw new AppError(
      "Refresh failed. Last successful events have been kept. Check the feed URL and try again.",
      502,
    );
  }
}
export function defaultWindow(zone: string) {
  const start = DateTime.now().setZone(zone).startOf("day");
  return {
    start: start.toUTC().toISO()!,
    end: start.plus({ days: 7 }).toUTC().toISO()!,
  };
}
