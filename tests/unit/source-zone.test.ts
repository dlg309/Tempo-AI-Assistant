import { it, expect } from "vitest";
import { loadWorkspace } from "../../src/lib/services";
import type { DbClient } from "../../src/lib/supabase";
import { prefs, sourceId, owner, ics, vevent } from "./fixtures";
it("preserves floating source instants when the user changes their display/planning zone", async () => {
  const preferences = { ...prefs, timezone: "America/Los_Angeles" };
  const rows: Record<string, unknown[]> = {
    tasks: [],
    events: [],
    calendar_sources: [
      {
        id: sourceId,
        owner_id: owner,
        name: "Classes",
        timezone: "America/New_York",
        kind: "file",
        enabled: true,
        all_day_busy: false,
        raw_ics: ics(vevent.replaceAll(";TZID=America/New_York", "")),
        last_success: null,
        last_attempt: null,
        refresh_error: null,
        version: 1,
      },
    ],
    proposals: [],
    messages: [],
    feed_tokens: [],
  };
  const db = {
    rpc: () => ({ single: async () => ({ data: preferences, error: null }) }),
    from: (table: string) => {
      const result = { data: rows[table], error: null };
      const builder = {
        select: () => builder,
        order: () => builder,
        or: () => builder,
        limit: async () => result,
        single: async () => ({ data: preferences, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve(result)),
      };
      return builder;
    },
  } as unknown as DbClient;
  const state = await loadWorkspace(
    db,
    "user@example.com",
    Date.parse("2026-10-12T00:00:00Z"),
    Date.parse("2026-10-19T00:00:00Z"),
  );
  expect(state.preferences.timezone).toBe("America/Los_Angeles");
  expect(state.events[0].starts_at).toBe("2026-10-12T13:00:00.000Z");
  expect(state.events[0].timezone).toBe("America/New_York");
});
