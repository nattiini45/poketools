# Dev seed

The local-development seed (`npm run dev:seed`): a sign-in-able admin, the standard rulesets and one small league, so a fresh local stack has something to look at without Discord. Idempotent: every step looks for what it would create first, so a re-run tops up instead of duplicating. Server only; `scripts/dev-seed-run.ts` owns the loopback guard and the env. The visual-capture seed builds on it ([Visual harness](./visual-harness.md)).

## File Structure

```
src/lib/dev-seed/
├── seed.ts         # The seed itself: admin, rulesets, one small league; works through the service-role client it is given
└── constants.ts    # What the seed creates, by name — dependency-free so the seed, its runner and Playwright all import it
```

## Core Functions/Classes

- **`seed.ts`** — never reads env itself: it works through the service-role client the import graph hands it, and the runner owns the loopback-only guard (the seed must never reach a hosted project). On a phase-mode local stack the league it creates is an active phase league (participants, rounds, matches), so the dev pages render real data.
- **`constants.ts`** — names the seeded entities (the admin's email, the league name, the ruleset names) in one dependency-free module, because the seed, its runner and the Playwright suite (`e2e/`) all import it and none of them can load the others' server-only modules.

## Testing

- **Test Files — `src/lib/dev-seed/`**: `src/lib/dev-seed/__tests__/` (1 test file): `seed.local.test.ts` — real-DB, opt-in through the shared local-stack gate (`npm run test:db`).
- **Running Tests**: `npx vitest run src/lib/dev-seed/__tests__` against a local stack.

## Related Modules

- [Visual harness](./visual-harness.md) — the deterministic capture seed that runs the dev seed first.
- [Supabase environments](./supabase-environments.md) — the local stack the seed targets.
