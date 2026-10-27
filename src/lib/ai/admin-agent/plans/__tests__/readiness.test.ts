import { describe, expect, it } from 'vitest';
import { dexFactKey, planFactNeeds } from '../facts';
import { PLAN_BLOCKERS, planReadiness, type PlanReadiness } from '../readiness';
import { parseOrThrow, PLAYERS, RULESET_DEFINITION, RULESET_VERSION, SEASON_ID, blockerCodes, okFacts, resolvedRoster, uid, workedExample, workedExampleUnpublished } from './fixtures';
import type { PlanDocument } from '../schema';

const edit = (plan: PlanDocument, slots: Record<string, unknown>, rest: Record<string, unknown> = {}): PlanDocument =>
  parseOrThrow({ ...plan, ...rest, slots: { ...plan.slots, ...slots } });

const codes = (plan: PlanDocument, facts = okFacts(plan)): string[] => blockerCodes(planReadiness(plan, facts));
const find = (readiness: PlanReadiness, code: string) => readiness.blockers.find((blocker) => blocker.code === code);

describe('planReadiness: the worked example (plan 4.10)', () => {
  it('is ready once the roster is resolved and the ruleset is a published version', () => {
    const plan = workedExample();
    const readiness = planReadiness(plan, okFacts(plan));
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready).toBe(true);
    expect(readiness.sections.league.state).toBe('ready');
    expect(readiness.sections.roster).toMatchObject({ state: 'ready', resolved: 12, target: 12 });
  });

  it('blocks Build while the ruleset is still an intent: publish it first (ruleset_unpublished)', () => {
    const plan = workedExampleUnpublished();
    const readiness = planReadiness(plan, okFacts(plan));
    expect(find(readiness, 'ruleset_unpublished')).toMatchObject({ section: 'ruleset', path: '/slots/ruleset', params: { mode: 'new' }, kind: 'prerequisite' });
    expect(readiness.ready).toBe(false);
    // The chip shows the assumption but the blocker wins.
    expect(readiness.sections.ruleset.state).toBe('needs_input');
  });

  it('reproduces the first-turn state: roster 0/12, a double round robin gap, nothing buildable', () => {
    const plan = parseOrThrow({
      ...workedExampleUnpublished(),
      assumptions: [{ key: 'legs.regular_season', value: 2, source: 'admin', confirmed: true }],
      slots: { ...workedExampleUnpublished().slots, roster: { entries: [], target_count: 12 } },
    });
    const readiness = planReadiness(plan, okFacts(plan));
    expect(blockerCodes(readiness)).toEqual(expect.arrayContaining(['double_round_robin_unsupported', 'roster_required', 'roster_count_mismatch', 'ruleset_unpublished']));
    expect(readiness.sections.phases.state).toBe('engine_gap');
    expect(readiness.sections.roster).toMatchObject({ state: 'needs_input', resolved: 0, target: 12 });
  });
});

describe('planReadiness: double round robin (Q22)', () => {
  const withLegs = (value: unknown, bracket = 'round_robin') => {
    const plan = workedExample();
    return parseOrThrow({
      ...plan,
      assumptions: [{ key: 'legs.regular_season', value, source: 'admin', confirmed: true }],
      slots: { ...plan.slots, phases: plan.slots.phases?.map((p) => (p.key === 'regular_season' ? { ...p, bracket_type: bracket } : p)) },
    });
  };

  it('blocks a second circle with a plain engine-gap blocker that names the supported count', () => {
    const plan = withLegs(2);
    const readiness = planReadiness(plan, okFacts(plan));
    expect(find(readiness, 'double_round_robin_unsupported')).toMatchObject({
      kind: 'engine_gap',
      section: 'phases',
      path: '/slots/phases/0/bracket_type',
      params: { source: 'plan', phase: 'regular_season', legs: 2, supported: 1 },
    });
    expect(readiness.ready).toBe(false);
  });

  it('accepts one circle, and ignores the assumption on a phase that is not a round robin', () => {
    expect(codes(withLegs(1))).toEqual([]);
    expect(codes(withLegs(2, 'swiss'))).toEqual([]);
  });

  it('lifts when the caller says the engine plays two circles (LG1b)', () => {
    const plan = withLegs(2);
    expect(codes(plan, okFacts(plan, { engine: { roundRobinLegs: 2 } }))).toEqual([]);
  });

  it('blocks a Format Studio format that asks for legs: 2 (recorded but never run)', () => {
    const plan = edit(
      parseOrThrow({ ...workedExample(), slots: { ruleset: workedExample().slots.ruleset, league: { name: 'L', format_type: 'custom', language: 'de' } } }),
      { format: { mode: 'existing', definition_id: uid(31) } },
    );
    const facts = okFacts(plan, { formats: { [uid(31)]: { state: 'ok', maxRoundRobinLegs: 2 } } });
    expect(find(planReadiness(plan, facts), 'double_round_robin_unsupported')).toMatchObject({ params: { source: 'format', legs: 2, supported: 1 } });
    expect(codes(plan, okFacts(plan, { formats: { [uid(31)]: { state: 'ok', maxRoundRobinLegs: 1 } } }))).toEqual([]);
  });
});

describe('planReadiness: ruleset', () => {
  it('maps assertRulesetUsable answers to typed blockers', () => {
    const plan = workedExample();
    expect(codes(plan, okFacts(plan, { rulesetVersions: { [RULESET_VERSION]: 'not_found' } }))).toContain('ruleset_not_found');
    expect(codes(plan, okFacts(plan, { rulesetVersions: { [RULESET_VERSION]: 'forbidden' } }))).toContain('ruleset_forbidden');
  });

  it('checks a version named directly on a phase or a tournament', () => {
    const other = uid(9100);
    const plan = edit(workedExample(), { phases: workedExample().slots.phases?.map((p, i) => (i === 1 ? { ...p, ruleset: { id: other } } : p)) });
    expect(codes(plan, okFacts(plan, { rulesetVersions: { [RULESET_VERSION]: 'usable', [other]: 'forbidden' } }))).toEqual(['ruleset_forbidden']);
    const tournamentPlan = parseOrThrow({
      v: 1, title: 'T', intent: 'tournament', contentLocale: 'en', assumptions: [], refs: {},
      slots: { tournament: { name: 'Cup', bracket_type: 'single_elim', best_of: 1, is_doubles: false, team_visibility: 'hidden_until_match', ruleset: { id: other } } },
    });
    expect(codes(tournamentPlan, okFacts(tournamentPlan, { rulesetVersions: { [other]: 'not_found' } }))).toEqual(['ruleset_not_found']);
  });

  it('needs a ruleset slot for a phase that says "plan"', () => {
    const plan = parseOrThrow({ ...workedExample(), slots: { ...workedExample().slots, ruleset: undefined } });
    expect(codes(plan)).toContain('ruleset_missing');
  });

  it('treats a draft like an unpublished intent, and reports a draft whose compile has errors', () => {
    const plan = edit(workedExample(), { ruleset: { mode: 'draft', definition_id: RULESET_DEFINITION, draft_rev: 4 } });
    expect(codes(plan)).toEqual(['ruleset_unpublished']);
    const invalid = okFacts(plan, { rulesetDefinitions: { [RULESET_DEFINITION]: { state: 'ok', diagnosticsErrors: 2 } } });
    expect(find(planReadiness(plan, invalid), 'ruleset_document_invalid')).toMatchObject({ params: { errors: 2 } });
    expect(codes(plan, okFacts(plan, { rulesetDefinitions: { [RULESET_DEFINITION]: { state: 'forbidden' } } }))).toContain('ruleset_forbidden');
    expect(codes(plan, okFacts(plan, { rulesetDefinitions: { [RULESET_DEFINITION]: { state: 'not_found' } } }))).toContain('ruleset_not_found');
  });

  it('checks the preset, the quota and every dex id of a new ruleset', () => {
    const plan = edit(workedExample(), {
      ruleset: {
        mode: 'new', name: 'N', base_locale: 'en', preset: 'gen9ou',
        delta: { pokemon: { ban: ['kingambit', 'rotom'] }, moves: { ban: ['xyz'] } },
      },
    });
    const facts = okFacts(plan, {
      rulesetPresets: { gen9ou: { known: false } },
      rulesetQuota: { owned: 200, max: 200 },
      dex: {
        [dexFactKey('pokemon', 'kingambit')]: 'ok',
        [dexFactKey('pokemon', 'rotom')]: 'forme_expansion_needed',
        [dexFactKey('moves', 'xyz')]: 'unknown',
      },
    });
    const readiness = planReadiness(plan, facts);
    expect(find(readiness, 'base_format_unknown')).toMatchObject({ params: { preset: 'gen9ou' } });
    expect(find(readiness, 'ruleset_owner_quota_exceeded')).toMatchObject({ params: { max: 200 } });
    expect(find(readiness, 'forme_expansion_needed')).toMatchObject({ params: { name: 'rotom' }, path: '/slots/ruleset/delta/pokemon/ban/1' });
    expect(find(readiness, 'ban_name_unresolved')).toMatchObject({ params: { category: 'moves', name: 'xyz' } });
  });

  it('fails closed when a needed fact was not loaded', () => {
    const plan = workedExampleUnpublished();
    const facts = okFacts(plan);
    delete facts.dex;
    delete facts.rulesetQuota;
    delete facts.rulesetPresets;
    const readiness = planReadiness(plan, facts);
    const missing = readiness.blockers.filter((b) => b.code === 'fact_unavailable').map((b) => b.params.kind);
    expect(missing).toEqual(expect.arrayContaining(['dex', 'ruleset_quota', 'ruleset_preset']));
    expect(planReadiness(workedExample(), {}).blockers.filter((b) => b.code === 'fact_unavailable').length).toBeGreaterThan(10);
  });

  it('allows auto_epb only for an Evolution Point Buy league', () => {
    const epb = edit(workedExample(), {
      ruleset: { mode: 'auto_epb' },
      league: { name: 'EvoLiga', format_type: 'evolution_point_buy', language: 'de' },
    });
    expect(codes(epb)).toEqual([]);
    const wrong = edit(workedExample(), { ruleset: { mode: 'auto_epb' } });
    expect(codes(wrong)).toEqual(['ruleset_auto_epb_wrong_format']);
  });
});

describe('planReadiness: roster', () => {
  const entries = (extra: unknown[]) => ({ entries: [...resolvedRoster(9).entries, ...extra], target_count: 12 });

  it('counts unresolved entries and blocks until they are resolved or skipped', () => {
    const plan = edit(workedExample(), {
      roster: entries([
        { input: 'Misty', state: 'candidates', player_ids: [PLAYERS[9], PLAYERS[10]] },
        { input: 'Brock', state: 'unresolved' },
        { input: 'Gary', state: 'skipped' },
      ]),
    });
    const readiness = planReadiness(plan, okFacts(plan));
    expect(find(readiness, 'roster_unresolved')).toMatchObject({ params: { count: 2 }, kind: 'input' });
    // The count mismatch waits until nothing is open.
    expect(find(readiness, 'roster_count_mismatch')).toBeUndefined();
    expect(readiness.sections.roster).toMatchObject({ state: 'needs_input', resolved: 9, target: 12 });
  });

  it('turns "12 players with 11 resolved" into a count question', () => {
    const plan = edit(workedExample(), { roster: { ...resolvedRoster(11), target_count: 12 } });
    expect(find(planReadiness(plan, okFacts(plan)), 'roster_count_mismatch')).toMatchObject({ params: { target: 12, resolved: 11 } });
  });

  it('refuses a player twice, an unknown player and an ineligible one', () => {
    const dup = edit(workedExample(), { roster: { entries: [...resolvedRoster(2).entries, { input: 'again', state: 'resolved', player_id: PLAYERS[0].toUpperCase() }] } });
    expect(find(planReadiness(dup, okFacts(dup)), 'roster_duplicate')).toMatchObject({ path: '/slots/roster/entries/2' });

    const plan = edit(workedExample(), { roster: resolvedRoster(4) });
    const facts = okFacts(plan, {
      players: {
        [PLAYERS[0]]: { status: 'ok' },
        [PLAYERS[1]]: { status: 'banned' },
        [PLAYERS[2]]: { status: 'test' },
        [PLAYERS[3]]: { status: 'not_found' },
      },
    });
    const readiness = planReadiness(plan, facts);
    expect(readiness.blockers.filter((b) => b.code === 'player_not_eligible').map((b) => b.params.reason)).toEqual(['banned', 'test']);
    expect(find(readiness, 'player_not_found')).toMatchObject({ path: '/slots/roster/entries/3/player_id' });
  });

  it('flags a player who is already enrolled (amend plans)', () => {
    const plan = edit(workedExample(), { roster: resolvedRoster(5) });
    expect(codes(plan, okFacts(plan, { enrolledPlayerIds: [PLAYERS[1].toUpperCase()] }))).toEqual(['participant_already_enrolled']);
  });

  it('needs at least two players before the first phase, unless a clone copies the roster or a live roster exists', () => {
    const noRoster = edit(workedExample(), { roster: undefined });
    expect(codes(noRoster)).toEqual(['roster_required']);
    expect(codes(noRoster, okFacts(noRoster, { liveRosterCount: 8 }))).toEqual([]);
    const cloned = edit(workedExample(), { roster: undefined, phases: [], league: { name: 'Copy', format_type: 'singles', language: 'de', clone_from: { season_id: SEASON_ID, copy_roster: true } } });
    expect(codes(cloned)).toEqual([]);
  });
});

describe('planReadiness: league, phases, groups', () => {
  it('orders the dates', () => {
    const plan = edit(workedExample(), { league: { name: 'L', format_type: 'singles', language: 'de', start_date: '2026-11-02', end_date: '2026-10-01' } });
    expect(find(planReadiness(plan, okFacts(plan)), 'SEASON_DATES_INVALID')).toMatchObject({ path: '/slots/league/end_date' });
    const ok = edit(workedExample(), { league: { name: 'L', format_type: 'singles', language: 'de', start_date: '2026-11-02', end_date: '2026-11-02' } });
    expect(codes(ok)).toEqual([]);
  });

  it('warns, but does not block, when another league has the name', () => {
    const plan = workedExample();
    const readiness = planReadiness(plan, okFacts(plan, { leagueNameInUse: true }));
    expect(readiness.ready).toBe(true);
    expect(readiness.warnings.map((w) => w.code)).toEqual(['league_name_in_use']);
  });

  it('keeps classic phases and a custom league apart, and a clone from its own phases', () => {
    const custom = edit(workedExample(), { league: { name: 'L', format_type: 'custom', language: 'de' } });
    expect(codes(custom)).toContain('custom_league_has_phases');
    const cloneWithPhases = edit(workedExample(), { league: { name: 'L', format_type: 'singles', language: 'de', clone_from: { season_id: SEASON_ID } } });
    expect(codes(cloneWithPhases)).toContain('clone_with_own_phases');
  });

  it('wants a custom league for a format, and the format to exist', () => {
    const plan = edit(workedExample(), { format: { mode: 'draft', definition_id: uid(41) } });
    expect(codes(plan)).toContain('format_requires_custom_league');
    const custom = edit(
      parseOrThrow({ ...workedExample(), slots: { ruleset: workedExample().slots.ruleset, league: { name: 'L', format_type: 'custom', language: 'de' } } }),
      { format: { mode: 'existing', definition_id: uid(41) } },
    );
    expect(codes(custom, okFacts(custom, { formats: { [uid(41)]: { state: 'forbidden' } } }))).toEqual(['format_unavailable']);
    expect(codes(custom)).toEqual([]);
  });

  describe('advancement', () => {
    const phases = (rule: unknown, firstRule?: unknown) => [
      { key: 'regular_season', name: 'Regular season', bracket_type: 'round_robin', best_of: 1, is_doubles: false, ruleset: 'plan', ...(firstRule ? { advancement_rule: firstRule } : {}) },
      { key: 'playoffs', name: 'Playoffs', bracket_type: 'single_elim', best_of: 3, is_doubles: false, ruleset: 'plan', advancement_rule: rule },
    ];

    it('puts the rule on the receiving phase', () => {
      const plan = edit(workedExample(), { phases: phases({ type: 'top_n', count: 4 }, { type: 'top_n', count: 4 }) });
      expect(find(planReadiness(plan, okFacts(plan)), 'advancement_rule_on_first_phase')).toMatchObject({ params: { phase: 'regular_season' } });
    });

    it('needs groups for per_group and a table big enough for the count', () => {
      const perGroup = edit(workedExample(), { phases: phases({ type: 'top_n', count: 2, per_group: true }) });
      expect(codes(perGroup)).toEqual(['advancement_per_group_needs_groups']);

      const grouped = edit(workedExample(), { phases: phases({ type: 'top_n', count: 7, per_group: true }), groups: { mode: 'serpentine', count: 2 } });
      expect(find(planReadiness(grouped, okFacts(grouped)), 'advancement_exceeds_roster')).toMatchObject({ params: { count: 7, available: 6 } });
      const fits = edit(workedExample(), { phases: phases({ type: 'top_n', count: 6, per_group: true }), groups: { mode: 'serpentine', count: 2 } });
      expect(codes(fits)).toEqual([]);

      const tooMany = edit(workedExample(), { phases: phases({ type: 'top_n', count: 13 }) });
      expect(find(planReadiness(tooMany, okFacts(tooMany)), 'advancement_exceeds_roster')).toMatchObject({ params: { count: 13, available: 12 } });
    });
  });

  it('reports bo_overrides keys that are not real round names, and fails closed without the check', () => {
    const phases = workedExample().slots.phases!.map((p) => (p.key === 'playoffs' ? { ...p, bo_overrides: { Finalz: 5 } } : p));
    const plan = edit(workedExample(), { phases });
    const checked = okFacts(plan, { unknownBoOverrideKeys: { playoffs: ['Finalz'] } });
    expect(find(planReadiness(plan, checked), 'bo_override_key_unknown')).toMatchObject({ params: { key: 'Finalz', phase: 'playoffs' } });
    const unchecked = okFacts(plan);
    delete unchecked.unknownBoOverrideKeys;
    expect(find(planReadiness(plan, unchecked), 'fact_unavailable')).toMatchObject({ params: { kind: 'bo_override_keys', id: 'playoffs' } });
  });

  it('does not split a roster into more groups than it can seat (two per group)', () => {
    const tooMany = edit(workedExample(), { groups: { mode: 'serpentine', count: 7 } });
    expect(find(planReadiness(tooMany, okFacts(tooMany)), 'SEASON_GROUPS_TOO_MANY')).toMatchObject({ params: { participants: 12, count: 7 } });
    expect(codes(edit(workedExample(), { groups: { mode: 'serpentine', count: 6 } }))).toEqual([]);
  });
});

describe('planReadiness: draft setup (all blockers BEFORE Build)', () => {
  const epbLeague = { name: 'EvoLiga', format_type: 'evolution_point_buy', language: 'de' };
  const epb = (draft: unknown[], groups?: unknown) =>
    edit(workedExample(), { ruleset: { mode: 'auto_epb' }, league: epbLeague, draft, ...(groups ? { groups } : {}) });

  it('accepts a queue pool for an EPB league and a legacy pool for a draft league', () => {
    expect(codes(epb([{ engine: 'queue' }]))).toEqual([]);
    const legacy = edit(workedExample(), { league: { name: 'L', format_type: 'draft', language: 'de' }, draft: [{ engine: 'legacy', draft_type: 'budget', budget: 110, pick_order: 'snake' }] });
    expect(codes(legacy)).toEqual([]);
  });

  it('refuses a draft in a custom league', () => {
    const plan = edit(
      parseOrThrow({ ...workedExample(), slots: { ruleset: workedExample().slots.ruleset, league: { name: 'L', format_type: 'custom', language: 'de' } } }),
      { draft: [{ engine: 'legacy' }] },
    );
    expect(codes(plan)).toContain('draft_not_supported_for_format');
  });

  it('keeps each engine on its league type', () => {
    expect(codes(edit(workedExample(), { draft: [{ engine: 'queue' }] }))).toContain('draft_engine_mismatch');
    expect(codes(epb([{ engine: 'legacy' }]))).toContain('draft_engine_mismatch');
  });

  it('needs one queue pool per group, and the legacy engine cannot draft groups', () => {
    const groups = { mode: 'serpentine', count: 2 };
    expect(codes(epb([{ engine: 'queue' }], groups))).toEqual(['SEASON_GROUP_REQUIRED']);
    expect(codes(epb([{ engine: 'queue', group_key: 'C' }], groups))).toEqual(['SEASON_GROUP_INVALID']);
    expect(codes(epb([{ engine: 'queue', group_key: 'A' }, { engine: 'queue', group_key: 'B' }], groups))).toEqual([]);
    const legacy = edit(workedExample(), { league: { name: 'L', format_type: 'draft', language: 'de' }, groups, draft: [{ engine: 'legacy' }] });
    expect(codes(legacy)).toEqual(['draft_groups_need_point_buy']);
  });

  it('refuses a group key when the league has no groups', () => {
    expect(codes(epb([{ engine: 'queue', group_key: 'A' }]))).toEqual(['SEASON_GROUP_INVALID']);
  });

  it('applies the legacy create rules before the route would', () => {
    const legacy = (draft: unknown) => edit(workedExample(), { league: { name: 'L', format_type: 'draft', language: 'de' }, draft: [draft] });
    expect(codes(legacy({ engine: 'legacy', draft_type: 'budget' }))).toEqual(['POINT_BUDGET_REQUIRED']);
    expect(codes(legacy({ engine: 'legacy', draft_type: 'auction', pick_order: 'snake', budget: 100 }))).toEqual(['draft_auction_order_not_free']);
    expect(codes(legacy({ engine: 'legacy', draft_type: 'auction', pick_order: 'free', budget: 100 }))).toEqual([]);
    expect(codes(legacy({ engine: 'legacy' }))).toEqual([]);
  });

  it('needs a bound point-buy list for the queue engine and a seat order from the roster', () => {
    const plan = epb([{ engine: 'queue', participant_order: [PLAYERS[0], uid(555)] }]);
    expect(codes(plan, okFacts(plan, { epbActiveListAvailable: false }))).toEqual(['participant_order_not_in_roster', 'SEASON_HAS_NO_LIST']);
    const unchecked = okFacts(plan);
    delete unchecked.epbActiveListAvailable;
    expect(find(planReadiness(plan, unchecked), 'fact_unavailable')).toMatchObject({ params: { kind: 'epb_point_buy_list' } });
  });
});

describe('planReadiness: shape, text and size', () => {
  it('asks for the slots the intent needs', () => {
    const league = parseOrThrow({ v: 1, title: 'T', intent: 'league', contentLocale: 'en', assumptions: [], slots: {}, refs: {} });
    expect(planReadiness(league, {}).blockers.filter((b) => b.code === 'plan_incomplete').map((b) => b.params.missing)).toEqual(['league']);
    const tournament = parseOrThrow({ ...league, intent: 'tournament' });
    expect(planReadiness(tournament, {}).blockers.find((b) => b.code === 'plan_incomplete')?.params.missing).toBe('tournament');
    const orphan = parseOrThrow({ ...league, intent: 'mixed', slots: { phases: workedExample().slots.phases, roster: resolvedRoster(2) } });
    expect(planReadiness(orphan, okFacts(orphan)).blockers.filter((b) => b.code === 'plan_incomplete')).toHaveLength(1);
  });

  it('says there is nothing to build for a ruleset-only plan', () => {
    const plan = parseOrThrow({ v: 1, title: 'R', intent: 'ruleset', contentLocale: 'en', assumptions: [], refs: {}, slots: { ruleset: { mode: 'new', name: 'N', base_locale: 'en' } } });
    expect(codes(plan)).toContain('nothing_to_build');
  });

  it('refuses hidden characters, links and markdown in names and descriptions', () => {
    const plan = edit(workedExample(), {
      league: { name: `Liga${String.fromCharCode(0x202e)}evil`, description: 'see https://example.com', format_type: 'singles', language: 'de' },
      phases: [{ key: 'a', name: '[click](somewhere)', bracket_type: 'swiss', best_of: 1, is_doubles: false, ruleset: 'plan' }],
    });
    const found = planReadiness(plan, okFacts(plan)).blockers.filter((b) => b.code === 'text_not_allowed');
    expect(found.map((b) => [b.path, b.params.reason])).toEqual([
      ['/slots/league/name', 'bidi_characters'],
      ['/slots/league/description', 'url'],
      ['/slots/phases/0/name', 'markdown_link'],
    ]);
  });

  it('blocks a Build over the caps (40 steps, 10 creating steps)', () => {
    const phases = Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, name: `Phase ${i}`, bracket_type: 'swiss', best_of: 1, is_doubles: false, ruleset: 'plan' }));
    const plan = edit(workedExample(), { phases });
    // league + 10 phases = 11 creating steps.
    expect(find(planReadiness(plan, okFacts(plan)), 'build_too_large')).toMatchObject({ params: { creating: 11, maxCreating: 10, maxSteps: 40 } });
  });
});

describe('planReadiness: built entities', () => {
  it('does not ask for a ruleset publish or a roster again once the slot is built, and watches the live row', () => {
    const plan = parseOrThrow({
      ...workedExample(),
      refs: { league: { entity_type: 'season', entity_id: SEASON_ID }, roster: { entity_type: 'season_roster', entity_id: SEASON_ID } },
    });
    expect(codes(plan)).toEqual([]);
    const gone = okFacts(plan, { refs: { league: 'gone', roster: 'in_trash' } });
    const readiness = planReadiness(plan, gone);
    expect(readiness.blockers.filter((b) => b.code === 'built_entity_unavailable').map((b) => b.params)).toEqual([
      { ref: 'league', state: 'gone' },
      { ref: 'roster', state: 'in_trash' },
    ]);
    const unchecked = okFacts(plan);
    delete unchecked.refs;
    expect(planReadiness(plan, unchecked).blockers.filter((b) => b.code === 'fact_unavailable')).toHaveLength(2);
  });

  it('shows built sections as built and does not ask for nothing_to_build', () => {
    const plan = parseOrThrow({
      ...workedExample(),
      refs: {
        league: { entity_type: 'season', entity_id: SEASON_ID },
        roster: { entity_type: 'season_roster', entity_id: SEASON_ID },
        'phase.regular_season': { entity_type: 'tournament', entity_id: uid(61) },
        'phase.playoffs': { entity_type: 'tournament', entity_id: uid(62) },
      },
    });
    const readiness = planReadiness(plan, okFacts(plan));
    expect(readiness.ready).toBe(true);
    expect(readiness.sections.league.state).toBe('built');
    expect(readiness.sections.phases.state).toBe('built');
    expect(readiness.sections.roster.state).toBe('built');
  });
});

describe('chips and the blocker table', () => {
  it('shows unconfirmed assumptions as Assumed when nothing blocks', () => {
    const plan = parseOrThrow({
      ...workedExample(),
      assumptions: [{ key: 'league.language', value: 'de', source: 'default', confirmed: false }],
    });
    const readiness = planReadiness(plan, okFacts(plan));
    expect(readiness.sections.league.state).toBe('assumed');
    expect(readiness.sections.format.state).toBe('empty');
    expect(readiness.sections.tournament.state).toBe('empty');
  });

  it('declares a kind for every code and uses the same kind in the emitted blocker', () => {
    const plan = workedExampleUnpublished();
    for (const blocker of planReadiness(plan, {}).blockers) expect(blocker.kind).toBe(PLAN_BLOCKERS[blocker.code].kind);
  });

  it('lists the lookups a Plan needs', () => {
    const needs = planFactNeeds(workedExampleUnpublished());
    expect(needs.rulesetVersionIds).toEqual([]);
    expect(needs.presetIds).toEqual(['gen9ou']);
    expect(needs.dex).toEqual([{ category: 'pokemon', id: 'kingambit' }]);
    expect(needs.playerIds).toHaveLength(12);
    expect(needs.needsRulesetQuota).toBe(true);
    expect(planFactNeeds(workedExample()).rulesetVersionIds).toEqual([RULESET_VERSION]);
  });
});
