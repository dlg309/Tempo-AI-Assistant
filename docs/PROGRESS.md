# Tempo rebuild progress

Branch: `revamp/tempo-next`. Baseline: `2fced69`. Original clean `main`; verified origin `https://github.com/dlg309/Tempo-AI-Assistant.git`. No applicable AGENTS.md files in the repository or ancestors. No user changes to preserve.

## Plan

1. Replace the React/Vite + FastAPI stacks with one strict TypeScript Next.js App Router application. Preserve the previous implementation in Git history.
2. Supabase cookie authentication, relational schema, owner RLS, optimistic versions, transactional plan application and undo.
3. Manual task/commitment CRUD and planning preferences; deterministic planner independent of Gemini.
4. Previewed iCalendar imports, conservative source reconciliation, exports, SSRF-protected feed retrieval, private revocable feeds and daily refresh job.
5. Bounded Gemini tools sharing application services; calm responsive workspace and actionable configuration states.
6. Unit/security/database tests, browser workflow, production build, CI and reproducible documentation.

## Discovery

Retain tasks by category/priority, fixed calendar commitments, available hours, deadline-aware split work and conversational planning. Remove overlapping workspace/user storage, browser workspace persistence, Python service and provider-specific Google write integration. Shared meeting booking is outside this release's single-user planning workflow.

Official references checked: Next.js installation (Node >=20.9), Supabase SSR cookie clients, Google GenAI SDK/function calling and models, FullCalendar React/MIT licensing, ical.js recurrence APIs, Vercel cron limits (Hobby: daily). See architecture/deployment documents for links.

## Implemented

1. Clean inspection and isolated branch; replaced both old stacks with one npm/strict-TypeScript Next.js application. Original code remains at the baseline in Git history.
2. Supabase cookie authentication, PKCE confirmation callback, onboarding/preferences, schema/constraints/owner RLS, maintained database types, lockfile and actionable missing-configuration state.
3. Persistent task and commitment forms, categories/priorities/deadlines/effort/progress, completion, locked focus blocks and read-only imported event details.
4. Independent deterministic planner, calendar/list previews, placement explanations, insufficient-effort accounting, adjustable proposals, transactionally idempotent application and conflict-aware undo.
5. Library-based .ics preview/import/upsert/cancellation and serialized event/week/applied-plan exports.
6. HTTPS sources, DNS-pinned public network fetching, bounded redirects/time/size, manual refresh/leases/error retention, scheduled daily cron configuration, hashed/rotatable/revocable private feeds and ETags.
7. Server-side official Gemini SDK with strict tools, proposal review, actual save outcomes, bounded context/iterations/rates and provider/configuration failures. Ordinary manual operations do not call Gemini.
8. Responsive Today/Calendar/Tasks/Assistant/Connections/Settings, desktop assistant collapse, mobile agenda/tabs, native dialogs, keyboard alternatives, reduced motion and improved text contrast. CI and complete setup/architecture/calendar/AI/deployment docs.

Next.js generated AGENTS.md during the first dev/build run. Its current bundled guides for proxy, cookies, route handlers, TypeScript and server/client boundaries were read and checked; keep the generated rules tracked. There were no applicable agent rules at initial inspection.

## Verification evidence (October 12, 2026)

- `npm run check`: passed, strict application/test TypeScript.
- `npm test`: 39 passed across 9 suites. Covers intervals, deadlines, splitting/effort, buffers, locked/minimal-disruption replanning, local/DST conversion, all-day semantics, recurring exceptions/RDATE/EXDATE/cancellation, serialization, invalid/oversized input, SSRF/redirect pinning, token/ETag revocation, origin/body boundaries, Gemini validation/signature preservation/limits/provider failures, auth/job boundaries and failed-refresh retention.
- `npm run test:db`: 22 passed. Runs the exact migration in PostgreSQL/PGlite with simulated Supabase Auth roles/claims. Covers isolation/permissions, versions/staleness, transactional rollback, duplicate application, undo and intervening edits, task proposals, duplicate import/update, conservative omission/error handling, explicit cancellation, imported immutability, leases, token rotation/revocation, fixed persistent rate policies, disabled sources, availability/deadlines and privilege rejection.
- `npm run test:e2e`: 4 passed across desktop (1440 px) and mobile (390 px). The real UI/planner/parser runs against explicitly mocked HTTP Auth/persistence. Flow: sign-in UI → .ics preview/import → task → manual preview → apply → reload → export → undo. Also verifies AI-unconfigured manual planning, Escape dismissal and narrow-screen overflow. There is no normal application fake backend.
- Desktop/mobile screenshots inspected. Evidence lives in ignored `test-results/tempo-{desktop,mobile}-{today,calendar}.png`; no bearer credentials or actual account data in screenshots.
- `npm run build`: passed; actual production compilation and TypeScript checks. Sandbox child-process output capture prevented initial builds, so the successful builds ran with the authorized sandbox override. No TypeScript build-error bypass was enabled.
- Clean `npm ci --offline --no-audit`: passed using the downloaded cache.
- Dependency install/audit after the Vitest patch: 0 reported vulnerabilities. Compatible FullCalendar packages are all pinned to 6.1.21 rather than mixing registry major versions.
- `git diff --check`: passed.

Chromium initially could not launch because this WSL image lacked libasound.so.2. Downloaded/extracted the runtime into `/tmp/tempo-browser-libs` and used `LD_LIBRARY_PATH` for browser tests; no system packages were changed. Chromium is in `/tmp/tempo-browsers`. This session's browser command was:

```bash
LD_LIBRARY_PATH=/tmp/tempo-browser-libs/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/tempo-browsers npm run test:e2e
```

CI uses Playwright's standard `install --with-deps chromium` instead.

## External checks still blocked

No Supabase project credentials, Gemini key, real calendar feed or hosting account were supplied. Live Supabase Auth/email callbacks/PostgREST RPC shapes, real Gemini tool execution, actual feed network retrieval, provider calendar subscription behavior and hosted cron execution are **not verified**. PostgreSQL tests simulate Auth claims; browser tests mock HTTP. Concurrent processes against hosted PostgreSQL require a live follow-up despite transaction/lock/version logic being implemented. `npm run test:e2e:live` is opt-in and was not run.

Follow `docs/DEPLOYMENT.md` using a disposable development Supabase project; apply the migration and exact callback URLs. Then run the opt-in persistence smoke test and manually check two-account isolation, Gemini, a public HTTPS .ics feed, rotation/revocation/ETag and scheduler invocation. No production deployment, database edits, DNS changes, remote pushes, merges or history rewrites were performed.

## Signup setup follow-up

Diagnosed a local signup failure: NEXT_PUBLIC_SUPABASE_URL contained a dashboard webpage URL instead of the project's API origin. Corrected only that ignored .env.local entry, preserving the user's other settings. A read-only request to the derived project API's `/auth/v1/settings` returned HTTP 200 using the configured publishable key: signups enabled, Email provider enabled, email confirmation required. No accounts were created or provider settings changed during diagnosis.

Added configuration validation in the server client/proxy so dashboard URLs and placeholder configuration produce actionable errors. Known signup errors now explain SMTP recipient restrictions, rate limits, password policy, disabled signup/provider and unavailable Auth. Logs include only a sanitized error code/status, never email/password/provider bodies. Added configuration and route tests, including credential-free logging assertions. Type checking, 43 unit tests across 10 suites, and production build passed. Actual account creation still needs the user to restart the dev server and retry with their own credentials.

## Explicit initial-release limits

- The cron handles three due sources per invocation; the daily schedule can create backlog. More sources/users need more frequent compatible scheduling or a queue before promising daily freshness.
- See CALENDAR.md for unsupported recurrence/time-zone features, computation/occurrence/input bounds and conservative retained omissions. Imported/provider events cannot be edited in Tempo.
- AI task creation and subsequent scheduling are separate approval steps. New fixed commitments are entered/imported manually. No automatic older-chat summary/long-term memory.
- Shared meeting booking, CalDAV/provider writes, automatic conversion of old accounts/workspaces, account deletion and password recovery are outside this implementation.
- Complete code/setup is prepared; live integration and hosted-operational acceptance remain outstanding until external setup is available.
