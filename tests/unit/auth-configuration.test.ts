import { it, expect } from "vitest";
import {
  supabaseConfigurationError,
  signupFailure,
} from "../../src/lib/auth-configuration";
it("rejects dashboard URLs before sending credentials to a webpage", () => {
  expect(
    supabaseConfigurationError(
      "https://supabase.com/dashboard/project/example",
      "sb_publishable_example",
    ),
  ).toContain("not a Supabase dashboard URL");
  expect(
    supabaseConfigurationError(
      "https://example.supabase.co",
      "sb_publishable_example",
    ),
  ).toBeNull();
  expect(
    supabaseConfigurationError("http://127.0.0.1:54321", "local-anon-key"),
  ).toBeNull();
  expect(
    supabaseConfigurationError(
      "https://your-project.supabase.co",
      "your-publishable-key",
    ),
  ).toContain("Set the Supabase");
});
it("never includes supplied keys in configuration errors", () => {
  const key = "sb_secret_do_not_show_this";
  const error = supabaseConfigurationError("https://example.supabase.co", key);
  expect(error).toContain("publishable key");
  expect(error).not.toContain(key);
});
it("explains email restrictions, quota limits and password policy failures", () => {
  expect(
    signupFailure({ code: "email_address_not_authorized", status: 400 })
      .message,
  ).toContain("custom SMTP");
  expect(
    signupFailure({ code: "over_email_send_rate_limit", status: 429 }).status,
  ).toBe(429);
  expect(
    signupFailure({ code: "weak_password", status: 422 }).message,
  ).toContain("password policy");
  expect(
    signupFailure({ name: "AuthRetryableFetchError", status: 0 }).status,
  ).toBe(503);
  expect(signupFailure({ code: "unexpected_secret=abc" }).code).toBe("unknown");
});
