import { it, expect, vi, afterEach } from "vitest";
import { event, owner } from "./fixtures";
const mocks = vi.hoisted(() => ({ job: vi.fn(), user: vi.fn() }));
vi.mock("../../src/lib/supabase", () => ({
  jobClient: mocks.job,
  userClient: mocks.user,
}));
import { GET, POST } from "../../src/app/api/[...path]/route";
import { generateFeedToken } from "../../src/lib/feed-security";
afterEach(() => vi.unstubAllEnvs());
it("signup reports the SMTP restriction without logging email or password", async () => {
  const email = "private@example.com",
    password = "private-test-password";
  mocks.user.mockResolvedValue({
    auth: {
      signUp: async () => ({
        data: { session: null },
        error: { code: "email_address_not_authorized", status: 400 },
      }),
    },
  });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await POST(
      new Request("https://tempo.example/api/auth", {
        method: "POST",
        headers: {
          origin: "https://tempo.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "signup", email, password }),
      }),
      { params: Promise.resolve({ path: ["auth"] }) },
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("custom SMTP");
    const logs = JSON.stringify(log.mock.calls);
    expect(logs).toContain("email_address_not_authorized");
    expect(logs).not.toContain(email);
    expect(logs).not.toContain(password);
  } finally {
    log.mockRestore();
  }
});
it("private feed supports ETag but always rechecks revocation before returning 304", async () => {
  const { token, hash } = generateFeedToken();
  let active = true;
  const now = new Date().toISOString();
  const owned = event({
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 7200000).toISOString(),
    updated_at: now,
  });
  const imported = event({ uid: "excluded", source_id: "source" });
  mocks.job.mockReturnValue({
    from: (table: string) => {
      if (table === "feed_tokens")
        return {
          select: () => ({
            eq: (_field: string, value: string) => ({
              maybeSingle: async () => ({
                data:
                  active && value === hash
                    ? {
                        owner_id: owner,
                        include_commitments: true,
                        include_focus: true,
                      }
                    : null,
                error: null,
              }),
            }),
          }),
        };
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              limit: async () => ({ data: [owned, imported], error: null }),
            }),
          }),
        }),
      };
    },
  });
  const url = `https://tempo.example/api/feed/${token}.ics`,
    params = Promise.resolve({ path: ["feed", token + ".ics"] });
  const initial = await GET(new Request(url), { params });
  expect(initial.status).toBe(200);
  expect(initial.headers.get("Content-Type")).toContain("text/calendar");
  const raw = await initial.text();
  expect(raw).toContain(owned.uid);
  expect(raw).not.toContain("excluded");
  const etag = initial.headers.get("ETag")!;
  expect(
    (
      await GET(new Request(url, { headers: { "If-None-Match": etag } }), {
        params,
      })
    ).status,
  ).toBe(304);
  active = false;
  expect(
    (
      await GET(new Request(url, { headers: { "If-None-Match": etag } }), {
        params,
      })
    ).status,
  ).toBe(404);
});
it("job endpoint rejects missing and incorrect authorization", async () => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  const params = Promise.resolve({ path: ["jobs", "refresh"] });
  expect(
    (
      await GET(new Request("https://tempo.example/api/jobs/refresh"), {
        params,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await GET(
        new Request("https://tempo.example/api/jobs/refresh", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
        { params },
      )
    ).status,
  ).toBe(401);
});
it("workspace endpoint verifies authentication before reading user records", async () => {
  mocks.user.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  expect(
    (
      await GET(new Request("https://tempo.example/api/workspace"), {
        params: Promise.resolve({ path: ["workspace"] }),
      })
    ).status,
  ).toBe(401);
});
