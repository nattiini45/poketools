# Utils Module

## Overview
The Utils module contains shared browser/server utility helpers used across feature modules.

## File Structure
```
src/lib/utils/
├── capture-node.ts  # DOM node capture to data URL
├── cn.ts  # cn(): clsx + tailwind-merge class joiner
├── crypto.ts  # timingSafeCompare, secretsEqual (length-independent) + HMAC-signed expiring link tokens
├── csv.ts  # parseCsv / recordsToCsv
├── rate-limit.ts  # fixed-window checkRateLimit (Postgres rate_limit_hit RPC or in-process, RATE_LIMIT_STORE), getClientIp, checkPublicRateLimit (per-IP limit of a public route; a local run without an address header is not throttled), 429 helper
├── hidden-text.ts  # Invisible-character matcher (bidi, zero-width, Unicode tag characters) shared by the Admin Assistant fences
├── node-image.ts  # Cross-origin image proxying shared by both exporters
├── uuid.ts  # UUID assertion helpers
├── lru-cache.ts  # Shared in-memory LRU cache with TTL expiry
└── __tests__/  # crypto, csv, lru-cache, node-image, rate-limit and uuid tests
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

### Node Image Proxy
- **File**: `node-image.ts`
- **Purpose**: The cross-origin `<img>` handling of `capture-node.ts`: swap each image for a data URL fetched through `/api/proxy-image` so the canvas is not tainted, then put `src` and `srcset` back
- **Key Methods**: `toDataUrl()`, `proxyCrossOriginImages(node, { onFailure: 'keep' | 'transparent' })` (`capture-node` keeps the original source of an image the proxy cannot fetch, `export-node` swaps in a transparent pixel), `restoreImages()`

### LRU Cache
- **File**: `lru-cache.ts`
- **Purpose**: Shared in-memory LRU cache with TTL expiry, so per-module caches (AI agent `pkmn` / `smogon` / `execute` tools) don't each re-implement the same Map-based LRU. Recency is refreshed on read (Map re-insertion moves an entry to newest); eviction removes the oldest insertion-order key once `maxEntries` is reached.
- **Constructor**: `new LruCache(opts: LruCacheOptions)` where `LruCacheOptions = { ttlMs: number; maxEntries: number }` — callers pass their module's own `CACHE_TTL_MS` / `CACHE_MAX_ENTRIES` budget.
- **Key Methods**:
  - `get<T>(key: string): T | undefined` — returns the cached value, or `undefined` on a miss or expired entry.
  - `getEntry<T>(key: string): { value: T } | undefined` — like `get()`, but wraps the hit in `{ value }` so a cached `undefined` stays distinguishable from a genuine miss. Use this whenever the cached type is `unknown` or may legitimately be `undefined`; `get()` cannot make that distinction since both cases return `undefined`. Used by the AI agent tool executor (`src/lib/ai/agent/tools/execute.ts`) for its tool-result cache.
  - `set(key: string, value: unknown): void` — stores a value, evicting the oldest entry first if at `maxEntries`.
  - `clear(): void` — empties the cache.

### Hidden Text
- **File**: `hidden-text.ts`
- **Purpose**: One definition of the characters a reader cannot see but a model reads (bidi marks, zero-width characters, Unicode tag characters, blank fillers), so every place that strips, counts or refuses them agrees. Pure and dependency-free.
- **Key Methods**: `hasHiddenChars()`, `stripHiddenChars()`, `countHiddenChars()`, `HIDDEN_CLASS_BODY`. Its callers are in the Admin Assistant (`src/lib/ai/admin-agent/`, [ai-agent.md](./ai-agent.md)).

### Dates and numbers
Dates and numbers render through the formatter of [`i18n.md`](./i18n.md) (`src/i18n/format.ts`, `useFormatter()`, `<LocalTime>`); `src/lib/utils` holds no date helpers.

## Data Flows
- **Input**: DOM node references/IDs, image URLs, IDs
- **Processing**:
  1. Validate/normalize inputs
  2. Proxy cross-origin images when needed
  3. Render/capture output image payload
- **Output**: Validated IDs and image export artifacts

## Dependencies
- **External Libraries**: `html-to-image`, `clsx`, `tailwind-merge`
- **Internal Modules**: Consumed by UI and broadcast/export features

## API Routes
- `/api/proxy-image` (used by capture/export helpers)

## Usage Examples

```typescript
import { assertValidUuid } from '@/lib/utils/uuid';

assertValidUuid(tournamentId, 'Tournament ID');
```

## Testing
- **Test Files**: `src/lib/utils/__tests__/lru-cache.test.ts` (get/set/clear, TTL expiry, LRU eviction, and `getEntry()`'s cached-undefined-vs-miss distinction), `crypto.test.ts`, `csv.test.ts`, `node-image.test.ts`, `rate-limit.test.ts` and `uuid.test.ts` in the same directory
- **Testing Approach**: Unit tests for the cache, crypto, CSV, rate-limit, UUID and image-proxy helpers; `cn.ts`, `hidden-text.ts` (covered through the Admin Assistant fence tests) and the two exporters rely on feature integration testing

## Related Modules
- Used by multiple feature modules across `src/lib` and `src/components`
