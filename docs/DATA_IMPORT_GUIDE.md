# DATA_IMPORT_GUIDE — Evolution Point Buy

## Source of truth

The league's workbooks are **not in the repository**. The league organiser supplies them privately; keep a local copy outside the repository and pass its path with `--xlsx`.

| Workbook | Contents |
|----------|----------|
| Point-buy workbook | The point-buy list sheet, plus an optional summary (checksum) sheet and rules sheet |
| Team-roles workbook | The matchup role tables |

The sheet names, column positions, header spellings and summary labels are not hard-coded: they come from the active [format pack](./format-packs.md)'s `epb.workbook`. [Point-Buy Workbook Format](./point-buy-format.md) documents every key with the example pack's layout.

HTML exports and zip files of the workbooks are **not** authoritative. The import scripts exit with an error when the workbook is missing.

## Fixtures

The committed list fixtures are synthetic and follow the example pack:

- `src/lib/draft/__tests__/fixtures/example-list.json` (importer-row shape);
- `src/app/(public)/draft-preview/fixture-lines.example.json` (read-layer shape, example overrides applied).

`npx tsx --tsconfig tsconfig.json scripts/draft/make-example-list-fixtures.ts` regenerates both from a fixed seed (no database, no network). Stage names and species ids are @pkmn data; prices, thresholds, ratings and texts are not a real list. `scripts/draft/dump-list-fixture.ts` and `scripts/draft-preview/make-fixture-lines.ts` read a private workbook; do not commit their output.

## Point-buy list

The importer (`src/lib/import/point-buy-xlsx.ts`) reads the sheet and columns named in `epb.workbook.pointBuy`:

- Each row becomes one `point_buy_list_entries` row: line number, base and evolution line, price and price group, the two kill thresholds, the legacy tier, the early / mid / late ratings (0–10 smallint), and the rationale, historical data, special-rule text and sources prose. A total-kills column, if the sheet has one, is derived and not stored.
- The price group cell is mapped through `priceGroupSpellings`; an empty or unknown cell falls back to the pack's `epb.priceGroups` ranges.
- Special-rule flags (`special_rules` jsonb: `cosmog`, `no_redraft`, `scatterbug`, `no_cocoon_rule`) come from the pack's `epb.lineRules` for the row's base name, never from the sheet text. A rule with `expectedThresholds` warns when the sheet disagrees.
- Counts are derived from the parsed rows. When the pack names a summary sheet, its line count, per-group counts and average price are compared; mismatches are warnings and the derived value wins.

## Team roles

The team-roles importer (`src/lib/import/team-roles-xlsx.ts`) reads the sheets named in `epb.workbook.teamRoles.sheets` and, in each, the column blocks in `epb.workbook.teamRoles.blocks` (one species column and one move column per category) under the header row whose first cell is the first block's heading. Categories map to the stored `TeamRoleCategory` vocabulary (`hazard_setting`, `hazard_removal`, `healing_cleric`, `momentum`, `item_removal`, `status`, `priority`, `disruption`) through `categoryLabels`.

Species/moves are resolved via `@pkmn/data`. Unknowns are reported and kept (never silently dropped). Format bans are filtered at evaluation time, not import time.

## Zero-dependency reader

`scripts/lib/xlsx.ts` / `src/lib/import/xlsx.ts` reads OOXML via zip central directory + shared strings. No `xlsx`/`exceljs` package.

## Idempotency

- Point-buy: upsert by `(list_version_id, line_number)`; refuse writes when version is bound to a non-upcoming season.
- Team roles: upsert by `(species_form, category, move_name)`.
