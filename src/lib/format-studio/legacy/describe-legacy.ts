/**
 * `describeLegacy`: a live league (its phases, groups and settings, as plain data) in, a read-only
 * `FormatDefinition` out. The definition describes what the league does TODAY; it drives nothing. The Studio
 * compiles it like any other document, so the same plain-language rules text, diagnostics and coverage line work
 * for a league that was never authored in the kit.
 *
 * Pure: no I/O, no clock, no locale argument (both languages are written into the document), never throws and
 * never mutates its input. The output is plain JSON (no `undefined` property) and survives a JSON round trip.
 *
 * Mapping, in short (docs/format-kit.md has the full tables):
 * - phases become stages `stage_1..stage_n` in `stageOrder` order (at most 50); proper names keep the stored text
 *   in both languages, so no translation gap is reported for them;
 * - the advancement rule stored on a phase is read as the edge OUT of it (the phase form and the timeline read it
 *   that way); a rule that no later phase consumes is kept as a text section, so nothing is dropped silently;
 * - scoring and rank characterise today's code and name their sources next to the constants below;
 * - settings the kit has no primitive for (core pool, tier limits, Evolution Point Buy tuning) become legacy
 *   modules whose facts are data only.
 *
 * Values are never coerced into meaning: an even best-of stays even and the compiler reports it. Numbers are only
 * clamped into the kit's ranges so the document stays valid.
 */
import { createTranslator } from '@/i18n/core';
import { formatStudioLegacyMessages } from '@/i18n/messages/format-studio/legacy';
import {
  LTEXT_MAX_CHARS,
  MAX_BEST_OF,
  MAX_GROUPS,
  MAX_N,
  MAX_N_PER_GROUP,
  MAX_STAGES,
  MAX_TEXT_SECTIONS,
  MIN_GROUPS,
  SCORE_ABS_MAX,
  isKey,
  isUuid,
  ltext,
  type AdvanceSelect,
  type Edge,
  type FormatDefinition,
  type LText,
  type Locale,
  type Pairing,
  type RankStep,
  type Scoring,
  type Stage,
  type TextSection,
} from '@/lib/format-kit/client';
import { ROUND_ROBIN_MATCH_POINTS, effectiveMatchPoints, effectiveTiebreakerChain } from '@/lib/tournament/standings-rules';
import { buildModules, type LegacyTexts } from './facts';
import { mapOverrides } from './overrides';
import type { LegacyFacts, LegacyInput, LegacyPack, LegacyStageInput } from './types';

type StoredRule = NonNullable<LegacyStageInput['advancementRule']>;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** A DB-authored name: NUL removed, trimmed, cut to the kit's text length; empty gives the fallback. */
function cleanText(raw: unknown, fallback: string): string {
  let text = typeof raw === 'string' ? raw.split('\u0000').join('').trim() : '';
  if (text.length > LTEXT_MAX_CHARS) {
    text = text.slice(0, LTEXT_MAX_CHARS);
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
    text = text.trimEnd();
  }
  return text === '' ? fallback : text;
}

/** The advancement rule of a phase when it advances at least one player. */
function usableRule(stage: LegacyStageInput | undefined): StoredRule | null {
  const rule = stage?.advancementRule;
  return rule !== null && rule !== undefined && Number.isFinite(rule.count) && rule.count >= 1 ? rule : null;
}

function selectOf(rule: StoredRule): AdvanceSelect {
  return rule.per_group
    ? { kind: 'per_group', n: clampInt(rule.count, 1, MAX_N_PER_GROUP) }
    : { kind: 'top_n', n: clampInt(rule.count, 1, MAX_N) };
}

function pairingOf(stage: LegacyStageInput): Pairing {
  switch (stage.bracketType) {
    case 'swiss':
      return { kind: 'swiss', rounds: 'auto', avoid_repeats: true };
    case 'single_elim':
      return { kind: 'single_elim', third_place: false };
    case 'double_elim':
      return { kind: 'double_elim', bracket_reset: stage.bracketResetEnabled !== false };
    default:
      return { kind: 'round_robin', legs: 1, mirror_legs: true };
  }
}

const isTable = (stage: LegacyStageInput): boolean => stage.bracketType === 'round_robin' || stage.bracketType === 'swiss';

/**
 * Today's scoring, per bracket type (it is not uniform, and the descriptor says so rather than hiding it):
 * - round robin: 3 per win (`pointsPerWin` of the round-robin table, `src/lib/league-hub/views.ts`, and of the
 *   tournament tabs); a round-robin bye is a rest round worth nothing (`scoringByeRecords` in
 *   `src/lib/tournament/byes.ts`);
 * - Swiss: 1 per win and a bye scores as a win (`computeStandings` default, `scoringByeRecords`);
 * - elimination stages: 1 per win, no table, no byes that score;
 * - Evolution Point Buy: the standings take the points per win from the pack (`effectiveMatchPoints`,
 *   `src/lib/tournament/standings-rules.ts`) in round robin and Swiss alike, whatever the caller passes. Neither
 *   scores a bye (`formatScoresByes`).
 * Draws and forfeits are never set: the match model has neither.
 */
function scoringOf(stage: LegacyStageInput, evolutionPointBuy: boolean, pack: LegacyPack): Scoring {
  const table = isTable(stage);
  if (table && evolutionPointBuy) {
    const win = effectiveMatchPoints('evolution_point_buy', {}, pack.epb).pointsPerWin;
    const fallback = stage.bracketType === 'swiss' ? 1 : ROUND_ROBIN_MATCH_POINTS.pointsPerWin;
    const value = win !== undefined && Number.isFinite(win) ? win : fallback;
    return { win: Math.min(SCORE_ABS_MAX, Math.max(-SCORE_ABS_MAX, value)), loss: 0, bye: 0 };
  }
  if (stage.bracketType === 'round_robin') return { win: ROUND_ROBIN_MATCH_POINTS.pointsPerWin, loss: 0, bye: 0 };
  if (stage.bracketType === 'swiss') return { win: 1, loss: 0, bye: 1 };
  return { win: 1, loss: 0, bye: 0 };
}

/**
 * Today's tie-break order. Table stages outside Evolution Point Buy sort by points, KO differential, Buchholz and
 * wins (`computeStandings`, `src/lib/tournament/standings.ts`). Evolution Point Buy sorts by the league's stored
 * tiebreaker order when it is a usable chain, else by the pack's chain (`effectiveTiebreakerChain`,
 * `src/lib/tournament/standings-rules.ts`, the helper the standings use): match points, KO difference,
 * head-to-head and the decision match map to kit steps one by one; evolution points have no kit metric and are left
 * out here (the module facts keep their position). Elimination stages have no rank chain.
 */
function rankOf(stage: LegacyStageInput, evolutionPointBuy: boolean, pack: LegacyPack, rules: LegacyFacts['formatRules']): RankStep[] {
  if (!isTable(stage)) return [];
  if (!evolutionPointBuy) {
    return [
      { kind: 'metric', metric: 'points', direction: 'desc' },
      { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
      { kind: 'metric', metric: 'buchholz', direction: 'desc' },
      { kind: 'metric', metric: 'wins', direction: 'desc' },
    ];
  }
  const steps: RankStep[] = [];
  for (const step of effectiveTiebreakerChain(rules, pack.epb)) {
    if (step === 'match_points') steps.push({ kind: 'metric', metric: 'points', direction: 'desc' });
    else if (step === 'kill_difference') steps.push({ kind: 'metric', metric: 'kill_differential', direction: 'desc' });
    else if (step === 'head_to_head') steps.push({ kind: 'head_to_head', scope: 'pairwise' });
    else if (step === 'decision_match') steps.push({ kind: 'decision_match' });
  }
  return steps;
}

/**
 * Groups of a phase: its own generated groups, else (round robin only) the league's groups, because phases mirror
 * the league groups and may not be generated yet. Placement is manual when the league has groups of its own.
 */
function groupsOf(stage: LegacyStageInput, leagueGroups: number): Stage['groups'] {
  const own = Number.isFinite(stage.groupCount) ? stage.groupCount : 0;
  const count = own >= MIN_GROUPS ? own : stage.bracketType === 'round_robin' && leagueGroups >= MIN_GROUPS ? leagueGroups : 0;
  if (count < MIN_GROUPS) return undefined;
  return { count: Math.min(MAX_GROUPS, Math.trunc(count)), method: leagueGroups >= MIN_GROUPS ? 'manual' : 'serpentine' };
}

function boundedBody(lines: readonly string[]): string {
  let body = '';
  for (const line of lines) {
    const next = body === '' ? line : `${body}\n${line}`;
    if (next.length > LTEXT_MAX_CHARS) break;
    body = next;
  }
  return body;
}

export function describeLegacy(input: LegacyInput): FormatDefinition {
  const { season, pack } = input;
  const tr: LegacyTexts = {
    en: createTranslator(formatStudioLegacyMessages, 'en'),
    de: createTranslator(formatStudioLegacyMessages, 'de'),
  };
  const base: Locale = season.language === 'de' ? 'de' : 'en';
  const proper = (text: string): LText => ltext(base, text, text);
  const evolutionPointBuy = season.formatType === 'evolution_point_buy';

  const stages = (input.stages ?? [])
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => (Number.isFinite(a.stage.stageOrder) ? a.stage.stageOrder : 0) - (Number.isFinite(b.stage.stageOrder) ? b.stage.stageOrder : 0) || a.index - b.index)
    .slice(0, MAX_STAGES)
    .map((entry) => entry.stage);

  const indexById = new Map<string, number>();
  stages.forEach((stage, index) => {
    if (!indexById.has(stage.id)) indexById.set(stage.id, index);
  });
  const keyOf = (index: number): string => `stage_${index + 1}`;

  // Edges. A phase takes its players from an earlier phase it names (enrollment by standings), else from the phase
  // directly before it when that one advances players, else from the roster.
  const edges: Edge[] = [];
  const hasIncoming = new Set<number>();
  const consumed = new Set<number>();
  for (let index = 1; index < stages.length; index += 1) {
    const source = stages[index].enrollmentSource;
    let from = -1;
    let select: AdvanceSelect[] = [];
    if (source !== null && source.type === 'standings' && source.source_phase_id !== null) {
      const named = indexById.get(source.source_phase_id);
      if (named !== undefined && named < index) {
        from = named;
        const rule = usableRule(stages[named]);
        select = rule === null ? [{ kind: 'manual_list' }] : [selectOf(rule)];
        if (rule !== null) consumed.add(named);
      }
    }
    if (from < 0 && (source === null || source.type !== 'roster')) {
      const rule = usableRule(stages[index - 1]);
      if (rule !== null) {
        from = index - 1;
        select = [selectOf(rule)];
        consumed.add(index - 1);
      }
    }
    if (from < 0) continue;
    hasIncoming.add(index);
    edges.push({
      key: `advance_${from + 1}_${index + 1}`,
      from: keyOf(from),
      to: keyOf(index),
      select,
      seeding: 'rank',
      gate: 'admin_confirm',
    });
  }

  const sections: TextSection[] = [];
  const outStages: Stage[] = stages.map((stage, index) => {
    const key = keyOf(index);
    const fallback = tr.en('stage.fallback', { n: index + 1 });
    const name = cleanText(stage.name, fallback);
    const { overrides, unmapped } = mapOverrides(stage.bracketType, stage.boOverrides);
    if (unmapped.length > 0) {
      const lines = (locale: 'en' | 'de') =>
        unmapped.flatMap((entry) => {
          const round = cleanText(entry.name, '');
          return round === '' ? [] : [tr[locale]('override.line', { round, best_of: entry.bestOf })];
        });
      const en = boundedBody(lines('en'));
      const de = boundedBody(lines('de'));
      if (en !== '' && de !== '') {
        sections.push({
          id: `bo_stage_${index + 1}`,
          title: ltext('en', tr.en('override.title', { stage: name }), tr.de('override.title', { stage: name })),
          body: ltext('en', en, de),
          stage: key,
        });
      }
    }
    const unused = usableRule(stage);
    if (unused !== null && !consumed.has(index)) {
      const ruleKey = unused.per_group ? 'advancement.rule_per_group' : 'advancement.rule_top_n';
      const count = clampInt(unused.count, 1, unused.per_group ? MAX_N_PER_GROUP : MAX_N);
      const sentence = (locale: 'en' | 'de') =>
        tr[locale]('advancement.unused', { stage: name, rule: tr[locale].dynamic(ruleKey, { count }) });
      sections.push({
        id: `adv_unused_${index + 1}`,
        title: ltext('en', tr.en('advancement.unused_title', { stage: name }), tr.de('advancement.unused_title', { stage: name })),
        body: ltext('en', sentence('en'), sentence('de')),
        stage: key,
      });
    }

    const groups = groupsOf(stage, season.leagueGroupCount);
    const rulesetId = stage.rulesetId;
    const ownRuleset =
      isUuid(rulesetId) && (season.rulesetId === null || rulesetId.toLowerCase() !== season.rulesetId.toLowerCase());
    return {
      key,
      name: proper(name),
      participants: hasIncoming.has(index)
        ? { from: 'edges', seeding: 'edge_order' }
        : { from: 'roster', seeding: 'manual' },
      ...(groups === undefined ? {} : { groups }),
      pairing: pairingOf(stage),
      series: { best_of: clampInt(stage.bestOfDefault, 1, MAX_BEST_OF), allow_draw: false, overrides },
      ruleset: ownRuleset ? { kind: 'ruleset', id: rulesetId } : { kind: 'season_default' },
      doubles: stage.isDoubles === true || season.formatType === 'doubles',
      players_per_match: 2,
      scoring: scoringOf(stage, evolutionPointBuy, pack),
      rank: rankOf(stage, evolutionPointBuy, pack, input.facts.formatRules),
      columns: [],
    };
  });

  const seasonName = cleanText(season.name, '');
  const description = cleanText(season.description, '');
  return {
    schema_version: 1,
    identity: {
      name: seasonName === '' ? ltext(base, tr.en('season.fallback'), tr.de('season.fallback')) : proper(seasonName),
      ...(description === '' ? {} : { summary: proper(description) }),
    },
    stages: outStages,
    edges,
    views: [],
    rules: [],
    // The kit allows 32 sections; a league with that many unmappable settings keeps the first 32.
    text: { sections: sections.slice(0, MAX_TEXT_SECTIONS) },
    theme: { world: isKey(season.routeTheme) ? season.routeTheme : 'auto' },
    modules: buildModules(input, tr),
  };
}
