# PokéTools — CLAUDE.md

> Claude Code wrapper. **[`AGENTS.md`](./AGENTS.md) is the canonical instruction file** — it owns the hard rules, security requirements, Pokémon data rules, key file locations, completion gate, escalation, and coordination policy. Read it before making any change.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (port 3000) |
| `npm run build` | Production build (includes type-check) |
| `npm run lint` | ESLint `src/` |
| `npm run test` | Vitest (single run) |
| `npm run test:watch` | Vitest (watch mode) |

## Claude Code specifics

- **Ownership:** Claude Code owns architecture, schema decisions, ambiguity resolution, security review, and this file. Codex owns implementation within the approved spec. When agents disagree, `docs/poketools-spec.md` wins; when the spec is silent, escalate to the human.
- **Nested instructions:** when working under `src/app/`, `src/components/`, or `src/lib/`, read that directory's nested `AGENTS.md` — Claude Code does not auto-load them.
- **Launch config:** `.claude/launch.json` starts `next dev` on port 3000.

## Deeper context (load on demand)

- 3D route-world maintainer tooling (fidelity harness, handoffs, design specs) lives in a private overlay; a public checkout does not need it.

- Security patterns (OWASP, error-handling, input validation): [`docs/security-patterns.md`](./docs/security-patterns.md)
- League tuning (format packs, the private overlay): [`docs/format-packs.md`](./docs/format-packs.md)
- Dependency gotchas: [`docs/dependencies.md`](./docs/dependencies.md)
- External review / CI remediation loop: [`docs/review-remediation.md`](./docs/review-remediation.md)
- Module catalog: [`docs/modules-index.md`](./docs/modules-index.md)
- System architecture: [`docs/poketools-spec.md`](./docs/poketools-spec.md) (canonical) and [`openwiki/architecture/overview.md`](./openwiki/architecture/overview.md) (navigable summary)
