# Architecture

Tempo is one Next.js App Router application with strict TypeScript, cookie-based Supabase authentication and PostgreSQL persistence. The earlier React/Vite and FastAPI application is retained in Git history at `2fced69`; there is one active stack. No production data has been migrated automatically.

## Boundaries

| Module                                | Responsibility                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/components`                      | Workspace, accessible dialogs, tasks, calendar, proposals, assistant, connections and preferences |
| `src/lib/domain.ts`                   | Maintained record types and strict Zod boundary schemas                                           |
| `src/lib/services.ts`                 | Authenticated reads, CRUD, proposals, revalidation and source refresh                             |
| `src/lib/planner.ts`                  | Pure availability/interval operations and deterministic allocation                                |
| `src/lib/ical.ts`                     | RFC 5545 parser, bounded expansion and serialization using unmodified ical.js                     |
| `src/lib/feed-security.ts`            | Public HTTPS validation, pinned DNS, redirects, time/size limits, bearer tokens                   |
| `src/lib/assistant.ts`                | Official Google GenAI SDK, bounded function calls and provider failure handling                   |
| `src/lib/supabase.ts`, `src/proxy.ts` | Cookie clients, verified users, session refresh and narrow server job client                      |
| `src/app/api/[...path]/route.ts`      | HTTP boundaries, authentication, same-origin checks and dispatch                                  |
| `supabase/migrations`                 | Relational schema, RLS, constraints, atomic apply/undo, refresh leases and limits                 |

## Data flow

UI → JSON boundary → verified Supabase user → application service → authenticated PostgreSQL RPC. Ownership is always `auth.uid()`, never a browser/AI argument. Reads use RLS; direct user writes to tables are denied. SECURITY DEFINER functions use a fixed search path, explicit ownership predicates and revoked PUBLIC/anon execution. Privileged credentials are only loaded by calendar jobs and bearer feed reads.

Tasks record estimates and remaining effort separately. Commitments and focus blocks are event rows; focus blocks reference tasks. Uploaded/feed calendars are named source rows with the last successful raw content and a retained source time zone for floating/date-only interpretation. Imported occurrences have `(owner, source, UID, recurrence identity)` uniqueness and remain read-only. Planning proposals contain just proposed changes and explanations; they are not workspace snapshots. Before/after images in change batches are scoped to undo. The database is authoritative; browser state is a fetched view, with no workspace localStorage persistence.

All schedule mutations acquire the same per-owner advisory transaction lock, then increment a workspace revision. Updating individual tasks/events requires the expected record version. A proposal captures the revision, and application compares it under the lock. Plan application, block removal, task changes and batch recording happen in one database function/transaction. Repeated application returns the original batch. Undo checks affected row versions and restoration conflicts, then restores with fresh versions; unrelated changes are left in place. A changed workspace makes a pending proposal stale even if the edit seems unrelated, which is intentionally conservative.

## Planner

The initial algorithm is greedy, not an optimal solver. It merges half-open `[start,end)` busy intervals, builds local availability using Luxon/IANA zones, subtracts buffers, ranks tasks by earliest hard deadline then priority, and allocates sessions earliest-first. It reserves breaks between sessions and explains all remaining effort that did not fit. Existing future allocations count toward remaining effort; elapsed unfinished work does not count as progress. Replanning retains valid flexible blocks and replaces only invalid eligible flexible blocks in the selected window. It never moves locked events or marks a scheduled task complete.

Manual forms remain available without Gemini. Completing a task is an explicit user action. Remaining effort can be recorded in the task form. Source all-day busy behavior is configured separately from Tempo-created all-day events. Timed instants use `timestamptz`; date-only events use exclusive `date` endpoints. Manual ambiguous/nonexistent DST times are rejected with a corrective message.

## Practical bounds

Planning: next 31 days. Workspace/export: up to 31 days. Tasks: 500 per account. Sources: 20 per account. Calendar import: 1 MB, 1,000 components, 2,000 expanded occurrences, 124-day maximum expansion, 25,000 traversal steps and a 750 ms computation budget. Over-limit input is rejected; it is not partially presented as successful. Gemini: 10 requests/hour/user, five model turns, six tools/turn, 4,000-character input, 100 KB accumulated context, 12-second provider request timeout. Persistent PostgreSQL rate limits also bound ordinary writes/imports; clients cannot choose a different bucket policy. Supabase/Auth HTTP requests preserve caller cancellation and have a 10-second timeout. The initial cron handles three due feeds per invocation; see deployment capacity limits.

The UI keeps fetched tasks/messages in memory only. It presents errors and retry/configuration states; data is rendered as plain text, never imported HTML. FullCalendar dragging is disabled; forms provide keyboard-accessible editing. Dialogs use native focus trapping and Escape, and reduced-motion styles are provided. The assistant can be collapsed on desktop; narrow screens use navigation tabs and an agenda calendar.

## Verified references

APIs/package versions were checked on October 12, 2026 against official docs and npm registry. Runtime APIs were also checked against installed SDK/type declarations. Dependencies are exact pins with one npm lockfile. Vendor declaration checking follows the standard Next.js `skipLibCheck` convention; application and test code remain strict and builds do not ignore TypeScript errors.

- [Next.js installation and runtime requirements](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [PostgREST function response formats](https://docs.postgrest.org/en/latest/references/api/functions.html)
- [FullCalendar React](https://fullcalendar.io/docs/react) and [MIT license](https://fullcalendar.io/license)
- [ical.js recurrence API](https://kewisch.github.io/ical.js/api/ICAL.Event.html), [MPL-2.0 source/license](https://github.com/kewisch/ical.js)
- [PGlite extensions used in database tests](https://pglite.dev/extensions/)

Shared meeting booking, CalDAV, provider-specific calendar writes and the old theme catalog are outside the initial rebuild. Account deletion/password recovery and multi-account collaboration need separate product flows. No agent framework, vector database or second service is required.
