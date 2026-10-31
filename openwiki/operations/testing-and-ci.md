# Testing & CI

> Test structure, CI pipeline, coverage expectations, and the safe-error-response enforcement guard.

## Test Framework

**Framework:** Vitest (v4+)

**Commands:**
| Command | Purpose |
|---|---|
| `npm test` | Single run |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report (V8 provider) |

Vitest seeds dummy Supabase env vars when unset, so unit tests don't require real secrets.

## Test File Locations

Tests live in `__tests__/` directories adjacent to the modules they cover:

```
src/lib/tournament/__tests__/*.test.ts       # Tournament engines, match state
src/lib/rating/__tests__/glicko2.test.ts     # Glicko-2 math
src/lib/rating/__tests__/tiers.test.ts       # Rating tier classifier
src/lib/draft/__tests__/engine.test.ts       # Draft state/pick validation
src/lib/broadcast/__tests__/tracker-reducer.test.ts  # Overlay state
src/lib/team/__tests__/visibility.test.ts    # Team visibility/redaction
src/lib/auth/__tests__/helpers.test.ts       # Auth helpers
src/lib/pkmn/__tests__/*.test.ts             # Dex legality, speed calc, replay frames
src/lib/stats/__tests__/usage-rows.test.ts   # Usage row computation
src/lib/insights/__tests__/scope.test.ts     # Scope parsing
src/lib/ai/agent/__tests__/*.test.ts         # Agent orchestrator, context pack, tools
src/lib/ai/__tests__/*.test.ts               # Legacy AI, league context, scouting parse
src/lib/supabase/queries/__tests__/*.test.ts # Query module tests
src/lib/api/__tests__/*.test.ts              # Error response, pagination
src/lib/utils/__tests__/*.test.ts            # LRU cache, date helpers
src/lib/validation/__tests__/*.test.ts       # Input validation
src/lib/season/__tests__/*.test.ts           # Core assignment
src/lib/social/__tests__/*.test.ts           # Social crypto
src/lib/smogon/__tests__/*.test.ts           # Format registry, import stats/sets
src/app/(public)/replays/__tests__/*.test.ts # Replay library utils
src/app/api/**/ __tests__/*.test.ts          # API route tests
scripts/__tests__/safe-error-scan.test.mjs   # CI guard self-test
```

## Key Test Suites

| Module | Focus |
|---|---|
| Rating / Glicko-2 | `glicko2Update`, `expectedScore`, `inflateRD` — pure math |
| Rating / Tiers | `getRatingTier` — Poké/Great/Ultra/Master bands, provisional rule, Master RD gate |
| Draft Engine | Snake order, pick validation, draft state, completion |
| Broadcast Tracker | Reducer actions, undo, game submit/reset, payload builder |
| Team Visibility | `canViewTeamPokemon`, `filterTeamVisibility` (Spec §7) |
| Auth Helpers | `requireAuth`, `requireAdmin`, `requireCreator`, sync checks |
| Tournament Engine | Match state transitions, standings, Swiss/RR/SE/DE pairing |
| PKMN Utilities | Dex legality, speed calc, replay frame extraction |
| Stats / Usage | `aggregatesToUsageRows`, `metaUsageToUsageRows` |
| Insights / Scope | `parseScopeFromSearchParams`, `scopeAggregateKey` |
| Agent Orchestrator | Tool dispatch, context pack, memory, model fallback |
| API / Pagination | `parsePagination` — limit clamp, default fallback |
| Utils / LruCache | TTL expiry, LRU eviction, cached-undefined-vs-miss |
| CI Guard | `safe-error-scan` — per-return catch-block enforcement |

## CI Pipeline

**File:** `.github/workflows/ci.yml`

Runs on push to `main` and PRs targeting `main`. Concurrency: cancel in-progress runs for the same branch.

### Steps
1. **Checkout** and **Node setup** (Node.js 22, npm cache), then `npm ci`
2. **Security audit** — `npm audit --omit=dev --audit-level=high` (blocking, what ships), then the same over all dependencies (report only)
3. **Lint** — `npm run lint` (`src/` and tracked `scripts/`)
4. **Safe error response guard** — `ENFORCE=1 node scripts/check-safe-error-response.mjs`
5. **Mojibake guard** — `ENFORCE=1 node scripts/check-mojibake.mjs`
6. **i18n hard-coded string check** — `ENFORCE=1 node scripts/check-i18n-strings.mjs --all`
7. **Type-check (example format pack)** — `npm run typecheck:example`
8. **Type-check & build** — `npm run build` with `FORMAT_PACK=example` and placeholder env vars
9. **Tests** — `npm test`
10. **Coverage** — `npm run test:coverage` (floors on `src/lib/**` and API route handlers; components and pages are report-only)

`npm run verify:ci` (`scripts/verify-ci.mjs`) runs the same steps locally, in a clean clone, with an allow-listed environment (what the toolchain needs: paths, home, temp dirs, npm cache, CA trust, proxies; PATH is still honoured) plus `CI=true` and `TZ=UTC`, so a project variable in your shell cannot change the result.

### CI Environment
Build and tests use placeholder env vars (`NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co`, etc.). Real secrets are never needed for CI, and CI never reaches a Supabase project.

## Safe Error Response Guard

**Files:** `scripts/check-safe-error-response.mjs`, `scripts/safe-error-scan.mjs`

Custom CI guard that scans all route handler files for catch blocks that return a `NextResponse` or `Response` without first calling `console.error` or `safeErrorResponse()`.

### What it enforces
- Every catch block that returns a response must log the error server-side first
- Prefers `safeErrorResponse()` over manual `console.error` + `NextResponse.json()`
- Escape hatch: `// safe-error-response-allow: <reason>` on the line before the return

### Running locally
```bash
# Check mode (advisory)
node scripts/check-safe-error-response.mjs

# Enforce mode (exits non-zero on violations)
ENFORCE=1 node scripts/check-safe-error-response.mjs
```

## Test Configuration

**File:** `vitest.config.ts`

- Uses `@vitejs/plugin-react`
- Coverage provider: V8
- Tests run against the `src/` directory
- Projects: `app` (all `src/**/__tests__`, always against the public example format pack), `scripts`, and `private-pack` (only when the private format pack is on disk and `FORMAT_PACK` is not `example`). CI runs plain `npm test` in a checkout without the private pack, which is the public view (`FORMAT_PACK=example npm test` gives the same set on a maintainer checkout). See `docs/format-packs.md`.

## Writing Tests

### API route tests
Use Next.js test helpers. Pattern:
```typescript
import { POST } from '../route';
import { createMockRequest } from '@/lib/test-helpers';

it('returns 401 without auth', async () => {
  const req = createMockRequest({ body: {} });
  const res = await POST(req);
  expect(res.status).toBe(401);
});
```

### Pure logic tests
Standard Vitest assertions against exported functions. No mocking needed for pure modules (Glicko-2, standings, match state).
