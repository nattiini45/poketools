# Utils Module

## Overview
The Utils module contains shared browser/server utility helpers used across feature modules.

## File Structure
```
src/lib/utils/
├── capture-node.ts  # DOM node capture to data URL
├── cn.ts  # cn(): clsx + tailwind-merge class joiner
├── crypto.ts  # timingSafeCompare + HMAC-signed expiring link tokens
├── csv.ts  # parseCsv / recordsToCsv
├── rate-limit.ts  # in-memory fixed-window checkRateLimit
├── export-node.ts  # DOM node export to PNG blob URL
├── uuid.ts  # UUID assertion helpers
├── lru-cache.ts  # Shared in-memory LRU cache with TTL expiry
└── date.ts  # Shared date/time formatting helpers
```

## Core Functions/Classes

### Class Names
- **File**: `cn.ts`
- **Purpose**: Join conditional class names and resolve conflicting Tailwind utilities (`twMerge(clsx(inputs))`), so a caller's `className` override wins over a component's default
- **Key Methods**: `cn(...inputs: ClassValue[]): string`

### UUID Validation
- **File**: `uuid.ts`
- **Purpose**: Guard UUID inputs before query construction
- **Key Methods**: `assertValidUuid()`

### Node Capture
- **File**: `capture-node.ts`
- **Purpose**: Capture node images via html-to-image
- **Key Methods**: `captureNodeAsDataUrl()`

### Node Export
- **File**: `export-node.ts`
- **Purpose**: Export nodes as PNG blob URLs via html2canvas
- **Key Methods**: `renderNodeAsPng()`

### LRU Cache
- **File**: `lru-cache.ts`
- **Purpose**: Shared in-memory LRU cache with TTL expiry, so per-module caches (AI agent `pkmn` / `smogon` / `execute` tools) don't each re-implement the same Map-based LRU. Recency is refreshed on read (Map re-insertion moves an entry to newest); eviction removes the oldest insertion-order key once `maxEntries` is reached.
- **Constructor**: `new LruCache(opts: LruCacheOptions)` where `LruCacheOptions = { ttlMs: number; maxEntries: number }` — callers pass their module's own `CACHE_TTL_MS` / `CACHE_MAX_ENTRIES` budget.
- **Key Methods**:
  - `get<T>(key: string): T | undefined` — returns the cached value, or `undefined` on a miss or expired entry.
  - `getEntry<T>(key: string): { value: T } | undefined` — like `get()`, but wraps the hit in `{ value }` so a cached `undefined` stays distinguishable from a genuine miss. Use this whenever the cached type is `unknown` or may legitimately be `undefined`; `get()` cannot make that distinction since both cases return `undefined`. Used by the AI agent tool executor (`src/lib/ai/agent/tools/execute.ts`) for its tool-result cache.
  - `set(key: string, value: unknown): void` — stores a value, evicting the oldest entry first if at `maxEntries`.
  - `clear(): void` — empties the cache.

### Date Formatting
- **File**: `date.ts`
- **Purpose**: Shared date/time formatting helpers, extracted from inline helpers that used to live in `MatchSchedulingPanel`, `DashboardContent`, `AuditLogBrowser`, `AdminDashboardContent`, and the public replays page, so the `Intl` options and null-handling contracts don't drift.
- **Key Methods**:
  - `formatDateTime(value: string | null, fallback = 'Not scheduled'): string` — "Mon D, H:MM AM/PM" (host locale); returns `fallback` for null/empty input.
  - `formatDateTimeOrNull(value: string | null): string | null` — delegates to `formatDateTime`, returning `null` instead of a fallback string when `value` is null/empty (`value ? formatDateTime(value) : null`), so callers can branch on the null return themselves.
  - `formatDate(value: string): string` — medium date + short time style (host locale); input is non-nullable.
  - `formatDateOnly(value: string): string` — "Mon D, YYYY" with a hardcoded `'en-US'` locale so server-rendered output (e.g. the replays table) stays stable across deploys/hydration.
  - `formatTimeAgo(dateStr: string, now: Date = new Date()): string` — relative time ("just now" / "Nm ago" / "Nh ago" / "Nd ago"); accepts an explicit `now` for deterministic server rendering/tests.

## Data Flows
- **Input**: DOM node references/IDs, image URLs, IDs
- **Processing**:
  1. Validate/normalize inputs
  2. Proxy cross-origin images when needed
  3. Render/capture output image payload
- **Output**: Validated IDs and image export artifacts

## Dependencies
- **External Libraries**: `html-to-image`, `html2canvas`, `clsx`, `tailwind-merge`
- **Internal Modules**: Consumed by UI and broadcast/export features

## API Routes
- `/api/proxy-image` (used by capture/export helpers)

## Usage Examples

```typescript
import { assertValidUuid } from '@/lib/utils/uuid';

assertValidUuid(tournamentId, 'Tournament ID');
```

## Testing
- **Test Files**: `src/lib/utils/__tests__/lru-cache.test.ts` (get/set/clear, TTL expiry, LRU eviction, and `getEntry()`'s cached-undefined-vs-miss distinction), `src/lib/utils/__tests__/date.test.ts` (`formatDateTime`, `formatDateTimeOrNull` delegation, `formatDate`, `formatDateOnly`, `formatTimeAgo`), plus `uuid.test.ts` and `crypto.test.ts` in the same directory
- **Testing Approach**: Unit tests for `lru-cache.ts` and `date.ts`; remaining helpers rely on feature integration testing

## Related Modules
- Used by multiple feature modules across `src/lib` and `src/components`
