/**
 * Plan 3.9 test 9: the Plan neither adds nor loses a key of the create schemas it feeds. Fails when
 * `phaseCreateSchema`, `tournamentCreateSchema` or `seasonCreateRequestSchema` gains a key that the Plan slot neither
 * maps nor explicitly excludes.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SEASON_GROUPS,
  MIN_SEASON_GROUPS,
  seasonGroupsReplaceSchema,
} from '@/app/api/seasons/[id]/groups/_lib/schemas';
import { seasonCreateSchema } from '@/lib/validation/schemas';
import { PLAN_ONLY_FIELDS, ROUTE_SCHEMA_PARITY, planSlotFields, type ParityTarget } from '../parity';
import { toGroupsBody } from '../route-bodies';
import { PLAN_LIMITS } from '../schema';

const entries = Object.entries(ROUTE_SCHEMA_PARITY);

describe('route schema parity (plan 3.9 test 9)', () => {
  it.each(entries)('%s: every key is mapped or explicitly excluded, never both', (_name, entry) => {
    const keys = Object.keys(entry.schema.shape).sort();
    const mapped = Object.keys(entry.mapped);
    const excluded = Object.keys(entry.excluded);
    expect([...mapped, ...excluded].sort()).toEqual(keys);
    expect(mapped.filter((key) => excluded.includes(key))).toEqual([]);
  });

  it.each(entries)('%s: every exclusion has a reason', (_name, entry) => {
    for (const reason of Object.values(entry.excluded)) expect(reason.length).toBeGreaterThan(20);
  });

  it.each(entries)('%s: every mapped target is a field of the Plan slot it names', (_name, entry) => {
    for (const [routeKey, target] of Object.entries(entry.mapped) as Array<[string, ParityTarget]>) {
      expect(planSlotFields(target.slot), `${routeKey} -> ${target.slot}.${target.field}`).toContain(target.field);
    }
  });

  it('every Plan field of a slot object is the target of a mapped key or a declared Plan-only field', () => {
    const targets = (slot: ParityTarget['slot']): string[] =>
      entries.flatMap(([, entry]) =>
        (Object.values(entry.mapped) as ParityTarget[]).filter((t) => t.slot === slot).map((t) => t.field),
      );
    for (const slot of ['league', 'phase', 'tournament'] as const) {
      const covered = new Set([...targets(slot), ...PLAN_ONLY_FIELDS[slot]]);
      expect(planSlotFields(slot).filter((field) => !covered.has(field)), slot).toEqual([]);
    }
  });

  it('seeds the exclusions and renames the plan lists (3.9 #9)', () => {
    const { seasonCreateRequestSchema, phaseCreateSchema, tournamentCreateSchema } = ROUTE_SCHEMA_PARITY;
    expect(Object.keys(seasonCreateRequestSchema.excluded)).toEqual(['route_theme']);
    expect(Object.keys(phaseCreateSchema.excluded).sort()).toEqual(['insert_at', 'stage_order']);
    expect(Object.keys(tournamentCreateSchema.excluded).sort()).toEqual(['season_id', 'stage_order']);
    expect(phaseCreateSchema.mapped.best_of_default).toEqual({ slot: 'phase', field: 'best_of' });
    expect(tournamentCreateSchema.mapped.best_of_default).toEqual({ slot: 'tournament', field: 'best_of' });
    // ruleset_id is a VERSION id on all three; the Plan slot is `ruleset`.
    expect(phaseCreateSchema.mapped.ruleset_id).toEqual({ slot: 'phase', field: 'ruleset' });
    expect(tournamentCreateSchema.mapped.ruleset_id).toEqual({ slot: 'tournament', field: 'ruleset' });
    expect(seasonCreateRequestSchema.mapped.ruleset_id).toEqual({ slot: 'ruleset', field: 'version_id' });
  });

  it('would notice a new key: the check is on the live schema shape', () => {
    const extended = seasonCreateSchema.extend({ brand_new_key: seasonCreateSchema.shape.name });
    const known = new Set([...Object.keys(ROUTE_SCHEMA_PARITY.seasonCreateRequestSchema.mapped), ...Object.keys(ROUTE_SCHEMA_PARITY.seasonCreateRequestSchema.excluded)]);
    expect(Object.keys(extended.shape).filter((key) => !known.has(key))).toEqual(['brand_new_key']);
  });
});

describe('constants the Plan copies from the routes', () => {
  it('uses the group count bounds of the groups route', () => {
    expect(PLAN_LIMITS.groupsMin).toBe(MIN_SEASON_GROUPS);
    expect(PLAN_LIMITS.groupsMax).toBe(MAX_SEASON_GROUPS);
  });

  it('builds a serpentine groups body the route schema accepts', () => {
    for (const count of [PLAN_LIMITS.groupsMin, 3, PLAN_LIMITS.groupsMax]) {
      expect(seasonGroupsReplaceSchema.safeParse(toGroupsBody(count)).success).toBe(true);
    }
    expect(seasonGroupsReplaceSchema.safeParse(toGroupsBody(1)).success).toBe(false);
  });
});
