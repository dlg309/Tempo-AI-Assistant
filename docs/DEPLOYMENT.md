# Setup and deployment

Prepare a new Supabase project and Next.js hosting environment. Nothing in this branch deploys or modifies a production database automatically. The base URL is configurable; `findmytempo.us` is not assumed to be available.

## Supabase

1. Create a disposable development project. Get its HTTPS project URL and publishable key from Connect/API settings.
2. In SQL Editor, apply the entire `supabase/migrations/202610120001_tempo.sql` once. Alternatively use a trusted direct database connection:

   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202610120001_tempo.sql
   ```

3. Enable email/password Auth. For local development, set Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback`. If using `127.0.0.1`, register that matching origin/callback too. Keep the standard ConfirmationURL email template so PKCE returns a `code` to the callback. Confirm accounts via email; configure SMTP and Auth abuse controls for a live environment.
4. For deployed environments, set Site URL to the actual application origin and allow the exact `/auth/callback` URL. Avoid unrestricted production redirect wildcards. Use a separate project/keys for previews.
5. Copy `.env.example` into `.env.local`; set the URL/publishable key. The service role key is **server-only**, required only for cron and private feed reads. Never prefix it with `NEXT_PUBLIC_`. Restart Next after changing environment values.

   Use the **project API URL**, normally `https://<project-ref>.supabase.co`, not the `supabase.com/dashboard/project/...` URL from the browser address bar. Tempo rejects dashboard URLs with a configuration message before sending Auth requests.

   Supabase's [default email sender](https://supabase.com/docs/guides/auth/auth-smtp) is intended for testing and only sends to organization-member email addresses. Use your Supabase organization-member email for initial testing, or configure custom SMTP for other recipients. Signup now explains known SMTP restrictions, email/request rate limits, password policy and disabled-provider errors without logging email addresses, passwords or raw provider messages.

6. Database types are maintained in `src/lib/database.types.ts`. If generating via Supabase CLI, preserve the RPC arguments and composite response shape (row-returning RPCs explicitly use `.single()`). Refresh the PostgREST schema cache if needed after SQL changes: `NOTIFY pgrst, 'reload schema';`.

The migration uses owner RLS and disallows direct authenticated table writes. Do not disable RLS or use a service-role client for ordinary user operations. Ordinary reads and RPC mutations use verified session cookies and `auth.uid()`. Existing data in the retired database requires a separately reviewed migration; there is no automatic old-account/workspace conversion.

## Local run

Node 22+ (tested Node 24), npm only:

```bash
npm ci
cp .env.example .env.local
# Fill Supabase values and apply the migration above.
npm run dev
```

Open `http://localhost:3000`, create/confirm an account, configure available hours, add/import commitments, add a task, preview/apply a plan, reload and export. No Gemini key is required for this manual flow. Set `GEMINI_API_KEY` to enable chat. Default model configuration is documented in AI.md.

## Next.js hosting / Vercel

Configure a repository-based Next.js project, repository root directory, Node 24, `npm ci` install, `npm run build` build. Set environment variables from `.env.example`; use the deployment origin for `NEXT_PUBLIC_APP_URL`. No static-export configuration is used because API routes require a Node server. `npm run build && npm start` also supports a self-hosted Node deployment; an external scheduler is needed in that case.

`vercel.json` is a real daily cron declaration for `/api/jobs/refresh` at `0 6 * * *` (06:00 UTC). Generate a strong random `CRON_SECRET` and set it in the host. Vercel sends `Authorization: Bearer <CRON_SECRET>`; the route rejects missing/mismatched secrets with timing-safe comparison. It uses narrowly scoped service-role reads plus refresh RPCs, never impersonates a browser user. Node HTTPS/DNS APIs are required, so the endpoint is not an Edge runtime.

Official constraints checked October 12, 2026: [Vercel cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) allows Hobby jobs once daily with hourly timing precision; more frequent schedules need a compatible paid plan. [Cron behavior](https://vercel.com/docs/cron-jobs) invokes deployed functions; an endpoint alone is not a scheduler. Check current function duration/plan limits before a live release; the route requests `maxDuration=60`.

**Initial capacity:** each invocation handles at most three feeds whose last attempt is older than 24 hours, oldest first. Retrieval is bounded to 12 seconds/feed. More than three due feeds create a backlog serviced by later invocations; daily config does not promise every source refreshes daily. For larger usage, run this protected endpoint more frequently on a supported plan/external scheduler, preserving its leases and 24-hour due filter, or extend the job with a reviewed queue/batch design. The interface warns on data older than 48 hours. No hosted scheduler execution has been verified without deployment access.

Self-hosted scheduling example (set the secret through protected scheduler configuration, not a public command log): make an authenticated GET to `https://<base>/api/jobs/refresh` at least daily. Treat failures as operational alerts. Keep the last successful events and inspect generic source errors in Connections.

## Private feed logging and domains

Private feed URLs are bearer credentials. Next development incoming-request logs exclude `/api/feed/`; application logs contain operation categories/counts only. Configure hosting/access logs, reverse proxy, analytics and error trackers to redact/omit the full `/api/feed/*` path before enabling production subscriptions. Never record feed paths or external private feed URLs in request body capture. If the host cannot redact these credentials, do not enable production subscription feeds until a suitable gateway/log configuration is in place.

For a custom domain, add the domain in the hosting provider, configure the provider’s exact DNS records and TLS, update `NEXT_PUBLIC_APP_URL`, Supabase Site URL and callback allowlist, then run live Auth/feed/export checks. This branch does not purchase services, change DNS, publish Sites or deploy.

## Verification

```bash
npm run check
npm test
npm run test:db
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Unit tests mock external requests. Database tests run the exact migration in embedded PostgreSQL/PGlite with simulated Supabase Auth claims; this verifies SQL/RLS/transactions, not live Supabase networking, concurrent-process behavior or Auth configuration. Browser tests explicitly mock HTTP authentication/persistence but run the real UI, calendar parsing/export and planning logic at desktop/mobile sizes. No normal application fake backend is enabled.

Opt-in real persistence smoke test: start the app with a migrated disposable Supabase project; configure `TEMPO_TEST_BASE_URL`, `TEMPO_TEST_EMAIL`, `TEMPO_TEST_PASSWORD`; run `npm run test:e2e:live`. The test creates and deletes one uniquely named task in that account. Verify real Gemini, external feed retrieval, token rotation/ETag, scheduled job execution and two-account isolation separately before production. These live checks were not run in this session.
