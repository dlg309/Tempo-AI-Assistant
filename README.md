# Tempo

Tell Tempo what you need to accomplish, and it helps you find time to do it.

Tempo turns tasks, deadlines, available hours and commitments into a reviewable plan. The rebuilt workspace includes Today, a timezone-aware calendar, tasks, a Gemini assistant, calendar connections and planning preferences. Manual planning works without an AI key.

One strict TypeScript Next.js application replaces the previous Vite/FastAPI stacks. Supabase Auth/PostgreSQL own persistent data; users approve atomic, version-checked proposals and can undo them subject to conflict checks. Calendar exchange supports previewed `.ics` import, deduplicated reimport, file export, server-refreshed HTTPS sources and revocable private feeds. Imports/feed subscriptions are read-only snapshots, not instant two-way sync.

## Start

Use Node 22+ and npm (tested Node 24). Create a development Supabase project, apply `supabase/migrations/202610120001_tempo.sql`, and configure email/password Auth/callback URLs as described in [deployment setup](docs/DEPLOYMENT.md).

```bash
npm ci
cp .env.example .env.local
# Fill Supabase URL/publishable key and matching application URL.
npm run dev
```

Open http://localhost:3000. Sign up/confirm, configure available hours, add or import commitments, create a task, use **Plan my week**, review/apply, reload, and export. Add `GEMINI_API_KEY` to enable chat. Private subscription feeds and scheduled jobs also require the server-only service-role key and `CRON_SECRET`. No credentials are committed.

## Commands

| Command                                       | Purpose                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm ci`                                      | Reproducible installation from the lockfile                                             |
| `npm run dev`                                 | Local Next.js application                                                               |
| `npm run check`                               | Strict application/test type checking                                                   |
| `npm test`                                    | Planner, calendar, AI and request/security unit tests                                   |
| `npm run test:db`                             | Exact migration/RLS/transaction tests in embedded PostgreSQL with simulated Auth claims |
| `npm run build`                               | Production build, including TypeScript checks                                           |
| `npm start`                                   | Serve an already built production application                                           |
| `npx playwright install --with-deps chromium` | Browser/test runtime installation                                                       |
| `npm run test:e2e`                            | Desktop/mobile workflows with explicitly mocked external HTTP services                  |
| `npm run test:e2e:live`                       | Opt-in disposable Supabase Auth/persistence smoke check                                 |

The normal application has no mock AI or browser database fallback. Automated mock-based browser tests do not verify live Supabase/Gemini credentials or a hosted cron. See [progress and evidence](docs/PROGRESS.md) for checks actually run.

## Design and limits

The scheduler uses earliest-deadline/priority greedy allocation, with breaks, buffers and full-effort accounting; it makes no optimality claim. Planning is bounded to the next 31 days. Locked events stay put, scheduling does not complete tasks, and insufficient time is explained. Replanning preserves valid flexible work. iCalendar support is bounded and rejects unsupported content; missing feed events are retained unless explicitly canceled. Daily cron initially processes three due feeds per invocation, so larger workloads need more frequent invocations or a queue. No production deployment or old database migration is performed by this branch.

- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Calendar behavior, supported recurrence and limitations](docs/CALENDAR.md)
- [Gemini tools, review steps and failures](docs/AI.md)
- [Supabase, hosting, secrets, scheduler and domains](docs/DEPLOYMENT.md)
- [Completed work, verification and next steps](docs/PROGRESS.md)

The original implementation is preserved in Git history at `2fced69`. Shared meeting booking, CalDAV/provider writes and automatic migration of old accounts/workspaces are outside this initial release.
