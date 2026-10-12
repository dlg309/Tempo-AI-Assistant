"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { Check, Clock3, Undo2, Pencil, X } from "lucide-react";
import type { Proposal } from "@/lib/domain";
import { localInstant } from "@/lib/domain";
import { api, Modal } from "./ui";
export function ProposalCard({
  proposal,
  zone,
  onSaved,
}: {
  proposal: Proposal;
  zone: string;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [adjust, setAdjust] = useState(false);
  const p = proposal.payload,
    minutes = p.blocks.reduce(
      (n, b) => n + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000,
      0,
    );
  async function act(action: "apply" | "reject" | "undo") {
    setBusy(true);
    setError("");
    try {
      await api("proposal", { id: proposal.id, action });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`proposal-card proposal-${proposal.status}`}>
      <div className="proposal-heading">
        <span>
          <Clock3 size={16} />
          {proposal.status === "applied"
            ? "Plan saved"
            : proposal.status === "undone"
              ? "Plan undone"
              : "Your proposed plan"}
        </span>
        <span className="badge">
          {proposal.status === "pending" ? "For review" : proposal.status}
        </span>
      </div>
      <p className="proposal-summary">
        {p.blocks.length
          ? `${p.blocks.length} focus ${p.blocks.length === 1 ? "block" : "blocks"} · ${Math.round(minutes)} min`
          : `${p.task_changes?.length || 0} task changes`}
      </p>
      {p.blocks.map((b, i) => (
        <div className="proposal-block" key={i}>
          <i className={`dot ${b.category}`} />
          <div>
            <strong>{b.title}</strong>
            <span>
              {DateTime.fromISO(b.starts_at)
                .setZone(zone)
                .toFormat("ccc, LLL d · h:mm a")}{" "}
              – {DateTime.fromISO(b.ends_at).setZone(zone).toFormat("h:mm a")}
            </span>
            <details>
              <summary>Why this time?</summary>
              <p>{b.reason}</p>
            </details>
          </div>
        </div>
      ))}
      {p.task_changes?.map((t, i) => (
        <div className="proposal-block" key={`task-${i}`}>
          <i className={`dot ${t.data.category}`} />
          <div>
            <strong>
              {t.id ? "Update" : "Add"} {t.data.title}
            </strong>
            <span>
              {t.data.remaining_minutes} min · {t.data.priority} priority
            </span>
            {t.data.deadline && (
              <span>
                Due{" "}
                {DateTime.fromISO(t.data.deadline)
                  .setZone(zone)
                  .toFormat("ccc, LLL d · h:mm a")}
              </span>
            )}
          </div>
        </div>
      ))}
      {p.remove_ids.length > 0 && (
        <p className="hint">
          Replaces {p.remove_ids.length} flexible{" "}
          {p.remove_ids.length === 1 ? "block" : "blocks"}. Locked events stay
          in place.
        </p>
      )}
      {p.unscheduled.map((u) => (
        <div className="proposal-warning" key={u.task_id}>
          <strong>
            {u.title}: {u.minutes} min still needs time
          </strong>
          <p>{u.reason}</p>
        </div>
      ))}
      {p.warnings.map((w, i) => (
        <p className="proposal-warning" key={i}>
          {w}
        </p>
      ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {proposal.status === "pending" && (
        <div className="proposal-actions">
          <button
            className="primary"
            disabled={
              busy ||
              (!p.blocks.length &&
                !p.task_changes?.length &&
                !p.remove_ids.length)
            }
            onClick={() => act("apply")}
          >
            <Check size={15} />
            {busy ? "Saving…" : "Apply plan"}
          </button>
          {p.blocks.length > 0 && (
            <button
              className="icon-button"
              aria-label="Adjust proposed times"
              onClick={() => setAdjust(true)}
              disabled={busy}
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Reject proposal"
            onClick={() => act("reject")}
            disabled={busy}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {proposal.status === "applied" && (
        <div className="proposal-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act("undo")}
          >
            <Undo2 size={15} />
            Undo plan
          </button>
          <a
            className="text-button"
            href={`/api/export?proposal=${proposal.id}&start=${encodeURIComponent(DateTime.now().setZone(zone).startOf("day").toUTC().toISO()!)}&end=${encodeURIComponent(DateTime.now().setZone(zone).startOf("day").plus({ days: 31 }).toUTC().toISO()!)}`}
          >
            Export
          </a>
        </div>
      )}
      {adjust && (
        <AdjustProposal
          proposal={proposal}
          zone={zone}
          onClose={() => setAdjust(false)}
          onSaved={onSaved}
        />
      )}
    </article>
  );
}
function AdjustProposal({
  proposal,
  zone,
  onClose,
  onSaved,
}: {
  proposal: Proposal;
  zone: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [starts, setStarts] = useState(
      proposal.payload.blocks.map((b) =>
        DateTime.fromISO(b.starts_at)
          .setZone(zone)
          .toFormat("yyyy-MM-dd'T'HH:mm"),
      ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Adjust your focus blocks" onClose={onClose}>
      <p className="hint">
        Move start times in {zone}. Each block keeps its full duration. Tempo
        checks conflicts again when you save.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const blocks = proposal.payload.blocks.map((b, i) => {
              const start = localInstant(starts[i], zone);
              return {
                ...b,
                starts_at: start,
                ends_at: new Date(
                  Date.parse(start) +
                    Date.parse(b.ends_at) -
                    Date.parse(b.starts_at),
                ).toISOString(),
                reason: "Time adjusted by you; full duration preserved.",
              };
            });
            await api("proposal/adjust", { id: proposal.id, blocks });
            await onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {proposal.payload.blocks.map((b, i) => (
          <label className="field" key={i}>
            {b.title} ·{" "}
            {(Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000} min
            <input
              type="datetime-local"
              value={starts[i]}
              onChange={(e) =>
                setStarts(starts.map((v, j) => (j === i ? e.target.value : v)))
              }
              required
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Checking…" : "Save adjusted proposal"}
        </button>
      </form>
    </Modal>
  );
}
