/**
 * `planReadiness(plan, facts)`: why Build is disabled, as data (plan 4.3 "Rules", 3.3 preflight, spec §18.3).
 *
 * A Plan is `ready` when it has no blockers. A blocker is a typed code, the section it belongs to, a JSON pointer to
 * the field to fix and plain-valued params; the Plan panel renders it through the i18n catalogs and the "Fix" shortcut
 * jumps to `path`. Blockers are separate from schema issues (./schema.ts): a blocker means the document is well formed
 * but cannot be built yet, so the admin can keep editing the Plan.
 *
 * Everything outside the Plan arrives as `PlanFacts` (./facts.ts); a needed fact that is missing is the blocker
 * `fact_unavailable` (fail closed). `warnings` use the same shape but never block (`league_name_in_use`).
 *
 * Codes that mirror an answer a route already gives keep that route's code (`SEASON_DATES_INVALID`,
 * `SEASON_GROUP_REQUIRED`, ...); the assistant's own codes are lower-case. `PLAN_BLOCKERS[code].catalog` says which
 * error catalog already has the code (`'catalog'`) and which need an entry in `errors/admin-assistant` (`'todo'`).
 */
import { dexFactKey, type PlanFacts } from './facts';
import { PLAN_ENGINE_SUPPORT } from './engine-support';
import { BUILD_LIMITS } from './ops';
import {
  RULESET_DELTA_CATEGORIES,
  phaseRefKey,
  roundRobinLegsKey,
  type PlanDocument,
  type PlanRulesetRef,
} from './schema';
import { deriveSteps, resolvedRosterIds, summarizeBuild } from './steps';
import { scanPlanText } from './text';

export type BlockerKind = 'input' | 'engine_gap' | 'invalid' | 'prerequisite' | 'fact';
export type PlanSection = 'plan' | 'ruleset' | 'format' | 'league' | 'phases' | 'roster' | 'groups' | 'draft' | 'tournament';

interface BlockerInfo {
  kind: BlockerKind;
  /** `catalog`: the code is already in an error catalog; `todo`: it needs an entry in `errors/admin-assistant`. */
  catalog: 'catalog' | 'todo';
}

export const PLAN_BLOCKERS = {
  // Plan
  plan_incomplete: { kind: 'input', catalog: 'todo' },
  nothing_to_build: { kind: 'prerequisite', catalog: 'catalog' },
  text_not_allowed: { kind: 'invalid', catalog: 'catalog' },
  build_too_large: { kind: 'invalid', catalog: 'catalog' },
  built_entity_unavailable: { kind: 'prerequisite', catalog: 'todo' },
  fact_unavailable: { kind: 'fact', catalog: 'todo' },
  // League
  SEASON_DATES_INVALID: { kind: 'invalid', catalog: 'catalog' },
  clone_with_own_phases: { kind: 'invalid', catalog: 'todo' },
  custom_league_has_phases: { kind: 'input', catalog: 'todo' },
  // Ruleset and format
  ruleset_missing: { kind: 'input', catalog: 'todo' },
  ruleset_unpublished: { kind: 'prerequisite', catalog: 'catalog' },
  ruleset_not_found: { kind: 'invalid', catalog: 'catalog' },
  ruleset_forbidden: { kind: 'invalid', catalog: 'catalog' },
  ruleset_document_invalid: { kind: 'invalid', catalog: 'catalog' },
  ruleset_owner_quota_exceeded: { kind: 'invalid', catalog: 'catalog' },
  ruleset_auto_epb_wrong_format: { kind: 'invalid', catalog: 'todo' },
  base_format_unknown: { kind: 'invalid', catalog: 'catalog' },
  ban_name_unresolved: { kind: 'input', catalog: 'catalog' },
  forme_expansion_needed: { kind: 'input', catalog: 'catalog' },
  format_requires_custom_league: { kind: 'invalid', catalog: 'todo' },
  format_unavailable: { kind: 'invalid', catalog: 'todo' },
  // Phases and tournament
  double_round_robin_unsupported: { kind: 'engine_gap', catalog: 'todo' },
  advancement_rule_on_first_phase: { kind: 'invalid', catalog: 'todo' },
  advancement_per_group_needs_groups: { kind: 'invalid', catalog: 'todo' },
  advancement_exceeds_roster: { kind: 'invalid', catalog: 'todo' },
  bo_override_key_unknown: { kind: 'invalid', catalog: 'catalog' },
  // Roster
  roster_unresolved: { kind: 'input', catalog: 'todo' },
  roster_count_mismatch: { kind: 'input', catalog: 'todo' },
  roster_duplicate: { kind: 'invalid', catalog: 'todo' },
  roster_required: { kind: 'input', catalog: 'todo' },
  player_not_found: { kind: 'invalid', catalog: 'todo' },
  player_not_eligible: { kind: 'invalid', catalog: 'catalog' },
  participant_already_enrolled: { kind: 'invalid', catalog: 'catalog' },
  // Groups
  SEASON_GROUPS_TOO_MANY: { kind: 'invalid', catalog: 'catalog' },
  // Draft
  draft_not_supported_for_format: { kind: 'invalid', catalog: 'catalog' },
  draft_engine_mismatch: { kind: 'invalid', catalog: 'todo' },
  draft_groups_need_point_buy: { kind: 'invalid', catalog: 'catalog' },
  SEASON_GROUP_REQUIRED: { kind: 'invalid', catalog: 'catalog' },
  SEASON_GROUP_INVALID: { kind: 'invalid', catalog: 'catalog' },
  POINT_BUDGET_REQUIRED: { kind: 'invalid', catalog: 'catalog' },
  draft_auction_order_not_free: { kind: 'invalid', catalog: 'catalog' },
  SEASON_HAS_NO_LIST: { kind: 'invalid', catalog: 'catalog' },
  participant_order_not_in_roster: { kind: 'invalid', catalog: 'todo' },
  // Warnings (never block)
  league_name_in_use: { kind: 'input', catalog: 'todo' },
} as const satisfies Record<string, BlockerInfo>;

export type PlanBlockerCode = keyof typeof PLAN_BLOCKERS;
export const PLAN_BLOCKER_CODES = Object.keys(PLAN_BLOCKERS) as PlanBlockerCode[];

export type BlockerParams = Record<string, string | number | boolean>;

export interface PlanBlocker {
  code: PlanBlockerCode;
  kind: BlockerKind;
  section: PlanSection;
  /** RFC 6901 pointer to the field that fixes it (the "Fix" shortcut target). */
  path: string;
  params: BlockerParams;
}

export type SectionState = 'empty' | 'ready' | 'needs_input' | 'assumed' | 'engine_gap' | 'built';

export interface SectionChip {
  state: SectionState;
  blockers: number;
  /** Roster only: resolved entries and the target. */
  resolved?: number;
  target?: number;
}

export interface PlanReadiness {
  ready: boolean;
  blockers: PlanBlocker[];
  warnings: PlanBlocker[];
  sections: Record<PlanSection, SectionChip>;
}

const lower = (id: string): string => id.toLowerCase();
const SECTIONS: PlanSection[] = ['plan', 'ruleset', 'format', 'league', 'phases', 'roster', 'groups', 'draft', 'tournament'];

/** Which section an assumption belongs to, by the prefix of its key (`league.language`, `legs.regular_season`). */
function assumptionSection(key: string): PlanSection | null {
  const head = key.split(/[.:]/, 1)[0];
  if (head === 'legs' || head === 'phase' || head === 'phases') return 'phases';
  return (SECTIONS as string[]).includes(head) ? (head as PlanSection) : null;
}

export function planReadiness(plan: PlanDocument, facts: PlanFacts = {}): PlanReadiness {
  const blockers: PlanBlocker[] = [];
  const warnings: PlanBlocker[] = [];
  const add = (code: PlanBlockerCode, section: PlanSection, path: string, params: BlockerParams = {}, into = blockers) => {
    into.push({ code, kind: PLAN_BLOCKERS[code].kind, section, path, params });
  };
  const missingFact = (section: PlanSection, path: string, kind: string, id: string) =>
    add('fact_unavailable', section, path, { kind, id });

  const { league, ruleset, format, phases, roster, groups, draft, tournament } = plan.slots;
  const engineLegs = facts.engine?.roundRobinLegs ?? PLAN_ENGINE_SUPPORT.roundRobinLegs;

  // ── Plan shape ──
  const needed = new Set<string>();
  const need = (slot: string, present: boolean) => {
    if (present || needed.has(slot)) return;
    needed.add(slot);
    add('plan_incomplete', 'plan', `/slots/${slot}`, { missing: slot });
  };
  if (plan.intent === 'league') need('league', league !== undefined);
  if (plan.intent === 'tournament') need('tournament', tournament !== undefined);
  if (plan.intent === 'mixed') need('league', league !== undefined || tournament !== undefined);
  if ((phases?.length ?? 0) > 0) need('league', league !== undefined);
  if (roster !== undefined) need('league', league !== undefined);
  if (groups?.mode === 'serpentine') need('league', league !== undefined);
  if ((draft?.length ?? 0) > 0) need('league', league !== undefined);

  for (const finding of scanPlanText(plan)) {
    add('text_not_allowed', finding.path.startsWith('/slots/ruleset') ? 'ruleset' : 'plan', finding.path, { reason: finding.reason });
  }

  // ── Built entities must still answer ──
  for (const refKey of Object.keys(plan.refs)) {
    const state = facts.refs?.[refKey];
    if (state === undefined) missingFact('plan', `/refs/${refKey}`, 'ref', refKey);
    else if (state !== 'live') add('built_entity_unavailable', 'plan', `/refs/${refKey}`, { ref: refKey, state });
  }

  // ── League ──
  if (league) {
    if (league.start_date !== undefined && league.end_date !== undefined && league.end_date < league.start_date) {
      add('SEASON_DATES_INVALID', 'league', '/slots/league/end_date');
    }
    if (league.clone_from && (phases?.length ?? 0) > 0) add('clone_with_own_phases', 'league', '/slots/league/clone_from');
    if (league.format_type === 'custom' && (phases?.length ?? 0) > 0) add('custom_league_has_phases', 'phases', '/slots/phases');
    if (facts.leagueNameInUse === true) add('league_name_in_use', 'league', '/slots/league/name', {}, warnings);
  }

  // ── Format (attached later, by its own Go-live card) ──
  if (format && format.mode !== 'none') {
    if (league && league.format_type !== 'custom') add('format_requires_custom_league', 'format', '/slots/format');
    const fact = facts.formats?.[lower(format.definition_id)];
    if (fact === undefined) missingFact('format', '/slots/format', 'format', format.definition_id);
    else if (fact.state !== 'ok') add('format_unavailable', 'format', '/slots/format', { state: fact.state });
    else if ((fact.maxRoundRobinLegs ?? 1) > engineLegs) {
      add('double_round_robin_unsupported', 'format', '/slots/format', { source: 'format', legs: fact.maxRoundRobinLegs ?? 1, supported: engineLegs });
    }
  }

  // ── Ruleset ──
  const consumers: Array<{ path: string; section: PlanSection; ref: PlanRulesetRef }> = [];
  (phases ?? []).forEach((phase, index) => consumers.push({ path: `/slots/phases/${index}/ruleset`, section: 'phases', ref: phase.ruleset }));
  if (tournament) consumers.push({ path: '/slots/tournament/ruleset', section: 'tournament', ref: tournament.ruleset });
  const usesSlot = consumers.some((consumer) => consumer.ref === 'plan') || (league !== undefined && ruleset !== undefined);

  for (const consumer of consumers) {
    if (consumer.ref === 'plan') {
      if (ruleset === undefined) add('ruleset_missing', consumer.section, consumer.path, { consumer: consumer.section });
    } else {
      const fact = facts.rulesetVersions?.[lower(consumer.ref.id)];
      if (fact === undefined) missingFact(consumer.section, consumer.path, 'ruleset_version', consumer.ref.id);
      else if (fact === 'not_found') add('ruleset_not_found', consumer.section, consumer.path, { id: consumer.ref.id });
      else if (fact === 'forbidden') add('ruleset_forbidden', consumer.section, consumer.path, { id: consumer.ref.id });
    }
  }

  if (ruleset) {
    if (ruleset.mode === 'auto_epb') {
      if (league === undefined || league.format_type !== 'evolution_point_buy') {
        add('ruleset_auto_epb_wrong_format', 'ruleset', '/slots/ruleset/mode');
      }
    } else if (ruleset.mode === 'existing') {
      if (usesSlot) {
        const fact = facts.rulesetVersions?.[lower(ruleset.version_id)];
        if (fact === undefined) missingFact('ruleset', '/slots/ruleset/version_id', 'ruleset_version', ruleset.version_id);
        else if (fact === 'not_found') add('ruleset_not_found', 'ruleset', '/slots/ruleset/version_id', { id: ruleset.version_id });
        else if (fact === 'forbidden') add('ruleset_forbidden', 'ruleset', '/slots/ruleset/version_id', { id: ruleset.version_id });
      }
    } else {
      // draft, new, fork: a league, phase or tournament can pin only a PUBLISHED version, so it needs its own G card first.
      if (usesSlot) add('ruleset_unpublished', 'ruleset', '/slots/ruleset', { mode: ruleset.mode });
      if (ruleset.mode === 'draft' || ruleset.mode === 'fork') {
        const id = ruleset.mode === 'draft' ? ruleset.definition_id : ruleset.from_definition_id;
        const path = ruleset.mode === 'draft' ? '/slots/ruleset/definition_id' : '/slots/ruleset/from_definition_id';
        const fact = facts.rulesetDefinitions?.[lower(id)];
        if (fact === undefined) missingFact('ruleset', path, 'ruleset_definition', id);
        else if (fact.state === 'not_found') add('ruleset_not_found', 'ruleset', path, { id });
        else if (fact.state === 'forbidden') add('ruleset_forbidden', 'ruleset', path, { id });
        else if (ruleset.mode === 'draft' && (fact.diagnosticsErrors ?? 0) > 0) {
          add('ruleset_document_invalid', 'ruleset', path, { errors: fact.diagnosticsErrors ?? 0 });
        }
      }
      if (ruleset.mode === 'new' || ruleset.mode === 'fork') {
        if (facts.rulesetQuota === undefined) missingFact('ruleset', '/slots/ruleset', 'ruleset_quota', 'owner');
        else if (facts.rulesetQuota.owned >= facts.rulesetQuota.max) {
          add('ruleset_owner_quota_exceeded', 'ruleset', '/slots/ruleset', { max: facts.rulesetQuota.max });
        }
        if (ruleset.mode === 'new' && ruleset.preset !== undefined) {
          const fact = facts.rulesetPresets?.[ruleset.preset];
          if (fact === undefined) missingFact('ruleset', '/slots/ruleset/preset', 'ruleset_preset', ruleset.preset);
          else if (!fact.known) add('base_format_unknown', 'ruleset', '/slots/ruleset/preset', { preset: ruleset.preset });
        }
        for (const category of RULESET_DELTA_CATEGORIES) {
          const delta = ruleset.delta[category];
          const lists: Array<[string, string[]]> = [['ban', delta.ban], ['unban', delta.unban], ['allow', delta.allow ?? []]];
          for (const [listName, ids] of lists) {
            ids.forEach((id, index) => {
              const path = `/slots/ruleset/delta/${category}/${listName}/${index}`;
              const fact = facts.dex?.[dexFactKey(category, id)];
              if (fact === undefined) missingFact('ruleset', path, 'dex', dexFactKey(category, id));
              else if (fact === 'unknown') add('ban_name_unresolved', 'ruleset', path, { category, name: id });
              else if (fact === 'forme_expansion_needed') add('forme_expansion_needed', 'ruleset', path, { name: id });
            });
          }
        }
      }
    }
  }

  // ── Roster ──
  const resolvedIds = resolvedRosterIds(plan);
  const entries = roster?.entries ?? [];
  const open = entries.filter((entry) => entry.state === 'candidates' || entry.state === 'unresolved').length;
  if (roster) {
    if (open > 0) add('roster_unresolved', 'roster', '/slots/roster/entries', { count: open });
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (entry.state !== 'resolved') return;
      const id = lower(entry.player_id);
      if (seen.has(id)) add('roster_duplicate', 'roster', `/slots/roster/entries/${index}`, { player_id: entry.player_id });
      seen.add(id);
      const fact = facts.players?.[id];
      const path = `/slots/roster/entries/${index}/player_id`;
      if (fact === undefined) missingFact('roster', path, 'player', entry.player_id);
      else if (fact.status === 'not_found') add('player_not_found', 'roster', path, { player_id: entry.player_id });
      else if (fact.status !== 'ok') add('player_not_eligible', 'roster', path, { player_id: entry.player_id, reason: fact.status });
      if (facts.enrolledPlayerIds?.some((enrolled) => lower(enrolled) === id)) {
        add('participant_already_enrolled', 'roster', path, { player_id: entry.player_id });
      }
    });
    if (open === 0 && roster.target_count !== undefined && resolvedIds.length !== roster.target_count) {
      add('roster_count_mismatch', 'roster', '/slots/roster/target_count', { target: roster.target_count, resolved: resolvedIds.length });
    }
  }
  const rosterKnown = roster !== undefined && open === 0;
  const participants = resolvedIds.length + (facts.liveRosterCount ?? 0);

  // The first phase enrolls the roster at creation, so a roster must exist before any phase step runs.
  const pendingPhase = (phases ?? []).some((phase) => plan.refs[phaseRefKey(phase.key)] === undefined);
  if (league && pendingPhase && plan.refs.roster === undefined && !league.clone_from?.copy_roster && participants < 2 && open === 0) {
    add('roster_required', 'roster', '/slots/roster', { needed: 2 });
  }

  // ── Phases ──
  (phases ?? []).forEach((phase, index) => {
    const base = `/slots/phases/${index}`;
    if (phase.advancement_rule !== undefined) {
      if (index === 0) add('advancement_rule_on_first_phase', 'phases', `${base}/advancement_rule`, { phase: phase.key });
      if (phase.advancement_rule.per_group && groups?.mode !== 'serpentine') {
        add('advancement_per_group_needs_groups', 'phases', `${base}/advancement_rule/per_group`, { phase: phase.key });
      }
      if (rosterKnown) {
        const groupCount = phase.advancement_rule.per_group && groups?.mode === 'serpentine' ? groups.count ?? 1 : 1;
        const capacity = phase.advancement_rule.per_group ? Math.floor(participants / groupCount) : participants;
        if (phase.advancement_rule.count > capacity) {
          add('advancement_exceeds_roster', 'phases', `${base}/advancement_rule/count`, {
            phase: phase.key,
            count: phase.advancement_rule.count,
            available: capacity,
          });
        }
      }
    }
    // A double round robin has no field in the Plan; the request is recorded as the `legs.<phase>` assumption.
    const asked = plan.assumptions.find((assumption) => assumption.key === roundRobinLegsKey(phase.key));
    if (phase.bracket_type === 'round_robin' && asked !== undefined && typeof asked.value === 'number' && asked.value > engineLegs) {
      add('double_round_robin_unsupported', 'phases', `${base}/bracket_type`, { source: 'plan', phase: phase.key, legs: asked.value, supported: engineLegs });
    }
    for (const key of facts.unknownBoOverrideKeys?.[phase.key] ?? []) {
      add('bo_override_key_unknown', 'phases', `${base}/bo_overrides`, { key, phase: phase.key });
    }
  });
  for (const check of [...(phases ?? []).map((p) => p.key), ...(tournament ? ['tournament'] : [])]) {
    const hasOverrides = check === 'tournament' ? tournament?.bo_overrides : phases?.find((p) => p.key === check)?.bo_overrides;
    if (hasOverrides && Object.keys(hasOverrides).length > 0 && facts.unknownBoOverrideKeys?.[check] === undefined) {
      missingFact(check === 'tournament' ? 'tournament' : 'phases', check === 'tournament' ? '/slots/tournament/bo_overrides' : '/slots/phases', 'bo_override_keys', check);
    }
  }
  for (const key of facts.unknownBoOverrideKeys?.tournament ?? []) {
    add('bo_override_key_unknown', 'tournament', '/slots/tournament/bo_overrides', { key, phase: 'tournament' });
  }

  // ── Groups ──
  if (groups?.mode === 'serpentine' && groups.count !== undefined && rosterKnown && participants < groups.count * 2) {
    add('SEASON_GROUPS_TOO_MANY', 'groups', '/slots/groups/count', { participants, count: groups.count });
  }

  // ── Draft setup ──
  if (draft && draft.length > 0 && league) {
    const groupKeys = groups?.mode === 'serpentine' && groups.count !== undefined
      ? Array.from({ length: groups.count }, (_, i) => String.fromCharCode(65 + i))
      : [];
    const grouped = groupKeys.length > 0;
    if (league.format_type === 'custom') add('draft_not_supported_for_format', 'draft', '/slots/draft');
    const rosterSet = new Set(resolvedIds.map(lower));
    draft.forEach((entry, index) => {
      const base = `/slots/draft/${index}`;
      if (entry.engine === 'queue' && league.format_type !== 'evolution_point_buy') {
        add('draft_engine_mismatch', 'draft', `${base}/engine`, { engine: entry.engine, format_type: league.format_type });
      }
      if (entry.engine === 'legacy' && league.format_type === 'evolution_point_buy') {
        add('draft_engine_mismatch', 'draft', `${base}/engine`, { engine: entry.engine, format_type: league.format_type });
      }
      if (grouped) {
        if (entry.engine === 'legacy') add('draft_groups_need_point_buy', 'draft', `${base}/engine`);
        else if (entry.group_key === undefined) add('SEASON_GROUP_REQUIRED', 'draft', `${base}/group_key`);
        else if (!groupKeys.includes(entry.group_key)) add('SEASON_GROUP_INVALID', 'draft', `${base}/group_key`, { group_key: entry.group_key });
      } else if (entry.group_key !== undefined) {
        add('SEASON_GROUP_INVALID', 'draft', `${base}/group_key`, { group_key: entry.group_key });
      }
      if (entry.engine === 'legacy') {
        const type = entry.draft_type ?? 'snake';
        if ((type === 'budget' || type === 'auction') && entry.budget === undefined) {
          add('POINT_BUDGET_REQUIRED', 'draft', `${base}/budget`, { draft_type: type });
        }
        if (type === 'auction' && entry.pick_order !== undefined && entry.pick_order !== 'free') {
          add('draft_auction_order_not_free', 'draft', `${base}/pick_order`);
        }
      }
      if (entry.participant_order && rosterKnown) {
        entry.participant_order.forEach((playerId, i) => {
          if (!rosterSet.has(lower(playerId))) {
            add('participant_order_not_in_roster', 'draft', `${base}/participant_order/${i}`, { player_id: playerId });
          }
        });
      }
    });
    if (league.format_type === 'evolution_point_buy' && draft.some((entry) => entry.engine === 'queue')) {
      if (facts.epbActiveListAvailable === undefined) missingFact('draft', '/slots/draft', 'epb_point_buy_list', 'active');
      else if (!facts.epbActiveListAvailable) add('SEASON_HAS_NO_LIST', 'draft', '/slots/draft');
    }
  }

  // ── Build size and content ──
  const steps = deriveSteps(plan);
  const summary = summarizeBuild(steps);
  if (summary.overLimit.length > 0) {
    add('build_too_large', 'plan', '/slots', { steps: summary.steps, creating: summary.creating, maxSteps: BUILD_LIMITS.steps, maxCreating: BUILD_LIMITS.creating });
  }
  if (steps.length === 0 && Object.keys(plan.refs).length === 0) add('nothing_to_build', 'plan', '/slots');

  return { ready: blockers.length === 0, blockers, warnings, sections: chips(plan, blockers, resolvedIds.length) };
}

function chips(plan: PlanDocument, blockers: readonly PlanBlocker[], resolved: number): Record<PlanSection, SectionChip> {
  const out = {} as Record<PlanSection, SectionChip>;
  const unconfirmed = new Set<PlanSection>();
  for (const assumption of plan.assumptions) {
    const section = assumptionSection(assumption.key);
    if (section !== null && !assumption.confirmed) unconfirmed.add(section);
  }
  const refsOf = (section: PlanSection): string[] => Object.keys(plan.refs).filter((key) => refSection(key) === section);
  const present = (section: PlanSection): boolean => {
    if (section === 'plan') return true;
    const slot = plan.slots[section];
    if (Array.isArray(slot)) return slot.length > 0;
    return slot !== undefined;
  };
  for (const section of SECTIONS) {
    const mine = blockers.filter((blocker) => blocker.section === section);
    let state: SectionState;
    if (mine.some((blocker) => blocker.kind === 'engine_gap')) state = 'engine_gap';
    else if (mine.length > 0) state = 'needs_input';
    else if (!present(section)) state = 'empty';
    else if (unconfirmed.has(section)) state = 'assumed';
    else if (refsOf(section).length > 0 && sectionBuilt(plan, section)) state = 'built';
    else state = 'ready';
    out[section] = { state, blockers: mine.length };
  }
  out.roster.resolved = resolved;
  if (plan.slots.roster?.target_count !== undefined) out.roster.target = plan.slots.roster.target_count;
  return out;
}

/** Which section a `refs` key belongs to. */
function refSection(refKey: string): PlanSection {
  if (refKey.startsWith('phase.')) return 'phases';
  if (refKey.startsWith('draft.')) return 'draft';
  return refKey as PlanSection;
}

/** A section is built when every slot part that has a step has its ref. */
function sectionBuilt(plan: PlanDocument, section: PlanSection): boolean {
  if (section === 'phases') return (plan.slots.phases ?? []).every((phase) => plan.refs[phaseRefKey(phase.key)] !== undefined);
  if (section === 'draft') {
    return (plan.slots.draft ?? []).every((entry) => plan.refs[`draft.${entry.group_key ?? 'all'}`] !== undefined);
  }
  return plan.refs[section] !== undefined;
}

