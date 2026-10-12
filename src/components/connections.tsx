"use client";
import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  FileUp,
  Link2,
  RefreshCw,
  Trash2,
  Copy,
  ShieldCheck,
} from "lucide-react";
import { DateTime } from "luxon";
import type { Source, CalendarEvent } from "@/lib/domain";
import { api, Field, Modal, Empty } from "./ui";
type Preview = {
  events: CalendarEvent[];
  warnings: string[];
  canceled: { uid: string; recurrence_id: string | null }[];
};
export default function Connections({
  sources,
  feedActive,
  zone,
  onSaved,
}: {
  sources: Source[];
  feedActive: boolean;
  zone: string;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [raw, setRaw] = useState(""),
    [sourceId, setSourceId] = useState(""),
    [feedUrl, setFeedUrl] = useState(""),
    [commitments, setCommitments] = useState(true),
    [focus, setFocus] = useState(true);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addSource(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      form = e.currentTarget;
    await run(async () => {
      const result = await api<{ id: string }>("sources", {
        name: f.get("name"),
        kind: f.get("kind"),
        url: f.get("url") || null,
        all_day_busy: f.get("allDay") === "on",
      });
      setSourceId(result.id);
      setNotice("Calendar source added. Import a file or refresh its feed.");
      form.reset();
    });
  }
  async function previewFile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      file = f.get("file") as File,
      id = String(f.get("source"));
    await run(async () => {
      if (!file || file.size > 1048576)
        throw new Error("Choose an .ics file up to 1 MB.");
      const content = await file.text();
      const result = await api<Preview>("import", {
        raw: content,
        source_id: id,
        confirm: false,
      });
      setRaw(content);
      setSourceId(id);
      setPreview(result);
    });
  }
  const update = (s: Source, data: Partial<Source>) =>
    run(async () => {
      await api("sources", {
        id: s.id,
        version: s.version,
        name: s.name,
        kind: s.kind,
        url: s.url,
        enabled: s.enabled,
        all_day_busy: s.all_day_busy,
        ...data,
      });
    });
  return (
    <div className="connections-view">
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-message" role="status">
          {notice}
        </p>
      )}
      <div className="connections-grid">
        <section className="surface">
          <div className="section-title">
            <CalendarDays size={19} />
            <h2>Your calendars</h2>
          </div>
          <p className="hint">
            Imported commitments are read-only. Feeds refresh periodically;
            changes aren’t immediate two-way sync.
          </p>
          {sources.length ? (
            sources.map((s) => (
              <article className="source-row" key={s.id}>
                <div className="source-icon">
                  {s.kind === "feed" ? (
                    <Link2 size={18} />
                  ) : (
                    <FileUp size={18} />
                  )}
                </div>
                <div className="source-info">
                  <strong>{s.name}</strong>
                  <span>
                    {s.kind === "feed" ? "HTTPS subscription" : "File import"} ·{" "}
                    {s.enabled ? "Enabled" : "Disabled"}
                  </span>
                  {s.last_success && (
                    <span>
                      Last successful:{" "}
                      {DateTime.fromISO(s.last_success)
                        .setZone(zone)
                        .toFormat("LLL d, h:mm a")}
                    </span>
                  )}
                  {s.last_attempt && (
                    <span>
                      Last attempted:{" "}
                      {DateTime.fromISO(s.last_attempt)
                        .setZone(zone)
                        .toFormat("LLL d, h:mm a")}
                    </span>
                  )}
                  {s.refresh_error && (
                    <p className="error-message">{s.refresh_error}</p>
                  )}
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => update(s, { enabled: e.target.checked })}
                      disabled={busy}
                    />
                    Include in planning
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={s.all_day_busy}
                      onChange={(e) =>
                        update(s, { all_day_busy: e.target.checked })
                      }
                      disabled={busy}
                    />
                    Busy all-day entries block availability
                  </label>
                </div>
                <div className="source-actions">
                  {s.kind === "feed" && (
                    <button
                      className="icon-button"
                      aria-label={`Refresh ${s.name}`}
                      disabled={busy || !s.enabled}
                      onClick={() =>
                        run(async () => {
                          await api("sources/refresh", { id: s.id });
                          setNotice(`${s.name} refreshed.`);
                        })
                      }
                    >
                      <RefreshCw size={17} />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    aria-label={`Remove ${s.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${s.name} and all its imported events from Tempo? Events at the source remain unchanged.`,
                        )
                      )
                        update(s, { remove: true } as Partial<Source>);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <Empty title="Bring your real week in">
              Classes, shifts, appointments. Start with a calendar file or a
              private HTTPS feed.
            </Empty>
          )}
        </section>
        <section className="surface">
          <div className="section-title">
            <Link2 size={19} />
            <h2>Add a calendar source</h2>
          </div>
          <form onSubmit={addSource}>
            <Field label="Calendar name">
              <input
                name="name"
                placeholder="University timetable"
                required
                maxLength={200}
              />
            </Field>
            <Field label="Source type">
              <select name="kind">
                <option value="file">File import (.ics)</option>
                <option value="feed">HTTPS feed subscription</option>
              </select>
            </Field>
            <Field label="HTTPS feed URL (feeds only)">
              <input
                type="url"
                name="url"
                placeholder="https://calendar.example.com/private.ics"
                maxLength={2048}
              />
            </Field>
            <label className="check-field">
              <input type="checkbox" name="allDay" />
              Busy all-day entries block availability
            </label>
            <button className="primary" disabled={busy}>
              Add calendar
            </button>
          </form>
        </section>
        <section className="surface">
          <div className="section-title">
            <FileUp size={19} />
            <h2>Import an .ics file</h2>
          </div>
          <p className="hint">
            Preview before importing. Select the same source when reimporting to
            update its events without duplicates.
          </p>
          <form onSubmit={previewFile}>
            <Field label="Import into source">
              <select
                name="source"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
              >
                <option value="">Select a file source</option>
                {sources
                  .filter((s) => s.kind === "file")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Calendar file (up to 1 MB)">
              <input
                name="file"
                type="file"
                accept=".ics,text/calendar"
                required
              />
            </Field>
            <button
              className="secondary"
              disabled={busy || !sources.some((s) => s.kind === "file")}
            >
              <FileUp size={16} />
              Preview import
            </button>
          </form>
        </section>
        <section className="surface">
          <div className="section-title">
            <ShieldCheck size={19} />
            <h2>Subscribe to your Tempo</h2>
          </div>
          <p className="hint">
            A private URL lets calendar apps read your Tempo events. Anyone with
            the URL can read the included data. Imported events are excluded.
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              checked={commitments}
              onChange={(e) => setCommitments(e.target.checked)}
            />
            Tempo-created commitments
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={focus}
              onChange={(e) => setFocus(e.target.checked)}
            />
            Scheduled focus blocks
          </label>
          <p className="hint">
            {feedActive
              ? "A subscription URL is active. Rotate it to invalidate the old URL."
              : "No subscription URL is active."}{" "}
            The URL is shown only when created; copy it now.
          </p>
          {feedUrl && (
            <div className="feed-copy">
              <input
                aria-label="Private Tempo subscription URL"
                value={feedUrl}
                readOnly
              />
              <button
                className="icon-button"
                aria-label="Copy subscription URL"
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(feedUrl);
                    setNotice("Private URL copied.");
                  })
                }
              >
                <Copy size={17} />
              </button>
            </div>
          )}
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ url: string }>("feed", {
                    action: "rotate",
                    commitments,
                    focus,
                  });
                  setFeedUrl(r.url);
                  setNotice(
                    "Private feed created. Copy the URL before leaving this view.",
                  );
                })
              }
            >
              {feedActive ? "Rotate private URL" : "Create private URL"}
            </button>
            {feedActive && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("feed", { action: "revoke" });
                    setFeedUrl("");
                    setNotice("Subscription revoked.");
                  })
                }
              >
                Revoke
              </button>
            )}
          </div>
        </section>
      </div>
      {preview && (
        <Modal title="Review calendar import" onClose={() => setPreview(null)}>
          <p>
            {preview.events.length} occurrences recognized in the next 90 days
            and previous 31 days.
          </p>
          {preview.warnings.map((w) => (
            <p className="proposal-warning" key={w}>
              {w}
            </p>
          ))}
          {preview.canceled.length > 0 && (
            <p className="hint">
              {preview.canceled.length} explicit cancellations will be removed.
            </p>
          )}
          <div className="import-preview">
            {preview.events.slice(0, 100).map((e) => (
              <div key={e.id}>
                <strong>{e.title}</strong>
                <span>
                  {e.all_day
                    ? `${e.start_date} – ${e.end_date} (end exclusive)`
                    : DateTime.fromISO(e.starts_at!)
                        .setZone(zone)
                        .toFormat("ccc, LLL d · h:mm a")}
                </span>
              </div>
            ))}
          </div>
          {preview.events.length > 100 && (
            <p className="hint">
              Showing the first 100 of {preview.events.length} occurrences.
            </p>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("import", {
                    raw,
                    source_id: sourceId,
                    confirm: true,
                  });
                  setPreview(null);
                  setNotice(
                    "Calendar imported. Reimport into this source to update it.",
                  );
                })
              }
            >
              {busy ? "Importing…" : "Confirm import"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
