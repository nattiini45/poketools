# Import Module

> Ingestion of external data — XLSX point-buy lists and team-role tables, Smogon sample sets/usage stats, and Showdown/pokepast team text — into the Supabase-backed store.

## Overview
The Import module covers two distinct flows: **admin XLSX imports** (Evolution Point Buy lists and team-role tables from the authoritative workbooks documented in [DATA_IMPORT_GUIDE](./DATA_IMPORT_GUIDE.md)) and **player team-text imports** (Showdown/Poképaste pastes). A second, Smogon-driven family of admin routes pulls sample sets and usage stats via `src/lib/smogon` (see [Smogon](./smogon.md)). All XLSX parsing is zero-dependency so the same code runs in API routes and CLI scripts.

## File Structure
```
src/lib/import/
├── xlsx.ts             # Zero-dependency OOXML (.xlsx) reader
├── xlsx-upload.ts      # Server-side upload validation helpers
├── point-buy-xlsx.ts   # EPB point-buy list parse + validate
└── team-roles-xlsx.ts  # Team-role table parse + validate (@pkmn/data)
```

## Core Functions/Classes

### XLSX reader — `src/lib/import/xlsx.ts`
- **Purpose**: Parse `.xlsx` (OOXML zip) with no external deps; shared strings, inline strings, numbers, booleans; no formula evaluation.
- **Key exports**: `readXlsx()`, `readXlsxBuffer()`, `getSheet()`, `cellString()`, `cellNumber()`, types `XlsxSheet`/`XlsxCellValue`.
- **Notes**: Zip-bomb guard (50 MB decompressed entry cap) and XML part cap (40 MB).

### Upload validation — `src/lib/import/xlsx-upload.ts`
- **Purpose**: Validate multipart `.xlsx` uploads (server-only).
- **Key exports**: `validateXlsxFile()`, `assertXlsxMagicBytes()`, `fileToBuffer()`, `MAX_XLSX_BYTES` (8 MB).

### Point-buy parsing — `src/lib/import/point-buy-xlsx.ts`
- **Purpose**: Parse and validate the point-buy list sheet plus the optional summary-sheet checksums. Sheet names, columns and labels come from the active format pack's `epb.workbook.pointBuy` ([Point-Buy Workbook Format](./point-buy-format.md)).
- **Key exports**: `parsePointBuySheets()`, `parsePointBuyXlsxBuffer()`, `validatePointBuyImport()`, `pointBuyEntriesToRows()`, `speciesIdFor()` (dex-backed species id, `foldId` fallback), types `ParsedPointBuyEntry`/`PointBuyImportReport`.
- **Notes**: Maps the sheet's price-group spelling → `PriceGroup` (`priceGroupSpellings`, else the pack's price ranges); writes the stored special-rule flags (`scatterbug`, `cosmog`, `no_redraft`, `no_cocoon_rule`) from the pack's `epb.lineRules` for each base name; derives the line count, group counts and average price from the rows and warns where the summary sheet differs; warns when a rule line's thresholds differ from its `expectedThresholds`.

### Team-role parsing — `src/lib/import/team-roles-xlsx.ts`
- **Purpose**: Parse the team-roles workbook's matchup role tables, resolve species/moves against NatDex Gen 9 (`@pkmn/data`), and dedupe.
- **Key exports**: `VALID_ROLE_CATEGORIES`, `parseTeamRolesSheets()`, `parseTeamRolesXlsxBuffer()`, `validateTeamRoleImport()`, type `TeamRoleImportReport`.
- **Notes**: 8 categories mapped from the column pairs in the pack's `epb.workbook.teamRoles.blocks`; unknown species/moves kept as-is with warnings.

## Data Flows
- **Point-buy import**: multipart `.xlsx` → `validateXlsxFile` → `fileToBuffer` → `assertXlsxMagicBytes` → `validatePointBuyImport` (parse + validate + checksums) → `pointBuyEntriesToRows` → `bulkCreateListEntries`; optionally `bindSeasonToList`.
- **Team-role import**: multipart `.xlsx` → upload validation → `validateTeamRoleImport` (resolve vs `@pkmn/data`, dedupe) → `bulkCreateRoles`.
- **Team-text import**: JSON body (`text` or `pokepast.es` URL) → `importTeamSchema` (Zod) → fetch pokepast `/raw` if URL → `parseTeamText` → optional `validateTeam` against a ruleset.
- **Smogon sets/stats**: delegated to `src/lib/smogon/import-sets.ts` and `import-stats.ts`.

## Dependencies
- **External Libraries**: `@pkmn/data`, `@pkmn/dex` (team-roles resolution only).
- **Internal Modules**:
  - [Supabase Module](./supabase.md) — queries: `point-buy-lists`, `team-roles`, `seasons`, `rulesets`, `meta-usage`
  - [Smogon Module](./smogon.md) — `import-sets.ts`, `import-stats.ts`, `format-registry.ts`
  - [Pokémon Module](./pkmn.md) — `pkmn/teams` (`parseTeamText`), `pkmn/validation` (`validateTeam`)
  - Auth helpers (`requireAdmin`, `requireResourceAdmin`, `requirePlayer`), `lib/validation`, `lib/utils/rate-limit`

## API Routes

### `admin/import/*`
- `POST /api/admin/import/point-buy` — EPB XLSX import; `name`, `version`, optional `season_id`, optional `dry_run`; immutable when bound to an active/completed season.
- `POST /api/admin/import/team-roles` — team-role XLSX import; optional `dry_run`.

### `import-sets` / `import-sample-sets`
- `POST /api/admin/import-sets` — Smogon sample sets for one `generation`.
- `POST /api/admin/import-sample-sets` — all generations or `generations[]` (`maxDuration = 300`).

### `import-stats` / `import-usage-stats`
- `POST /api/admin/import-stats` — Smogon usage stats for one `format`.
- `POST /api/admin/import-usage-stats` — all formats or `formats[]`; `GET` returns per-format coverage summary (`maxDuration = 300`).

### `import-team`
- `POST /api/import-team` — player team import (Showdown text or `pokepast.es` URL), optional `ruleset_id` validation; rate-limited 20/hour per player.

## Related Modules
- [Evolution Point Buy](./evolution-point-buy.md)
- [Season](./season.md)
- [Admin](./admin.md)
- [Smogon](./smogon.md)
- [DATA_IMPORT_GUIDE](./DATA_IMPORT_GUIDE.md)
- [Point-Buy Workbook Format](./point-buy-format.md)
- [Format Packs](./format-packs.md)
