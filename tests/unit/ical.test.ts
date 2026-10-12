import { describe, it, expect } from "vitest";
import {
  parseCalendar,
  exportCalendar,
  MAX_ICS_BYTES,
} from "../../src/lib/ical";
import { ics, vevent, sourceId, owner, event } from "./fixtures";
const start = Date.parse("2026-10-01T00:00:00Z"),
  end = Date.parse("2026-11-30T00:00:00Z");
function parse(raw: string) {
  return parseCalendar(raw, sourceId, owner, "America/New_York", start, end);
}
describe("iCalendar boundary", () => {
  it("parses local instants with IANA zones and stable identities", () => {
    const a = parse(ics(vevent)),
      b = parse(ics(vevent.replace("Statistics class", "Changed class")));
    expect(a.events[0].starts_at).toBe("2026-10-12T13:00:00.000Z");
    expect(a.events[0].id).toBe(b.events[0].id);
    expect(b.events[0].title).toBe("Changed class");
  });
  it("expands RRULE and EXDATE, applies moved recurrence exceptions", () => {
    const repeating = vevent.replace(
      "SUMMARY:",
      "RRULE:FREQ=WEEKLY;COUNT=4\nEXDATE;TZID=America/New_York:20261019T090000\nSUMMARY:",
    );
    const exception = vevent
      .replace(
        "DTSTART;TZID=America/New_York:20261012T090000",
        "RECURRENCE-ID;TZID=America/New_York:20261026T090000\nDTSTART;TZID=America/New_York:20261026T140000",
      )
      .replace(
        "DTEND;TZID=America/New_York:20261012T100000",
        "DTEND;TZID=America/New_York:20261026T150000",
      );
    const p = parse(ics(repeating + "\n" + exception));
    expect(p.events).toHaveLength(3);
    expect(p.events.map((e) => e.starts_at)).toContain(
      "2026-10-26T18:00:00.000Z",
    );
    expect(p.events.map((e) => e.starts_at)).toContain(
      "2026-11-02T14:00:00.000Z",
    );
    expect(p.events.some((e) => e.starts_at?.startsWith("2026-10-19"))).toBe(
      false,
    );
  });
  it("supports RDATE and explicit cancellation identities", () => {
    const raw = ics(
      vevent.replace(
        "SUMMARY:",
        "RDATE;TZID=America/New_York:20261015T090000\nSUMMARY:",
      ) + "\nBEGIN:VEVENT\nUID:other\nSTATUS:CANCELLED\nEND:VEVENT",
    );
    const p = parse(raw);
    expect(p.events).toHaveLength(2);
    expect(p.canceled).toEqual([{ uid: "other", recurrence_id: null }]);
  });
  it("preserves all-day dates and source transparency", () => {
    const raw = ics(
      "BEGIN:VEVENT\nUID:holiday\nDTSTART;VALUE=DATE:20261012\nDTEND;VALUE=DATE:20261013\nSUMMARY:Holiday\nEND:VEVENT",
    );
    const p = parse(raw);
    expect(p.events[0]).toMatchObject({
      start_date: "2026-10-12",
      end_date: "2026-10-13",
      starts_at: null,
      busy: false,
    });
    expect(
      parseCalendar(raw, sourceId, owner, "America/New_York", start, end, true)
        .events[0].busy,
    ).toBe(true);
    expect(
      parseCalendar(
        raw.replace("SUMMARY:", "TRANSP:TRANSPARENT\r\nSUMMARY:"),
        sourceId,
        owner,
        "America/New_York",
        start,
        end,
        true,
      ).events[0].busy,
    ).toBe(false);
  });
  it("rejects malformed, oversized, unbounded and unsupported input", () => {
    expect(() => parse("junk")).toThrow();
    expect(() => parse("x".repeat(MAX_ICS_BYTES + 1))).toThrow("1 MB");
    expect(() =>
      parse(
        ics(
          vevent
            .replaceAll("20261012", "20001012")
            .replace("SUMMARY:", "RRULE:FREQ=SECONDLY\nSUMMARY:"),
        ),
      ),
    ).toThrow("frequencies");
    expect(() =>
      parse(ics(vevent.replace("SUMMARY:", "EXRULE:FREQ=DAILY\nSUMMARY:"))),
    ).toThrow("EXRULE");
    expect(() =>
      parse(ics(vevent.replace("America/New_York", "Unknown/Zone"))),
    ).toThrow("Unsupported time zone");
    expect(() => parse(ics(vevent + "\n" + vevent))).toThrow("duplicate");
  });
  it("exports valid UTC and all-day entries while excluding imported events", () => {
    const own = event({ source_id: null }),
      allDay = event({
        id: "day",
        uid: "all-day",
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-10-12",
        end_date: "2026-10-13",
      });
    const raw = exportCalendar([
      own,
      allDay,
      event({ source_id: sourceId, uid: "imported" }),
    ]);
    expect(raw).toContain("DTSTART:20261012T140000Z");
    expect(raw).toContain("DTEND;VALUE=DATE:20261013");
    expect(raw).toContain("DTSTAMP:");
    expect(raw).not.toContain("imported");
    expect(parse(raw).events).toHaveLength(2);
  });
  it("escapes descriptions safely and folds long UTF-8 properties", () => {
    const raw = exportCalendar([
      event({
        description: "Line one\nLine two; comma, \\",
        title: "é".repeat(100),
      }),
    ]);
    expect(parse(raw).events[0].description).toBe(
      "Line one\nLine two; comma, \\",
    );
    expect(raw).toContain("\r\n ");
  });
});
