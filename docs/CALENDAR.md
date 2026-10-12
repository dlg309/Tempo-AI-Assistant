# Calendar exchange

Tempo uses RFC 5545 iCalendar at the boundary and structured PostgreSQL events internally. Imports and subscriptions are snapshots/read feeds, not immediate two-way synchronization.

## File import

In Connections, create a file source, choose it, upload an `.ics` file, preview occurrences/warnings, and confirm. The preview covers the previous 31 days and next 90 days. Reimport into the **same source**: `(source, UID, recurrence identity)` is upserted, so repeated identical imports do not duplicate occurrences. Separate calendars should use separate sources.

Parsing supports VEVENT timed UTC/IANA-zone/floating times, all-day exclusive dates, RRULE (hourly/daily/weekly/monthly/yearly subject to bounds), date/time RDATE, EXDATE, individual RECURRENCE-ID exceptions and explicit STATUS:CANCELLED components. Embedded VTIMEZONE is used for recognized IANA identifiers; unknown/custom identifiers are rejected. Floating times use the account zone captured when that source is created and display a warning. That source zone is retained when the user later changes their planning/display zone; existing instants do not shift. DTSTART is included in RDATE-only recurrence sets. Moved exceptions retain original recurrence identity. EXDATE and all-day semantics are preserved. TRANSP:TRANSPARENT never blocks availability; busy all-day source entries block only when the source preference enables it.

Unsupported input is rejected with a useful error: VTODO/other component types, multiple RRULEs, EXRULE, RDATE periods, THISANDFUTURE ranges, secondly/minutely rules, unknown TZIDs, ambiguous/nonexistent local DST occurrences and input/recurrence over the documented limits. To recover, export UTC timestamps or an expanded/narrower VEVENT date range at the source. Descriptions and titles render as text. Alarms/attendees/provider metadata are not imported as Tempo application actions.

Original successful source text is retained for bounded on-demand recurrence expansion. Imported occurrences are also materialized over the rolling import window; new occurrences outside it can be displayed from the raw source. Planning is limited to the next 31 days, inside that materialized horizon. Historical high-frequency feeds may exceed traversal/computation limits and require a narrower source export.

## Conservative reconciliation

Recognized identities update in place. Explicit master cancellation removes that UID in that source; an instance cancellation removes its matching recurrence identity. Missing entries are retained because provider responses can be partial. Network, parse and persistence failures keep the previous successful content and events. Removal of a whole source explicitly removes its Tempo-imported events without changing the external provider.

This policy may retain events/old recurrence identities a provider simply omits, including a changed recurrence pattern. Review such events at the source and obtain explicit cancellations, or remove/recreate the source after reviewing the replacement data. Tempo does not claim omission means cancellation. Disabled sources stop affecting availability and stay stored. Imported events are read-only; edit at the source and refresh/reimport.

## External HTTPS feeds

Add a named HTTPS source and use Refresh for an initial/manual retrieval. The scheduler config in `vercel.json` calls the protected refresh endpoint daily. Each refresh records last attempt, last success and a generic error; leases prevent overlap and manual requests are limited to one per minute/source. See deployment docs for job capacity and hosting constraints.

Retrieval allows public HTTPS/443 only, with no embedded credentials. Every DNS answer must be globally routable; IPv4-mapped private IPv6 is rejected. The validated address is pinned to the connection, with TLS hostname validation unchanged. Every redirect repeats URL/DNS validation. Limits: three redirects, 12-second overall retrieval deadline and 1 MB response. Compressed feeds are explicitly unsupported. URLs/response contents and bearer tokens are not written to application logs.

## Export and private subscription

Use Export week, proposal Export, or `/api/export?start=<ISO>&end=<ISO>&event=<UUID>` for a single owned event. File exports include only Tempo-created commitments and focus blocks; tasks themselves are not calendar events. Maximum date range is 31 days. Proposal export includes the applied batch’s created focus blocks in that range. Serialization uses ical.js with stable UID, DTSTAMP, LAST-MODIFIED, SEQUENCE, UTC DTSTART/DTEND or date-only exclusive ends, escaping and line folding. Content type is `text/calendar; charset=utf-8`.

Connections can create/rotate a private subscription URL, choose Tempo commitments/focus blocks, copy the URL and revoke it. The feed covers the previous 31 days and next 90 days. It excludes imported events, preventing feed loops. Tokens contain 256 random bits; only SHA-256 hashes are stored. The raw token is returned once. Rotation invalidates the previous URL; revocation makes it unavailable. Anyone with this URL can read the included calendar data. Calendar apps refresh on their own schedules. ETags support conditional requests without bypassing token validation.

Do not put private URLs in tickets, analytics, screenshots or logs. Next development logging excludes `/api/feed/`; configure production access-log/observability redaction for the full feed path as described in deployment docs. Revocation prevents future access but cannot erase copies already cached by other apps.
