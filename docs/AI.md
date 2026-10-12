# Gemini assistant

Set server-only `GEMINI_API_KEY` and optional `GEMINI_MODEL` in `.env.local`/hosting secrets. The checked default is `gemini-3.8-flash`; model availability can differ by account/region, so verify it before a live release. The implementation uses official `@google/genai` with `models.generateContent`, validated function declarations and original SDK model parts preserved on subsequent tool turns (including thought signatures).

References: [official Google GenAI SDK](https://googleapis.github.io/js-genai/release_docs/), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [current model list](https://ai.google.dev/gemini-api/docs/models), [3.8 Generate Content compatibility and sampling deprecations](https://ai.google.dev/gemini-api/docs/generate-content/latest-model). Requests use low thinking and omit deprecated sampling parameters.

## Tools

| Tool                   | Behavior                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| `get_tasks`            | Read relevant owned task IDs, versions, effort and deadlines            |
| `get_schedule`         | Read owned commitments/focus blocks in a bounded window                 |
| `get_availability`     | Calculate free intervals from preferences and busy events               |
| `propose_task_changes` | Propose up to 10 task creations/updates; no direct persistence of tasks |
| `propose_schedule`     | Run the same deterministic planner as the manual Plan my week button    |
| `explain_plan`         | Read saved proposal reasons, unscheduled effort and warnings            |

All parameters are strictly validated; unknown fields/tools are rejected. The model cannot supply ownership, run SQL/code, fetch URLs or call arbitrary operations. External calendar/task text is explicitly treated as data. The system instruction provides the user’s IANA zone and current local date/time for relative-date resolution. Ambiguous effort, dates and task identities require clarification.

“Add statistics homework, due Friday, estimate two hours” creates a task proposal. The user applies it, then can ask to schedule the saved task. “Find 90 minutes tomorrow” needs an identified task/remaining effort; Tempo asks if identity or effort is unclear. “Plan my week” reads the current records and generates specific blocks. “Move unfinished work” uses minimal-disruption replanning. “Why Wednesday?” reads placement reasons. “What can finish?” includes unscheduled effort rather than claiming impossible work fits. New commitments are added/imported through Calendar/Connections; the current AI tool set proposes task and focus changes, not external or fixed-event writes.

Task creation and scheduling are intentionally separate review steps. Pending task changes are not treated as saved tasks. Every modification requires user application. Atomic apply returns the real database outcome, then records the saved-plan message for the next assistant turn. The model never receives privileged credentials or a browser-supplied user ID. A provider reply is not proof of persistence.

## Failure/efficiency behavior

No key: clear configuration state, no fabricated responses. Manual tasks/events/preferences/imports/planning remain available. Provider errors/quotas/timeouts: concise retry/manual-planning error. Any proposals already persisted before an AI failure remain available on reload. Conversation storage retains the most recent 100 messages; model context uses at most the latest 10 messages (4,000 characters each), not unlimited history. No automatic historical conversation summary or long-term memory is implemented.

Limits: 10 AI calls/hour/account in PostgreSQL, five model iterations, six requested tools per turn, 12-second request timeout, 45-second loop deadline, 100 KB accumulated context and 1,600 output tokens. Context retrieval is bounded by task/date limits. Tests mock provider responses and test validation, signature preservation, loop bounds, provider failure and missing credentials. Live Gemini execution is a separate integration smoke check and was not verified without credentials.
