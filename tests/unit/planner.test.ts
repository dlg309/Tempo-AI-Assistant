import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  overlaps,
  subtractIntervals,
  planSchedule,
  availability,
} from "../../src/lib/planner";
import { localInstant } from "../../src/lib/domain";
import { event, task, prefs } from "./fixtures";
const start = Date.parse("2026-10-12T13:00:00Z"),
  end = Date.parse("2026-10-12T21:00:00Z");
describe("deterministic planning", () => {
  it("reserves a break before an existing locked focus block", () => {
    const locked = event({
      kind: "focus",
      task_id: task().id,
      starts_at: "2026-10-12T14:00:00Z",
      ends_at: "2026-10-12T15:00:00Z",
    });
    const p = planSchedule(
      [task()],
      [locked],
      { ...prefs, availability: [{ day: 1, start: "09:00", end: "11:00" }] },
      start,
      end,
    );
    expect(p.blocks[0].ends_at).toBe("2026-10-12T13:50:00.000Z");
    expect(p.unscheduled[0].minutes).toBe(10);
  });
  it("uses half-open intervals: adjacent events do not conflict", () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(
      subtractIntervals(
        [{ start: 0, end: 30 }],
        [
          { start: 10, end: 20 },
          { start: 15, end: 25 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 25, end: 30 },
    ]);
  });
  it("splits work around commitments and inserts breaks", () => {
    const p = planSchedule([task()], [event()], prefs, start, end);
    expect(p.blocks).toHaveLength(2);
    expect(p.blocks[0].starts_at).toBe("2026-10-12T13:00:00.000Z");
    expect(p.blocks[1].starts_at).toBe("2026-10-12T15:00:00.000Z");
    expect(p.unscheduled).toEqual([]);
    expect(task().status).toBe("open");
  });
  it("honors buffers without putting work into appointments", () => {
    const p = planSchedule(
      [task()],
      [event()],
      { ...prefs, buffer_minutes: 15 },
      start,
      end,
    );
    for (const b of p.blocks)
      expect(
        overlaps(
          { start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) },
          {
            start: Date.parse(event().starts_at!) - 15 * 60000,
            end: Date.parse(event().ends_at!) + 15 * 60000,
          },
        ),
      ).toBe(false);
  });
  it("reports every minute that cannot fit before a deadline", () => {
    const p = planSchedule(
      [task({ deadline: "2026-10-12T14:30:00Z" })],
      [event()],
      prefs,
      start,
      end,
    );
    expect(p.blocks).toHaveLength(1);
    expect(p.unscheduled[0].minutes).toBe(60);
    expect(Date.parse(p.blocks[0].ends_at)).toBeLessThanOrEqual(
      Date.parse("2026-10-12T14:30:00Z"),
    );
  });
  it("never shortens an unsplittable task to fit", () => {
    const p = planSchedule(
      [task({ splittable: false })],
      [event()],
      { ...prefs, availability: [{ day: 1, start: "09:00", end: "10:00" }] },
      start,
      end,
    );
    expect(p.blocks).toEqual([]);
    expect(p.unscheduled[0].minutes).toBe(120);
  });
  it("reports passed deadlines and days with no availability", () => {
    const p = planSchedule(
      [task({ deadline: "2026-10-11T12:00:00Z" })],
      [],
      prefs,
      start,
      end,
    );
    expect(p.unscheduled[0].reason).toContain("passed");
    expect(
      planSchedule([task()], [], { ...prefs, availability: [] }, start, end)
        .unscheduled[0].minutes,
    ).toBe(120);
  });
  it("retains valid flexible blocks and never moves locked blocks", () => {
    const flexible = event({
      kind: "focus",
      task_id: task().id,
      locked: false,
      starts_at: "2026-10-12T16:00:00Z",
      ends_at: "2026-10-12T17:00:00Z",
    });
    const p = planSchedule(
      [task()],
      [flexible, event({ id: "locked" })],
      prefs,
      start,
      end,
      true,
    );
    expect(p.remove_ids).toEqual([]);
    expect(p.locked_ids).toContain("locked");
    expect(
      p.blocks.reduce(
        (n, b) => n + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000,
        0,
      ),
    ).toBe(60);
  });
  it("replaces only flexible blocks that conflict with new commitments", () => {
    const flexible = event({
      id: "flex",
      kind: "focus",
      task_id: task().id,
      locked: false,
    });
    const p = planSchedule(
      [task()],
      [flexible, event({ id: "locked" })],
      prefs,
      start,
      end,
      true,
    );
    expect(p.remove_ids).toEqual(["flex"]);
    expect(p.locked_ids).toEqual(["locked"]);
    expect(p.blocks).toHaveLength(2);
  });
  it("does not count past unfinished blocks as completed effort", () => {
    const past = event({
      kind: "focus",
      task_id: task().id,
      starts_at: "2026-10-11T14:00:00Z",
      ends_at: "2026-10-11T15:00:00Z",
    });
    expect(
      planSchedule([task()], [past], prefs, start, end).blocks,
    ).toHaveLength(2);
  });
  it("honors all-day source semantics and exclusive end dates", () => {
    const allDay = event({
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: "2026-10-12",
      end_date: "2026-10-13",
    });
    expect(
      planSchedule([task()], [allDay], prefs, start, end).blocks.length,
    ).toBe(2);
    expect(
      planSchedule(
        [task()],
        [allDay],
        { ...prefs, all_day_busy: true },
        start,
        end,
      ).blocks.length,
    ).toBe(0);
    expect(
      planSchedule(
        [task()],
        [{ ...allDay, source_id: "source" }],
        prefs,
        start,
        end,
      ).blocks.length,
    ).toBe(0);
    expect(
      planSchedule(
        [task()],
        [{ ...allDay, source_id: "source", busy: false }],
        prefs,
        start,
        end,
      ).blocks.length,
    ).toBe(2);
  });
  it("keeps local availability stable across a DST boundary", () => {
    const p = {
      ...prefs,
      availability: [{ day: 7, start: "09:00", end: "10:00" }],
    };
    const windows = availability(
      p,
      Date.parse("2026-10-31T00:00:00Z"),
      Date.parse("2026-11-09T00:00:00Z"),
    );
    expect(windows.map((w) => new Date(w.start).toISOString())).toEqual([
      "2026-11-01T14:00:00.000Z",
      "2026-11-08T14:00:00.000Z",
    ]);
    const march = availability(
      p,
      Date.parse("2026-03-01T00:00:00Z"),
      Date.parse("2026-03-09T00:00:00Z"),
    );
    expect(march.map((w) => new Date(w.start).toISOString())).toEqual([
      "2026-03-01T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
    ]);
  });
  it("rejects ambiguous and nonexistent local input times", () => {
    expect(() => localInstant("2026-03-08T02:30", "America/New_York")).toThrow(
      "does not exist",
    );
    expect(() => localInstant("2026-11-01T01:30", "America/New_York")).toThrow(
      "twice",
    );
    expect(localInstant("2026-11-01T09:00", "America/New_York")).toBe(
      "2026-11-01T14:00:00.000Z",
    );
  });
  it("does not overlap allocated blocks under varied busy intervals", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const commitments = Array.from({ length: 4 }, (_, i) =>
        event({
          id: `${seed}-${i}`,
          starts_at: new Date(
            start + ((seed * 13 + i * 71) % 400) * 60000,
          ).toISOString(),
          ends_at: new Date(
            start + (((seed * 13 + i * 71) % 400) + 25) * 60000,
          ).toISOString(),
        }),
      );
      const p = planSchedule(
        [task({ estimated_minutes: 300, remaining_minutes: 300 })],
        commitments,
        prefs,
        start,
        end,
      );
      const blocks = p.blocks.map((b) => ({
        start: Date.parse(b.starts_at),
        end: Date.parse(b.ends_at),
      }));
      for (let i = 0; i < blocks.length; i++) {
        expect(
          commitments.some((e) =>
            overlaps(blocks[i], {
              start: Date.parse(e.starts_at!),
              end: Date.parse(e.ends_at!),
            }),
          ),
        ).toBe(false);
        expect(blocks.slice(i + 1).some((b) => overlaps(blocks[i], b))).toBe(
          false,
        );
      }
      const scheduled = blocks.reduce(
        (n, b) => n + (b.end - b.start) / 60000,
        0,
      );
      expect(scheduled + (p.unscheduled[0]?.minutes || 0)).toBe(300);
    }
  });
});
