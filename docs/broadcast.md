# Broadcast Module

## Overview
The Broadcast module powers live overlay state, draft replay playback, and weekly recap composition.

## File Structure
```
src/lib/broadcast/
├── animations.ts  # Overlay animation presets
├── draft-replay.ts  # Draft replay state/reducer helpers
├── error-retry.ts  # Back-off schedule of the overlay error boundary
├── overlay-config.ts  # Overlay configuration helpers
├── poll-loop.ts  # `usePollLoop`: chained polling with backoff and Retry-After
├── poll-schedule.ts  # Pure backoff and Retry-After maths
├── polling.ts  # Polling utilities
├── recap-engine.ts  # Weekly recap composition
├── request-guard.ts  # Per-IP limits and query refusal of the public data routes
└── tracker-reducer.ts  # Live battle tracker state transitions
```

## Core Functions/Classes

### Battle Tracker
- **File**: `tracker-reducer.ts`
- **Purpose**: Build/update live tracker state
- **Key Methods**: `createInitialState()`, `trackerReducer()`, `buildGamePayload()`

### Draft Replay Engine
- **File**: `draft-replay.ts`
- **Purpose**: Replay pick timelines deterministically
- **Key Methods**: `createReplayState()`, `advanceToIndex()`, `stepForward()`, `stepBackward()`, `jumpToRound()`

### Recap Engine
- **File**: `recap-engine.ts`
- **Purpose**: Build weekly recap payloads for overlays
- **Key Methods**: `composeWeeklyRecap()`

## Data Flows
- **Input**: Match stats, moments, draft replay events
- **Processing**:
  1. Reduce live events into overlay state
  2. Reconstruct draft replay state per sequence index
  3. Compose recap summaries from completed matches/moments
- **Output**: Overlay-ready state and recap payloads

## Dependencies
- **External Libraries**: None required in `src/lib/broadcast/*`
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Draft Module](./draft.md)
  - [Supabase Module](./supabase.md)
  - [AI Module](./ai.md) - optional recap narrative generation

## API Routes
- `/api/broadcast/moments`
- `/api/broadcast/state/[mid]`
- `/api/broadcast/preview/[mid]`
- `/api/broadcast/recap/[sid]`
- `/api/broadcast/standings/[sid]`
- `/api/broadcast/solo/[sessionId]`
- `/api/broadcast/presets` + `/api/broadcast/presets/[id]`

### Limits on the public data routes
The overlay data routes need no session, and a miss runs the whole database fan-out, so each is limited per client IP (`guardBroadcastRequest`, `src/lib/broadcast/request-guard.ts`, limits in `BROADCAST_ROUTE_LIMITS`). One OBS machine is one IP and runs several overlays, so the limits are sized from the polling: five state-driven overlays at `?poll=1000` make 300 calls a minute.

| Route | Bucket | Requests per IP per minute |
|-------|--------|----------------------------|
| `state/[mid]` | `broadcast-state` | 300 |
| `solo/[sessionId]` | `broadcast-solo` | 150 |
| `preview/[mid]` | `broadcast-preview` | 60 |
| `standings/[sid]` | `broadcast-standings` | 60 |
| `recap/[sid]` | `broadcast-recap` | 30 (its own, older limit) |

- Every bucket is its own: exhausting one route does not limit another. Past the limit the answer is `429` with `Retry-After` and the standard `rate_limited` body.
- Unknown query parameters are refused with `400 broadcast_query_invalid` before any read and before the limiter, and a refused request does not spend the bucket. `state` accepts only `enrich=true|false`; `solo`, `preview` and `standings` accept no parameter at all. The CDN keys its cache on the full URL, so a random `?x=1` would otherwise be a cache miss; a repeated name or another value for `enrich` is refused for the same reason, and so is any other raw spelling of an accepted query (`%65nrich=true`, a trailing `&`, a bare `?`): the raw query must equal its canonical serialization. Overlay options (`poll`, `lang`, `transparent`, ...) belong to the overlay page URL, never to these calls.
- Random valid UUIDs in the path also miss the CDN; the limiter is the control for that.
- The limiter fails open: a limiter outage (it is a Postgres RPC on Vercel) lets requests through rather than blacking out a live broadcast. The query refusal protects the database either way.
- A request without a client IP (a local run, the capture harness) is not limited on the in-memory store.
- `Cache-Control` of the 200 responses is unchanged (state 2 s, or 5 s with `enrich=true`; preview 30 s; standings 60 s; solo 2 s).

### Client behaviour under a limit
Polling overlays run on `usePollLoop` (`poll-loop.ts`, schedule in `poll-schedule.ts`): ticks chain on `setTimeout`, a failed poll doubles the wait up to 30 s (never below the caster's `?poll=`), and a `429`'s `Retry-After` is honoured (at most 120 s). The overlay keeps its last good data and returns to the normal interval after the first good answer. One-shot overlays (preview, results, story, moments, team comparison) fetch once and are not affected.

## Overlay pages (`src/app/(broadcast)`)

**Transparency guarantee.** `<html>` and `<body>` are transparent on every overlay URL with no caster CSS: `(broadcast)/layout.tsx` renders `html,body{background:transparent!important}` as a server-rendered `<style>` (`BROADCAST_TRANSPARENCY_CSS`). It is in the first HTML, so it needs no JavaScript and no `:has()` (OBS builds older than Chromium 105 have none), and it holds while the page loads or fails. `!important` beats the site palette script's inline style on `<html>`. Site pages do not carry the rule.

- `loading.tsx` and `not-found.tsx` render nothing; `error.tsx` renders nothing, logs the error, and calls `reset()` on a back-off of 2 s doubling to 30 s (`src/lib/broadcast/error-retry.ts`), so an overlay that threw recovers on its own once its data is valid. It never shows `error.message`.
- Only the wiki overlays (`/broadcast/wiki/{moves,items,abilities,tera}/...`) answer an unknown name with HTTP 404 and a minimal transparent HTML document (`src/proxy.ts`): the body is never empty, because Chromium, and so OBS's browser source, replaces a 4xx response with an empty body by its own opaque white "HTTP ERROR 404" page. The document has no text, link or script. An unknown match, league or solo id renders the transparent shell with HTTP 200: checking existence would cost a query on every load. A URL outside the overlay tree (`/broadcast/nonsense`) is served by the root not-found page.
- `SiteExtras` (root layout) skips the service worker registrar, the palette guard and Vercel Analytics under `/broadcast`: an OBS browser source is a viewerless embed.
- Frame protections stay: `/broadcast/*` is sent with `X-Frame-Options: DENY` and `frame-ancestors 'none'`. A browser source is a top-level page, not a frame, so OBS is unaffected; embedding an overlay in a page is intentionally not supported.

## Overlay Types (url-builder.ts)
- **Match**: preview, live, results, story, teams, h2h, moments
- **League**: standings, attract, recap, usage_chart
- **Draft**: live, pick, replay
- **Player**: spotlight
- **Wiki** (Phase 9): move, item, ability, pokemon, tera
- **Solo** (Phase 9): ko-stats

## Usage Examples

```typescript
import { createInitialState, trackerReducer } from '@/lib/broadcast/tracker-reducer';

const next = trackerReducer(createInitialState(match), action);
```

## Testing
- **Test Files**: No dedicated broadcast unit test file currently
- **Testing Approach**: Overlay integration + route validation

## Related Modules
- [Match Module](./match.md)
- [Draft Module](./draft.md)
- [Supabase Module](./supabase.md)
- [Cast Studio Module](./cast-studio.md) — extended tracker reducer, cast sessions
- [Wiki Module](./wiki.md) — wiki overlay types
