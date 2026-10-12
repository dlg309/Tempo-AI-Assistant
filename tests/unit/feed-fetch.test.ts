import { it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
import { fetchFeed } from "../../src/lib/feed-security";
it("revalidates redirects and never connects to private redirected addresses", async () => {
  mocks.lookup
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
  mocks.request.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (e: Error) => void;
    };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: unknown;
        destroy: () => void;
      };
      res.statusCode = 302;
      res.headers = { location: "https://redirect.example.com/calendar.ics" };
      res.destroy = () => req.emit("close");
      callback(res);
    };
    req.destroy = (e) => req.emit("error", e);
    return req;
  });
  await expect(fetchFeed("https://calendar.example.com/a.ics")).rejects.toThrow(
    "private",
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const options = mocks.request.mock.calls[0][1],
    callback = vi.fn();
  options.lookup("calendar.example.com", { all: false }, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
});
