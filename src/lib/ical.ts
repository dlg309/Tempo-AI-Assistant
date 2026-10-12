import ICAL from "ical.js";
import { DateTime, IANAZone } from "luxon";
import type { CalendarEvent } from "./domain";
import { createHash } from "node:crypto";

export const MAX_ICS_BYTES = 1048576;
export type ParsedCalendar = {
  events: CalendarEvent[];
  canceled: { uid: string; recurrence_id: string | null }[];
  warnings: string[];
};
function stableId(key: string) {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
function dateText(t: ICAL.Time) {
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}
function asInstant(t: ICAL.Time, zone: string): string {
  // Embedded VTIMEZONE takes precedence. Otherwise interpret local recurrence
  // fields with the IANA zone rather than treating a floating time as UTC.
  if (
    t.zone &&
    t.zone.tzid !== "floating" &&
    t.zone.tzid !== "UTC" &&
    t.zone.component
  )
    return t.toJSDate().toISOString();
  if (t.zone?.tzid === "UTC") return t.toJSDate().toISOString();
  const dt = DateTime.fromObject(
    {
      year: t.year,
      month: t.month,
      day: t.day,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
    },
    { zone },
  );
  if (!dt.isValid || dt.hour !== t.hour || dt.minute !== t.minute)
    throw new Error(
      "Calendar contains a nonexistent local time at a daylight saving change.",
    );
  if (dt.getPossibleOffsets().length > 1)
    throw new Error(
      "Calendar contains an ambiguous local time at a daylight saving change. Use UTC for this occurrence.",
    );
  return dt.toUTC().toISO()!;
}
function zoneFor(c: ICAL.Component, fallback: string): string {
  const tzid = c.getFirstProperty("dtstart")?.getParameter("tzid");
  const value = c.getFirstPropertyValue("dtstart") as ICAL.Time | null;
  if (value?.zone?.tzid === "UTC") return "UTC";
  if (tzid && typeof tzid === "string") {
    if (!IANAZone.isValidZone(tzid))
      throw new Error(
        `Unsupported time zone: ${tzid}. Export with an IANA time zone or UTC.`,
      );
    return tzid;
  }
  return fallback;
}
export function parseCalendar(
  raw: string,
  source: string,
  owner: string,
  fallbackZone: string,
  start: number,
  end: number,
  allDayBusy = false,
): ParsedCalendar {
  if (Buffer.byteLength(raw, "utf8") > MAX_ICS_BYTES)
    throw new Error("Calendar exceeds the 1 MB limit.");
  if (!IANAZone.isValidZone(fallbackZone))
    throw new Error("Invalid fallback time zone");
  if (end <= start || end - start > 124 * 86400000)
    throw new Error("Calendar expansion is limited to 124 days.");
  if (
    !/^BEGIN:VCALENDAR\r?\n/i.test(raw.trimStart()) ||
    !raw.trimEnd().endsWith("END:VCALENDAR")
  )
    throw new Error("Upload a complete RFC 5545 VCALENDAR file.");
  try {
    ICAL.TimezoneService.reset();
    const root = new ICAL.Component(ICAL.parse(raw));
    if (
      root.name !== "vcalendar" ||
      root.getFirstPropertyValue("version") !== "2.0"
    )
      throw new Error("Only iCalendar 2.0 is supported.");
    if (
      root
        .getAllSubcomponents()
        .some((c) => !["vevent", "vtimezone"].includes(c.name))
    )
      throw new Error(
        "Only VEVENT calendars are supported; VTODO and other component types cannot be imported.",
      );
    for (const zone of root.getAllSubcomponents("vtimezone")) {
      const id = String(zone.getFirstPropertyValue("tzid"));
      ICAL.TimezoneService.register(
        new ICAL.Timezone({ component: zone, tzid: id }),
        id,
      );
    }
    const components = root.getAllSubcomponents("vevent");
    const computationStart = Date.now();
    if (components.length > 1000)
      throw new Error("Calendar contains more than 1,000 event components.");
    const events: CalendarEvent[] = [],
      canceled: ParsedCalendar["canceled"] = [],
      warnings: string[] = [];
    if (
      components.some(
        (c) =>
          c.getAllSubcomponents("valarm").length ||
          c.getFirstProperty("attendee") ||
          c.getFirstProperty("attach"),
      )
    ) {
      warnings.push(
        "Event times are imported; alarms, attendee lists and attachments are not imported into Tempo.",
      );
    }
    const groups = new Map<string, ICAL.Component[]>();
    const keys = new Set<string>();
    for (const c of components) {
      const uid = String(c.getFirstPropertyValue("uid") || "");
      if (!uid || uid.length > 1000)
        throw new Error("Every event needs a valid UID.");
      if (c.getFirstProperty("recurrence-id")?.getParameter("range"))
        throw new Error(
          "RANGE=THISANDFUTURE is not supported; export individual exceptions.",
        );
      if (c.getAllProperties("rdate").some((p) => p.type === "period"))
        throw new Error(
          "RDATE periods are not supported. Export date/time RDATE values.",
        );
      if (c.getFirstProperty("exrule"))
        throw new Error("EXRULE is not supported; use EXDATE.");
      if (c.getAllProperties("rrule").length > 1)
        throw new Error("Multiple RRULE properties are not supported.");
      const rule = c.getFirstPropertyValue("rrule") as ICAL.Recur | null;
      if (rule && ["SECONDLY", "MINUTELY"].includes(rule.freq))
        throw new Error(
          "SECONDLY and MINUTELY recurrence frequencies are unsupported. Export individual events.",
        );
      const rid = c.getFirstPropertyValue("recurrence-id") as ICAL.Time | null;
      const key = uid + "|" + (rid?.toString() || "");
      if (keys.has(key))
        throw new Error(
          "Calendar contains duplicate UID/RECURRENCE-ID components.",
        );
      keys.add(key);
      if (
        String(c.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED"
      )
        canceled.push({ uid, recurrence_id: rid?.toString() || null });
      if (
        !c.getFirstProperty("dtstart") &&
        String(c.getFirstPropertyValue("status")).toUpperCase() !== "CANCELLED"
      )
        throw new Error("An event is missing DTSTART.");
      groups.set(uid, [...(groups.get(uid) || []), c]);
    }
    let iterations = 0;
    const add = (
      c: ICAL.Component,
      event: ICAL.Event,
      s: ICAL.Time,
      e: ICAL.Time,
      rid: string,
    ) => {
      if (
        String(c.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED"
      )
        return;
      const zone = zoneFor(c, fallbackZone),
        allDay = s.isDate;
      const starts = allDay ? null : asInstant(s, zone),
        ends = allDay ? null : asInstant(e, zone);
      const from = allDay
        ? DateTime.fromISO(dateText(s), { zone }).toMillis()
        : Date.parse(starts!);
      const until = allDay
        ? DateTime.fromISO(dateText(e), { zone }).toMillis()
        : Date.parse(ends!);
      if (until <= from)
        throw new Error("An event has an invalid or missing duration.");
      if (from >= end || until <= start) return;
      if (events.length >= 2000)
        throw new Error(
          "More than 2,000 occurrences in this window. Narrow the calendar at its source.",
        );
      const transparent =
        String(c.getFirstPropertyValue("transp")).toUpperCase() ===
        "TRANSPARENT";
      events.push({
        id: stableId(`${source}|${event.uid}|${rid}`),
        owner_id: owner,
        source_id: source,
        uid: event.uid,
        recurrence_id: rid,
        title: (event.summary || "Untitled event").slice(0, 200),
        description: (event.description || "").slice(0, 4000),
        category: "personal",
        kind: "commitment",
        starts_at: starts,
        ends_at: ends,
        start_date: allDay ? dateText(s) : null,
        end_date: allDay ? dateText(e) : null,
        timezone: zone,
        all_day: allDay,
        busy: !transparent && (!allDay || allDayBusy),
        locked: true,
        task_id: null,
        version: 1,
        updated_at: new Date().toISOString(),
        recurrence: {
          rrule: c.getFirstPropertyValue("rrule")?.toString() || null,
          transparent,
        },
      });
    };
    for (const [uid, group] of groups) {
      const master = group.find((c) => !c.getFirstProperty("recurrence-id"));
      const exceptions = group.filter((c) =>
        c.getFirstProperty("recurrence-id"),
      );
      if (!master) {
        for (const c of exceptions) {
          if (c.getFirstProperty("dtstart")) {
            const ev = new ICAL.Event(c);
            add(
              c,
              ev,
              ev.startDate,
              ev.endDate,
              String(c.getFirstPropertyValue("recurrence-id")),
            );
          }
        }
        continue;
      }
      if (canceled.some((c) => c.uid === uid && c.recurrence_id === null))
        continue;
      const ev = new ICAL.Event(master);
      const cancelledIds = new Set(
        canceled.filter((c) => c.uid === uid).map((c) => c.recurrence_id),
      );
      for (const c of exceptions.filter(
        (c) =>
          c.getFirstProperty("dtstart") &&
          !cancelledIds.has(String(c.getFirstPropertyValue("recurrence-id"))),
      ))
        ev.relateException(new ICAL.Event(c));
      if (ev.isRecurring()) {
        // Bound traversal too: an ancient secondly rule must never hang the server.
        const iterator = ev.iterator();
        let occurrence: ICAL.Time | null;
        const emitted = new Set<string>();
        // RDATE-only expansion in ical.js omits DTSTART. RFC 5545 includes it
        // in the recurrence set unless EXDATE explicitly removes it.
        const firstId = ev.startDate.toString();
        const excluded = master
          .getAllProperties("exdate")
          .flatMap((p) => p.getValues())
          .some((t) => t.toString() === firstId);
        if (!excluded && !cancelledIds.has(firstId)) {
          const first = ev.getOccurrenceDetails(ev.startDate);
          add(
            first.item.component,
            first.item,
            first.startDate,
            first.endDate,
            firstId,
          );
          emitted.add(firstId);
        }
        while ((occurrence = iterator.next())) {
          if (++iterations > 25000)
            throw new Error(
              "Recurrence expansion exceeds 25,000 steps. Export a narrower date range.",
            );
          if (Date.now() - computationStart > 750)
            throw new Error(
              "Recurrence exceeds the computation limit. Export a narrower date range.",
            );
          const rid = occurrence.toString();
          const details = ev.getOccurrenceDetails(occurrence);
          const c = details.item.component;
          if (!cancelledIds.has(rid) && !emitted.has(rid)) {
            add(c, details.item, details.startDate, details.endDate, rid);
            emitted.add(rid);
          }
          const zone = zoneFor(master, fallbackZone);
          const millis = occurrence.isDate
            ? DateTime.fromISO(dateText(occurrence), { zone }).toMillis()
            : Date.parse(asInstant(occurrence, zone));
          if (millis >= end) break;
        }
        // A moved occurrence may originate outside the queried window.
        for (const c of exceptions) {
          const rid = String(c.getFirstPropertyValue("recurrence-id"));
          if (
            !emitted.has(rid) &&
            !cancelledIds.has(rid) &&
            c.getFirstProperty("dtstart")
          ) {
            const ex = new ICAL.Event(c);
            add(c, ex, ex.startDate, ex.endDate, rid);
          }
        }
      } else add(master, ev, ev.startDate, ev.endDate, "");
    }
    if (
      components.some(
        (c) =>
          c.getFirstProperty("dtstart") &&
          !c.getFirstProperty("dtstart")?.getParameter("tzid") &&
          (c.getFirstPropertyValue("dtstart") as ICAL.Time | null)?.zone
            ?.tzid === "floating" &&
          !(c.getFirstPropertyValue("dtstart") as ICAL.Time | null)?.isDate,
      )
    )
      warnings.push(`Floating times use ${fallbackZone}.`);
    if (!events.length && !canceled.length)
      warnings.push("No events occur in this preview window.");
    return { events, canceled, warnings };
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`Could not import calendar: ${error.message}`);
    throw new Error("Could not import calendar: malformed iCalendar content.");
  } finally {
    ICAL.TimezoneService.reset();
  }
}

export function exportCalendar(events: CalendarEvent[]): string {
  const root = new ICAL.Component(["vcalendar", [], []]);
  root.addPropertyWithValue("version", "2.0");
  root.addPropertyWithValue("prodid", "-//Tempo//Planning Assistant//EN");
  root.addPropertyWithValue("calscale", "GREGORIAN");
  for (const e of events.filter((e) => !e.source_id)) {
    const component = new ICAL.Component("vevent");
    component.addPropertyWithValue("uid", e.uid);
    component.addPropertyWithValue("summary", e.title);
    component.addPropertyWithValue("description", e.description);
    component.addPropertyWithValue(
      "dtstamp",
      ICAL.Time.fromJSDate(new Date(e.updated_at), true),
    );
    component.addPropertyWithValue(
      "last-modified",
      ICAL.Time.fromJSDate(new Date(e.updated_at), true),
    );
    component.addPropertyWithValue("sequence", e.version);
    component.addPropertyWithValue(
      "dtstart",
      e.all_day
        ? ICAL.Time.fromDateString(e.start_date!)
        : ICAL.Time.fromJSDate(new Date(e.starts_at!), true),
    );
    component.addPropertyWithValue(
      "dtend",
      e.all_day
        ? ICAL.Time.fromDateString(e.end_date!)
        : ICAL.Time.fromJSDate(new Date(e.ends_at!), true),
    );
    component.addPropertyWithValue("transp", e.busy ? "OPAQUE" : "TRANSPARENT");
    root.addSubcomponent(component);
  }
  return root.toString() + "\r\n";
}
