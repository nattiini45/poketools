# Point-Buy Workbook Format

> How a league workbook maps onto `epb.workbook` in a [format pack](./format-packs.md), with the example pack's layout. The importers (`src/lib/import/`) are public mechanics; the sheet names, column positions, header spellings and labels are pack data.

## Overview

A league keeps its Evolution Point Buy list in an `.xlsx` workbook. Three readers consume it:

| Reader | Pack section | Used by |
|---|---|---|
| Point-buy list (`src/lib/import/point-buy-xlsx.ts`) | `epb.workbook.pointBuy` | Admin import panel, `scripts/import-point-buy.ts` |
| Utility sheet (`src/lib/import/utility-sheet-xlsx.ts`) | `epb.workbook.utilitySheet` | The reconciliation report only (`scripts/draft/reconcile-point-buy.ts`); the draft's utility categories come from `epb.utility` and the Gen 9 learnsets |
| Team roles (`src/lib/import/team-roles-xlsx.ts`) | `epb.workbook.teamRoles` | Admin import panel, `scripts/import-team-roles.ts` |

All column indices are **0-based** (column A = 0). The XLSX reader is zero-dependency (`src/lib/import/xlsx.ts`). The example values below are in `src/format-packs/example/workbook.ts`.

## Point-buy list (`pointBuy`)

| Key | Meaning | Example |
|---|---|---|
| `sheet` | The list sheet | `Lines` |
| `defaultListName` | The list name an import uses when none is given (admin import panel, `--name` of `scripts/import-point-buy.ts`) | `Example Point Buy` |
| `overviewSheet` | Optional summary sheet with the organiser's checksums (`null` = none) | `Summary` |
| `rulesSheet` | Optional rules sheet; its rows go to the reconciliation report (`null` = none) | `Rules` |
| `columns` | Column index of every field (below) | |
| `skipStartNames` | Lower-cased start-column values that mark a header or section row; such rows are skipped | `start`, `base`, `group` |
| `priceGroupSpellings` | Lower-cased sheet spelling → stored `PriceGroup` | `top` → `premium`, `upper` → `hoch`, `middle` → `mittel`, `lower` → `guenstig`, `bargain` → `budget` |
| `overviewGroupLabels` | Summary-sheet label of each group's line count | `Top`, `Upper`, `Middle`, `Lower`, `Bargain` |
| `overviewLabels` | Summary-sheet labels of the total line count and the average price | `Line count`, `Average price` |

Example column layout of the `Lines` sheet:

| Col | Index | Field (`columns` key) | Stored as |
|---|---|---|---|
| A | 0 | `lineNumber` | `line_number` |
| B | 1 | `evolutionLine` (`A → B → C`) | `stage2_pokemon`, `stage3_pokemon`, `species_ids` |
| C | 2 | `startName` | `base_pokemon` |
| D | 3 | `price` | `price` |
| E | 4 | `priceGroup` (a `priceGroupSpellings` key) | `price_group` |
| F | 5 | `killsToStage2` | `kills_to_stage2` |
| G | 6 | `additionalKillsToStage3` | `additional_kills_to_stage3` |
| H | 7 | `legacyTier` | `legacy_tier` |
| I–K | 8–10 | `early`, `mid`, `late` (ratings 0–10) | `early_rating`, `mid_rating`, `late_rating` |
| L | 11 | `rationale` | `rationale` |
| M | 12 | `historical` | `historical_data` |
| N | 13 | `specialRulesText` | `special_rules_text` |
| O | 14 | `sources` | `sources` |

Rules the importer applies (mechanics, the same for every pack):

- **Price group.** The `priceGroup` cell is mapped through `priceGroupSpellings`. When the cell is empty or unknown, `priceGroupForPrice(price)` derives the group from `epb.priceGroups`.
- **Special-rule flags** come from the pack, not from the sheet: `storedSpecialRulesForBase(base)` turns the `epb.lineRules` entry of the base into the stored `special_rules` flags (`STORED_FLAG`, [Format Packs](./format-packs.md#stored-names-stay)). A rule with `expectedThresholds` adds a warning when the sheet's thresholds differ.
- **Counts are derived** from the parsed rows. When `overviewSheet` is set, the line count, the per-group counts and the average price on that sheet are compared with the derived values; a mismatch is a warning, and the derived value wins.
- **Rules sheet.** When `rulesSheet` is set, its rows are kept as strings for the reconciliation report, where the pack's optional `epb.reconciliation.ruleChecks` hook turns them into league-specific notes.

## Utility sheet (`utilitySheet`)

Used only by the reconciliation report, which compares the league's utility sheet with the pack's `epb.utility` categories.

| Key | Meaning | Example |
|---|---|---|
| `sheet` | The sheet name | `Utility` |
| `categories` | The block headings, in sheet order; the first one also locates the header row | `Hazards`, `Hazard Control`, `Recovery`, `Pivoting`, `Priority` |
| `branchMarkers` | Species labels that select one branch of a branched base | `Pikachu (A)` → the `Pichu → Raichu-Alola` line |
| `typos` | Labels with no exact match: reported, never applied | none |
| `exact` | Whole-label renames | none |
| `moveRenames` | Sheet move label → `@pkmn` move name | `U-Turn` → `U-turn` |

Each block is a species column with its move in the next column, headed by its category in the header row.

## Team roles (`teamRoles`)

| Key | Meaning |
|---|---|
| `sheets` | The two role-table sheets the importer reads, in order; the import panel names them. Example: `Roles A`, `Roles B`. |
| `categoryLabels` | Lower-cased sheet heading → stored `TeamRoleCategory` (`hazard_setting`, `hazard_removal`, `healing_cleric`, `momentum`, `item_removal`, `status`, `priority`, `disruption`; the DB CHECK vocabulary, public). |
| `blocks` | One block per category: its heading, its category, and its species and move columns. The header row is the row whose first cell is the first block's heading. |

Example blocks: `Hazards` (columns 0/1), `Hazard control` (2/3), `Healing` (4/5), `Pivoting` (6/7), `Item removal` (8/9), `Status` (10/11), `Priority` (12/13), `Disruption` (14/15).

Species and moves resolve against NatDex Gen 9 (`@pkmn/data`); unknown names are reported and kept, never dropped.

## Related Modules

- [Format Packs](./format-packs.md)
- [Import](./import.md)
- [Data Import Guide](./DATA_IMPORT_GUIDE.md)
- [Evolution Point Buy](./evolution-point-buy.md)
