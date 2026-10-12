"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { DateTime } from "luxon";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  LayoutDashboard,
  Link2,
  ListTodo,
  LogOut,
  Plus,
  Settings2,
  Sparkles,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import type { Workspace as State, Task, CalendarEvent } from "@/lib/domain";
import { api, ConfigState, Empty, Field, Modal } from "./ui";
import { TaskForm, EventForm, PreferencesForm } from "./forms";
import AssistantPanel from "./assistant-panel";
import Connections from "./connections";
import { ProposalCard } from "./proposals";
const Calendar = dynamic(() => import("./calendar"), {
  ssr: false,
  loading: () => (
    <div className="surface calendar-loading" role="status">
      Opening your calendar…
    </div>
  ),
});
type View =
  "today" | "calendar" | "tasks" | "assistant" | "connections" | "settings";
const nav = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "assistant", label: "Assistant", icon: Sparkles },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
export default function Workspace() {
  const [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>("today"),
    [anchor, setAnchor] = useState(
      DateTime.now().setZone("America/New_York").startOf("week").toISODate()!,
    ),
    [zone, setZone] = useState("America/New_York"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [assistant, setAssistant] = useState(true),
    [taskModal, setTaskModal] = useState<Task | true | null>(null),
    [eventModal, setEventModal] = useState<CalendarEvent | true | null>(null),
    [planModal, setPlanModal] = useState(false),
    [onboarding, setOnboarding] = useState(false),
    [filter, setFilter] = useState("open"),
    [query, setQuery] = useState("");
  const reload = useCallback(async () => {
    const day = DateTime.fromISO(anchor, { zone }).startOf("day"),
      search = new URLSearchParams({
        start: day.toUTC().toISO()!,
        end: day.plus({ days: 7 }).toUTC().toISO()!,
      });
    const s = await api<State>(`workspace?${search}`);
    setState(s);
    setZone(s.preferences.timezone);
    setError("");
    if (!s.preferences.onboarded) setOnboarding(true);
  }, [anchor, zone]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    reload()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);
  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function toggle(t: Task) {
    const { id, version, owner_id, updated_at, ...data } = t;
    await run(async () => {
      await api("tasks", {
        id,
        version,
        data: {
          ...data,
          status: t.status === "done" ? "open" : "done",
          remaining_minutes: t.status === "done" ? t.estimated_minutes : 0,
        },
      });
    });
  }
  if (!state) {
    if (error)
      return (
        <ConfigState
          message={error}
          onRetry={() => {
            setLoading(true);
            reload()
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false));
          }}
        />
      );
    return (
      <main className="state-page" role="status">
        <span className="brand-mark">t</span>
        <p>Finding your place in the week…</p>
      </main>
    );
  }
  const now = DateTime.now().setZone(zone),
    open = state.tasks.filter((t) => t.status === "open"),
    due = open.filter(
      (t) =>
        t.deadline &&
        DateTime.fromISO(t.deadline).setZone(zone).startOf("day").toMillis() <=
          now.endOf("day").toMillis(),
    ),
    today = state.events
      .filter((e) =>
        e.all_day
          ? e.start_date! <= now.toISODate()! && e.end_date! > now.toISODate()!
          : DateTime.fromISO(e.starts_at!).setZone(zone).hasSame(now, "day"),
      )
      .sort(
        (a, b) =>
          Date.parse(a.starts_at || a.start_date!) -
          Date.parse(b.starts_at || b.start_date!),
      );
  const focusMinutes = today
      .filter((e) => e.kind === "focus")
      .reduce(
        (sum, e) =>
          sum + (Date.parse(e.ends_at!) - Date.parse(e.starts_at!)) / 60000,
        0,
      ),
    next = today.filter(
      (e) => e.all_day || Date.parse(e.ends_at!) > now.toMillis(),
    );
  const viewTitle = {
    today: "A little clarity for your day.",
    calendar: "Your week, at a glance.",
    tasks: "Small steps. Meaningful progress.",
    assistant: "Find time with Tempo.",
    connections: "Your calendars, connected.",
    settings: "A plan that works for you.",
  }[view];
  const exportParams = new URLSearchParams({
    start: DateTime.fromISO(anchor, { zone }).toUTC().toISO()!,
    end: DateTime.fromISO(anchor, { zone }).plus({ days: 7 }).toUTC().toISO()!,
  });
  function taskRow(t: Task) {
    return (
      <div className="task-row" key={t.id}>
        <button
          className={`task-check ${t.status === "done" ? "completed" : ""}`}
          aria-label={
            t.status === "done" ? `Reopen ${t.title}` : `Complete ${t.title}`
          }
          disabled={saving}
          onClick={() => toggle(t)}
        >
          {t.status === "done" ? <Check size={15} /> : <Circle size={18} />}
        </button>
        <button className="task-info" onClick={() => setTaskModal(t)}>
          <strong className={t.status === "done" ? "struck" : ""}>
            {t.title}
          </strong>
          <span>
            <i className={`dot ${t.category}`} />
            {t.category} · {t.remaining_minutes} min
            {t.deadline
              ? ` · Due ${DateTime.fromISO(t.deadline).setZone(zone).toFormat("LLL d")}`
              : ""}
          </span>
        </button>
        <span className={`priority priority-${t.priority}`}>{t.priority}</span>
        <button
          className="icon-button"
          aria-label={`Edit ${t.title}`}
          onClick={() => setTaskModal(t)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    );
  }
  return (
    <div
      className={`app-shell ${assistant || view === "assistant" ? "with-assistant" : ""}`}
    >
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">t</span>tempo
          <span className="brand-dot">.</span>
        </a>
        <span className="workspace-label">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              onClick={() => {
                setView(n.id);
                if (n.id === "assistant") setAssistant(true);
              }}
              className={view === n.id ? "active" : ""}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "tasks" && open.length > 0 && (
                <span className="nav-count">{open.length}</span>
              )}
              {n.id === "assistant" && <i className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span>Room for what matters.</span>
            <p>A realistic plan leaves a little space for life.</p>
            <button onClick={() => setView("settings")}>
              Your planning preferences <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="account">
            <span className="avatar">
              {state.email[0]?.toUpperCase() || "T"}
            </span>
            <div>
              <strong>Your Tempo</strong>
              <span title={state.email}>{state.email}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  await api("auth", { action: "logout" });
                  window.location.assign("/login");
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="workspace-top">
          <span>{now.toFormat("cccc, LLLL d")}</span>
          <div>
            <span className="save-status">
              <i />
              {saving ? "Saving…" : loading ? "Updating…" : "All changes saved"}
            </span>
            <button
              className="icon-button"
              aria-label="Reload workspace"
              disabled={loading || saving}
              onClick={() => run(async () => {})}
            >
              <RefreshCw size={16} />
            </button>
            {view !== "assistant" && (
              <button
                className={`secondary assistant-toggle ${assistant ? "selected" : ""}`}
                onClick={() => setAssistant(!assistant)}
              >
                <Sparkles size={15} />
                {assistant ? "Hide assistant" : "Ask Tempo"}
              </button>
            )}
          </div>
        </header>
        <main className="workspace-main" id="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === "today"
                  ? "LET’S MAKE A LITTLE ROOM"
                  : view.toUpperCase()}
              </span>
              <h1>{viewTitle}</h1>
              <p>
                {view === "today"
                  ? "Your commitments, priorities, and a realistic plan."
                  : view === "calendar"
                    ? "Review your commitments and make room for focused work."
                    : view === "tasks"
                      ? "Give your work a deadline, an estimate, and somewhere to start."
                      : view === "connections"
                        ? "Bring commitments in. Take your Tempo plan with you."
                        : view === "settings"
                          ? "Set your available hours, focus rhythm, and time zone."
                          : "Tell Tempo what you need to accomplish."}
              </p>
            </div>
            {["today", "calendar", "tasks"].includes(view) && (
              <div className="heading-actions">
                <button
                  className="secondary"
                  onClick={() => setTaskModal(true)}
                >
                  <Plus size={16} />
                  New task
                </button>
                <button className="primary" onClick={() => setPlanModal(true)}>
                  <Sparkles size={16} />
                  Plan my week
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {view === "today" && (
            <>
              <div className="today-stats">
                <div>
                  <span className="stat-icon">
                    <CalendarDays size={18} />
                  </span>
                  <div>
                    <strong>
                      {today.filter((e) => e.kind === "commitment").length}
                      <span>commitments today</span>
                    </strong>
                    <p>Your fixed points for the day</p>
                  </div>
                </div>
                <div>
                  <span className="stat-icon amber">
                    <ListTodo size={18} />
                  </span>
                  <div>
                    <strong>
                      {due.length}
                      <span>tasks due or overdue</span>
                    </strong>
                    <p>
                      {due.length
                        ? "Start with what needs you most"
                        : "A little breathing room"}
                    </p>
                  </div>
                </div>
                <div>
                  <span className="stat-icon green">
                    <Clock3 size={18} />
                  </span>
                  <div>
                    <strong>
                      {focusMinutes >= 60
                        ? `${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60 ? `${focusMinutes % 60}m` : ""}`
                        : `${focusMinutes}m`}
                      <span>focus time planned</span>
                    </strong>
                    <p>Scheduled work, ready when you are</p>
                  </div>
                </div>
              </div>
              <div className="today-columns">
                <section className="surface compact-surface">
                  <div className="section-title spread">
                    <h2>Coming up today</h2>
                    <span className="badge">{now.toFormat("ccc d")}</span>
                  </div>
                  {next.length ? (
                    next.slice(0, 3).map((e) => (
                      <button
                        className="upcoming-row"
                        onClick={() => setEventModal(e)}
                        key={e.id}
                      >
                        <span className={`upcoming-line ${e.category}`} />
                        <div>
                          <strong>{e.title}</strong>
                          <span>
                            {e.all_day
                              ? "All day"
                              : `${DateTime.fromISO(e.starts_at!).setZone(zone).toFormat("h:mm a")} – ${DateTime.fromISO(e.ends_at!).setZone(zone).toFormat("h:mm a")}`}{" "}
                            · {e.kind === "focus" ? "Focus" : "Commitment"}
                          </span>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <div className="small-empty">
                      <p>No more commitments today.</p>
                      <button
                        className="text-button"
                        onClick={() => setEventModal(true)}
                      >
                        Add a commitment <Plus size={14} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="surface compact-surface">
                  <div className="section-title spread">
                    <h2>A good place to start</h2>
                    <button
                      className="text-button"
                      onClick={() => setView("tasks")}
                    >
                      All tasks <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {open.length ? (
                    (due.length ? due : open).slice(0, 2).map(taskRow)
                  ) : (
                    <div className="small-empty">
                      <p>What would you like to make time for?</p>
                      <button
                        className="text-button"
                        onClick={() => setTaskModal(true)}
                      >
                        Add your first task <Plus size={14} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {(view === "today" || view === "calendar") && (
            <>
              <div className="section-above-calendar">
                <span>
                  <CalendarDays size={16} />
                  Your week
                </span>
                <a href={`/api/export?${exportParams}`} className="text-button">
                  <Download size={14} />
                  Export week
                </a>
              </div>
              <Calendar
                events={state.events}
                proposals={state.proposals}
                zone={zone}
                start={anchor}
                onChange={setAnchor}
                onEvent={setEventModal}
                onAdd={() => setEventModal(true)}
              />
              {!assistant &&
                state.proposals.some(
                  (p) => p.status === "pending" || p.status === "applied",
                ) && (
                  <div className="standalone-proposals">
                    {state.proposals
                      .filter(
                        (p) => p.status === "pending" || p.status === "applied",
                      )
                      .slice(0, 3)
                      .map((p) => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          zone={zone}
                          onSaved={reload}
                        />
                      ))}
                  </div>
                )}
            </>
          )}
          {view === "tasks" && (
            <section className="surface tasks-surface">
              <div className="tasks-toolbar">
                <div className="filter-tabs">
                  {["open", "done", "archived", "all"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={filter === f ? "active" : ""}
                    >
                      {f === "open"
                        ? "To do"
                        : f === "done"
                          ? "Complete"
                          : f === "archived"
                            ? "Archived"
                            : "All"}
                    </button>
                  ))}
                </div>
                <label className="sr-only" htmlFor="task-search">
                  Search tasks
                </label>
                <input
                  id="task-search"
                  type="search"
                  placeholder="Search your tasks…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {state.tasks
                .filter(
                  (t) =>
                    (filter === "all" || t.status === filter) &&
                    t.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map(taskRow)}
              {!state.tasks.some(
                (t) =>
                  (filter === "all" || t.status === filter) &&
                  t.title.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <Empty
                  title={
                    query
                      ? "No matching tasks"
                      : "A little space for your next goal"
                  }
                  action={
                    <button
                      className="secondary"
                      onClick={() => setTaskModal(true)}
                    >
                      <Plus size={16} />
                      Add a task
                    </button>
                  }
                >
                  Add something you need to accomplish, with an estimate of the
                  time it will take.
                </Empty>
              )}
            </section>
          )}
          {view === "connections" && (
            <Connections
              sources={state.sources}
              feedActive={state.feedActive}
              zone={zone}
              onSaved={reload}
            />
          )}{" "}
          {view === "settings" && (
            <section className="surface settings-surface">
              <div className="section-title">
                <Settings2 size={19} />
                <h2>Your planning rhythm</h2>
              </div>
              <PreferencesForm prefs={state.preferences} onSaved={reload} />
            </section>
          )}
          {view === "assistant" && (
            <div className="assistant-full">
              <AssistantPanel
                state={state}
                onSaved={reload}
                onClose={() => setView("today")}
                onPlan={() => setPlanModal(true)}
              />
            </div>
          )}
        </main>
      </div>
      {assistant && view !== "assistant" && (
        <AssistantPanel
          state={state}
          onSaved={reload}
          onClose={() => setAssistant(false)}
          onPlan={() => setPlanModal(true)}
        />
      )}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={view === n.id ? "active" : ""}
          >
            <n.icon size={19} />
            <span>{n.label}</span>
          </button>
        ))}
        <button
          onClick={() =>
            setView(view === "connections" ? "settings" : "connections")
          }
          className={
            view === "connections" || view === "settings" ? "active" : ""
          }
        >
          <Settings2 size={19} />
          <span>{view === "connections" ? "Settings" : "More"}</span>
        </button>
      </nav>
      {taskModal && (
        <TaskForm
          task={taskModal === true ? undefined : taskModal}
          zone={zone}
          onClose={() => setTaskModal(null)}
          onSaved={reload}
        />
      )}{" "}
      {eventModal && (
        <EventForm
          event={eventModal === true ? undefined : eventModal}
          zone={zone}
          tasks={state.tasks}
          onClose={() => setEventModal(null)}
          onSaved={reload}
        />
      )}{" "}
      {planModal && (
        <PlanForm
          state={state}
          onSaved={async () => {
            await reload();
            setAssistant(true);
            if (window.matchMedia("(max-width: 1050px)").matches)
              setView("assistant");
          }}
          onClose={() => {
            setPlanModal(false);
          }}
        />
      )}
      {onboarding && (
        <Modal
          title="Let’s find your rhythm"
          onClose={() => setOnboarding(false)}
        >
          <p className="hint">
            Start with your time zone and typical available hours. Bring in your
            existing calendar in Connections when you’re ready.
          </p>
          <PreferencesForm
            prefs={state.preferences}
            onSaved={reload}
            onDone={() => setOnboarding(false)}
          />
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                const { owner_id, revision, ...data } = state.preferences;
                await api("preferences", {
                  revision,
                  data: { ...data, onboarded: true },
                });
                setOnboarding(false);
              })
            }
          >
            Use defaults for now
          </button>
        </Modal>
      )}
    </div>
  );
}
function PlanForm({
  state,
  onSaved,
  onClose,
}: {
  state: State;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const zone = state.preferences.timezone,
    now = DateTime.now().setZone(zone);
  return (
    <Modal title="Make a realistic plan" onClose={onClose}>
      <p className="hint">
        Tempo finds time inside your available hours, keeps commitments in
        place, and respects deadlines. You’ll review every block before saving.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const start = DateTime.fromISO(String(f.get("start")), { zone })
                .startOf("day")
                .toUTC()
                .toISO()!,
              end = DateTime.fromISO(String(f.get("end")), { zone })
                .plus({ days: 1 })
                .startOf("day")
                .toUTC()
                .toISO()!;
            await api("plan", {
              start,
              end,
              ...(f.get("task") ? { task_ids: [f.get("task")] } : {}),
              replan: f.get("replan") === "on",
            });
            await onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <Field label="From">
            <input
              name="start"
              type="date"
              min={now.toISODate()!}
              defaultValue={now.toISODate()!}
              required
            />
          </Field>
          <Field label="Through">
            <input
              name="end"
              type="date"
              defaultValue={now.plus({ days: 6 }).toISODate()!}
              required
            />
          </Field>
        </div>
        <Field label="Tasks to plan">
          <select name="task">
            <option value="">All unfinished tasks</option>
            {state.tasks
              .filter((t) => t.status === "open")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.remaining_minutes} min
                </option>
              ))}
          </select>
        </Field>
        <label className="check-field">
          <input type="checkbox" name="replan" />
          Replan flexible unfinished blocks when they no longer fit
        </label>
        <p className="hint">
          Valid existing blocks are preserved. Scheduling never marks a task
          complete.
        </p>
        {!state.tasks.some((t) => t.status === "open") && (
          <p className="proposal-warning">
            Add a task with remaining effort first.
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || !state.tasks.some((t) => t.status === "open")}
        >
          {busy ? "Finding time…" : "Preview plan"}
        </button>
      </form>
    </Modal>
  );
}
