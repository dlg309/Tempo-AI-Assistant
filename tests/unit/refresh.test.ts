import { it, expect, vi } from "vitest";
vi.mock("../../src/lib/feed-security", () => ({
  fetchFeed: vi.fn().mockRejectedValue(new Error("network failed")),
}));
import { refreshSource } from "../../src/lib/services";
import type { DbClient } from "../../src/lib/supabase";
it("failed server fetch records an error without invoking reconciliation or deleting data", async () => {
  const rpc = vi
    .fn()
    .mockImplementation((name: string) =>
      name === "claim_refresh"
        ? {
            single: async () => ({
              data: {
                id: "source",
                owner_id: "owner",
                url: "https://example.com/a.ics",
                version: 1,
              },
              error: null,
            }),
          }
        : Promise.resolve({ data: null, error: null }),
    );
  const db = {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { timezone: "America/New_York" },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as DbClient;
  await expect(refreshSource(db, "source")).rejects.toThrow("kept");
  expect(rpc.mock.calls.map((c) => c[0])).toEqual([
    "claim_refresh",
    "fail_refresh",
  ]);
});
