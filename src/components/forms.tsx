"use client";
import { useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { Plus, Trash2 } from "lucide-react";
import { api, Field, Modal } from "./ui";
import {
  localInstant,
  type CalendarEvent,
  type Preferences,
  type Task,
} from "@/lib/domain";
const asLocal = (value: string | null, zone: string) =>
  value
    ? DateTime.fromISO(value).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
    : "";
export function TaskForm({
  task,
  zone,
  onClose,
  onSaved,
}: {
  task?: Task;
  zone: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const estimate = Number(f.get("estimate"));
      await api("tasks", {
        ...(task ? { id: task.id, version: task.version } : {}),
        data: {
          title: f.get("title"),
          description: f.get("description"),
          category: f.get("category"),
          priority: f.get("priority"),
          deadline: f.get("deadline")
            ? localInstant(String(f.get("deadline")), zone)
            : null,
          estimated_minutes: estimate,
          remaining_minutes: Number(f.get("remaining")),
          status: f.get("status"),
          splittable: f.get("splittable") === "on",
          min_session: Number(f.get("minimum")),
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !task ||
      !window.confirm("Delete this task and all its scheduled focus blocks?")
    )
      return;
    setBusy(true);
    try {
      await api("tasks", {
        id: task.id,
        version: task.version,
        data: {},
        remove: true,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={task ? "Edit task" : "Make room for a task"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <Field label="Task title">
          <input
            name="title"
            defaultValue={task?.title}
            placeholder="Study for statistics"
            required
            maxLength={200}
            autoFocus
          />
        </Field>
        <div className="form-row">
          <Field label="Category">
            <select name="category" defaultValue={task?.category || "school"}>
              <option value="school">School</option>
              <option value="work">Work</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue={task?.priority || "medium"}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
        </div>
        <Field label={`Deadline (${zone}, optional)`}>
          <input
            type="datetime-local"
            name="deadline"
            defaultValue={asLocal(task?.deadline || null, zone)}
          />
        </Field>
        <div className="form-row">
          <Field label="Estimated minutes">
            <input
              type="number"
              name="estimate"
              defaultValue={task?.estimated_minutes || 60}
              onChange={(e) => {
                if (!task) {
                  const remaining = e.currentTarget.form?.elements.namedItem(
                    "remaining",
                  ) as HTMLInputElement | null;
                  if (remaining) remaining.value = e.target.value;
                }
              }}
              min={5}
              max={10080}
              required
            />
          </Field>
          <Field label="Remaining minutes">
            <input
              type="number"
              name="remaining"
              defaultValue={task?.remaining_minutes ?? 60}
              min={0}
              max={10080}
              required
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Status">
            <select name="status" defaultValue={task?.status || "open"}>
              <option value="open">To do</option>
              <option value="done">Complete</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Minimum session (minutes)">
            <input
              type="number"
              name="minimum"
              defaultValue={task?.min_session || 25}
              min={5}
              max={480}
              required
            />
          </Field>
        </div>
        <label className="check-field">
          <input
            name="splittable"
            type="checkbox"
            defaultChecked={task?.splittable ?? true}
          />{" "}
          Work can be split into sessions
        </label>
        <Field label="Notes (optional)">
          <textarea
            name="description"
            defaultValue={task?.description || ""}
            maxLength={4000}
            rows={3}
          />
        </Field>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {task && (
            <button
              type="button"
              className="danger text-button"
              onClick={remove}
              disabled={busy}
            >
              Delete task & blocks
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function EventForm({
  event,
  zone,
  tasks,
  onClose,
  onSaved,
}: {
  event?: CalendarEvent;
  zone: string;
  tasks: Task[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [allDay, setAllDay] = useState(event?.all_day || false),
    [kind, setKind] = useState(event?.kind || "commitment"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const now = DateTime.now().setZone(zone).plus({ hours: 1 }).startOf("hour");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("events", {
        ...(event ? { id: event.id, version: event.version } : {}),
        data: {
          title: f.get("title"),
          description: f.get("description"),
          category: f.get("category"),
          kind,
          all_day: allDay,
          timezone: zone,
          starts_at: allDay ? null : localInstant(String(f.get("start")), zone),
          ends_at: allDay ? null : localInstant(String(f.get("end")), zone),
          start_date: allDay ? f.get("start") : null,
          end_date: allDay ? f.get("end") : null,
          busy: f.get("busy") === "on",
          locked: kind === "commitment" || f.get("locked") === "on",
          task_id: kind === "focus" ? f.get("task") : null,
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!event || !window.confirm("Remove this Tempo event?")) return;
    setBusy(true);
    try {
      await api("events", {
        id: event.id,
        version: event.version,
        data: {},
        remove: true,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (event?.source_id)
    return (
      <Modal title={event.title} onClose={onClose}>
        <p className="muted">Imported commitment · read-only</p>
        <p>
          {event.all_day
            ? `${event.start_date} → ${event.end_date} (exclusive)`
            : `${DateTime.fromISO(event.starts_at!).setZone(zone).toFormat("ccc, LLL d · h:mm a")} – ${DateTime.fromISO(event.ends_at!).setZone(zone).toFormat("h:mm a")}`}
        </p>
        <p className="preserve-lines">{event.description || "No notes."}</p>
        <p className="hint">
          Edit this event at its source, then refresh or reimport the calendar
          in Connections.
        </p>
      </Modal>
    );
  return (
    <Modal
      title={event ? "Edit calendar block" : "Add a commitment"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <Field label="Event title">
          <input
            name="title"
            defaultValue={event?.title}
            required
            maxLength={200}
            autoFocus
            placeholder="Class, shift, or appointment"
          />
        </Field>
        <div className="form-row">
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                if (e.target.value === "focus") setAllDay(false);
              }}
            >
              <option value="commitment">Commitment</option>
              <option value="focus">Focus block</option>
            </select>
          </Field>
          <Field label="Category">
            <select
              name="category"
              defaultValue={event?.category || "personal"}
            >
              <option value="school">School</option>
              <option value="work">Work</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
        </div>
        {kind === "focus" && (
          <Field label="Associated task">
            <select name="task" defaultValue={event?.task_id || ""} required>
              <option value="">Choose a task</option>
              {tasks
                .filter((t) => t.status === "open" || t.id === event?.task_id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === "commitment" && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />{" "}
            All-day event
          </label>
        )}
        <p className="hint">
          Times use {zone}.{" "}
          {allDay
            ? "End date is exclusive: a one-day event ends the following day."
            : ""}
        </p>
        <div className="form-row" key={String(allDay)}>
          <Field label={allDay ? "Start date" : "Starts"}>
            <input
              name="start"
              type={allDay ? "date" : "datetime-local"}
              defaultValue={
                allDay
                  ? event?.start_date || now.toISODate()!
                  : asLocal(event?.starts_at || now.toISO(), zone)
              }
              required
            />
          </Field>
          <Field label={allDay ? "End date (exclusive)" : "Ends"}>
            <input
              name="end"
              type={allDay ? "date" : "datetime-local"}
              defaultValue={
                allDay
                  ? event?.end_date || now.plus({ days: 1 }).toISODate()!
                  : asLocal(
                      event?.ends_at || now.plus({ hours: 1 }).toISO(),
                      zone,
                    )
              }
              required
            />
          </Field>
        </div>
        <label className="check-field">
          <input
            name="busy"
            type="checkbox"
            defaultChecked={event?.busy ?? true}
          />{" "}
          Blocks availability
          {allDay ? " when all-day busy preference is enabled" : ""}
        </label>
        {kind === "focus" && (
          <label className="check-field">
            <input
              name="locked"
              type="checkbox"
              defaultChecked={event?.locked || false}
            />{" "}
            Lock this focus block during replanning
          </label>
        )}
        <Field label="Notes">
          <textarea
            name="description"
            rows={3}
            defaultValue={event?.description || ""}
            maxLength={4000}
          />
        </Field>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {event && (
            <button
              type="button"
              className="text-button danger"
              onClick={remove}
              disabled={busy}
            >
              Delete event
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save event"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PreferencesForm({
  prefs,
  onSaved,
  onDone,
}: {
  prefs: Preferences;
  onSaved: () => Promise<void>;
  onDone?: () => void;
}) {
  const [windows, setWindows] = useState(prefs.availability),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("preferences", {
        revision: prefs.revision,
        data: {
          timezone: f.get("zone"),
          focus_minutes: Number(f.get("focus")),
          break_minutes: Number(f.get("break")),
          buffer_minutes: Number(f.get("buffer")),
          all_day_busy: f.get("allDay") === "on",
          onboarded: true,
          availability: windows,
        },
      });
      await onSaved();
      setSaved(true);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="preferences-form">
      <Field label="Time zone">
        <input
          name="zone"
          defaultValue={prefs.timezone}
          list="timezones"
          required
        />
        <datalist id="timezones">
          {[
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
            "Europe/London",
            "Europe/Berlin",
            "Asia/Kolkata",
            "Asia/Tokyo",
            "Australia/Sydney",
            "UTC",
          ].map((z) => (
            <option key={z}>{z}</option>
          ))}
        </datalist>
      </Field>
      <div className="form-row">
        <Field label="Focus session (minutes)">
          <input
            name="focus"
            type="number"
            defaultValue={prefs.focus_minutes}
            min={15}
            max={240}
            required
          />
        </Field>
        <Field label="Break (minutes)">
          <input
            name="break"
            type="number"
            defaultValue={prefs.break_minutes}
            min={0}
            max={60}
            required
          />
        </Field>
      </div>
      <Field label="Buffer around commitments (minutes)">
        <input
          name="buffer"
          type="number"
          defaultValue={prefs.buffer_minutes}
          min={0}
          max={60}
          required
        />
      </Field>
      <label className="check-field">
        <input
          name="allDay"
          type="checkbox"
          defaultChecked={prefs.all_day_busy}
        />{" "}
        Treat my own busy all-day events as unavailable
      </label>
      <h3>When you have time</h3>
      <p className="hint">
        Tempo only schedules inside these windows. A day with no window is
        unavailable.
      </p>
      {windows.map((w, i) => (
        <div className="availability-row" key={i}>
          <select
            aria-label={`Day for availability ${i + 1}`}
            value={w.day}
            onChange={(e) =>
              setWindows(
                windows.map((v, j) =>
                  j === i ? { ...v, day: Number(e.target.value) } : v,
                ),
              )
            }
          >
            {[
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ].map((d, j) => (
              <option key={d} value={j + 1}>
                {d}
              </option>
            ))}
          </select>
          <input
            aria-label={`Start for availability ${i + 1}`}
            type="time"
            value={w.start}
            onChange={(e) =>
              setWindows(
                windows.map((v, j) =>
                  j === i ? { ...v, start: e.target.value } : v,
                ),
              )
            }
            required
          />
          <span>to</span>
          <input
            aria-label={`End for availability ${i + 1}`}
            type="time"
            value={w.end}
            onChange={(e) =>
              setWindows(
                windows.map((v, j) =>
                  j === i ? { ...v, end: e.target.value } : v,
                ),
              )
            }
            required
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove availability ${i + 1}`}
            onClick={() => setWindows(windows.filter((_, j) => i !== j))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={windows.length >= 35}
        onClick={() =>
          setWindows([...windows, { day: 1, start: "09:00", end: "18:00" }])
        }
      >
        <Plus size={16} />
        Add available hours
      </button>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="success-message">
          Preferences saved.
        </p>
      )}
      <div className="modal-actions">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
