import { describe, expect, it } from 'vitest';
import {
  PLAN_LIMITS,
  PLAN_REF_KEY_PATTERN,
  draftRefKey,
  emptyPlan,
  parsePlanDocument,
  phaseRefKey,
  planDocumentSchema,
  roundRobinLegsKey,
  type PlanDocument,
} from '../schema';
import { PLAYERS, RULESET_VERSION, parseOrThrow, uid, workedExample, workedExampleUnpublished } from './fixtures';

const base = () => ({ v: 1, title: 'T', intent: 'league', contentLocale: 'en', assumptions: [], slots: {}, refs: {} });
const withSlots = (slots: Record<string, unknown>) => ({ ...base(), slots });
const issues = (input: unknown) => {
  const result = parsePlanDocument(input);
  return result.ok ? [] : result.issues;
};
const phase = (extra: Record<string, unknown> = {}) => ({
  key: 'regular_season',
  name: 'Regular season',
  bracket_type: 'round_robin',
  best_of: 1,
  is_doubles: false,
  ruleset: 'plan',
  ...extra,
});

describe('planDocumentSchema v1', () => {
  it('parses the worked example and normalises it to plain JSON', () => {
    const plan = workedExample();
    expect(plan.v).toBe(1);
    expect(plan.slots.phases).toHaveLength(2);
    // per_group is required by the route schema; the Plan defaults it to false.
    expect(plan.slots.phases?.[1].advancement_rule).toEqual({ type: 'top_n', count: 4, per_group: false });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it('is idempotent: parsing a parsed Plan changes nothing', () => {
    for (const plan of [workedExample(), workedExampleUnpublished()]) {
      const again = parsePlanDocument(plan);
      expect(again.ok && again.plan).toEqual(plan);
    }
  });

  it('builds an empty Plan that is valid', () => {
    const plan = emptyPlan({ title: 'Idea', intent: 'mixed', contentLocale: 'en' });
    expect(planDocumentSchema.safeParse(plan).success).toBe(true);
  });

  it('refuses every unknown key (all objects are strict), one issue per key', () => {
    expect(issues({ ...base(), extra: 1 })).toContainEqual({ path: '/extra', code: 'unrecognized_keys' });
    expect(issues(withSlots({ phases: [phase({ legs: 2 })] }))).toContainEqual({ path: '/slots/phases/0/legs', code: 'unrecognized_keys' });
    expect(issues(withSlots({ league: { name: 'L', format_type: 'singles', language: 'en', route_theme: 'plaza' } }))).toContainEqual({
      path: '/slots/league/route_theme',
      code: 'unrecognized_keys',
    });
  });

  it('returns machine codes only, never zod prose', () => {
    const found = issues(
      withSlots({
        league: { name: '', format_type: 'nope', language: 'fr', start_date: 'monday' },
        phases: [phase({ best_of: 2, bracket_type: 'ladder' })],
      }),
    );
    expect(found.length).toBeGreaterThan(3);
    for (const issue of found) expect(issue.code).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });

  it('requires odd best-of values, as the route does', () => {
    expect(issues(withSlots({ phases: [phase({ best_of: 3 })] }))).toEqual([]);
    expect(issues(withSlots({ phases: [phase({ best_of: 2 })] })).length).toBeGreaterThan(0);
    expect(issues(withSlots({ phases: [phase({ bo_overrides: { Finals: 4 } })] })).length).toBeGreaterThan(0);
    expect(issues(withSlots({ phases: [phase({ bo_overrides: { Finals: 5 } })] }))).toEqual([]);
  });

  describe('phases', () => {
    it('refuses duplicate keys and case-insensitive duplicate names', () => {
      const dup = issues(withSlots({ phases: [phase(), phase()] }));
      expect(dup).toContainEqual({ path: '/slots/phases/1/key', code: 'plan_key_duplicate' });
      expect(dup).toContainEqual({ path: '/slots/phases/1/name', code: 'PHASE_NAME_TAKEN' });
      expect(issues(withSlots({ phases: [phase(), phase({ key: 'second', name: '  REGULAR SEASON ' })] }))).toContainEqual({
        path: '/slots/phases/1/name',
        code: 'PHASE_NAME_TAKEN',
      });
    });

    it('validates the key pattern and caps the number of phases', () => {
      expect(issues(withSlots({ phases: [phase({ key: 'Bad Key' })] }))).toContainEqual({ path: '/slots/phases/0/key', code: 'plan_key_invalid' });
      const many = Array.from({ length: PLAN_LIMITS.phases + 1 }, (_, i) => phase({ key: `p${i}`, name: `Phase ${i}` }));
      expect(issues(withSlots({ phases: many })).length).toBeGreaterThan(0);
    });

    it('takes a ruleset either as the plan slot or a version id, never anything else', () => {
      expect(issues(withSlots({ phases: [phase({ ruleset: { id: RULESET_VERSION } })] }))).toEqual([]);
      expect(issues(withSlots({ phases: [phase({ ruleset: { id: 'gen9ou' } })] })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ phases: [phase({ ruleset: 'gen9ou' })] })).length).toBeGreaterThan(0);
    });

    it('bounds the advancement rule like advancementRuleSchema', () => {
      expect(issues(withSlots({ phases: [phase({ advancement_rule: { type: 'top_n', count: 0 } })] })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ phases: [phase({ advancement_rule: { type: 'top_n', count: 257 } })] })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ phases: [phase({ advancement_rule: { type: 'bottom_n', count: 4 } })] })).length).toBeGreaterThan(0);
    });
  });

  describe('ruleset slot', () => {
    it('accepts the five modes', () => {
      for (const ruleset of [
        { mode: 'existing', version_id: RULESET_VERSION },
        { mode: 'draft', definition_id: uid(1), draft_rev: 3 },
        { mode: 'new', name: 'N', base_locale: 'en', preset: 'gen9ou', tour_overlay: true, delta: {} },
        { mode: 'fork', from_definition_id: uid(2), name: 'F' },
        { mode: 'auto_epb' },
      ]) {
        expect(issues(withSlots({ ruleset }))).toEqual([]);
      }
    });

    it('fills an empty delta for new and fork', () => {
      const plan = parseOrThrow(withSlots({ ruleset: { mode: 'new', name: 'N', base_locale: 'en' } }));
      const slot = plan.slots.ruleset;
      expect(slot?.mode === 'new' && slot.delta).toEqual({
        pokemon: { ban: [], unban: [], allow: null },
        moves: { ban: [], unban: [], allow: null },
        items: { ban: [], unban: [], allow: null },
        abilities: { ban: [], unban: [], allow: null },
        clauses: { add: [], remove: [] },
      });
    });

    it('stores dex ids, never display names', () => {
      const bad = (pokemon: unknown) => issues(withSlots({ ruleset: { mode: 'new', name: 'N', base_locale: 'en', delta: { pokemon } } }));
      expect(bad({ ban: ['kingambit', 'tapukoko'] })).toEqual([]);
      expect(bad({ ban: ['Kingambit'] })).toContainEqual({ path: '/slots/ruleset/delta/pokemon/ban/0', code: 'dex_id_invalid' });
      expect(bad({ ban: ['tapu koko'] }).length).toBeGreaterThan(0);
    });

    it('refuses contradictory deltas', () => {
      const bad = (pokemon: unknown) => issues(withSlots({ ruleset: { mode: 'new', name: 'N', base_locale: 'en', delta: { pokemon } } }));
      expect(bad({ ban: ['kingambit'], unban: ['kingambit'] })).toContainEqual({ path: '/slots/ruleset/delta/pokemon/unban', code: 'entry_in_ban_and_unban' });
      expect(bad({ ban: ['kingambit'], allow: ['pikachu'] })).toContainEqual({ path: '/slots/ruleset/delta/pokemon/allow', code: 'allowlist_with_bans' });
      expect(bad({ allow: [] })).toContainEqual({ path: '/slots/ruleset/delta/pokemon/allow', code: 'allowlist_empty' });
      expect(bad({ ban: ['kingambit', 'kingambit'] })).toContainEqual({ path: '/slots/ruleset/delta/pokemon/ban', code: 'duplicate_entry' });
      expect(bad({ allow: ['pikachu', 'raichu'] })).toEqual([]);
    });

    it('takes only an integer shared-type percentage from 0 to 100', () => {
      const pct = (value: unknown) =>
        issues(withSlots({ ruleset: { mode: 'new', name: 'N', base_locale: 'en', delta: { min_shared_type_pct: value } } }));
      expect(pct(50)).toEqual([]);
      expect(pct(0)).toEqual([]);
      expect(pct(33.5).length).toBeGreaterThan(0);
      expect(pct(101).length).toBeGreaterThan(0);
    });

    it('refuses a definition id passed as a version id by shape only where the shape differs', () => {
      // Both are uuids; telling them apart is a fact lookup (planReadiness), not a schema job.
      expect(issues(withSlots({ ruleset: { mode: 'existing', version_id: 'not-a-uuid' } })).length).toBeGreaterThan(0);
    });
  });

  describe('roster, groups, draft, tournament', () => {
    it('models the four roster states', () => {
      const roster = {
        entries: [
          { input: 'Ash', state: 'resolved', player_id: PLAYERS[0] },
          { input: 'Misty', state: 'candidates', player_ids: [PLAYERS[1], PLAYERS[2]] },
          { input: 'Brock', state: 'unresolved' },
          { input: 'Gary', state: 'skipped' },
        ],
        target_count: 4,
      };
      expect(issues(withSlots({ roster }))).toEqual([]);
      expect(issues(withSlots({ roster: { entries: [{ input: 'X', state: 'candidates', player_ids: [PLAYERS[0]] }] } })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ roster: { entries: [{ input: 'X', state: 'resolved' }] } })).length).toBeGreaterThan(0);
    });

    it('needs a count for serpentine groups and none for no groups', () => {
      expect(issues(withSlots({ groups: { mode: 'serpentine' } }))).toContainEqual({ path: '/slots/groups/count', code: 'groups_count_required' });
      expect(issues(withSlots({ groups: { mode: 'serpentine', count: 2 } }))).toEqual([]);
      expect(issues(withSlots({ groups: { mode: 'serpentine', count: 1 } })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ groups: { mode: 'serpentine', count: 27 } })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ groups: { mode: 'none', count: 2 } }))).toContainEqual({ path: '/slots/groups/count', code: 'groups_count_not_allowed' });
      expect(issues(withSlots({ groups: { mode: 'none' } }))).toEqual([]);
    });

    it('keeps draft options to the engine that has them', () => {
      expect(issues(withSlots({ draft: [{ engine: 'legacy', draft_type: 'budget', pick_order: 'snake', budget: 110 }] }))).toEqual([]);
      expect(issues(withSlots({ draft: [{ engine: 'legacy', participant_order: [PLAYERS[0], PLAYERS[1]] }] }))).toContainEqual({
        path: '/slots/draft/0/participant_order',
        code: 'draft_option_unsupported',
      });
      expect(issues(withSlots({ draft: [{ engine: 'queue', budget: 100, participant_order: [PLAYERS[0], PLAYERS[1]] }] }))).toEqual([]);
      expect(issues(withSlots({ draft: [{ engine: 'queue', draft_type: 'budget' }] }))).toContainEqual({
        path: '/slots/draft/0/draft_type',
        code: 'draft_option_unsupported',
      });
      expect(issues(withSlots({ draft: [{ engine: 'queue', pick_order: 'linear' }] }))).toContainEqual({
        path: '/slots/draft/0/pick_order',
        code: 'draft_option_unsupported',
      });
      expect(issues(withSlots({ draft: [{ engine: 'queue', budget: 5000 }] }))).toContainEqual({
        path: '/slots/draft/0/budget',
        code: 'draft_budget_out_of_range',
      });
      expect(issues(withSlots({ draft: [{ engine: 'queue', participant_order: [PLAYERS[0], PLAYERS[0]] }] }))).toContainEqual({
        path: '/slots/draft/0/participant_order',
        code: 'participant_order_repeats_player',
      });
    });

    it('allows one pool per group key', () => {
      const pools = [{ engine: 'queue', group_key: 'A' }, { engine: 'queue', group_key: 'A' }];
      expect(issues(withSlots({ draft: pools }))).toContainEqual({ path: '/slots/draft/1/group_key', code: 'draft_pool_duplicate' });
      expect(issues(withSlots({ draft: [{ engine: 'queue', group_key: 'A' }, { engine: 'queue', group_key: 'B' }] }))).toEqual([]);
      expect(issues(withSlots({ draft: [{ engine: 'queue', group_key: 'a' }] })).length).toBeGreaterThan(0);
    });

    it('requires the explicit team visibility of a standalone tournament', () => {
      const tournament = { name: 'Cup', bracket_type: 'single_elim', best_of: 1, is_doubles: false, ruleset: 'plan' };
      expect(issues(withSlots({ tournament })).length).toBeGreaterThan(0);
      expect(issues(withSlots({ tournament: { ...tournament, team_visibility: 'always_public' } }))).toEqual([]);
    });
  });

  describe('assumptions and refs', () => {
    it('keeps assumption values to bounded JSON with unique keys', () => {
      const plan = (assumptions: unknown) => ({ ...base(), assumptions });
      expect(issues(plan([{ key: 'league.language', value: 'de', source: 'inferred', confirmed: false }]))).toEqual([]);
      expect(issues(plan([{ key: 'k', value: 'x'.repeat(PLAN_LIMITS.assumptionValueBytes + 1), source: 'admin', confirmed: true }])).length).toBeGreaterThan(0);
      expect(issues(plan([{ key: 'k', source: 'admin', confirmed: true }])).length).toBeGreaterThan(0);
      expect(
        issues(plan([
          { key: 'k', value: 1, source: 'admin', confirmed: true },
          { key: 'k', value: 2, source: 'admin', confirmed: true },
        ])),
      ).toContainEqual({ path: '/assumptions/1/key', code: 'assumption_key_duplicate' });
      expect(issues(plan([{ key: 'k', value: 1, source: 'guess', confirmed: true }])).length).toBeGreaterThan(0);
    });

    it('names the legs assumption of a phase', () => {
      expect(roundRobinLegsKey('regular_season')).toBe('legs.regular_season');
    });

    it('accepts only the documented ref keys', () => {
      const ref = { entity_type: 'season', entity_id: uid(5) };
      const valid = ['league', 'roster', 'groups', 'tournament', phaseRefKey('regular_season'), draftRefKey('A'), draftRefKey(undefined)];
      for (const key of valid) {
        expect(PLAN_REF_KEY_PATTERN.test(key), key).toBe(true);
        expect(issues({ ...base(), refs: { [key]: ref } })).toEqual([]);
      }
      for (const key of ['ruleset', 'phase.', 'draft.a', 'phase.Bad']) {
        expect(issues({ ...base(), refs: { [key]: ref } }).length, key).toBeGreaterThan(0);
      }
      expect(issues({ ...base(), refs: { league: { entity_type: 'season', entity_id: 'x' } } }).length).toBeGreaterThan(0);
    });

    it('pins the document version', () => {
      expect(issues({ ...base(), v: 2 }).length).toBeGreaterThan(0);
    });
  });

  it('is a type-level fit: a parsed plan is a PlanDocument', () => {
    const plan: PlanDocument = workedExample();
    expect(plan.contentLocale).toBe('de');
  });
});
