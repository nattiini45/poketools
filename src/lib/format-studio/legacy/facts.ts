/**
 * The legacy modules of a descriptor: the settings of an existing league format that the kit has no primitive for
 * yet (core pool and assigned cores, draft tier limits, Evolution Point Buy tuning). A module carries data only:
 * it states what the league is configured with, never that the kit runs it. Labels are written in both languages
 * from the `format-studio/legacy` catalog; values are plain strings, numbers and booleans.
 *
 * The facts are a read-only picture. The settings themselves stay in the league admin (participants, rules).
 */
import { MAX_FACTS, ltext, type LegacyFact, type LegacyModule } from '@/lib/format-kit/client';
import type { Translator } from '@/i18n/core';
import type { formatStudioLegacyMessages } from '@/i18n/messages/format-studio/legacy';
import { effectiveTiebreakerChain } from '@/lib/tournament/standings-rules';
import type { LegacyInput } from './types';

type LegacyT = Translator<(typeof formatStudioLegacyMessages)['en']>;

/** Both languages of the legacy catalog; the descriptor stores both in the document. */
export interface LegacyTexts {
  en: LegacyT;
  de: LegacyT;
}

type FactKey = keyof (typeof formatStudioLegacyMessages)['en']['facts'];
type FactValue = string | number | boolean;

function fact(tr: LegacyTexts, key: FactKey, value: FactValue | null | undefined): LegacyFact | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const path = `facts.${key}`;
  return { key, label: ltext('en', tr.en.dynamic(path), tr.de.dynamic(path)), value };
}

function compact(entries: readonly (LegacyFact | null)[]): LegacyFact[] {
  return entries.filter((entry): entry is LegacyFact => entry !== null).slice(0, MAX_FACTS);
}

function coreLigaModule(input: LegacyInput, tr: LegacyTexts): LegacyModule | null {
  const { season, facts } = input;
  const assignments = facts.typeAssignments;
  const classic = season.formatType === 'singles' || season.formatType === 'doubles' || season.formatType === 'draft';
  if (!classic) return null;
  const used = season.corePoolSize !== null || (assignments?.cored ?? 0) > 0 || (assignments?.gymTyped ?? 0) > 0;
  if (!used) return null;
  return {
    kind: 'module.legacy',
    adapter: 'core_liga',
    facts: compact([
      fact(tr, 'core_pool_size', season.corePoolSize),
      fact(tr, 'cores_assigned', assignments?.cored),
      fact(tr, 'gym_types_assigned', assignments?.gymTyped),
      fact(tr, 'roster_size', season.participantCount),
    ]),
  };
}

const TIERS = ['S', 'A', 'B', 'C'] as const;

function legacyDraftModule(input: LegacyInput, tr: LegacyTexts): LegacyModule | null {
  if (input.season.formatType !== 'draft') return null;
  const limits = input.facts.draftTierLimits ?? [];
  const entries = TIERS.map((tier) => {
    const limit = limits.find((entry) => entry.tier === tier);
    return limit === undefined ? null : fact(tr, `tier_limit_${tier.toLowerCase()}` as FactKey, limit.maxPicks);
  });
  return { kind: 'module.legacy', adapter: 'legacy_draft', facts: compact(entries) };
}

function epbModule(input: LegacyInput, tr: LegacyTexts): LegacyModule | null {
  if (input.season.formatType !== 'evolution_point_buy') return null;
  const epb = input.pack.epb;
  const rules = input.facts.formatRules;
  const tera = rules?.tera_rules ?? epb.teraByStage;

  // The positions come from the chain the standings rank by: the stored `tiebreaker_order` when it is usable, else
  // the pack's chain (`effectiveTiebreakerChain`, shared with the standings).
  const seen = new Set<string>();
  const tiebreaks: (LegacyFact | null)[] = [];
  effectiveTiebreakerChain(rules, epb).forEach((step, index) => {
    if (seen.has(step)) return;
    seen.add(step);
    const key = `tiebreak_${step}`;
    if (tr.en.has(`facts.${key}`)) tiebreaks.push(fact(tr, key as FactKey, index + 1));
  });

  return {
    kind: 'module.legacy',
    adapter: 'epb',
    facts: compact([
      fact(tr, 'match_points_win', epb.matchPoints.win),
      ...tiebreaks,
      fact(tr, 'tera_stage1', tera.stage1),
      fact(tr, 'tera_stage2', tera.stage2),
      fact(tr, 'tera_stage3', tera.stage3),
      fact(tr, 'draft_budget', rules?.draft_budget ?? epb.defaults.draftBudget),
      fact(tr, 'draft_picks', rules?.draft_picks ?? epb.defaults.draftPicks),
      fact(tr, 'draft_token_ratio', rules?.draft_token_ratio ?? epb.defaults.tokenRatio),
      fact(tr, 'draft_token_max', rules?.draft_token_max ?? epb.defaults.tokenMax),
      fact(tr, 'draft_token_max_per_line', rules?.draft_token_max_per_line ?? epb.defaults.tokenMaxPerLine),
      fact(tr, 'redraft_open', rules?.redraft_phase_open ?? false),
      fact(tr, 'banned_moves', (rules?.banned_moves ?? epb.defaults.bannedMoves).length),
      fact(tr, 'banned_items', (rules?.banned_items ?? epb.defaults.bannedItems).length),
      fact(tr, 'stage_lock_enabled', epb.stageLock.enabled),
      fact(tr, 'stage_lock_stage', epb.stageLock.stage),
      fact(tr, 'stage_lock_by_matchday', epb.stageLock.byMatchday),
      fact(tr, 'stage_lock_suspend_matchdays', epb.stageLock.suspendMatchdays),
      fact(tr, 'participation_per_matchday', epb.participationPoints.perMatchday),
      fact(tr, 'participation_until_stage', epb.participationPoints.untilStage),
      fact(tr, 'comeback_earn_window', epb.comeback.earnWindow),
    ]),
  };
}

/** At most one module per adapter, in a fixed order (Core Liga, draft, Evolution Point Buy). */
export function buildModules(input: LegacyInput, tr: LegacyTexts): LegacyModule[] {
  return [coreLigaModule(input, tr), legacyDraftModule(input, tr), epbModule(input, tr)].filter(
    (entry): entry is LegacyModule => entry !== null,
  );
}
