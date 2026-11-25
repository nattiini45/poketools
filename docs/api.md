# API helpers

The shared helpers every API route builds on: the safe error response, cache headers, pagination parsing, the JSON body reader, the invalid-path-id guard, the delete rebuild warning and the team-access guard. Client-safe and dependency-light — a route imports the one helper it needs; nothing here reads a database.

## File Structure

```
src/lib/api/
├── cache.ts                    # Cache-Control header helpers: cacheHeaders() + the named CACHE buckets
├── delete-rebuild-warning.ts   # The warning a delete response carries when the derived-data rebuild failed
├── error-response.ts           # safeErrorResponse(): logs server-side, returns the catalogued client error
├── extension-error-code.ts     # Brand an error code of a pack extension's own routes (docs/format-packs.md)
├── invalid-path-id.ts          # rejectInvalidPathId(): the catalogued INVALID_<NOUN>_ID 404 guard
├── json-body.ts                # readJsonBody(): malformed JSON is a distinct 400, never a swallowed validation error
├── pagination.ts               # parsePagination(): limit/offset parsing with the MAX_PAGE_LIMIT (200) ceiling
├── team-auth.ts                # requireTeamAccess(): team-scope authorization guard of the team routes
└── user-facing-error.ts        # UserFacingError: a machine-readable error code the client renders localized
```

## Core Functions/Classes

- **`safeErrorResponse()`** (`error-response.ts`) — the mandatory error path of every API route (root AGENTS.md, hard rules): logs the failure server-side with the request id (`x-request-id`), answers the client with a safe catalogued fallback, never a raw exception message. [Security Patterns](./security-patterns.md) owns the pattern; this module implements it.
- **`rejectInvalidPathId()`** (`invalid-path-id.ts`) — a dynamic UUID path segment is checked before any query: a malformed id answers 404 with the resource's `INVALID_<NOUN>_ID` code instead of a Postgres-level 500. The pinned route inventory lives in `src/app/api/__tests__/path-id-guards.test.ts`.
- **`parsePagination()`** (`pagination.ts`) — the `?limit`/`?offset` parsing of list routes, clamped to `MAX_PAGE_LIMIT` (200) so a huge `?limit` cannot blow up a query.
- **`readJsonBody()`** (`json-body.ts`) — a body that does not parse is a 400 `invalid_json`, not an empty object that would surface as a misleading `validation_failed`.
- **`cacheHeaders()` / `CACHE`** (`cache.ts`) — the shared `public, s-maxage=X, stale-while-revalidate=Y` shapes of public read routes, as named constants so the magic strings do not drift.
- **`requireTeamAccess()`** (`team-auth.ts`) — the authorization guard of the team routes.
- **`deleteRebuildWarning()`** (`delete-rebuild-warning.ts`) — a committed delete whose derived-data rebuild failed stays a success, but the response carries the warning code the client renders (e.g. `rating_history_incomplete`) instead of hiding it in the server log.
- **`UserFacingError`** (`user-facing-error.ts`) — an error whose `code` is a key of an error catalog under `src/i18n/messages/errors/`, so the client branches on it and renders the viewer's language.
- **`extensionErrorCode()`** (`extension-error-code.ts`) — brands an error code of a pack extension's own routes; extension routes ship their own catalog instead of the public `ApiErrorCode` catalogs.

## Testing

- **Test Files — `src/lib/api/`**: `src/lib/api/__tests__/` (6 test files): `error-response.test.ts`, `extension-error-code.test.ts`, `invalid-path-id.test.ts`, `json-body.test.ts`, `pagination.test.ts`, `test-flag-rebuild-warning.test.ts`.
- **Running Tests**: `npx vitest run src/lib/api/__tests__`

## Related Modules

- [Security Patterns](./security-patterns.md) — the OWASP and error-handling patterns these helpers implement.
- [Validation](./validation.md) — the Zod schemas the routes apply after `readJsonBody()`.
- [Format packs](./format-packs.md) — pack extension routes and their branded error codes.
