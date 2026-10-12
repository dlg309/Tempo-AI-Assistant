import { z } from "zod";
import { DateTime, IANAZone } from "luxon";

export const uuid = z.uuid();
export const instant = z.iso.datetime({ offset: true });
export const date = z.iso.date();
export const timezone = z
  .string()
  .refine(
    (v) => IANAZone.isValidZone(v),
    "Use an IANA time zone, such as America/New_York",
  );
export const category = z.enum(["school", "work", "personal"]);
export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(""),
    category: category.default("personal"),
    priority: z.enum(["high", "medium", "low"]).default("medium"),
    deadline: instant.nullable().default(null),
    estimated_minutes: z.number().int().min(5).max(10080),
    remaining_minutes: z.number().int().min(0).max(10080),
    status: z.enum(["open", "done", "archived"]).default("open"),
    splittable: z.boolean().default(true),
    min_session: z.number().int().min(5).max(480).default(25),
  })
  .strict()
  .refine(
    (t) => t.remaining_minutes <= t.estimated_minutes,
    "Remaining effort cannot exceed the estimate",
  );
export type TaskInput = z.infer<typeof taskInput>;
export type Task = TaskInput & {
  id: string;
  owner_id: string;
  version: number;
  updated_at: string;
};

export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(""),
    category: category.default("personal"),
    kind: z.enum(["commitment", "focus"]).default("commitment"),
    starts_at: instant.nullable(),
    ends_at: instant.nullable(),
    start_date: date.nullable().default(null),
    end_date: date.nullable().default(null),
    timezone,
    all_day: z.boolean().default(false),
    busy: z.boolean().default(true),
    locked: z.boolean().default(true),
    task_id: uuid.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.all_day
        ? !v.start_date ||
          !v.end_date ||
          v.end_date <= v.start_date ||
          v.starts_at !== null ||
          v.ends_at !== null
        : !v.starts_at ||
          !v.ends_at ||
          Date.parse(v.ends_at) <= Date.parse(v.starts_at) ||
          v.start_date !== null ||
          v.end_date !== null
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Provide an exclusive end after the start; all-day events use dates, timed events use instants",
      });
    if (v.kind === "focus" && (v.all_day || !v.task_id))
      ctx.addIssue({
        code: "custom",
        message: "Focus blocks must be timed and belong to a task",
      });
  });
export type CalendarEvent = z.infer<typeof eventInput> & {
  id: string;
  owner_id: string;
  source_id: string | null;
  uid: string;
  recurrence_id: string;
  version: number;
  updated_at: string;
  recurrence?: unknown;
};
const hours = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const preferencesInput = z
  .object({
    timezone,
    focus_minutes: z.number().int().min(15).max(240),
    break_minutes: z.number().int().min(0).max(60),
    buffer_minutes: z.number().int().min(0).max(60),
    all_day_busy: z.boolean(),
    onboarded: z.boolean(),
    availability: z
      .array(
        z
          .object({
            day: z.number().int().min(1).max(7),
            start: hours,
            end: hours,
          })
          .strict()
          .refine(
            (v) => v.start < v.end,
            "Availability must end after it starts",
          ),
      )
      .max(35),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesInput> & {
  owner_id: string;
  revision: number;
};
export const defaults: z.infer<typeof preferencesInput> = {
  timezone: "America/New_York",
  focus_minutes: 50,
  break_minutes: 10,
  buffer_minutes: 0,
  all_day_busy: false,
  onboarded: false,
  availability: Array.from({ length: 5 }, (_, i) => ({
    day: i + 1,
    start: "09:00",
    end: "18:00",
  })),
};
export type Source = {
  timezone: string;
  id: string;
  name: string;
  kind: "file" | "feed";
  url: string | null;
  enabled: boolean;
  all_day_busy: boolean;
  last_success: string | null;
  last_attempt: string | null;
  refresh_error: string | null;
  raw_ics: string | null;
  version: number;
  owner_id: string;
};
export type Block = {
  title: string;
  task_id: string;
  category: Task["category"];
  starts_at: string;
  ends_at: string;
  timezone: string;
  reason: string;
};
export type Plan = {
  blocks: Block[];
  remove_ids: string[];
  locked_ids: string[];
  unscheduled: {
    task_id: string;
    title: string;
    minutes: number;
    reason: string;
  }[];
  warnings: string[];
  task_changes?: { id?: string; version?: number; data: TaskInput }[];
};
export type Proposal = {
  id: string;
  status: "pending" | "applied" | "rejected" | "undone";
  base_revision: number;
  payload: Plan;
  created_at: string;
  owner_id: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
export type Workspace = {
  tasks: Task[];
  events: CalendarEvent[];
  sources: Source[];
  preferences: Preferences;
  proposals: Proposal[];
  messages: Message[];
  aiConfigured: boolean;
  email: string;
  feedActive: boolean;
};
export const windowInput = z
  .object({
    start: instant,
    end: instant,
    task_ids: z.array(uuid).max(100).optional(),
    replan: z.boolean().default(false),
  })
  .strict()
  .refine(
    (w) =>
      Date.parse(w.end) > Date.parse(w.start) &&
      Date.parse(w.end) - Date.parse(w.start) <= 31 * 86400000,
    "Choose a planning window of at most 31 days",
  );
export const proposalAction = z
  .object({ id: uuid, action: z.enum(["apply", "reject", "undo"]) })
  .strict();

export function localInstant(value: string, zone: string) {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16))
    throw new Error(
      "That local time does not exist because of a clock change. Choose another time.",
    );
  if (dt.getPossibleOffsets().length > 1)
    throw new Error(
      "That local time occurs twice because of a clock change. Choose an unambiguous time.",
    );
  return dt.toUTC().toISO()!;
}
