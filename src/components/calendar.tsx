"use client";
import FullCalendar from "@fullcalendar/react";
import timeGrid from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import luxonPlugin from "@fullcalendar/luxon3";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole, Plus } from "lucide-react";
import { DateTime } from "luxon";
import type { CalendarEvent, Proposal } from "@/lib/domain";
import { Empty } from "./ui";
export default function Calendar({
  events,
  proposals,
  zone,
  start,
  onChange,
  onEvent,
  onAdd,
}: {
  events: CalendarEvent[];
  proposals: Proposal[];
  zone: string;
  start: string;
  onChange: (start: string) => void;
  onEvent: (event: CalendarEvent) => void;
  onAdd: () => void;
}) {
  const ref = useRef<FullCalendar>(null),
    [agenda, setAgenda] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const change = () => setAgenda(mq.matches);
    change();
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    ref.current?.getApi().changeView(agenda ? "listWeek" : "timeGridWeek");
  }, [agenda]);
  useEffect(() => {
    ref.current?.getApi().gotoDate(start);
  }, [start]);
  const pending = proposals.find(
    (p) => p.status === "pending" && p.payload.blocks.length,
  );
  const items = [
    ...events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.all_day ? e.start_date! : e.starts_at!,
      end: e.all_day ? e.end_date! : e.ends_at!,
      allDay: e.all_day,
      classNames: [
        `event-${e.category}`,
        e.kind === "focus" ? "focus-event" : "",
        e.source_id ? "imported-event" : "",
      ],
      extendedProps: { event: e },
    })),
    ...(pending?.payload.blocks || []).map((b, i) => ({
      id: `preview-${i}`,
      title: b.title + " · proposed",
      start: b.starts_at,
      end: b.ends_at,
      classNames: ["proposed-event"],
      extendedProps: { preview: true },
    })),
  ];
  const day = DateTime.fromISO(start, { zone });
  const move = (n: number) => onChange(day.plus({ days: n * 7 }).toISODate()!);
  return (
    <section className="calendar-card">
      <div className="calendar-toolbar">
        <div>
          <h2>{day.toFormat("LLLL yyyy")}</h2>
          <span className="muted">
            {day.toFormat("LLL d")} – {day.plus({ days: 6 }).toFormat("LLL d")}{" "}
            · {zone.replaceAll("_", " ")}
          </span>
        </div>
        <div className="calendar-controls">
          <button
            className="secondary"
            onClick={() =>
              onChange(
                DateTime.now().setZone(zone).startOf("week").toISODate()!,
              )
            }
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="secondary view-toggle"
            onClick={() => setAgenda(!agenda)}
          >
            {agenda ? "Week grid" : "Agenda"}
          </button>
          <button
            className="icon-button"
            aria-label="Add a commitment"
            onClick={onAdd}
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
      <div className="calendar-body">
        <FullCalendar
          ref={ref}
          plugins={[timeGrid, listPlugin, luxonPlugin]}
          initialView="timeGridWeek"
          initialDate={start}
          timeZone={zone}
          firstDay={1}
          headerToolbar={false}
          height="auto"
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          nowIndicator
          allDaySlot
          events={items}
          editable={false}
          eventClick={(info) => {
            if (info.event.extendedProps.event)
              onEvent(info.event.extendedProps.event as CalendarEvent);
          }}
          eventDidMount={(info) => {
            if (!info.event.extendedProps.preview) {
              info.el.tabIndex = 0;
              info.el.setAttribute("role", "button");
              info.el.setAttribute(
                "aria-label",
                `${info.event.title}, ${info.event.start?.toLocaleString("en-US", { timeZone: zone })}, open details`,
              );
              info.el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEvent(info.event.extendedProps.event as CalendarEvent);
                }
              });
            }
          }}
          eventContent={(info) => (
            <div className="calendar-entry">
              <strong>{info.event.title}</strong>
              <span>
                {info.timeText}
                {info.event.extendedProps.event?.locked && (
                  <LockKeyhole size={10} />
                )}
              </span>
            </div>
          )}
          dayHeaderFormat={{ weekday: "short", day: "numeric" }}
          slotLabelFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          noEventsContent="No commitments this week. Add a task and find time for it."
        />
      </div>
      <div className="calendar-legend">
        <span>
          <i className="dot school" />
          School
        </span>
        <span>
          <i className="dot work" />
          Work
        </span>
        <span>
          <i className="dot personal" />
          Personal
        </span>
        <span className="legend-preview">
          <i className="preview-dot" />
          Proposed
        </span>
        <span className="legend-note">
          <LockKeyhole size={12} /> Locked commitments stay put
        </span>
      </div>
      {!events.length && !pending && !agenda && (
        <div className="calendar-empty-note">
          A clear week. Add your commitments or import a calendar to start
          planning.
        </div>
      )}
    </section>
  );
}
