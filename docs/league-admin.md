# League admin (workspace logic)

The pure, client-safe logic behind the league admin workspace (`/admin/leagues/[id]?tab=`) and the new-competition wizard: the tab model, the attention list, the header's one primary action, the phase controls' rules, the settings form's save payload, the unsaved-input guard, the clone-source helpers, the format rules form model and the season-delete description. The components live in `src/components/league/`; the routes they call are under `/api/seasons/`. See [Admin](./admin.md) for the console at large.

## File Structure

```
src/lib/league-admin/
├── tabs.ts                   # The seven workspace tabs; the active tab lives in the URL (?tab=)
├── attention.ts              # What a league needs from its admin, decided from the league row alone (no read)
├── primary-action.ts         # The one primary action in the header, from the season machine's legal admin moves
├── phase-controls.ts         # Rules of the phase screens: group counts, the re-draw confirm gate, insert positions
├── settings-patch.ts         # The settings form's save payload: only the fields the admin changed
├── form-dirty.ts             # One pure predicate per form: does it hold input that is not saved yet
├── unsaved.ts                # unsavedMarker() + UnsavedTabGuard: warn before a tab switch discards input
├── clone-source.ts           # "Start from an existing league" options of the create page
├── wizard.ts                 # The new-competition wizard (/admin/leagues/new): one POST /api/seasons request
├── format-rules-form.ts      # The Rules tab's form model of format_rules, mirroring the PUT route's schema
└── season-delete.ts          # What deleting a league does to the rows around it (the Danger tab's list)
```

## Core Functions/Classes

- **`primary-action.ts`** — the header's primary action is decided from the league row the page already holds and from `seasonMachine.transitionsFrom` — never from a status list of its own — and costs no read.
- **`attention.ts`** — the Overview tab's attention list: what is missing before the league can run, and whether it is archived. Waiting matches and open checks are deliberately not here; they are on the Phases and Live tabs.
- **`phase-controls.ts`** — the insert position rules mirror `POST /api/seasons/[id]/phases`: `insert_at` runs from 1 to the highest stage order + 1, and a position in front of a phase that already started is refused.
- **`settings-patch.ts`** — the form leaves out what the PATCH route would refuse (the league type once started, the battle ruleset of a point-buy league) instead of relying on the refusal.
- **`form-dirty.ts` / `unsaved.ts`** — every tab is a link, so a tab switch unmounts the open panel's forms. A form with unsaved input marks itself `data-unsaved="true"`; while any element inside the panel carries the marker, `UnsavedTabGuard` confirms the switch.
- **`season-delete.ts`** — a delete is never refused for what the league still holds: it moves to the recycle bin for `LEAGUE_TRASH_RETENTION_DAYS` ([Season](./season.md), league recycle bin). `SEASON_DELETE_KEPT` mirrors the trash inventory's `kept` class — the append-only logs and the global rebuild-lock singleton — and a test pins them equal.

## Testing

- **Test Files — `src/lib/league-admin/`**: `src/lib/league-admin/__tests__/` (12 test files): `attention.test.ts`, `clone-source.test.ts`, `created-href.test.ts`, `form-dirty.test.ts`, `format-rules-form.test.ts`, `phase-controls.test.ts`, `primary-action.test.ts`, `season-delete.test.ts`, `settings-patch.test.ts`, `tabs.test.ts`, `unsaved.test.ts`, `wizard.test.ts`.
- **Running Tests**: `npx vitest run src/lib/league-admin/__tests__`

## Related Modules

- [Admin](./admin.md) — the console and the route guards.
- [Season](./season.md) — the league lifecycle, the machine and the recycle bin.
- [League phase](./league-phase.md) — the phases the phase controls manage.
