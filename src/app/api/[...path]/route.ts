import { NextResponse } from "next/server";
import { z } from "zod";
import { DateTime } from "luxon";
import { timingSafeEqual } from "node:crypto";
import { userClient, jobClient } from "@/lib/supabase";
import {
  AppError,
  checked,
  loadWorkspace,
  saveTask,
  saveEvent,
  savePreferences,
  proposeSchedule,
  rateLimit,
  refreshSource,
  adjustProposal,
} from "@/lib/services";
import { proposalAction, uuid, type Plan } from "@/lib/domain";
import { exportCalendar, parseCalendar, MAX_ICS_BYTES } from "@/lib/ical";
import {
  generateFeedToken,
  hashToken,
  validateFeedUrl,
} from "@/lib/feed-security";
import { askAssistant } from "@/lib/assistant";
import { boundedJson, assertOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const authInput = z
  .object({
    action: z.enum(["login", "signup", "logout"]),
    email: z.email().max(320).optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict();
const recordInput = z
  .object({
    id: uuid.optional(),
    version: z.number().int().positive().optional(),
    data: z.unknown(),
    remove: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !v.id || v.version, "An existing record needs its version");
const sourceInput = z
  .object({
    id: uuid.optional(),
    version: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["file", "feed"]),
    url: z.string().max(2048).nullable().default(null),
    enabled: z.boolean().default(true),
    all_day_busy: z.boolean().default(false),
    remove: z.boolean().default(false),
  })
  .strict();
const importInput = z
  .object({
    raw: z.string().max(MAX_ICS_BYTES),
    source_id: uuid,
    confirm: z.boolean().default(false),
  })
  .strict();

function response(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
function errorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((i) => i.message)
          .slice(0, 3)
          .join(" "),
      },
      { status: 400 },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof Error && error.message.startsWith("CONFIGURATION:"))
    return NextResponse.json(
      { error: error.message.slice(15), configuration: true },
      { status: 503 },
    );
  if (
    error instanceof Error &&
    /^(Could not import calendar:|Calendar exceeds|Calendar feeds must|Use an HTTPS)/.test(
      error.message,
    )
  )
    return NextResponse.json(
      { error: error.message.slice(0, 500) },
      { status: 400 },
    );
  console.error(JSON.stringify({ event: "request_error", kind: "unexpected" }));
  return NextResponse.json(
    { error: "Tempo could not complete that request. Please try again." },
    { status: 500 },
  );
}
async function auth() {
  const db = await userClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new AppError("Sign in to continue.", 401);
  checked(await db.rpc("ensure_preferences", {}).single());
  return { db, user: data.user };
}
function dateWindow(url: URL) {
  const now = DateTime.utc().startOf("day");
  const start = url.searchParams.get("start") || now.toISO()!,
    end = url.searchParams.get("end") || now.plus({ days: 7 }).toISO()!;
  z.iso.datetime({ offset: true }).parse(start);
  z.iso.datetime({ offset: true }).parse(end);
  if (
    Date.parse(end) <= Date.parse(start) ||
    Date.parse(end) - Date.parse(start) > 31 * 86400000
  )
    throw new AppError("Select up to 31 days.");
  return { start: Date.parse(start), end: Date.parse(end) };
}
function calendarResponse(request: Request, raw: string, download = false) {
  const etag = `"${hashToken(raw)}"`;
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "private, no-cache",
    ETag: etag,
    ...(download
      ? { "Content-Disposition": 'attachment; filename="tempo-plan.ics"' }
      : {}),
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(raw, { headers });
}
async function privateFeed(request: Request, token: string) {
  const clean = token.replace(/\.ics$/, "");
  if (!/^[\w-]{43}$/.test(clean)) throw new AppError("Feed unavailable.", 404);
  const db = jobClient();
  const { data, error } = await db
    .from("feed_tokens")
    .select("*")
    .eq("token_hash", hashToken(clean))
    .maybeSingle();
  if (error || !data) throw new AppError("Feed unavailable or revoked.", 404);
  const start = Date.now() - 31 * 86400000,
    end = Date.now() + 90 * 86400000;
  const rows =
    checked(
      await db
        .from("events")
        .select("*")
        .eq("owner_id", data.owner_id)
        .is("source_id", null)
        .limit(5000),
    ) || [];
  const events = rows.filter(
    (e) =>
      (e.kind === "focus" ? data.include_focus : data.include_commitments) &&
      (e.all_day
        ? Date.parse(e.start_date!) < end && Date.parse(e.end_date!) > start
        : Date.parse(e.starts_at!) < end && Date.parse(e.ends_at!) > start),
  );
  return calendarResponse(request, exportCalendar(events));
}
async function job(request: Request) {
  const supplied = request.headers.get("authorization") || "",
    expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (
    !process.env.CRON_SECRET ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new AppError("Unauthorized job.", 401);
  const db = jobClient();
  const sources =
    checked(
      await db
        .from("calendar_sources")
        .select("*")
        .eq("kind", "feed")
        .eq("enabled", true)
        .or(
          `last_attempt.is.null,last_attempt.lt.${new Date(Date.now() - 24 * 3600000).toISOString()}`,
        )
        .order("last_attempt", { nullsFirst: true })
        .limit(3),
    ) || [];
  let refreshed = 0,
    failed = 0;
  for (const src of sources) {
    try {
      await refreshSource(db, src.id, src.owner_id);
      refreshed++;
    } catch {
      failed++;
    }
  }
  console.info(
    JSON.stringify({ event: "feed_refresh_job", refreshed, failed }),
  );
  return response({ refreshed, failed, limit: 3 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await context.params).path.join("/");
    if (path.startsWith("feed/"))
      return await privateFeed(request, path.slice(5));
    if (path === "jobs/refresh") return await job(request);
    const { db, user } = await auth(),
      url = new URL(request.url),
      { start, end } = dateWindow(url);
    if (path === "workspace")
      return response(await loadWorkspace(db, user.email || "", start, end));
    if (path === "export") {
      const state = await loadWorkspace(db, user.email || "", start, end);
      let events = state.events;
      const id = url.searchParams.get("event");
      if (id) {
        uuid.parse(id);
        events = events.filter((e) => e.id === id);
      }
      const proposal = url.searchParams.get("proposal");
      if (proposal) {
        uuid.parse(proposal);
        const batch = checked(
          await db
            .from("change_batches")
            .select("*")
            .eq("proposal_id", proposal)
            .eq("undone", false)
            .single(),
        );
        events = events.filter((e) => batch.created_ids.includes(e.id));
      }
      return calendarResponse(request, exportCalendar(events), true);
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    assertOrigin(request);
    const path = (await context.params).path.join("/"),
      raw = await boundedJson(request);
    if (path === "auth") {
      const a = authInput.parse(raw),
        db = await userClient();
      if (a.action === "logout") {
        const r = await db.auth.signOut();
        if (r.error) throw new AppError("Sign out failed. Try again.", 502);
        return response({ ok: true });
      }
      if (!a.email || !a.password)
        throw new AppError("Email and password required.");
      if (a.action === "signup") {
        const base =
          process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
        const r = await db.auth.signUp({
          email: a.email,
          password: a.password,
          options: { emailRedirectTo: new URL("/auth/callback", base).href },
        });
        if (r.error)
          throw new AppError(
            "Account creation failed. Check your details or try later.",
            400,
          );
        return response({ confirmationRequired: !r.data.session });
      }
      const r = await db.auth.signInWithPassword({
        email: a.email,
        password: a.password,
      });
      if (r.error)
        throw new AppError(
          "Could not sign in. Check your email and password.",
          401,
        );
      return response({ ok: true });
    }
    const { db, user } = await auth();
    await rateLimit(db, "mutation", 120, 60);
    if (path === "tasks" || path === "events") {
      const a = recordInput.parse(raw);
      if (a.remove) {
        if (!a.id) throw new AppError("Choose a record to remove.");
        return response({
          id: checked(
            await db.rpc(path === "tasks" ? "write_task" : "write_event", {
              p: {},
              record_id: a.id,
              expected: a.version,
              remove: true,
            }),
          ),
        });
      }
      return response({
        id:
          path === "tasks"
            ? await saveTask(db, a.data, a.id, a.version)
            : await saveEvent(db, a.data, a.id, a.version),
      });
    }
    if (path === "preferences") {
      const a = z
        .object({ data: z.unknown(), revision: z.number().int().nonnegative() })
        .strict()
        .parse(raw);
      return response(await savePreferences(db, a.data, a.revision));
    }
    if (path === "plan")
      return response(await proposeSchedule(db, user.email || "", raw));
    if (path === "proposal") {
      const a = proposalAction.parse(raw);
      if (a.action === "apply") {
        const batch = checked(
          await db.rpc("apply_proposal", { proposal: a.id }).single(),
        );
        const outcome = await db.rpc("append_message", {
          message_role: "assistant",
          text_content: `Plan applied. ${batch.created_ids.length} focus blocks saved. You can undo this change from the proposal.`,
        });
        if (outcome.error)
          console.error(
            JSON.stringify({ event: "applied_plan_message_failed" }),
          );
        return response({ ok: true });
      }
      checked(
        await db.rpc(
          a.action === "undo" ? "undo_proposal" : "reject_proposal",
          { proposal: a.id },
        ),
      );
      return response({ ok: true });
    }
    if (path === "proposal/adjust") {
      const a = z
        .object({
          id: uuid,
          blocks: z
            .array(
              z
                .object({
                  title: z.string().max(200),
                  task_id: uuid,
                  category: z.enum(["school", "work", "personal"]),
                  starts_at: z.iso.datetime({ offset: true }),
                  ends_at: z.iso.datetime({ offset: true }),
                  timezone: z.string(),
                  reason: z.string().max(1000),
                })
                .strict(),
            )
            .max(500),
        })
        .strict()
        .parse(raw);
      return response(
        await adjustProposal(
          db,
          user.email || "",
          a.id,
          a.blocks as Plan["blocks"],
        ),
      );
    }
    if (path === "sources") {
      const a = sourceInput.parse(raw);
      if (a.kind === "feed" && a.url) validateFeedUrl(a.url);
      if (a.kind === "feed" && !a.url && !a.id)
        throw new AppError("Feed URL required.");
      return response({
        id: checked(
          await db.rpc("write_source", {
            p: a,
            ...(a.id ? { record_id: a.id, expected: a.version } : {}),
            remove: a.remove,
          }),
        ),
      });
    }
    if (path === "import") {
      await rateLimit(db, "import", 10, 60);
      const a = importInput.parse(raw),
        src = checked(
          await db
            .from("calendar_sources")
            .select("*")
            .eq("id", a.source_id)
            .single(),
        );
      if (src.kind !== "file")
        throw new AppError("Select a file-import source.");
      const now = Date.now();
      const parsed = parseCalendar(
        a.raw,
        src.id,
        user.id,
        src.timezone,
        now - 31 * 86400000,
        now + 90 * 86400000,
        src.all_day_busy,
      );
      if (a.confirm)
        checked(
          await db.rpc("reconcile_source", {
            source: src.id,
            raw: a.raw,
            entries: parsed.events,
            canceled: parsed.canceled,
            expected: src.version,
          }),
        );
      return response({
        events: parsed.events,
        warnings: parsed.warnings,
        canceled: parsed.canceled,
        confirmed: a.confirm,
      });
    }
    if (path === "sources/refresh") {
      const a = z.object({ id: uuid }).strict().parse(raw);
      return response(await refreshSource(db, a.id));
    }
    if (path === "feed") {
      const a = z
        .object({
          action: z.enum(["rotate", "revoke"]),
          commitments: z.boolean().default(true),
          focus: z.boolean().default(true),
        })
        .strict()
        .parse(raw);
      if (a.action === "revoke") {
        checked(await db.rpc("set_feed", {}));
        return response({ revoked: true });
      }
      if (!a.commitments && !a.focus)
        throw new AppError("Include at least one event type.");
      const { token, hash } = generateFeedToken();
      checked(
        await db.rpc("set_feed", {
          hash,
          commitments: a.commitments,
          focus: a.focus,
        }),
      );
      // Token only leaves the server in this response, never logs or database.
      const base =
        process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
      return response({ url: new URL(`/api/feed/${token}.ics`, base).href });
    }
    if (path === "assistant") {
      const a = z
        .object({ message: z.string().trim().min(1).max(4000) })
        .strict()
        .parse(raw);
      return response(await askAssistant(db, user.email || "", a.message));
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
