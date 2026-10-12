"use client";
import { useState, useEffect, useRef } from "react";
import { ArrowUp, Sparkles, X, Plus } from "lucide-react";
import type { Workspace } from "@/lib/domain";
import { api } from "./ui";
import { ProposalCard } from "./proposals";
export default function AssistantPanel({
  state,
  onSaved,
  onClose,
  onPlan,
}: {
  state: Workspace;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onPlan: () => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [local, setLocal] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages.length, busy]);
  async function send(message = text) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError("");
    setLocal(message);
    setText("");
    try {
      await api("assistant", { message });
      await onSaved();
      setLocal(null);
    } catch (e) {
      setError((e as Error).message);
      await onSaved().catch(() => {});
      setLocal(null);
    } finally {
      setBusy(false);
    }
  }
  const proposals = state.proposals
    .filter((p) => p.status === "pending" || p.status === "applied")
    .slice(0, 3);
  return (
    <aside className="assistant-panel" aria-label="Tempo assistant">
      <div className="assistant-head">
        <span className="assistant-symbol">
          <Sparkles size={17} />
        </span>
        <div>
          <h2>Ask Tempo</h2>
          <span>Your week, thoughtfully planned</span>
        </div>
        <button
          className="icon-button"
          aria-label="Close assistant"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="assistant-scroll">
        {state.messages.length === 0 && (
          <div className="assistant-welcome">
            <span className="large-spark">
              <Sparkles size={25} />
            </span>
            <h3>A little help finding time.</h3>
            <p>
              Tell me what you need to accomplish. We’ll find a place for it,
              together.
            </p>
          </div>
        )}
        {!state.aiConfigured && (
          <div className="configuration-note">
            <strong>Assistant needs configuration</strong>
            <p>
              Add a Gemini API key on the server to enable chat. Manual planning
              is ready to use.
            </p>
            <button className="secondary" onClick={onPlan}>
              <Plus size={15} />
              Plan without AI
            </button>
          </div>
        )}
        {state.messages.map((m) => (
          <div className={`message ${m.role}`} key={m.id}>
            <span>{m.role === "assistant" ? "Tempo" : "You"}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {local && (
          <div className="message user">
            <span>You</span>
            <p>{local}</p>
          </div>
        )}
        {busy && (
          <p className="thinking" role="status">
            Tempo is looking for a little room…
          </p>
        )}
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            zone={state.preferences.timezone}
            onSaved={onSaved}
          />
        ))}
        {!state.messages.length && state.aiConfigured && (
          <div className="suggestions">
            {[
              "Plan my week around my commitments",
              "What can I realistically finish this week?",
              "Move unfinished work without changing appointments",
            ].map((s) => (
              <button key={s} disabled={busy} onClick={() => send(s)}>
                {s}
                <span>↗</span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="assistant-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="chat">
          Ask Tempo
        </label>
        <textarea
          id="chat"
          rows={2}
          placeholder={
            state.aiConfigured
              ? "What do you need time for?"
              : "Chat is waiting for a Gemini key"
          }
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          disabled={!state.aiConfigured || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="send-button"
          aria-label="Send message"
          disabled={!state.aiConfigured || busy || !text.trim()}
        >
          <ArrowUp size={18} />
        </button>
        <span className="compose-note">
          You review every change before it’s saved.
        </span>
      </form>
    </aside>
  );
}
