/**
 * Shared fixtures: valid RFC uuids, the plan 4.10 worked example (minus the double round robin, which the engine does
 * not play), and a facts builder that answers every lookup `planFactNeeds` asks for with the happy path.
 */
import { planFactNeeds, dexFactKey, type PlanFacts } from '../facts';
import { parsePlanDocument, type PlanDocument, type PlanDocumentInput } from '../schema';

/** A valid v4-shaped uuid (the zod uuid check wants RFC version and variant nibbles). */
export const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const RULESET_VERSION = uid(9001);
export const RULESET_DEFINITION = uid(9002);
export const SEASON_ID = uid(8001);
export const PLAYERS = Array.from({ length: 12 }, (_, i) => uid(100 + i));

export function parseOrThrow(input: PlanDocumentInput | Record<string, unknown>): PlanDocument {
  const result = parsePlanDocument(input);
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.plan;
}

export function resolvedRoster(count = 12): NonNullable<PlanDocument['slots']['roster']> {
  return {
    entries: PLAYERS.slice(0, count).map((player_id, i) => ({ input: `Player ${i + 1}`, state: 'resolved' as const, player_id })),
    target_count: count,
  };
}

/**
 * "A 12-player Gen 9 OU league, top 4 playoff, ban Kingambit, starts next Monday" after the admin chose a single round
 * robin, named 12 players and published the ruleset (slot `existing`).
 */
export function workedExample(): PlanDocument {
  return parseOrThrow({
    v: 1,
    title: 'Gen 9 OU league',
    intent: 'league',
    contentLocale: 'de',
    assumptions: [
      { key: 'ruleset.own_copy', value: true, source: 'default', confirmed: true },
      { key: 'league.language', value: 'de', source: 'inferred', confirmed: true },
      { key: 'legs.regular_season', value: 1, source: 'admin', confirmed: true },
    ],
    slots: {
      ruleset: { mode: 'existing', version_id: RULESET_VERSION },
      league: { name: 'Gen 9 OU League', format_type: 'singles', start_date: '2026-11-02', language: 'de' },
      phases: [
        { key: 'regular_season', name: 'Regular season', bracket_type: 'round_robin', best_of: 1, is_doubles: false, ruleset: 'plan' },
        {
          key: 'playoffs',
          name: 'Playoffs',
          bracket_type: 'single_elim',
          best_of: 3,
          is_doubles: false,
          advancement_rule: { type: 'top_n', count: 4 },
          ruleset: 'plan',
        },
      ],
      roster: resolvedRoster(12),
    },
    refs: {},
  });
}

/** The same request before the ruleset was published: a new private ruleset with Kingambit banned. */
export function workedExampleUnpublished(): PlanDocument {
  const plan = workedExample();
  return parseOrThrow({
    ...plan,
    assumptions: [{ key: 'ruleset.own_copy', value: true, source: 'default', confirmed: false }],
    slots: {
      ...plan.slots,
      ruleset: {
        mode: 'new',
        name: 'Gen 9 OU - Gen 9 OU League',
        base_locale: 'de',
        preset: 'gen9ou',
        delta: { pokemon: { ban: ['kingambit'] } },
      },
    },
  });
}

/** Facts that answer every lookup the Plan needs with "fine". Pass overrides to break one thing. */
export function okFacts(plan: PlanDocument, overrides: Partial<PlanFacts> = {}): PlanFacts {
  const needs = planFactNeeds(plan);
  const facts: PlanFacts = {
    rulesetVersions: Object.fromEntries(needs.rulesetVersionIds.map((id) => [id, 'usable' as const])),
    rulesetDefinitions: Object.fromEntries(needs.rulesetDefinitionIds.map((id) => [id, { state: 'ok' as const, diagnosticsErrors: 0 }])),
    rulesetPresets: Object.fromEntries(needs.presetIds.map((id) => [id, { known: true }])),
    dex: Object.fromEntries(needs.dex.map(({ category, id }) => [dexFactKey(category, id), 'ok' as const])),
    players: Object.fromEntries(needs.playerIds.map((id) => [id, { status: 'ok' as const }])),
    formats: Object.fromEntries(needs.formatDefinitionIds.map((id) => [id, { state: 'ok' as const }])),
    unknownBoOverrideKeys: Object.fromEntries(needs.boOverrideChecks.map((check) => [check.key, [] as string[]])),
    refs: Object.fromEntries(needs.refKeys.map((key) => [key, 'live' as const])),
    ...(needs.needsRulesetQuota ? { rulesetQuota: { owned: 3, max: 200 } } : {}),
    ...(needs.needsEpbListFact ? { epbActiveListAvailable: true } : {}),
  };
  return { ...facts, ...overrides };
}

export const blockerCodes = (readiness: { blockers: ReadonlyArray<{ code: string }> }): string[] =>
  readiness.blockers.map((blocker) => blocker.code);
