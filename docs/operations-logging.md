# Operations: server logs and request ids

How a server failure leaves a trace, and how an operator finds it from what a user reports. Applies to the Vercel runtime logs and to the `next dev` / `next start` stdout.

## One logger, one JSON line

Server code logs through `logger` in `src/lib/logger.ts`. Each call writes one JSON line to stdout (`console.error` for `error`, `console.warn` for `warn`, `console.info` for `info`):

```json
{"timestamp":"2026-11-03T14:02:11.529Z","level":"error","tag":"api","message":"Failed to save the language setting","requestId":"3b1c0f0e-5d0e-4b53-9c53-1f3a53b5a111","status":500,"error":{"name":"Error","message":"connection reset","stack":"Error: connection reset\n    at ..."}}
```

| Field | Meaning |
| --- | --- |
| `timestamp`, `level` | ISO time; `info`, `warn` or `error` |
| `tag` | Where it came from: `api` (`safeErrorResponse`), `request` (`onRequestError`), a route area such as `cron/auto-confirm`, `api/drafts/picks` or `ai/match-analysis` |
| `message` | What happened, in a fixed wording (variable data lives in its own field, so the message stays greppable) |
| `requestId` | The id of a failed API request, also returned as the `x-request-id` response header (see below) |
| `digest` | The id Next.js gives an unhandled render, route or action error; the error page shows the same value |
| `path`, `method`, `routerKind`, `routePath`, `routeType` | `onRequestError` only: the request path **without its query string**, the HTTP method, and the route that matched (`routePath` is the template, for example `/api/players/[id]`) |
| `error` | The caught value, serialised: `name`, `message`, `stack`, `code`, Supabase `details` and `hint`, and the `cause` chain (three levels) |

An `Error` anywhere in the meta is serialised the same way (`serializeError` in `src/lib/logger.ts`), and a value under the key `error` is serialised even when it is a plain object, which is what supabase-js throws. Never put secrets, tokens, cookies, the `Authorization` header or a request body in the meta.

## Rules for code

- `console.*` is an ESLint error in `src/app/api` (`eslint.config.mjs`, non-test files). Log with `logger.error(tag, message, { ...fields, error: err })`. `src/lib` keeps its own conventions; new server code there should use `logger` too.
- Every catch block returns `safeErrorResponse(err, fallback)` (`src/lib/api/error-response.ts`). A branch that builds its own error response must call `logger.error` or `logger.warn` with the caught error first. `ENFORCE=1 node scripts/check-safe-error-response.mjs` (CI) fails on a raw response in a catch block without that call (`scripts/safe-error-scan.mjs`).
- Do not interpolate ids into the message when a field will do: `logger.error('cron/auto-confirm', 'could not auto-confirm match', { matchId, error: err })`.

## Request ids

`safeErrorResponse()` sets `x-request-id` on every response it builds and logs the same value as `requestId` in its `tag: "api"` line. An incoming `x-request-id` of 8 to 128 plain characters (`A-Z a-z 0-9 . _ -`) is reused, so a caller can supply its own id; any other value is replaced by a fresh UUID. The helper reads the header from the request the handler is serving (the same request store `headers()` reads), so no route passes anything; the optional fifth argument (`request`) overrides it. Outside a request (a test, a cache callback) the id is always fresh. `draftErrorResponse` logs a `DraftRuleError` with tag `api` as well. A 401 or 403 `AuthError` is logged as one `level: "warn"` line (`requestId`, `status`, `code`, no stack), so the id a client quotes after a refused request is greppable too. The response body keeps only the static fallback text: no id, no `err.message`, no stack.

## Unhandled errors and the digest

`onRequestError` in `src/instrumentation.ts` is called by Next.js for every error that escapes a server render, route handler, server action or the proxy, including the ones no `try/catch` sees. It writes one `tag: "request"` line. Only the Node.js runtime logs (the edge runtime does not load the logger path). The line holds the `digest`, the `path` with the query string and fragment cut off, the `method`, the matched route, an incoming `x-request-id` if one was sent, and the serialised `error`. It holds no cookie, no `Authorization` header, no other header and no body. A failure of the log call itself is swallowed.

The `digest` is the same value the visitor sees on the error page (`src/app/error.tsx` and `src/app/global-error.tsx`).

## Operator recipes

A user reports an error page with reference `1234567890`:

```sh
# Vercel: filter the runtime logs for the digest, or from a captured stdout file
grep '"digest":"1234567890"' server.log
```

A user or script quotes the `x-request-id` of a failed API call:

```sh
grep '"requestId":"3b1c0f0e-5d0e-4b53-9c53-1f3a53b5a111"' server.log
```

Everything that went wrong on one route in a window:

```sh
grep '"tag":"cron/auto-confirm"' server.log | grep '"level":"error"'
```

On Vercel use the same strings in the Logs search box (Runtime Logs, filter by the function); each line is a single JSON object, so `jq` works on exported logs:

```sh
jq -c 'select(.digest == "1234567890") | {timestamp, path, method, routePath, error: .error.message}' server.log
```

Query strings are cut from `path` because they can carry one-time tokens (`?token_hash=...`). A path segment can still be a secret (a share token in `/teams/shared/<token>`): treat the log like the access log of the deployment.
