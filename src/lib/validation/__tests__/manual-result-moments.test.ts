import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BROADCAST_MOMENT_TYPES,
  MANUAL_RESULT_MAX_MOMENTS,
  MANUAL_RESULT_MAX_TURN,
  manualResultMomentSchema,
  manualResultSchema,
} from '@/lib/validation/schemas';
import { buildGamePayload, createInitialState, trackerReducer } from '@/lib/broadcast/tracker-reducer';
import type { BroadcastMomentInsert, BroadcastMomentType } from '@/types/broadcast';

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';

const baseBody = {
  match_id: MATCH_ID,
  winner_id: P1_ID,
  pokemon_stats: [
    { player_id: P1_ID, pokemon: [{ pokemon_name: 'Pikachu' }] },
    { player_id: P2_ID, pokemon: [{ pokemon_name: 'Charizard' }] },
  ],
};

describe('BROADCAST_MOMENT_TYPES', () => {
  it('matches the broadcast_moments.moment_type CHECK list in the baseline migration', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260608100000_baseline_professional_schema.sql'),
      'utf8'
    );
    const check = sql.match(/"broadcast_moments_moment_type_check" CHECK \(\(.*?ARRAY\[(.*?)\]/);
    expect(check).not.toBeNull();
    const dbValues = [...check![1].matchAll(/'([a-z_]+)'::"text"/g)].map((m) => m[1]);
    expect([...BROADCAST_MOMENT_TYPES].sort()).toEqual(dbValues.sort());
  });

  it('covers exactly the BroadcastMomentType union', () => {
    expectTypeOf<(typeof BROADCAST_MOMENT_TYPES)[number]>().toEqualTypeOf<BroadcastMomentType>();
  });
});

describe('manualResultMomentSchema', () => {
  it.each(BROADCAST_MOMENT_TYPES)('accepts moment_type %s', (moment_type) => {
    expect(manualResultMomentSchema.safeParse({ moment_type }).success).toBe(true);
  });

  it.each(['turnaround', 'upset', 'sweep', '', 'HIGHLIGHT'])('rejects moment_type %j', (moment_type) => {
    expect(manualResultMomentSchema.safeParse({ moment_type }).success).toBe(false);
  });

  it('strips the server-owned match_id, game_id and created_by', () => {
    const parsed = manualResultMomentSchema.parse({
      moment_type: 'big_ko',
      match_id: '99999999-9999-4999-8999-999999999999',
      game_id: '88888888-8888-4888-8888-888888888888',
      created_by: '77777777-7777-4777-8777-777777777777',
    });
    expect(parsed).toEqual({ moment_type: 'big_ko' });
  });

  it('accepts the nullable fields the tracker sends', () => {
    const parsed = manualResultMomentSchema.parse({
      moment_type: 'clutch',
      turn_number: null,
      description: null,
      timestamp: '2026-10-18T12:00:00.000Z',
    });
    expect(parsed).toEqual({
      moment_type: 'clutch',
      turn_number: null,
      description: null,
      timestamp: '2026-10-18T12:00:00.000Z',
    });
  });

  it('bounds turn_number, description and pokemon_name', () => {
    expect(manualResultMomentSchema.safeParse({ moment_type: 'misplay', turn_number: -1 }).success).toBe(false);
    expect(manualResultMomentSchema.safeParse({ moment_type: 'misplay', turn_number: 1.5 }).success).toBe(false);
    expect(
      manualResultMomentSchema.safeParse({ moment_type: 'misplay', turn_number: MANUAL_RESULT_MAX_TURN + 1 }).success
    ).toBe(false);
    expect(
      manualResultMomentSchema.safeParse({ moment_type: 'misplay', description: 'x'.repeat(501) }).success
    ).toBe(false);
    expect(manualResultMomentSchema.safeParse({ moment_type: 'misplay', pokemon_name: '   ' }).success).toBe(false);
  });

  it('rejects a timestamp that is not an ISO date-time', () => {
    expect(manualResultMomentSchema.safeParse({ moment_type: 'highlight', timestamp: 'yesterday' }).success).toBe(
      false
    );
  });
});

describe('manualResultSchema moments', () => {
  it('keeps moments (they were silently stripped before)', () => {
    const parsed = manualResultSchema.parse({ ...baseBody, moments: [{ moment_type: 'highlight' }] });
    expect(parsed.moments).toEqual([{ moment_type: 'highlight' }]);
  });

  it('leaves moments undefined when absent', () => {
    expect(manualResultSchema.parse(baseBody).moments).toBeUndefined();
  });

  it(`rejects more than ${MANUAL_RESULT_MAX_MOMENTS} moments`, () => {
    const moments = Array.from({ length: MANUAL_RESULT_MAX_MOMENTS + 1 }, () => ({ moment_type: 'highlight' }));
    expect(manualResultSchema.safeParse({ ...baseBody, moments }).success).toBe(false);
  });

  it('accepts the payload the battle tracker actually submits', () => {
    let state = createInitialState(
      MATCH_ID,
      { id: P1_ID, name: 'Alice', avatar_url: null, pokemon: ['Pikachu'] },
      { id: P2_ID, name: 'Bob', avatar_url: null, pokemon: ['Charizard'] }
    );
    // The shape TrackerControls.handleMoment dispatches.
    const moment: BroadcastMomentInsert = {
      match_id: MATCH_ID,
      moment_type: 'turning_point',
      turn_number: null,
      description: 'Big swing',
      timestamp: new Date().toISOString(),
      created_by: '',
    };
    state = trackerReducer(state, { type: 'mark_moment', moment });

    const parsed = manualResultSchema.safeParse(buildGamePayload(state, P1_ID));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.moments).toHaveLength(1);
    expect(parsed.data?.moments?.[0]).toEqual({
      moment_type: 'turning_point',
      turn_number: null,
      description: 'Big swing',
      timestamp: moment.timestamp,
    });
  });
});
