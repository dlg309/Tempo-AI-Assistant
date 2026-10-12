import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Real PostgreSQL SQL/RLS/transactions in WASM; only Supabase Auth claims are
// simulated. This is not a live Supabase integration test or a concurrency test.
const db = new PGlite({ extensions: { pgcrypto } });
const u1 = "11111111-1111-4111-a111-111111111111",
  u2 = "22222222-2222-4222-a222-222222222222";
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
async function row(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
async function asUser(u) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${u}',false); select set_config('request.jwt.claim.role','authenticated',false);`,
  );
  await db.query("select public.ensure_preferences()");
}
async function revision() {
  return Number((await row("select revision from preferences")).revision);
}
const taskData = {
  title: "Study statistics",
  description: "",
  category: "school",
  priority: "high",
  deadline: null,
  estimated_minutes: 120,
  remaining_minutes: 120,
  status: "open",
  splittable: true,
  min_session: 25,
};
const eventData = {
  title: "Class",
  description: "",
  category: "school",
  kind: "commitment",
  starts_at: "2030-10-14T14:00:00Z",
  ends_at: "2030-10-14T15:00:00Z",
  start_date: null,
  end_date: null,
  timezone: "UTC",
  all_day: false,
  busy: true,
  locked: true,
  task_id: null,
};
async function createTask(data = taskData) {
  return (await row("select write_task($1::jsonb) id", [JSON.stringify(data)]))
    .id;
}
async function createEvent(data = eventData) {
  return (await row("select write_event($1::jsonb) id", [JSON.stringify(data)]))
    .id;
}
async function proposal(payload) {
  return (
    await row("select (create_proposal($1::jsonb,$2)).id id", [
      JSON.stringify(payload),
      await revision(),
    ])
  ).id;
}
const plan = (task, overrides = {}) => ({
  blocks: [
    {
      title: "Study statistics",
      task_id: task,
      category: "school",
      starts_at: "2030-10-14T16:00:00Z",
      ends_at: "2030-10-14T17:00:00Z",
      timezone: "UTC",
      reason: "Available time",
    },
  ],
  remove_ids: [],
  locked_ids: [],
  unscheduled: [],
  warnings: [],
  ...overrides,
});
try {
  await db.exec(
    `create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); insert into auth.users values ('${u1}'),('${u2}'); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$; grant usage on schema auth to anon, authenticated, service_role;`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/202610120001_tempo.sql", import.meta.url),
      "utf8",
    ),
  );
  await asUser(u1);
  const task = await createTask(),
    commitment = await createEvent();
  await test("migration runs and manual records persist", async () => {
    assert.equal((await row("select count(*)::int n from tasks")).n, 1);
    assert.equal((await row("select count(*)::int n from events")).n, 1);
  });
  await test("cross-user RLS and mutation ownership", async () => {
    await asUser(u2);
    assert.equal((await row("select count(*)::int n from tasks")).n, 0);
    assert.equal((await row("select count(*)::int n from events")).n, 0);
    await assert.rejects(
      () =>
        db.query("select write_task($1::jsonb,$2,1)", [
          JSON.stringify(taskData),
          task,
        ]),
      /denied/i,
    );
    await assert.rejects(
      () => createEvent({ ...eventData, kind: "focus", task_id: task }),
      /foreign key/i,
    );
    await asUser(u1);
  });
  await test("direct writes and internal RPCs are denied", async () => {
    await assert.rejects(
      () => db.query("update tasks set title=$1 where id=$2", ["Bypass", task]),
      /permission denied/i,
    );
    await assert.rejects(
      () => db.query("select lock_workspace($1)", [u1]),
      /permission denied/i,
    );
  });
  await test("task version checks reject lost updates", async () => {
    await db.query("select write_task($1::jsonb,$2,1)", [
      JSON.stringify({ ...taskData, title: "Updated" }),
      task,
    ]);
    await assert.rejects(
      () =>
        db.query("select write_task($1::jsonb,$2,1)", [
          JSON.stringify(taskData),
          task,
        ]),
      /stale/i,
    );
  });
  await test("stale proposals cannot apply", async () => {
    const p = await proposal(plan(task));
    await createEvent({
      ...eventData,
      title: "New commitment",
      starts_at: "2030-10-15T12:00:00Z",
      ends_at: "2030-10-15T13:00:00Z",
    });
    await assert.rejects(
      () => db.query("select apply_proposal($1)", [p]),
      /stale/i,
    );
  });
  let applied;
  await test("application is atomic and retries are idempotent", async () => {
    applied = await proposal(plan(task));
    await db.query("select apply_proposal($1)", [applied]);
    await db.query("select apply_proposal($1)", [applied]);
    assert.equal(
      (await row("select count(*)::int n from events where kind='focus'")).n,
      1,
    );
    assert.equal(
      (
        await row(
          "select count(*)::int n from change_batches where proposal_id=$1",
          [applied],
        )
      ).n,
      1,
    );
    assert.equal(
      (await row("select status from tasks where id=$1", [task])).status,
      "open",
    );
  });
  await test("undo is idempotent and removes only its created blocks", async () => {
    await db.query("select undo_proposal($1)", [applied]);
    await db.query("select undo_proposal($1)", [applied]);
    assert.equal(
      (await row("select count(*)::int n from events where kind='focus'")).n,
      0,
    );
    assert.equal(
      (
        await row("select count(*)::int n from events where id=$1", [
          commitment,
        ])
      ).n,
      1,
    );
  });
  await test("overlapping proposal rolls back the entire batch", async () => {
    const p = await proposal(
      plan(task, {
        blocks: [
          plan(task).blocks[0],
          {
            ...plan(task).blocks[0],
            starts_at: "2030-10-14T16:30:00Z",
            ends_at: "2030-10-14T17:30:00Z",
          },
        ],
      }),
    );
    await assert.rejects(
      () => db.query("select apply_proposal($1)", [p]),
      /conflict/i,
    );
    assert.equal(
      (await row("select count(*)::int n from events where kind='focus'")).n,
      0,
    );
    assert.equal(
      (await row("select status from proposals where id=$1", [p])).status,
      "pending",
    );
  });
  await test("locked commitment removal is rejected", async () => {
    const p = await proposal(
      plan(task, { blocks: [], remove_ids: [commitment] }),
    );
    await assert.rejects(
      () => db.query("select apply_proposal($1)", [p]),
      /locked/i,
    );
  });
  await test("undo refuses to overwrite intervening edits", async () => {
    const p = await proposal(plan(task));
    await db.query("select apply_proposal($1)", [p]);
    const block = await row("select id,version from events where kind='focus'");
    await db.query("select write_event($1::jsonb,$2,$3)", [
      JSON.stringify({
        ...eventData,
        kind: "focus",
        task_id: task,
        locked: false,
        title: "Edited focus",
        starts_at: "2030-10-14T18:00:00Z",
        ends_at: "2030-10-14T19:00:00Z",
      }),
      block.id,
      block.version,
    ]);
    await assert.rejects(
      () => db.query("select undo_proposal($1)", [p]),
      /later event edit/i,
    );
    await db.query("select write_event($1::jsonb,$2,2,true)", ["{}", block.id]);
  });
  await test("task proposals apply and undo without marking scheduled work complete", async () => {
    const p = await proposal(
      plan(task, {
        blocks: [],
        task_changes: [{ data: { ...taskData, title: "New task" } }],
      }),
    );
    await db.query("select apply_proposal($1)", [p]);
    assert.equal(
      (await row("select count(*)::int n from tasks where title='New task'")).n,
      1,
    );
    await db.query("select undo_proposal($1)", [p]);
    assert.equal(
      (await row("select count(*)::int n from tasks where title='New task'")).n,
      0,
    );
  });
  await test("task updates restore prior content with a fresh version", async () => {
    const old = await row("select * from tasks where id=$1", [task]);
    const p = await proposal(
      plan(task, {
        blocks: [],
        task_changes: [
          {
            id: task,
            version: old.version,
            data: { ...taskData, title: "AI update" },
          },
        ],
      }),
    );
    await db.query("select apply_proposal($1)", [p]);
    await db.query("select undo_proposal($1)", [p]);
    const restored = await row("select * from tasks where id=$1", [task]);
    assert.equal(restored.title, old.title);
    assert.ok(restored.version > old.version);
  });
  let source;
  await test("reimports upsert source identity without duplicates", async () => {
    source = (
      await row("select write_source($1::jsonb) id", [
        JSON.stringify({
          name: "Classes",
          kind: "file",
          url: null,
          all_day_busy: false,
        }),
      ])
    ).id;
    const imported = {
      ...eventData,
      uid: "external-1",
      recurrence_id: "",
      recurrence: null,
    };
    let v = (
      await row("select version from calendar_sources where id=$1", [source])
    ).version;
    await db.query("select reconcile_source($1,$2,$3::jsonb,$4::jsonb,$5)", [
      source,
      "BEGIN:VCALENDAR",
      JSON.stringify([imported]),
      "[]",
      v,
    ]);
    v = (
      await row("select version from calendar_sources where id=$1", [source])
    ).version;
    await db.query("select reconcile_source($1,$2,$3::jsonb,$4::jsonb,$5)", [
      source,
      "BEGIN:VCALENDAR",
      JSON.stringify([{ ...imported, title: "Updated import" }]),
      "[]",
      v,
    ]);
    assert.equal(
      (
        await row("select count(*)::int n from events where source_id=$1", [
          source,
        ])
      ).n,
      1,
    );
    assert.equal(
      (await row("select title from events where source_id=$1", [source]))
        .title,
      "Updated import",
    );
  });
  await test("partial/failed refresh retains last successful events", async () => {
    const v = (
      await row("select version from calendar_sources where id=$1", [source])
    ).version;
    await db.query("select reconcile_source($1,$2,$3::jsonb,$4::jsonb,$5)", [
      source,
      "BEGIN:VCALENDAR",
      "[]",
      "[]",
      v,
    ]);
    await db.query("select fail_refresh($1)", [source]);
    assert.equal(
      (
        await row("select count(*)::int n from events where source_id=$1", [
          source,
        ])
      ).n,
      1,
    );
    assert.ok(
      (
        await row("select last_success from calendar_sources where id=$1", [
          source,
        ])
      ).last_success,
    );
  });
  await test("imported events cannot be edited manually", async () => {
    const e = await row("select id,version from events where source_id=$1", [
      source,
    ]);
    await assert.rejects(
      () =>
        db.query("select write_event($1::jsonb,$2,$3)", [
          JSON.stringify(eventData),
          e.id,
          e.version,
        ]),
      /read-only/i,
    );
  });
  await test("explicit cancellation removes only the source identity", async () => {
    const v = (
      await row("select version from calendar_sources where id=$1", [source])
    ).version;
    await db.query("select reconcile_source($1,$2,$3::jsonb,$4::jsonb,$5)", [
      source,
      "BEGIN:VCALENDAR",
      "[]",
      JSON.stringify([{ uid: "external-1", recurrence_id: null }]),
      v,
    ]);
    assert.equal(
      (
        await row("select count(*)::int n from events where source_id=$1", [
          source,
        ])
      ).n,
      0,
    );
  });
  await test("refresh leases prevent overlapping jobs", async () => {
    const feed = (
      await row("select write_source($1::jsonb) id", [
        JSON.stringify({
          name: "Feed",
          kind: "feed",
          url: "https://example.com/a.ics",
        }),
      ])
    ).id;
    await db.query("select claim_refresh($1)", [feed]);
    await assert.rejects(
      () => db.query("select claim_refresh($1)", [feed]),
      /already running/i,
    );
  });
  await test("feed tokens rotate, revoke, and cannot be read cross-user", async () => {
    const h1 = "a".repeat(64),
      h2 = "b".repeat(64);
    await db.query("select set_feed($1)", [h1]);
    await asUser(u2);
    assert.equal((await row("select count(*)::int n from feed_tokens")).n, 0);
    await asUser(u1);
    await db.query("select set_feed($1)", [h2]);
    assert.equal(
      (
        await row(
          "select count(*)::int n from feed_tokens where token_hash=$1",
          [h1],
        )
      ).n,
      0,
    );
    await db.query("select set_feed()");
    assert.equal((await row("select count(*)::int n from feed_tokens")).n, 0);
  });
  await test("persistent rate limits survive independent calls", async () => {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await row("select take_rate_limit('ai',10,3600) allowed")).allowed,
        true,
      );
    assert.equal(
      (await row("select take_rate_limit('ai',10,3600) allowed")).allowed,
      false,
    );
    await assert.rejects(
      () => db.query("select take_rate_limit('ai',120,60)"),
      /policy/i,
    );
  });
  await test("disabled source events stop blocking focus work", async () => {
    const s = (
      await row("select write_source($1::jsonb) id", [
        JSON.stringify({
          name: "Disabled",
          kind: "file",
          url: null,
          all_day_busy: false,
        }),
      ])
    ).id;
    let v = (await row("select version from calendar_sources where id=$1", [s]))
      .version;
    await db.query("select reconcile_source($1,$2,$3::jsonb,$4::jsonb,$5)", [
      s,
      "BEGIN:VCALENDAR",
      JSON.stringify([
        {
          ...eventData,
          starts_at: "2030-10-16T16:00:00Z",
          ends_at: "2030-10-16T17:00:00Z",
          uid: "disabled-external",
          recurrence_id: "",
        },
      ]),
      "[]",
      v,
    ]);
    v = (await row("select version from calendar_sources where id=$1", [s]))
      .version;
    await db.query("select write_source($1::jsonb,$2,$3)", [
      JSON.stringify({ name: "Disabled", enabled: false, all_day_busy: false }),
      s,
      v,
    ]);
    const id = await createEvent({
      ...eventData,
      kind: "focus",
      task_id: task,
      locked: false,
      starts_at: "2030-10-16T16:00:00Z",
      ends_at: "2030-10-16T17:00:00Z",
    });
    assert.ok(id);
  });
  await test("database revalidates proposal availability and deadlines", async () => {
    const p = await proposal(
      plan(task, {
        blocks: [
          {
            ...plan(task).blocks[0],
            starts_at: "2030-10-14T06:00:00Z",
            ends_at: "2030-10-14T07:00:00Z",
          },
        ],
      }),
    );
    await assert.rejects(
      () => db.query("select apply_proposal($1)", [p]),
      /availability/i,
    );
    const d = await createTask({
      ...taskData,
      deadline: "2030-10-15T15:00:00Z",
    });
    const late = await proposal(
      plan(d, {
        blocks: [
          {
            ...plan(d).blocks[0],
            starts_at: "2030-10-15T16:00:00Z",
            ends_at: "2030-10-15T17:00:00Z",
          },
        ],
      }),
    );
    await assert.rejects(
      () => db.query("select apply_proposal($1)", [late]),
      /deadline/i,
    );
  });
  await test("anonymous access and service-role impersonation are rejected", async () => {
    await assert.rejects(
      () => db.query("select claim_refresh($1,$2)", [source, u2]),
      /denied/i,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      () => db.query("select * from tasks"),
      /permission denied/i,
    );
    await assert.rejects(
      () => db.query("select ensure_preferences()"),
      /permission denied/i,
    );
  });
  console.log(`${passed} PostgreSQL checks passed (simulated Auth claims).`);
} finally {
  await db.close();
}
