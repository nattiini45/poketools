/**
 * EPB list reconciliation report (draft-backend §2.5, SPEC:172-182): a repeatable
 * artifact built on every import (admin route, `scripts/import-point-buy.ts`) and by
 * the CLI `scripts/draft/reconcile-point-buy.ts`. Server only (reads `@pkmn/dex`).
 * No database access: the input is the parsed workbook.
 *
 * Every count is derived from the entries; nothing is hard-coded (SPEC:47). League-specific
 * checks over the rules sheet, the quoted override row and the id tables come from the active
 * format pack (`epb.reconciliation`, `@/lib/format-pack`).
 */
// No `import 'server-only'`: the CLI runs this module under tsx, where that package throws.

import { overrideFor, overridesFor } from '@/lib/draft/league-overrides';
import { foldId, type LineId } from '@/lib/draft/line-identity';
import { PRICE_TABS, tabOf, type PriceTabKey } from '@/lib/draft/price-tabs';
import { DROPPED_UTILITY_MOVES, UTILITY_CATEGORIES } from '@/lib/draft/utility-categories';
import type { ParsedPointBuyEntry } from '@/lib/import/point-buy-xlsx';
import {
  normalizeUtilityLabel,
  normalizeUtilityMove,
  type UtilitySheetBlocks,
} from '@/lib/import/utility-sheet-xlsx';
import { epbPack, utilityLabel, type RuleConflictPkmnKind } from '@/lib/format-pack';
import { getGeneration } from '@/lib/pkmn/dex';
import type { PriceGroup } from '@/types/point-buy';

export type SheetGroupKey = PriceGroup;

/** A rule-conflict code; the pack's `epb.reconciliation.ruleChecks` hook defines them. */
export type RuleConflictCode = string;

export interface ReconciliationReport {
  generated_at: string;
  list_source: string | null;
  /** Derived from the entries. */
  line_count: number;
  price_tabs: { key: Exclude<PriceTabKey, 'all'>; count: number }[];
  out_of_tab_prices: { line_id: LineId; price: number }[];
  sheet_groups: Record<SheetGroupKey, number>;
  branched_bases: {
    base: string;
    lines: { line_id: LineId; final: string; price: number; k2: number; k3: number | null }[];
    thresholds_differ: boolean;
    same_price: boolean;
  }[];
  unresolved_names: {
    line_id: LineId;
    stage: 1 | 2 | 3;
    name: string;
    reason: 'not_in_dex' | 'nonstandard' | 'battle_only' | 'nfc_mismatch';
  }[];
  threshold_conflicts: {
    line_id: LineId;
    field: string;
    sheet_value: number | null;
    applied_value: number;
    source: string;
  }[];
  overrides_applied: { line_id: LineId; field: string; from: unknown; to: unknown; reason_en: string }[];
  /**
   * `detail` is the English text (markdown report). `message_key` / `params` select the localized text in the pack's
   * `messages.*.ruleConflicts` (`ruleConflictText`), which the import panel shows.
   */
  rule_conflicts: {
    code: RuleConflictCode;
    detail: string;
    message_key: string;
    params: Readonly<Record<string, string | number>>;
    /** Params holding an English move or item name, localized at display (`RuleConflict.pkmnParams`). */
    pkmn_params?: Readonly<Record<string, RuleConflictPkmnKind>>;
  }[];
  /** Only when a Gen 9 utility xlsx is supplied. */
  utility: null | {
    label_normalizations: { label: string; normalized: string; line_id: LineId | null }[];
    unresolved_labels: { category: string; label: string; reason: 'typo' | 'not_in_dex' }[];
    illegal_pairs: { category: string; species: string; move: string }[];
    unmapped_species_count: number;
    cap_species_count: number;
    lines_without_any_utility: LineId[];
    category_moves_not_in_module: { category: string; move: string }[];
  };
  warnings: string[];
  errors: string[];
}

export interface ReconciliationInput {
  entries: ParsedPointBuyEntry[];
  overview: Record<string, number | string>;
  /** The pack's rules-sheet rows as strings; the pack's rule checks and the quoted override row read them. */
  rulesSheetRows?: string[][];
  utilitySheet?: UtilitySheetBlocks;
  source?: string;
  /** Fixed timestamp for byte-identical output (tests, CLI `--generated-at`). Default: now. */
  generatedAt?: string;
}

/** The raw Gen 9 dex (nonstandard entries included), through the app's pkmn layer. */
const dex = getGeneration(9).dex;

/** Gen 9 status-healing moves of older games that cannot be members (`isNonstandard: 'Past'`), as move ids (pack data). */
const PAST_STATUS_HEALING_IDS: readonly string[] = epbPack.reconciliation.pastStatusHealingIds;

function stagesOf(e: ParsedPointBuyEntry): { stage: 1 | 2 | 3; name: string }[] {
  const out: { stage: 1 | 2 | 3; name: string }[] = [
    { stage: 1, name: e.base_pokemon },
    { stage: 2, name: e.stage2_pokemon },
  ];
  if (e.stage3_pokemon) out.push({ stage: 3, name: e.stage3_pokemon });
  return out;
}

function unresolvedReason(name: string): ReconciliationReport['unresolved_names'][number]['reason'] | null {
  if (name !== name.normalize('NFC')) return 'nfc_mismatch';
  const species = dex.species.get(name.normalize('NFC'));
  if (!species.exists) return 'not_in_dex';
  if (species.isNonstandard) return 'nonstandard';
  if (species.battleOnly) return 'battle_only';
  return null;
}

/** The rules-sheet row (1-based number and joined text) whose text mentions `needle`. */
function findRulesRow(rows: string[][] | undefined, needle: RegExp): { row: number; text: string } | null {
  if (!rows) return null;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].filter(Boolean);
    const text = cells.join(': ');
    if (needle.test(text)) return { row: i + 1, text };
  }
  return null;
}

/**
 * The league's rule conflicts: the pack's optional `epb.reconciliation.ruleChecks` hook over the
 * rules-sheet rows (`[]` when no sheet was given). Without a hook there are none.
 */
function ruleConflicts(rulesSheetRows: string[][] | undefined): ReconciliationReport['rule_conflicts'] {
  const check = epbPack.reconciliation.ruleChecks;
  if (!check) return [];
  return check(rulesSheetRows ?? [], {
    bannedMoves: epbPack.defaults.bannedMoves,
    bannedItems: epbPack.defaults.bannedItems,
    knownRepoOnlyBanIds: epbPack.reconciliation.knownRepoOnlyBanIds,
    foldId,
  }).map((c) => ({
    code: c.code,
    detail: c.message,
    message_key: c.messageKey ?? c.code,
    params: c.params ?? {},
    ...(c.pkmnParams ? { pkmn_params: c.pkmnParams } : {}),
  }));
}

async function utilitySection(
  entries: ParsedPointBuyEntry[],
  sheet: UtilitySheetBlocks,
): Promise<NonNullable<ReconciliationReport['utility']>> {
  const gen = getGeneration(9);

  // species name (NFC) → line ids that have it as a stage
  const linesBySpecies = new Map<string, Set<LineId>>();
  for (const e of entries) {
    for (const s of stagesOf(e)) {
      const key = foldId(s.name);
      const set = linesBySpecies.get(key) ?? new Set<LineId>();
      set.add(e.line_id);
      linesBySpecies.set(key, set);
    }
  }

  const memberIds = new Set<string>();
  for (const def of UTILITY_CATEGORIES) for (const m of def.members) memberIds.add(m.id);
  const droppedIds = new Set(DROPPED_UTILITY_MOVES.map((d) => d.id));

  const learnableCache = new Map<string, Set<string> | null>();
  async function learnable(speciesName: string): Promise<Set<string> | null> {
    const cached = learnableCache.get(speciesName);
    if (cached !== undefined) return cached;
    const species = gen.species.get(speciesName);
    const result = species ? new Set(Object.keys((await gen.learnsets.learnable(species.name, 'Paldea')) ?? {})) : null;
    learnableCache.set(speciesName, result);
    return result;
  }

  const labelNormalizations = new Map<string, { label: string; normalized: string; line_id: LineId | null }>();
  const unresolved = new Map<string, { category: string; label: string; reason: 'typo' | 'not_in_dex' }>();
  const illegal = new Map<string, { category: string; species: string; move: string }>();
  const notInModule = new Map<string, { category: string; move: string }>();
  const unmappedSpecies = new Set<string>();
  const capSpecies = new Set<string>();
  const linesWithUtility = new Set<LineId>();

  for (const pair of sheet.pairs) {
    const label = normalizeUtilityLabel(pair.label);
    const moveName = normalizeUtilityMove(pair.move);
    const moveId = foldId(moveName);

    if (!memberIds.has(moveId) && !droppedIds.has(moveId)) {
      notInModule.set(`${pair.category}|${moveId}`, { category: pair.category, move: moveName });
    }

    if (label.kind === 'typo') {
      unresolved.set(`${pair.category}|${pair.label}`, { category: pair.category, label: pair.label, reason: 'typo' });
      continue;
    }

    const lines = label.line_id ? new Set([label.line_id]) : linesBySpecies.get(foldId(label.normalized));
    if (label.kind === 'branch_marker' || label.normalized !== pair.label) {
      const single = label.line_id ?? (lines && lines.size === 1 ? [...lines][0] : null);
      labelNormalizations.set(pair.label, { label: pair.label, normalized: label.normalized, line_id: single });
    }

    const dexSpecies = dex.species.get(label.normalized);
    if (!dexSpecies.exists) {
      unresolved.set(`${pair.category}|${pair.label}`, { category: pair.category, label: pair.label, reason: 'not_in_dex' });
      continue;
    }

    if (lines && lines.size > 0) {
      for (const id of lines) linesWithUtility.add(id);
    } else {
      unmappedSpecies.add(dexSpecies.name);
      if (dexSpecies.isNonstandard === 'CAP') capSpecies.add(dexSpecies.name);
    }

    const moves = await learnable(dexSpecies.name);
    const move = gen.moves.get(moveId);
    if (moves && move && !moves.has(move.id)) {
      illegal.set(`${pair.category}|${dexSpecies.name}|${move.id}`, {
        category: pair.category,
        species: dexSpecies.name,
        move: move.name,
      });
    }
  }

  return {
    label_normalizations: [...labelNormalizations.values()].sort((a, b) => a.label.localeCompare(b.label)),
    unresolved_labels: [...unresolved.values()],
    illegal_pairs: [...illegal.values()],
    unmapped_species_count: unmappedSpecies.size,
    cap_species_count: capSpecies.size,
    lines_without_any_utility: entries.map((e) => e.line_id).filter((id) => !linesWithUtility.has(id)),
    category_moves_not_in_module: [...notInModule.values()],
  };
}

export async function buildReconciliationReport(input: ReconciliationInput): Promise<ReconciliationReport> {
  const { entries } = input;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Price tabs (derived).
  const tabCounts = new Map<Exclude<PriceTabKey, 'all'>, number>(PRICE_TABS.map((t) => [t.key, 0]));
  const outOfTab: ReconciliationReport['out_of_tab_prices'] = [];
  for (const e of entries) {
    const tab = tabOf(e.price);
    if (tab) tabCounts.set(tab, (tabCounts.get(tab) ?? 0) + 1);
    else outOfTab.push({ line_id: e.line_id, price: e.price });
  }
  if (outOfTab.length > 0) warnings.push(`${outOfTab.length} line(s) priced outside every tab (listed under "All" only)`);

  // Sheet price groups (derived from the entries' price_group column).
  const sheetGroups = { premium: 0, hoch: 0, mittel: 0, guenstig: 0, budget: 0 } satisfies Record<SheetGroupKey, number>;
  for (const e of entries) sheetGroups[e.price_group as PriceGroup] += 1;

  // Duplicate ids.
  const seen = new Set<LineId>();
  for (const e of entries) {
    if (seen.has(e.line_id)) errors.push(`Duplicate line id ${e.line_id}`);
    seen.add(e.line_id);
  }

  // Overrides (thresholds only) against the sheet values.
  const rowPattern = epbPack.reconciliation.overrideRowPattern;
  const overrideRule = rowPattern ? findRulesRow(input.rulesSheetRows, new RegExp(rowPattern, 'i')) : null;
  const thresholdConflicts: ReconciliationReport['threshold_conflicts'] = [];
  const overridesApplied: ReconciliationReport['overrides_applied'] = [];
  const effective = new Map<LineId, { k2: number; k3: number | null }>();
  for (const e of entries) {
    const applied = overridesFor(e);
    let k2 = e.kills_to_stage2;
    let k3 = e.additional_kills_to_stage3;
    const override = overrideFor(e.line_id);
    for (const o of applied) {
      if (o.field === 'kills_to_stage2') k2 = o.applied_value;
      else k3 = o.applied_value;
      const quoted = overrideRule ? ` | rules row ${overrideRule.row} reads: "${overrideRule.text}"` : '';
      thresholdConflicts.push({
        line_id: e.line_id,
        field: o.field,
        sheet_value: o.sheet_value,
        applied_value: o.applied_value,
        source: `${override?.source ?? 'league override'}${quoted}`,
      });
      overridesApplied.push({
        line_id: e.line_id,
        field: o.field,
        from: o.sheet_value,
        to: o.applied_value,
        reason_en: o.reason.en,
      });
    }
    effective.set(e.line_id, { k2, k3 });
  }

  // Branched bases.
  const byBase = new Map<string, ParsedPointBuyEntry[]>();
  for (const e of entries) {
    const key = foldId(e.base_pokemon);
    byBase.set(key, [...(byBase.get(key) ?? []), e]);
  }
  const branchedBases: ReconciliationReport['branched_bases'] = [];
  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    const lines = group.map((e) => {
      const t = effective.get(e.line_id) ?? { k2: e.kills_to_stage2, k3: e.additional_kills_to_stage3 };
      return { line_id: e.line_id, final: e.stage3_pokemon ?? e.stage2_pokemon, price: e.price, k2: t.k2, k3: t.k3 };
    });
    branchedBases.push({
      base: group[0].base_pokemon,
      lines,
      thresholds_differ: lines.some((l) => l.k2 !== lines[0].k2 || l.k3 !== lines[0].k3),
      same_price: lines.every((l) => l.price === lines[0].price),
    });
  }

  // Species names.
  const unresolvedNames: ReconciliationReport['unresolved_names'] = [];
  for (const e of entries) {
    for (const s of stagesOf(e)) {
      const reason = unresolvedReason(s.name);
      if (reason) unresolvedNames.push({ line_id: e.line_id, stage: s.stage, name: s.name, reason });
    }
  }
  if (unresolvedNames.length > 0) warnings.push(`${unresolvedNames.length} stage name(s) do not resolve cleanly in @pkmn/dex`);

  const utility = input.utilitySheet ? await utilitySection(entries, input.utilitySheet) : null;

  return {
    generated_at: input.generatedAt ?? new Date().toISOString(),
    list_source: input.source ?? null,
    line_count: entries.length,
    price_tabs: PRICE_TABS.map((t) => ({ key: t.key, count: tabCounts.get(t.key) ?? 0 })),
    out_of_tab_prices: outOfTab,
    sheet_groups: sheetGroups,
    branched_bases: branchedBases,
    unresolved_names: unresolvedNames,
    threshold_conflicts: thresholdConflicts,
    overrides_applied: overridesApplied,
    rule_conflicts: ruleConflicts(input.rulesSheetRows),
    utility,
    warnings,
    errors,
  };
}

// ── Markdown ──────────────────────────────────────────────────────

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  // Backslash first, so a value ending in `\` cannot turn the added `\|` into `\\|`.
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(headers: string[], rows: unknown[][]): string[] {
  if (rows.length === 0) return ['_none_', ''];
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    '',
  ];
}

/** The workbook's own group labels (`epb.workbook.pointBuy.overviewGroupLabels`). */
const GROUP_LABELS: Readonly<Record<SheetGroupKey, string>> = epbPack.workbook.pointBuy.overviewGroupLabels;

/** The human-readable artifact (English; the workbook's German prose is quoted verbatim). */
export function renderReconciliationMarkdown(r: ReconciliationReport): string {
  const out: string[] = [];
  out.push('# EPB list reconciliation report', '');
  out.push(`- Generated: ${r.generated_at}`);
  out.push(`- Source: ${r.list_source ?? '—'}`);
  out.push(`- Lines (derived): **${r.line_count}**`);
  out.push(`- Errors: ${r.errors.length} · Warnings: ${r.warnings.length}`, '');

  out.push('## Price tabs', '');
  out.push(
    ...table(
      ['Tab', 'Lines'],
      [...r.price_tabs.map((p) => [p.key, p.count]), ['all', r.line_count]],
    ),
  );
  if (r.out_of_tab_prices.length > 0) {
    out.push('Outside every tab:', '', ...table(['Line', 'Price'], r.out_of_tab_prices.map((o) => [o.line_id, o.price])));
  }

  out.push('## Sheet price groups (derived)', '');
  out.push(...table(['Group', 'Lines'], (Object.keys(r.sheet_groups) as SheetGroupKey[]).map((k) => [GROUP_LABELS[k], r.sheet_groups[k]])));

  out.push(`## Branched bases (${r.branched_bases.length} bases / ${r.branched_bases.reduce((s, b) => s + b.lines.length, 0)} lines)`, '');
  out.push(
    ...table(
      ['Base', 'Line id', 'Final stage', 'Price', 'KOs to stage 2', '+ KOs to stage 3', 'Thresholds differ', 'Same price'],
      r.branched_bases.flatMap((b) =>
        b.lines.map((l) => [b.base, l.line_id, l.final, l.price, l.k2, l.k3, b.thresholds_differ ? 'yes' : 'no', b.same_price ? 'yes' : 'no']),
      ),
    ),
  );

  out.push('## Threshold conflicts and league overrides', '');
  out.push(
    ...table(
      ['Line', 'Field', 'Sheet', 'Applied', 'Source'],
      r.threshold_conflicts.map((c) => [c.line_id, c.field, c.sheet_value, c.applied_value, c.source]),
    ),
  );
  if (r.overrides_applied.length > 0) {
    out.push('Reasons:', '');
    for (const reason of new Set(r.overrides_applied.map((o) => o.reason_en))) out.push(`- ${reason}`);
    out.push('');
  }

  out.push('## Unresolved stage names', '');
  out.push(...table(['Line', 'Stage', 'Name', 'Reason'], r.unresolved_names.map((u) => [u.line_id, u.stage, u.name, u.reason])));

  out.push('## Rule conflicts', '');
  out.push(...table(['Code', 'Detail'], r.rule_conflicts.map((c) => [c.code, c.detail])));

  if (r.utility) {
    const u = r.utility;
    out.push('## Gen 9 utility sheet', '');
    out.push(`- Utility categories: ${UTILITY_CATEGORIES.map((c) => utilityLabel(c.key, 'en')).join(', ')}`);
    out.push(`- Species with no draftable line: ${u.unmapped_species_count} (CAP: ${u.cap_species_count})`);
    out.push(`- Lines without any sheet utility: ${u.lines_without_any_utility.length === 0 ? 'none' : u.lines_without_any_utility.join(', ')}`);
    if (PAST_STATUS_HEALING_IDS.length > 0) {
      out.push(`- Not Gen 9 members (isNonstandard 'Past'): ${PAST_STATUS_HEALING_IDS.map((id) => dex.moves.get(id).name).join(', ')}`);
    }
    out.push('');
    out.push('### Label normalisations', '');
    out.push(...table(['Label', 'Normalised', 'Line'], u.label_normalizations.map((l) => [l.label, l.normalized, l.line_id])));
    out.push('### Unresolved labels', '');
    out.push(...table(['Category', 'Label', 'Reason'], u.unresolved_labels.map((l) => [l.category, l.label, l.reason])));
    out.push('### Pairs not learnable in Gen 9 (Paldea)', '');
    out.push(...table(['Category', 'Species', 'Move'], u.illegal_pairs.map((p) => [p.category, p.species, p.move])));
    out.push('### Sheet moves not in utility-categories.ts', '');
    out.push(...table(['Category', 'Move'], u.category_moves_not_in_module.map((m) => [m.category, m.move])));
  }

  if (r.errors.length > 0) out.push('## Errors', '', ...r.errors.map((e) => `- ${e}`), '');
  if (r.warnings.length > 0) out.push('## Warnings', '', ...r.warnings.map((w) => `- ${w}`), '');
  return out.join('\n');
}
