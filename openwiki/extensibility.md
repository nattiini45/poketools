# Extensibility & Deprecations

> Feature flags, the deprecation registry, and guidance for adding new modules.

## Feature Flags

**Docs:** `docs/feature-flags.md`

Runtime gates defined in `src/lib/feature-flags.ts`. All flags are `NEXT_PUBLIC_*` (client-readable).

| Flag | Default | Controls |
|---|---|---|
| `NEXT_PUBLIC_AGENT_POST_MATCH` | `false` | Routes post-match analysis through AI agent |
| `NEXT_PUBLIC_AGENT_MATCH_ANALYSIS` | `false` | Routes scouting card through AI agent |
| `NEXT_PUBLIC_ENABLE_KALE_CABBAGE` | `false` | Legacy Kale report testing |
| `NEXT_PUBLIC_PWA_ENABLED` | — | PWA installable shell |
| `NEXT_PUBLIC_PWA_CACHE_LEVEL` | — | Service worker cache aggressiveness |

### Feature flag pattern
```typescript
// src/lib/feature-flags.ts
export function isAgentPostMatchEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_POST_MATCH === 'true';
}
```

Use in API routes and components to gate new behavior. Always keep legacy paths as rollback until the flag default flips and hard-removal is approved.

## Deprecation Registry

**Docs:** `docs/deprecations.md`

### Active deprecations

| Item | Status | Replacement | Notes |
|---|---|---|---|
| Kale Cabbage | Soft-deprecated | Standard AI module paths | Keep `@ai-sdk/openai` + `src/lib/ai/kale/*` until hard-removal approved |
| Legacy AI (single-shot) | Active, agent alongside | AI Agent (`/api/ai/agent/*`) | Each legacy route has an agent counterpart gated by feature flags. Do not remove until flags default to agent. |
| Teambuilder V1 + V2 | Deleted | V3 (`TeamsEditor.tsx`) | Hard cutover; no fallback |
| Teambuilder v3 superseded components | Deleted | New picker/workspace components | See deprecations.md for full mapping |
| Tournament groups write path | Deleted (2026-07-08) | — | Zero callers; `GET` read path remains |
| Discord Bot | Deferred | — | Webhook fan-out only; future bot needs explicit design |

### Deprecation process
1. Mark as soft-deprecated in `docs/deprecations.md`
2. Add feature flag pointing to the replacement
3. Keep old code paths functional as rollback
4. Flip flag default when replacement is stable
5. Remove old code after hard-removal task approval

## Adding a New Module

### Steps
1. Create business logic in `src/lib/<module>/`
2. Create query functions in `src/lib/supabase/queries/<module>.ts`
3. Create API routes in `src/app/api/<module>/`
4. Create components in `src/components/<module>/`
5. Add types in `src/types/`
6. Write tests in `src/lib/<module>/__tests__/`
7. Create module doc in `docs/<module>.md` using `docs/module-documentation-template.md`
8. Add entry to `docs/modules-index.md`
9. Update `docs/poketools-spec.md` if it affects routes, schemas, or data flows

### Module documentation template

Each module doc follows this structure (from `docs/module-documentation-template.md`):
1. **Overview** — What the module does and why it exists
2. **File Structure** — Directory listing with file purposes
3. **Core Functions/Classes** — Key exports with signatures and behavior
4. **Data Flows** — Input → Processing → Output
5. **Dependencies** — External libraries and internal module links
6. **API Routes** — Endpoints with auth requirements
7. **Usage Examples** — Code snippets
8. **Testing** — Test file locations and what they cover
9. **Related Modules** — Cross-references

### Adding a new API route

Follow the established pattern:
```typescript
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const player = await requirePlayer();
    const body = await request.json();
    // validate input
    // business logic
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to do X');
  }
}
```

### Adding a database table
1. Create migration in `supabase/migrations/` with timestamp prefix
2. Include RLS policies (permissive for service role)
3. Regenerate `src/types/database.ts`
4. Create query module in `src/lib/supabase/queries/`

### Adding a new AI persona
1. Create prompt file in `src/lib/ai/agent/prompts/`
2. Register persona in `src/lib/ai/agent/personas.ts`
3. Define tools in `src/lib/ai/agent/tools/`
4. Add API route in `src/app/api/ai/agent/`
5. Document in `docs/ai-agent.md`

## Archived Documentation

Completed plans, postmortems and exploratory docs are no longer kept in the repository. Current guidance lives in `AGENTS.md`, `docs/poketools-spec.md` and the module docs listed in `docs/modules-index.md`.
