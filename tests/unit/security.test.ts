import { it, expect } from "vitest";
import {
  isPublicAddress,
  validateFeedUrl,
  generateFeedToken,
  hashToken,
} from "../../src/lib/feed-security";
import { taskInput, eventInput } from "../../src/lib/domain";
import { task, event } from "./fixtures";
it("rejects private, mapped, reserved, loopback and link-local destinations", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.2.4",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    expect(isPublicAddress(address), address).toBe(false);
  expect(isPublicAddress("8.8.8.8")).toBe(true);
});
it("only accepts public HTTPS URLs without credentials or custom ports", () => {
  for (const url of [
    "http://example.com/a.ics",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://host.internal/a",
    "https://user:pass@example.com/a",
    "https://example.com:8443/a",
  ])
    expect(() => validateFeedUrl(url), url).toThrow();
  expect(validateFeedUrl("https://calendar.example.com/a.ics").hostname).toBe(
    "calendar.example.com",
  );
});
it("generates unique high-entropy bearer tokens and stores hashes", () => {
  const a = generateFeedToken(),
    b = generateFeedToken();
  expect(a.token).toHaveLength(43);
  expect(a.token).not.toBe(b.token);
  expect(a.hash).toHaveLength(64);
  expect(a.hash).toBe(hashToken(a.token));
  expect(a.hash).not.toContain(a.token);
});
it("rejects ownership and arbitrary fields at manual boundaries", () => {
  expect(() => taskInput.parse(task())).toThrow();
  const { id, owner_id, version, updated_at, ...data } = task();
  expect(taskInput.parse(data).title).toBe("Statistics");
  expect(() => taskInput.parse({ ...data, remaining_minutes: 121 })).toThrow();
  expect(() => eventInput.parse(event())).toThrow();
});
