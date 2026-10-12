import { it, expect } from "vitest";
import { assertOrigin, boundedJson } from "../../src/lib/http";
it("rejects cross-origin and missing-origin mutation requests", () => {
  expect(() =>
    assertOrigin(
      new Request("https://tempo.example/api/tasks", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  ).toThrow("origin");
  expect(() =>
    assertOrigin(new Request("https://tempo.example/api/tasks")),
  ).toThrow("origin");
  expect(() =>
    assertOrigin(
      new Request("https://tempo.example/api/tasks", {
        headers: { origin: "https://tempo.example" },
      }),
    ),
  ).not.toThrow();
});
it("bounds request bodies and rejects non-JSON input", async () => {
  await expect(
    boundedJson(
      new Request("https://example.com", {
        method: "POST",
        body: "x",
        headers: { "Content-Type": "text/plain" },
      }),
    ),
  ).rejects.toThrow("application/json");
  await expect(
    boundedJson(
      new Request("https://example.com", {
        method: "POST",
        body: "x".repeat(1100000),
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ).rejects.toThrow("1 MB");
  await expect(
    boundedJson(
      new Request("https://example.com", {
        method: "POST",
        body: "{",
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ).rejects.toThrow("Invalid JSON");
});
