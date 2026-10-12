import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  defaults,
  type Workspace,
  type CalendarEvent,
  type Task,
} from "../../src/lib/domain";
import { planSchedule } from "../../src/lib/planner";
import { exportCalendar, parseCalendar } from "../../src/lib/ical";
import { event, task, owner, ics, vevent } from "../unit/fixtures";

// Explicitly mocked HTTP persistence and auth. Production routes contain no demo
// backend or fake assistant. SQL integrity is exercised separately in test:db.
async function mockedWorkspace(page: Page) {
  const state: Workspace = {
    email: "diego@example.com",
    aiConfigured: false,
    feedActive: false,
    preferences: {
      ...defaults,
      owner_id: owner,
      revision: 0,
      onboarded: true,
      focus_minutes: 60,
    },
    tasks: [
      task({
        title: "Review statistics notes",
        deadline: "2026-10-16T16:00:00Z",
      }),
      task({
        id: randomUUID(),
        title: "Polish portfolio",
        category: "work",
        priority: "medium",
        deadline: "2026-10-16T21:00:00Z",
        estimated_minutes: 90,
        remaining_minutes: 90,
      }),
    ],
    events: [
      event({ title: "Statistics lecture" }),
      event({
        id: randomUUID(),
        title: "Work shift",
        category: "work",
        starts_at: "2026-10-15T21:00:00Z",
        ends_at: "2026-10-16T02:00:00Z",
      }),
    ],
    sources: [],
    messages: [],
    proposals: [],
  };
  let signedIn = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.slice(5),
      body = req.method() === "POST" ? req.postDataJSON() : {};
    const ok = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "auth") {
      signedIn = body.action !== "logout";
      return ok({ ok: true });
    }
    if (!signedIn)
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sign in to continue." }),
      });
    if (path === "workspace") return ok(state);
    if (path === "tasks") {
      if (body.id) {
        const index = state.tasks.findIndex((t) => t.id === body.id);
        if (body.remove) state.tasks.splice(index, 1);
        else
          state.tasks[index] = {
            ...state.tasks[index],
            ...body.data,
            version: state.tasks[index].version + 1,
          };
      } else
        state.tasks.unshift({
          ...body.data,
          id: randomUUID(),
          owner_id: owner,
          version: 1,
          updated_at: new Date().toISOString(),
        });
      state.preferences.revision++;
      return ok({ ok: true });
    }
    if (path === "sources") {
      const id = body.id || randomUUID();
      state.sources.push({
        ...body,
        id,
        owner_id: owner,
        version: 1,
        enabled: true,
        raw_ics: null,
        last_success: null,
        last_attempt: null,
        refresh_error: null,
      });
      return ok({ id });
    }
    if (path === "import") {
      const parsed = parseCalendar(
        body.raw,
        body.source_id,
        owner,
        state.preferences.timezone,
        Date.parse("2026-10-01T00:00:00Z"),
        Date.parse("2026-11-30T00:00:00Z"),
      );
      if (body.confirm) {
        for (const e of parsed.events) {
          const index = state.events.findIndex((v) => v.id === e.id);
          if (index < 0) state.events.push(e);
          else state.events[index] = e;
        }
        state.preferences.revision++;
      }
      return ok(parsed);
    }
    if (path === "plan") {
      const payload = planSchedule(
        state.tasks,
        state.events,
        state.preferences,
        Math.max(Date.parse(body.start), Date.parse("2026-10-12T12:00:00Z")),
        Date.parse(body.end),
        body.replan,
      );
      const p = {
        id: randomUUID(),
        owner_id: owner,
        status: "pending" as const,
        base_revision: state.preferences.revision,
        payload,
        created_at: new Date().toISOString(),
      };
      state.proposals.unshift(p);
      return ok(p);
    }
    if (path === "proposal") {
      const p = state.proposals.find((p) => p.id === body.id)!;
      if (body.action === "apply" && p.status === "pending") {
        for (const b of p.payload.blocks)
          state.events.push({
            ...event(),
            ...b,
            id: randomUUID(),
            uid: randomUUID() + "@tempo",
            kind: "focus",
            locked: false,
          });
        p.status = "applied";
        state.preferences.revision++;
      } else if (body.action === "undo") {
        state.events = state.events.filter(
          (e) =>
            !(
              e.kind === "focus" &&
              p.payload.blocks.some(
                (b) => b.starts_at === e.starts_at && b.task_id === e.task_id,
              )
            ),
        );
        p.status = "undone";
      } else if (body.action === "reject") p.status = "rejected";
      return ok({ ok: true });
    }
    if (path === "export")
      return route.fulfill({
        status: 200,
        contentType: "text/calendar",
        headers: {
          "Content-Disposition": 'attachment; filename="tempo-plan.ics"',
        },
        body: exportCalendar(state.events),
      });
    if (path === "preferences") {
      state.preferences = {
        ...state.preferences,
        ...body.data,
        revision: state.preferences.revision + 1,
      };
      return ok(state.preferences);
    }
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Unhandled mocked test endpoint: " + path,
      }),
    });
  });
  return state;
}
async function navigate(page: Page, label: string, mobile: boolean) {
  const nav = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Main navigation",
    exact: true,
  });
  await nav.getByRole("button", { name: label, exact: true }).click();
}
test("manual planning workflow: sign in, import, create, preview, apply, reload, export, undo", async ({
  page,
}, info) => {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00Z") });
  const state = await mockedWorkspace(page),
    mobile = info.project.name === "mobile";
  await page.goto("/login");
  await page.getByLabel("Email address").fill("diego@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for your day." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/tempo-${info.project.name}-today.png`,
    fullPage: true,
  });
  await navigate(page, mobile ? "More" : "Connections", mobile);
  await page.getByLabel("Calendar name").fill("My classes");
  await page.getByRole("button", { name: "Add calendar", exact: true }).click();
  await page.getByLabel("Import into source").selectOption(state.sources[0].id);
  await page.getByLabel("Calendar file (up to 1 MB)").setInputFiles({
    name: "classes.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(ics(vevent)),
  });
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByRole("heading", { name: "Review calendar import" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    page.getByText(
      "Calendar imported. Reimport into this source to update it.",
    ),
  ).toBeVisible();
  await navigate(page, "Tasks", mobile);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Task title").fill("Study for Friday exam");
  await page.getByLabel("Estimated minutes").fill("180");
  await page.getByLabel("Remaining minutes").fill("180");
  await page.getByLabel(/Deadline/).fill("2026-10-16T08:00");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Study for Friday exam" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plan my week", exact: true }).click();
  await page.getByRole("button", { name: "Preview plan", exact: true }).click();
  if (mobile)
    await expect(
      page.getByRole("heading", { name: "Find time with Tempo." }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply plan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Undo plan", exact: true }),
  ).toBeVisible();
  expect(state.events.filter((e) => e.kind === "focus").length).toBeGreaterThan(
    0,
  );
  await page.reload();
  if (mobile) await navigate(page, "Assistant", true);
  await expect(
    page.getByRole("button", { name: "Undo plan", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("tempo-plan.ics");
  await page.getByRole("button", { name: "Undo plan", exact: true }).click();
  expect(state.events.filter((e) => e.kind === "focus")).toHaveLength(0);
  await navigate(page, "Calendar", mobile);
  await page.screenshot({
    path: `test-results/tempo-${info.project.name}-calendar.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
test("missing AI keeps manual planning available and forms are keyboard accessible", async ({
  page,
}, info) => {
  const state = await mockedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("diego@example.com");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for your day." }),
  ).toBeVisible();
  if (info.project.name === "mobile") await navigate(page, "Assistant", true);
  else await navigate(page, "Assistant", false);
  await expect(page.getByText("Assistant needs configuration")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan without AI" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Plan without AI" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.aiConfigured).toBe(false);
});
