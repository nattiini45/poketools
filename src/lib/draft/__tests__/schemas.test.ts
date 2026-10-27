import { describe, expect, it } from 'vitest';
import { DRAFT_AUDIT_ACTIONS } from '@/types/draft-queue';
import { draftPoolCreateSchema, formatZodErrors } from '@/lib/validation/schemas';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import {
  auditCursorSchema,
  auditQueryInput,
  auditQuerySchema,
  comebackOpenSchema,
  comebackSpendSchema,
  correctPickSchema,
  createQueueDraftSchema,
  draftConfigInputSchema,
  draftKillTokenPurchaseSchema,
  draftStateQuerySchema,
  draftTicksQuerySchema,
  endDraftSchema,
  extensionSchema,
  favoriteSchema,
  invalidDraftConfigField,
  legacyPickExtrasSchema,
  lineIdSchema,
  pauseDraftSchema,
  penaltySchema,
  queuePickSchema,
  redraftPatchSchema,
  redraftPublishSchema,
  redraftSubmissionSchema,
  startDraftSchema,
  voidPickSchema,
} from '../schemas';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

describe('lineIdSchema', () => {
  it('accepts line ids and rejects other shapes', () => {
    expect(lineIdSchema.safeParse('teddiursa--ursalunabloodmoon').success).toBe(true);
    for (const bad of ['Teddiursa--Ursaluna', 'teddiursa', 'a-b', 'a--b--c', '', `${'a'.repeat(40)}--${'b'.repeat(40)}`]) {
      expect(lineIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('draftConfigInputSchema', () => {
  it('accepts an empty body and a full valid body', () => {
    expect(draftConfigInputSchema.safeParse({}).success).toBe(true);
    const full = {
      mode: 'slow',
      roster_size: 9,
      budget: 180,
      pick_seconds: 43_200,
      makeup_seconds: 3_600,
      slow_ladder_seconds: [43_200, 21_600, 10_800, 5_400],
      extensions_enabled: false,
      redraft_max_lines: 3,
      redraft_lock_no_redraft_lines: true,
      participant_order: [U1, U2],
      submission_deadline_at: FUTURE,
      token_purchase_closes_at: PAST,
    };
    expect(draftConfigInputSchema.parse(full)).toEqual(full);
  });

  it('accepts token_purchase_closes_at (and null) but rejects token_purchase_cutoff_at', () => {
    expect(draftConfigInputSchema.safeParse({ token_purchase_closes_at: FUTURE }).success).toBe(true);
    expect(draftConfigInputSchema.safeParse({ token_purchase_closes_at: null }).success).toBe(true);
    expect(draftConfigInputSchema.safeParse({ token_purchase_cutoff_at: FUTURE }).success).toBe(false);
  });

  it('is strict about unknown keys', () => {
    expect(draftConfigInputSchema.safeParse({ budget: 180, extension_seconds: [120, 60] }).success).toBe(false);
  });

  it('checks pick_seconds against the mode when both are given', () => {
    expect(draftConfigInputSchema.safeParse({ mode: 'live', pick_seconds: 300 }).success).toBe(true);
    expect(draftConfigInputSchema.safeParse({ mode: 'live', pick_seconds: 100_000 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ mode: 'slow', pick_seconds: 300 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ pick_seconds: 29 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ pick_seconds: 172_801 }).success).toBe(false);
  });

  it('makeup ≤ pick, redraft_max_lines ≤ roster_size, ladder non-increasing with 1..6 stages', () => {
    expect(draftConfigInputSchema.safeParse({ pick_seconds: 300, makeup_seconds: 301 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ roster_size: 2, redraft_max_lines: 3 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ roster_size: 2, redraft_max_lines: null }).success).toBe(true);
    expect(draftConfigInputSchema.safeParse({ slow_ladder_seconds: [600, 1200] }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ slow_ladder_seconds: [] }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ slow_ladder_seconds: Array(7).fill(600) }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ slow_ladder_seconds: [599] }).success).toBe(false);
  });

  it('participant_order: 2..32 unique uuids', () => {
    expect(draftConfigInputSchema.safeParse({ participant_order: [U1] }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ participant_order: [U1, U1] }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ participant_order: [U1, 'not-a-uuid'] }).success).toBe(false);
  });

  it('submission_deadline_at must be a future ISO UTC instant', () => {
    expect(draftConfigInputSchema.safeParse({ submission_deadline_at: PAST }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ submission_deadline_at: '2099-01-01' }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ submission_deadline_at: null }).success).toBe(true);
  });

  it('rejects non-integers and out-of-range values', () => {
    expect(draftConfigInputSchema.safeParse({ budget: 0 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ budget: 1001 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ roster_size: 9.5 }).success).toBe(false);
    expect(draftConfigInputSchema.safeParse({ roster_size: 21 }).success).toBe(false);
  });
});

describe('invalidDraftConfigField (merged stored + patched config)', () => {
  const valid = {
    mode: 'live' as const,
    roster_size: 9,
    budget: 180,
    pick_seconds: 300,
    makeup_seconds: 150,
    slow_ladder_seconds: [43_200, 21_600, 10_800, 5_400],
    redraft_max_lines: 3,
  };

  it('null for a valid config', () => {
    expect(invalidDraftConfigField(valid)).toBeNull();
    expect(invalidDraftConfigField({ ...valid, redraft_max_lines: null })).toBeNull();
  });

  it('names the first invalid field', () => {
    expect(invalidDraftConfigField({ ...valid, mode: 'slow' })).toBe('pick_seconds');
    expect(invalidDraftConfigField({ ...valid, roster_size: 0 })).toBe('roster_size');
    expect(invalidDraftConfigField({ ...valid, budget: 2000 })).toBe('budget');
    expect(invalidDraftConfigField({ ...valid, makeup_seconds: 301 })).toBe('makeup_seconds');
    expect(invalidDraftConfigField({ ...valid, slow_ladder_seconds: [600, 700] })).toBe('slow_ladder_seconds');
    expect(invalidDraftConfigField({ ...valid, redraft_max_lines: 10 })).toBe('redraft_max_lines');
  });

  it('live checks the make-up time: at least 30 s, at most the pick time', () => {
    expect(invalidDraftConfigField({ ...valid, makeup_seconds: 29 })).toBe('makeup_seconds');
    expect(invalidDraftConfigField({ ...valid, makeup_seconds: 30 })).toBeNull();
    expect(invalidDraftConfigField({ ...valid, makeup_seconds: 300 })).toBeNull();
  });

  it('slow ignores the make-up time (the ladder times every slot) but still checks the pick time', () => {
    const slow = { ...valid, mode: 'slow' as const, pick_seconds: 43_200 };
    expect(invalidDraftConfigField(slow)).toBeNull();
    expect(invalidDraftConfigField({ ...slow, makeup_seconds: 10 })).toBeNull();
    expect(invalidDraftConfigField({ ...slow, makeup_seconds: 400_000 })).toBeNull();
    expect(invalidDraftConfigField({ ...slow, makeup_seconds: 10, pick_seconds: 300 })).toBe('pick_seconds');
    expect(invalidDraftConfigField({ ...slow, makeup_seconds: 10, slow_ladder_seconds: [600, 700] })).toBe('slow_ladder_seconds');
  });
});

describe('draft route bodies', () => {
  it('create: season, kind, optional config and force; strict', () => {
    expect(createQueueDraftSchema.safeParse({ season_id: U1, kind: 'initial' }).success).toBe(true);
    expect(
      createQueueDraftSchema.safeParse({ season_id: U1, kind: 'redraft', config: { participant_order: [U1, U2] }, force: true }).success,
    ).toBe(true);
    expect(createQueueDraftSchema.safeParse({ season_id: U1, kind: 'other' }).success).toBe(false);
    expect(createQueueDraftSchema.safeParse({ season_id: U1, kind: 'initial', participant_order: [U1, U2] }).success).toBe(false);
  });

  it('start is an empty strict object; end and void need a 3..500 reason', () => {
    expect(startDraftSchema.safeParse({}).success).toBe(true);
    expect(startDraftSchema.safeParse({ now: true }).success).toBe(false);
    expect(endDraftSchema.safeParse({ reason: 'ok!' }).success).toBe(true);
    expect(endDraftSchema.safeParse({ reason: '  ab  ' }).success).toBe(false);
    expect(endDraftSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(voidPickSchema.safeParse({ reason: 'wrong line', requeue: true }).success).toBe(true);
    expect(voidPickSchema.safeParse({ reason: 'wrong line' }).success).toBe(false);
    // no forfeit: a void always requeues
    expect(voidPickSchema.safeParse({ reason: 'wrong line', requeue: false }).success).toBe(false);
  });

  it('pause: paused flag with an optional reason', () => {
    expect(pauseDraftSchema.safeParse({ paused: true }).success).toBe(true);
    expect(pauseDraftSchema.safeParse({ paused: false, reason: '' }).success).toBe(true);
    expect(pauseDraftSchema.safeParse({ paused: 'yes' }).success).toBe(false);
  });

  it('queue pick: slot, line, request id; optional redraft slot / on-behalf-of / override reason; strict', () => {
    const pick = { slot_id: U1, line_id: 'ralts--gallade', client_request_id: U2 };
    expect(queuePickSchema.safeParse(pick).success).toBe(true);
    expect(queuePickSchema.safeParse({ ...pick, redraft_slot_id: U3, on_behalf_of: U3, override_reason: 'offline' }).success).toBe(true);
    expect(queuePickSchema.safeParse({ ...pick, client_request_id: undefined }).success).toBe(false);
    expect(queuePickSchema.safeParse({ ...pick, pokemon_name: 'Ralts' }).success).toBe(false);
  });

  it('correct requires client_request_id', () => {
    const body = { line_id: 'ralts--gallade', reason: 'misclick', client_request_id: U1 };
    expect(correctPickSchema.safeParse(body).success).toBe(true);
    const { client_request_id: _omit, ...withoutId } = body;
    void _omit;
    expect(correctPickSchema.safeParse(withoutId).success).toBe(false);
  });

  it('extension kinds, penalty stage 0..5, favourites', () => {
    expect(extensionSchema.safeParse({ kind: 'plus120', slot_id: U1 }).success).toBe(true);
    expect(extensionSchema.safeParse({ kind: 'plus30', slot_id: U1 }).success).toBe(false);
    expect(penaltySchema.safeParse({ stage: 0, reason: 'reset' }).success).toBe(true);
    expect(penaltySchema.safeParse({ stage: 6, reason: 'too far' }).success).toBe(false);
    expect(penaltySchema.safeParse({ stage: 1.5, reason: 'half' }).success).toBe(false);
    expect(favoriteSchema.safeParse({ line_id: 'ralts--gallade', favorite: true }).success).toBe(true);
    expect(favoriteSchema.safeParse({ line_id: 'ralts--gallade' }).success).toBe(false);
  });
});

describe('query schemas', () => {
  it('state: since ≥ 0 and include=trackers', () => {
    expect(draftStateQuerySchema.parse({ since: '12', include: 'trackers' })).toEqual({ since: 12, include: 'trackers' });
    expect(draftStateQuerySchema.safeParse({ since: '-1' }).success).toBe(false);
    expect(draftStateQuerySchema.safeParse({ include: 'everything' }).success).toBe(false);
  });

  it('audit: repeatable action ∈ DRAFT_AUDIT_ACTIONS, limit 1..200 (default 50), bigint cursor', () => {
    const sp = new URLSearchParams('action=pick_voided&action=paused&cursor=42');
    expect(auditQuerySchema.parse(auditQueryInput(sp))).toEqual({ action: ['pick_voided', 'paused'], cursor: '42', limit: 50 });
    expect(auditQuerySchema.safeParse(auditQueryInput(new URLSearchParams('action=dropped_table'))).success).toBe(false);
    expect(auditQuerySchema.safeParse(auditQueryInput(new URLSearchParams('limit=201'))).success).toBe(false);
    expect(auditQuerySchema.safeParse(auditQueryInput(new URLSearchParams('cursor=abc'))).success).toBe(false);
    expect(auditQuerySchema.safeParse({ action: [...DRAFT_AUDIT_ACTIONS] }).success).toBe(true);
  });

  it('audit cursor stays within bigint (a larger id is a 400, not a Postgres 22003 → 500)', () => {
    expect(auditCursorSchema.safeParse('9223372036854775807').success).toBe(true);
    expect(auditCursorSchema.safeParse('9223372036854775808').success).toBe(false);
    expect(auditCursorSchema.safeParse('9999999999999999999').success).toBe(false);
    expect(auditCursorSchema.safeParse('10000000000000000000').success).toBe(false);
    expect(auditCursorSchema.safeParse('0').success).toBe(false);
    const sp = new URLSearchParams('cursor=9999999999999999999');
    expect(auditQuerySchema.safeParse(auditQueryInput(sp)).success).toBe(false);
  });

  it('legacy pick extras: player_id is a uuid, points_spent a non-negative integer', () => {
    expect(legacyPickExtrasSchema.safeParse({}).success).toBe(true);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: null }).success).toBe(true);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: 0 }).success).toBe(true);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: -5 }).success).toBe(false);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: 1.5 }).success).toBe(false);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: '10' }).success).toBe(false);
    expect(legacyPickExtrasSchema.safeParse({ player_id: 'player-2' }).success).toBe(false);
  });

  it('legacy points: a pick and a pool budget share one upper bound', () => {
    expect(LEGACY_POINTS_MAX).toBe(100_000);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: LEGACY_POINTS_MAX }).success).toBe(true);
    expect(legacyPickExtrasSchema.safeParse({ points_spent: LEGACY_POINTS_MAX + 1 }).success).toBe(false);
    const pool = { season_id: U1, draft_type: 'budget' };
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: 180 }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: LEGACY_POINTS_MAX }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: LEGACY_POINTS_MAX + 1 }).success).toBe(false);
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: -1 }).success).toBe(false);
  });

  it('legacy points: the pool default price is optional, nullable and bounded like a bid', () => {
    const pool = { season_id: U1, draft_type: 'budget', budget: 180 };
    expect(draftPoolCreateSchema.parse(pool)).not.toHaveProperty('default_point_cost');
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: null }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: 0 }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: LEGACY_POINTS_MAX, default_point_cost: LEGACY_POINTS_MAX }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: LEGACY_POINTS_MAX + 1 }).success).toBe(false);
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: -1 }).success).toBe(false);
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: 2.5 }).success).toBe(false);
  });

  it('legacy points: the pool default price may not exceed the budget (issue on default_point_cost)', () => {
    const pool = { season_id: U1, draft_type: 'budget' };
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: 180, default_point_cost: 180 }).success).toBe(true);
    const over = draftPoolCreateSchema.safeParse({ ...pool, budget: 180, default_point_cost: 181 });
    expect(over.success).toBe(false);
    expect(over.error?.issues).toEqual([
      expect.objectContaining({ path: ['default_point_cost'], message: 'must not exceed budget (180)' }),
    ]);
    expect(formatZodErrors(over.error!)).toBe('default_point_cost: must not exceed budget (180)');
    // Either side missing: nothing to compare.
    expect(draftPoolCreateSchema.safeParse({ ...pool, default_point_cost: 500 }).success).toBe(true);
    expect(draftPoolCreateSchema.safeParse({ ...pool, budget: 10, default_point_cost: null }).success).toBe(true);
  });

  it('cron limit 1..100', () => {
    expect(draftTicksQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
    expect(draftTicksQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('redraft bodies', () => {
  it('PATCH redraft: deadline/max/order only — no `open` field', () => {
    expect(redraftPatchSchema.safeParse({ deadline_at: FUTURE, redraft_max_lines: 3, participant_order: [U1, U2] }).success).toBe(
      true,
    );
    expect(redraftPatchSchema.safeParse({ open: true }).success).toBe(false);
    expect(redraftPatchSchema.safeParse({ deadline_at: PAST }).success).toBe(false);
    expect(redraftPatchSchema.safeParse({ redraft_max_lines: 21 }).success).toBe(false);
  });

  it('submission: up to 20 unique line ids (empty = drop nothing)', () => {
    expect(redraftSubmissionSchema.safeParse({ line_ids: [] }).success).toBe(true);
    expect(redraftSubmissionSchema.safeParse({ line_ids: ['ralts--gallade', 'ralts--gardevoir'] }).success).toBe(true);
    expect(redraftSubmissionSchema.safeParse({ line_ids: ['ralts--gallade', 'ralts--gallade'] }).success).toBe(false);
    expect(redraftSubmissionSchema.safeParse({ line_ids: Array.from({ length: 21 }, (_, i) => `l${i}--x`) }).success).toBe(false);
  });

  it('publish: optional force and reason', () => {
    expect(redraftPublishSchema.safeParse({}).success).toBe(true);
    expect(redraftPublishSchema.safeParse({ force: true, reason: 'everyone submitted' }).success).toBe(true);
    expect(redraftPublishSchema.safeParse({ force: true, reason: 'no' }).success).toBe(false);
  });
});

describe('token bodies', () => {
  it('Draft Kill Token purchase: one line + request id', () => {
    expect(draftKillTokenPurchaseSchema.safeParse({ line_id: 'chikorita--meganium', client_request_id: U1 }).success).toBe(true);
    expect(draftKillTokenPurchaseSchema.safeParse({ line_id: 'chikorita--meganium' }).success).toBe(false);
    expect(draftKillTokenPurchaseSchema.safeParse({ line_id: 'chikorita--meganium', client_request_id: U1, count: 2 }).success).toBe(
      false,
    );
  });

  it('Comeback spend: 1..9 allocations, count 1..20, unique lines', () => {
    const ok = { allocations: [{ line_id: 'a--b', count: 2 }], client_request_id: U1 };
    expect(comebackSpendSchema.safeParse(ok).success).toBe(true);
    expect(comebackSpendSchema.safeParse({ ...ok, allocations: [] }).success).toBe(false);
    expect(comebackSpendSchema.safeParse({ ...ok, allocations: [{ line_id: 'a--b', count: 0 }] }).success).toBe(false);
    expect(comebackSpendSchema.safeParse({ ...ok, allocations: [{ line_id: 'a--b', count: 21 }] }).success).toBe(false);
    expect(
      comebackSpendSchema.safeParse({ ...ok, allocations: [{ line_id: 'a--b', count: 1 }, { line_id: 'a--b', count: 1 }] }).success,
    ).toBe(false);
    expect(
      comebackSpendSchema.safeParse({
        ...ok,
        allocations: Array.from({ length: 10 }, (_, i) => ({ line_id: `l${i}--x`, count: 1 })),
      }).success,
    ).toBe(false);
  });

  it('Comeback spend: the client cannot send a tokens-per-progress rate (the server derives it)', () => {
    const body = { allocations: [{ line_id: 'a--b', count: 2, ratio: 1 }], client_request_id: U1 };
    expect(comebackSpendSchema.safeParse(body).success).toBe(false);
  });

  it('Comeback open switch', () => {
    expect(comebackOpenSchema.safeParse({ open: true }).success).toBe(true);
    expect(comebackOpenSchema.safeParse({}).success).toBe(false);
  });
});
