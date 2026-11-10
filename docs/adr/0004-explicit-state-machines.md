---
status: accepted
date: 2026-11-09
---

# Explicit state machines: one typed definition per machine, enforced at the write

Matches had the only explicit state machine (`src/lib/tournament/match-state.ts`, spec Section 8). Seasons, tournaments, rounds, draft pools and slots, the format runtime, challenges, submissions, checks, cast sessions, wiki moderation, aggregate jobs, the league recycle bin and several client flows also move through states, but their legal moves lived only in scattered `.update({ status })` calls, WHERE clauses inside SQL functions, and the UI's own guesses about which button to show. Nothing listed the moves, so a new route could write any value from any state, two writers could race a row backwards, and an agent had no single file to read before touching one.

We decided that every such machine is defined once, as data, with `defineMachine` (`src/lib/state-machine/machine.ts`), in a client-safe module next to its domain (`src/lib/<domain>/<name>-state.ts`, or the domain's existing state file). A definition names the states, the initial and terminal states, the actors, and each transition with its event, its actors and its writers. From it:

- **Writers** call `assertTransition(from, to, actor)` and guard the UPDATE with the current state (`.eq(column, from)` or `.in(column, machine.sourcesOf(to))`), so a refused move is a catalogued `IllegalTransitionError` (409, or 403 for the wrong actor) and a row that moved on in between is never overwritten. Where the write already happens inside a SQL function, the function keeps its own WHERE guard, the definition lists it as a writer (`path#function`), and a test pins the two together.
- **UI** derives the actions it offers from `transitionsFrom(state, actor)`, and shows refusals through the catalog codes (`state_transition_invalid` / `state_transition_forbidden` in `errors/common`, or the domain's own codes).
- **Docs**: `docs/state-machines.md` is generated from the registry (`src/lib/state-machine/registry.ts`, `npm run docs:state-machines`) with a mermaid diagram and a transition table per machine; a test fails when it is stale, and another checks each definition's structure and that every writer it names exists.

Each machine is converted in its own change: characterization tests pin today's legal moves first, and the only behaviour change allowed is refusing a move that no legitimate flow performs.

## Considered options

- **XState** (or another statechart library): rejected. Our state lives in Postgres rows written by stateless request handlers and SQL functions; what we need is a transition table and a compare-and-set write, not an in-memory interpreter. It would add a dependency and client bundle weight, and its machines cannot be read by the SQL side either.
- **Database-only enforcement** (CHECK constraints or a transition trigger per column): rejected as the default. A trigger cannot tell an admin from a player or a cron, its refusals reach the client as opaque Postgres errors instead of catalog codes, and it is invisible to UI code that must decide which action to show. A trigger stays an option for one machine when its writes happen only in SQL and an app-level check cannot see them; that is its own schema change.
- **Per-machine ad-hoc functions** in the shape of `match-state.ts` without a shared helper: rejected. Each machine would re-invent the lookup, the error, the docs and the tests, and nothing would list the machines.

## Consequences

- AGENTS.md hard rule "Transitions go through the machine" covers every machine in the registry, not only matches.
- `match-state.ts` keeps its enforced tables; `matchMachine` describes the same moves as data, and a parity test holds them equal.
- A new status column, or a new value in an existing one, comes with its definition and a regenerated `docs/state-machines.md` in the same change.
