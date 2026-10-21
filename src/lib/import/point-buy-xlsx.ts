/**
 * Point-buy xlsx parse + validate. Shared by admin API and CLI scripts. Server only
 * (species ids come from `@pkmn/dex`).
 *
 * The workbook layout (sheet names, column indices, price-group spellings, overview
 * labels) and the per-line rulings come from the active format pack
 * (`epb.workbook.pointBuy`, `epb.lineRules`; `@/lib/format-pack`).
 *
 * Counts are always derived from the parsed entries (SPEC:47): the overview
 * sheet's totals are compared and reported as warnings, never enforced. Every run
 * also builds the reconciliation report (draft-backend §2.5), which lists the
 * league overrides (`epb.lineOverrides`) against the sheet values.
 */
import { getGeneration } from '@/lib/pkmn/dex';
import type { PriceGroup } from '@/types/point-buy';
import { epbLineRuleForBase, epbPack, priceGroupForPrice, storedSpecialRulesForBase } from '@/lib/format-pack';
import { foldId, toLineId, type LineId } from '@/lib/draft/line-identity';
import { buildReconciliationReport, type ReconciliationReport } from '@/lib/draft/reconciliation-report';
import { cellNumber, cellString, getSheet, readXlsxBuffer, type XlsxSheet } from '@/lib/import/xlsx';

export interface ParsedPointBuyEntry {
  line_number: number;
  /** `toID(base)--toID(final stage)` (src/lib/draft/line-identity.ts). */
  line_id: LineId;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  price: number;
  kills_to_stage2: number;
  additional_kills_to_stage3: number | null;
  price_group: PriceGroup;
  early_rating: number | null;
  mid_rating: number | null;
  late_rating: number | null;
  rationale: string | null;
  historical_data: string | null;
  special_rules: Record<string, boolean> | null;
  special_rules_text: string | null;
  sources: string | null;
  legacy_tier: string | null;
}

export interface PointBuyImportReport {
  total_lines: number;
  valid: number;
  imported: number;
  warnings: string[];
  errors: string[];
  /** Notes that need no action (e.g. special-rule prose without a machine flag). */
  info: string[];
  version_id: string | null;
  /** The repeatable validation artifact (draft-backend §2.5); null only when the workbook could not be parsed. */
  reconciliation: ReconciliationReport | null;
}

export interface ParsedPointBuyWorkbook {
  entries: ParsedPointBuyEntry[];
  overview: Record<string, number | string>;
  /** Rows of the pack's rules sheet as strings (the reconciliation report reads its rule checks from here). */
  rulesSheetRows: string[][];
}

/** The point-buy part of the active pack's workbook map. */
const WORKBOOK = epbPack.workbook.pointBuy;

/** Overview-sheet labels of the per-group line counts (`epb.workbook.pointBuy.overviewGroupLabels`). */
export const OVERVIEW_GROUP_LABELS: Readonly<Record<PriceGroup, string>> = WORKBOOK.overviewGroupLabels;

function mapPriceGroup(raw: string, price: number): PriceGroup {
  const key = raw.trim().toLowerCase();
  const spelled = Object.hasOwn(WORKBOOK.priceGroupSpellings, key) ? WORKBOOK.priceGroupSpellings[key] : undefined;
  if (spelled) return spelled;
  return priceGroupForPrice(price);
}

/** The stored `special_rules` flags of a base, from the pack's `epb.lineRules`. */
function detectSpecialRules(base: string): Record<string, boolean> | null {
  return storedSpecialRulesForBase(base);
}

/** Split "A → B → C" or "A -> B -> C" into stages. */
function splitEvolutionLine(raw: string): { base: string; stage2: string; stage3: string | null } {
  const parts = raw
    .split(/\s*(?:→|->|–|—)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Entwicklungsreihe must have at least 2 stages: "${raw}"`);
  }
  return {
    base: parts[0],
    stage2: parts[1],
    stage3: parts[2] ?? null,
  };
}

/**
 * The `@pkmn` species id of a list name (`Flabébé` → `flabebe`, not `flabb`).
 * Falls back to `foldId` when the dex does not know the name (the report lists it).
 */
export function speciesIdFor(name: string): string {
  const species = getGeneration(9).dex.species.get(name.normalize('NFC'));
  return species.exists ? species.id : foldId(name);
}

function sheetRowsAsStrings(sheet: XlsxSheet | undefined): string[][] {
  if (!sheet) return [];
  // Array.from, not map: rows are sparse, and the strings must be dense.
  return Array.from(sheet.rows, (row) => Array.from(row ?? [], (cell) => cellString(cell)));
}

export function parsePointBuySheets(sheets: XlsxSheet[]): ParsedPointBuyWorkbook {
  const pb = getSheet(sheets, WORKBOOK.sheet);
  if (!pb) throw new Error(`Sheet "${WORKBOOK.sheet}" not found`);

  const col = WORKBOOK.columns;
  const skipStartNames = new Set(WORKBOOK.skipStartNames);
  const overviewSheet = WORKBOOK.overviewSheet ? getSheet(sheets, WORKBOOK.overviewSheet) : undefined;
  const overview: Record<string, number | string> = {};
  if (overviewSheet) {
    for (const row of overviewSheet.rows) {
      const label = cellString(row?.[0]);
      const value = cellNumber(row?.[1]) ?? cellString(row?.[1]);
      if (label) overview[label] = value;
    }
  }

  const entries: ParsedPointBuyEntry[] = [];
  for (let i = 1; i < pb.rows.length; i++) {
    const row = pb.rows[i] ?? [];
    const startName = cellString(row[col.startName]);
    if (!startName || skipStartNames.has(startName.toLowerCase())) continue;

    const evoRaw = cellString(row[col.evolutionLine]);
    if (!evoRaw) continue;

    let stages: { base: string; stage2: string; stage3: string | null };
    try {
      stages = splitEvolutionLine(evoRaw);
    } catch (err) {
      throw new Error(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const price = cellNumber(row[col.price]);
    const kills2 = cellNumber(row[col.killsToStage2]);
    const kills3 = cellNumber(row[col.additionalKillsToStage3]);
    const groupRaw = cellString(row[col.priceGroup]);

    entries.push({
      line_number: entries.length + 1,
      line_id: toLineId(stages.base, stages.stage3 ?? stages.stage2),
      base_pokemon: stages.base,
      stage2_pokemon: stages.stage2,
      stage3_pokemon: stages.stage3,
      price: price ?? NaN,
      kills_to_stage2: kills2 ?? NaN,
      additional_kills_to_stage3: stages.stage3 ? (kills3 ?? null) : null,
      price_group: mapPriceGroup(groupRaw, price ?? 0),
      early_rating: cellNumber(row[col.early]),
      mid_rating: cellNumber(row[col.mid]),
      late_rating: cellNumber(row[col.late]),
      rationale: cellString(row[col.rationale]) || null,
      historical_data: cellString(row[col.historical]) || null,
      special_rules: detectSpecialRules(stages.base),
      special_rules_text: cellString(row[col.specialRulesText]) || null,
      sources: cellString(row[col.sources]) || null,
      legacy_tier: cellString(row[col.legacyTier]) || null,
    });
  }

  const rulesSheet = WORKBOOK.rulesSheet ? getSheet(sheets, WORKBOOK.rulesSheet) : undefined;
  return { entries, overview, rulesSheetRows: sheetRowsAsStrings(rulesSheet) };
}

export function parsePointBuyXlsxBuffer(buf: Buffer): ParsedPointBuyWorkbook {
  return parsePointBuySheets(readXlsxBuffer(buf));
}

function killWord(n: number): string {
  return n === 1 ? 'kill' : 'kills';
}

function validateEntry(entry: ParsedPointBuyEntry, report: PointBuyImportReport): boolean {
  const idx = entry.line_number;
  let valid = true;

  if (!Number.isFinite(entry.price) || entry.price <= 0) {
    report.errors.push(`Line ${idx} (${entry.base_pokemon}): price must be a positive number`);
    valid = false;
  }
  if (!Number.isFinite(entry.kills_to_stage2) || entry.kills_to_stage2 < 0) {
    report.errors.push(`Line ${idx} (${entry.base_pokemon}): kills_to_stage2 must be a non-negative integer`);
    valid = false;
  }
  if (
    entry.additional_kills_to_stage3 !== null &&
    (!Number.isFinite(entry.additional_kills_to_stage3) || entry.additional_kills_to_stage3 < 0)
  ) {
    report.errors.push(
      `Line ${idx} (${entry.base_pokemon}): additional_kills_to_stage3 must be a non-negative integer`
    );
    valid = false;
  }
  if (!entry.stage2_pokemon) {
    report.errors.push(`Line ${idx} (${entry.base_pokemon}): stage2_pokemon is empty`);
    valid = false;
  }
  if (entry.stage3_pokemon && entry.additional_kills_to_stage3 === null) {
    report.errors.push(
      `Line ${idx} (${entry.base_pokemon}): stage3 set but additional_kills_to_stage3 missing`
    );
    valid = false;
  }

  const expected = epbLineRuleForBase(entry.base_pokemon)?.expectedThresholds;
  if (expected) {
    const base = entry.base_pokemon;
    const k2 = expected.killsToStage2;
    if (entry.kills_to_stage2 !== k2) {
      report.warnings.push(
        `${base}: expected ${k2} ${killWord(k2)} to ${entry.stage2_pokemon} (got ${entry.kills_to_stage2})`
      );
    }
    const k3 = expected.additionalKillsToStage3;
    if (k3 !== null && entry.additional_kills_to_stage3 !== k3) {
      report.warnings.push(
        `${base}: expected ${k3} additional ${killWord(k3)} to ${entry.stage3_pokemon ?? entry.stage2_pokemon} (got ${entry.additional_kills_to_stage3})`
      );
    }
  }
  // League threshold overrides (`epb.lineOverrides`, src/lib/draft/league-overrides.ts): the sheet-vs-override
  // conflict is listed in report.reconciliation.threshold_conflicts on every run.

  if (entry.special_rules_text && !entry.special_rules) {
    report.info.push(
      `Line ${idx} (${entry.line_id}): special-rule text without a machine flag (shown as prose only)`
    );
  }

  return valid;
}

/** Compare the derived counts with the overview sheet; mismatches are warnings (the derived count wins). */
function validateOverview(
  entries: ParsedPointBuyEntry[],
  overview: Record<string, number | string>,
  report: PointBuyImportReport
): void {
  const sheetName = WORKBOOK.overviewSheet ?? 'Overview';
  const expectedCount = Number(overview[WORKBOOK.overviewLabels.lineCount]);
  if (Number.isFinite(expectedCount) && entries.length !== expectedCount) {
    report.warnings.push(
      `${sheetName} says ${expectedCount} lines, the list has ${entries.length}: the derived count ${entries.length} is authoritative`
    );
  }

  const avg = entries.reduce((s, e) => s + e.price, 0) / (entries.length || 1);
  const expectedAvg = Number(overview[WORKBOOK.overviewLabels.averagePrice]);
  if (Number.isFinite(expectedAvg) && Math.abs(avg - expectedAvg) > 0.05) {
    report.warnings.push(
      `${sheetName} avg price: expected ~${expectedAvg}, got ${avg.toFixed(4)}`
    );
  }

  const derived: Record<PriceGroup, number> = { premium: 0, hoch: 0, mittel: 0, guenstig: 0, budget: 0 };
  for (const e of entries) derived[e.price_group] += 1;
  for (const [group, label] of Object.entries(OVERVIEW_GROUP_LABELS) as [PriceGroup, string][]) {
    const expected = Number(overview[label]);
    if (overview[label] === undefined || !Number.isFinite(expected)) continue;
    if (derived[group] !== expected) {
      report.warnings.push(
        `${sheetName} group ${label}: sheet says ${expected}, the list has ${derived[group]} (derived count is authoritative)`
      );
    }
  }
}

function emptyReport(): PointBuyImportReport {
  return {
    total_lines: 0,
    valid: 0,
    imported: 0,
    warnings: [],
    errors: [],
    info: [],
    version_id: null,
    reconciliation: null,
  };
}

/** Validate parsed workbook sheets; builds the reconciliation report. Does not write to the database. */
export async function validatePointBuySheets(
  sheets: XlsxSheet[],
  options: { source?: string } = {}
): Promise<{ report: PointBuyImportReport; validEntries: ParsedPointBuyEntry[] }> {
  const report = emptyReport();

  let workbook: ParsedPointBuyWorkbook;
  try {
    workbook = parsePointBuySheets(sheets);
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
    return { report, validEntries: [] };
  }
  const { entries, overview, rulesSheetRows } = workbook;

  report.total_lines = entries.length;

  const seen = new Map<string, number>();
  for (const entry of entries) {
    const first = seen.get(entry.line_id);
    if (first !== undefined) {
      report.errors.push(
        `Duplicate line id ${entry.line_id}: lines ${first} and ${entry.line_number} (${entry.base_pokemon} → ${entry.stage3_pokemon ?? entry.stage2_pokemon})`
      );
    } else {
      seen.set(entry.line_id, entry.line_number);
    }
  }

  validateOverview(entries, overview, report);
  const validEntries = entries.filter((e) => validateEntry(e, report));
  report.valid = validEntries.length;

  report.reconciliation = await buildReconciliationReport({
    entries,
    overview,
    rulesSheetRows,
    source: options.source,
  });

  return { report, validEntries };
}

/** Parse and validate a point-buy xlsx buffer; does not write to the database. */
export async function validatePointBuyImport(
  buf: Buffer,
  options: { source?: string } = {}
): Promise<{ report: PointBuyImportReport; validEntries: ParsedPointBuyEntry[] }> {
  let sheets: XlsxSheet[];
  try {
    sheets = readXlsxBuffer(buf);
  } catch (err) {
    const report = emptyReport();
    report.errors.push(err instanceof Error ? err.message : String(err));
    return { report, validEntries: [] };
  }
  return validatePointBuySheets(sheets, options);
}

export function pointBuyEntriesToRows(
  versionId: string,
  validEntries: ParsedPointBuyEntry[]
) {
  return validEntries.map((e) => ({
    list_version_id: versionId,
    line_number: e.line_number,
    line_id: e.line_id,
    base_pokemon: e.base_pokemon,
    stage2_pokemon: e.stage2_pokemon,
    stage3_pokemon: e.stage3_pokemon,
    price: e.price,
    kills_to_stage2: e.kills_to_stage2,
    additional_kills_to_stage3: e.additional_kills_to_stage3,
    price_group: e.price_group,
    early_rating: e.early_rating,
    mid_rating: e.mid_rating,
    late_rating: e.late_rating,
    rationale: e.rationale,
    historical_data: e.historical_data,
    special_rules: e.special_rules,
    special_rules_text: e.special_rules_text,
    sources: e.sources,
    legacy_tier: e.legacy_tier,
    species_ids: {
      base: speciesIdFor(e.base_pokemon),
      stage2: speciesIdFor(e.stage2_pokemon),
      stage3: e.stage3_pokemon ? speciesIdFor(e.stage3_pokemon) : null,
    },
  }));
}
