/**
 * What the executor leaves in the ledger for a later undo (slice 5): the after-fingerprint of every undoable step, the entity a
 * row is filed under, and the `before` a reversal needs. The hooks are the ones the approve route wires
 * (`afterFingerprintFor`, `liveBeforeState`); here they run over a scripted source.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { PLAYERS } from '../../plans/__tests__/fixtures';
import { hashJson } from '../../plans/hash';
import { afterFingerprintFor, afterRead, rosterMembersState, sortedIds, type StepFacts } from '../after-state';
import { executeProposal, ledgerEntityId } from '../executor';
import type { FingerprintSource } from '../fingerprints';
import { LEAGUE_ID, PHASE_IDS, makeWorld, statusesOf } from './executor-helpers';

const V3 = '00000000-0000-4000-8000-000000009103';
const DEF = '00000000-0000-4000-8000-000000000700';
const TID = '00000000-0000-4000-8000-000000000710';
const SID = '00000000-0000-4000-8000-000000000720';

/** A source that answers every read with the read it was asked (so the hash says which read and target ran). */
const echo = (overrides: Record<string, unknown> = {}): FingerprintSource => ({
  read: async (read, target) => (read in overrides ? overrides[read] : { read, target }) as never,
});

describe('the after-fingerprint of a step that was written', () => {
  it('is recorded for the league and the roster, and for nothing the table does not undo', async () => {
    const world = await makeWorld();
    const seen: StepFacts[] = [];
    const hook = afterFingerprintFor(echo());
    const result = await executeProposal(
      { ...world.deps, afterFingerprint: async (facts) => (seen.push(facts), hook(facts)) },
      await world.input(),
    );

    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    expect(world.store.action('league')?.after_fingerprint).toBe(hashJson({ read: 'league_after', target: { kind: 'id', id: LEAGUE_ID } }));
    expect(world.store.action('roster.1')?.after_fingerprint).toBe(
      hashJson({ read: 'roster_members', target: { kind: 'params', params: { season_id: LEAGUE_ID, player_ids: sortedIds(PLAYERS) } } }),
    );
    // A phase is archived residue: no fingerprint.
    expect(world.store.action('phase.playoffs')?.after_fingerprint).toBeNull();
    // The hook sees the resolved request (the league id the roster step took from the ledger) and the ledger result.
    const roster = seen.find((facts) => facts.step.op === 'roster_add');
    expect(roster?.call?.params).toEqual({ id: LEAGUE_ID });
    expect(seen.find((facts) => facts.step.op === 'league_create')).toMatchObject({ entityId: LEAGUE_ID, result: { id: LEAGUE_ID } });
    expect(seen.find((facts) => facts.step.key === 'phase.playoffs')?.entityId).toBe(PHASE_IDS.playoffs);
  });

  it('is null when the entity cannot be read back, and a failing hook does not fail the step', async () => {
    const world = await makeWorld();
    const result = await executeProposal({ ...world.deps, afterFingerprint: afterFingerprintFor(echo({ league_after: null })) }, await world.input());
    expect(result.status).toBe('completed');
    expect(world.store.action('league')?.after_fingerprint).toBeNull();

    const other = await makeWorld();
    const broken = await executeProposal({ ...other.deps, afterFingerprint: async () => Promise.reject(new Error('read failed (secret detail)')) }, await other.input());
    expect(broken.status).toBe('completed');
    expect(other.store.action('league')?.after_fingerprint).toBeNull();
  });
});

describe('the before-state a reversal needs', () => {
  it('is stored on the ledger row, read after the preconditions passed and before the dispatch', async () => {
    const world = await makeWorld();
    const order: string[] = [];
    world.script.roster_add = () => {
      order.push('dispatch');
      return new Response(JSON.stringify({ success: true, data: null }), { status: 201, headers: { 'content-type': 'application/json' } });
    };
    const result = await executeProposal(
      {
        ...world.deps,
        beforeState: async ({ step }) => {
          order.push(`before:${step.op}`);
          return step.op === 'roster_add' ? { pins: [{ id: 'x', version_no: 1 }] } : null;
        },
      },
      await world.input(),
    );
    expect(result.status).toBe('completed');
    expect(order.slice(0, 3)).toEqual(['before:league_create', 'before:roster_add', 'dispatch']);
    expect(world.store.action('roster.1')?.before).toEqual({ pins: [{ id: 'x', version_no: 1 }] });
    expect(world.store.action('league')?.before).toBeNull();
  });

  it('never stops the write when it cannot be read', async () => {
    const world = await makeWorld();
    const result = await executeProposal({ ...world.deps, beforeState: async () => Promise.reject(new Error('read failed (secret detail)')) }, await world.input());
    expect(result.status).toBe('completed');
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
  });
});

describe('the entity a ledger row is filed under', () => {
  const call = (params: Record<string, string>) => ({ params });

  it('is the tournament of a start or a bracket, the definition of a publish or a pin move, and the entity an undo step acted on', () => {
    expect(ledgerEntityId('start_phase', call({ tid: TID }), { id: 'round' })).toBe(TID);
    expect(ledgerEntityId('generate_bracket', call({ id: TID }), { id: TID })).toBe(TID);
    expect(ledgerEntityId('publish_ruleset', call({ id: DEF }), { id: V3 })).toBe(DEF);
    expect(ledgerEntityId('move_pin', call({ id: DEF }), { id: V3 })).toBe(DEF);
    for (const op of ['league_archive', 'tournament_archive', 'roster_remove', 'ruleset_restore_draft', 'ruleset_delete_draft']) expect(ledgerEntityId(op, call({ id: SID }), null), op).toBe(SID);
  });

  it('is the id the route answered with for what a step creates, and nothing for a roster add', () => {
    expect(ledgerEntityId('league_create', undefined, { id: LEAGUE_ID })).toBe(LEAGUE_ID);
    expect(ledgerEntityId('phase_create', call({ id: LEAGUE_ID }), { id: PHASE_IDS.playoffs })).toBe(PHASE_IDS.playoffs);
    expect(ledgerEntityId('roster_add', call({ id: LEAGUE_ID }), null)).toBeNull();
    expect(ledgerEntityId('start_phase', undefined, { id: 'round' })).toBeNull();
  });
});

describe('afterRead', () => {
  const facts = (op: string, params: Record<string, string>, body: unknown, entityId: string | null = null): StepFacts => ({ step: { key: 'k', op }, call: { params, body }, result: null, entityId });

  it('names the read of each undoable op and none for the others', () => {
    expect(afterRead(facts('league_create', {}, {}, LEAGUE_ID))).toEqual({ read: 'league_after', target: { kind: 'id', id: LEAGUE_ID } });
    expect(afterRead(facts('tournament_create', {}, {}, TID))).toEqual({ read: 'tournament_after', target: { kind: 'id', id: TID } });
    expect(afterRead(facts('roster_add', { id: LEAGUE_ID }, { player_ids: ['B', 'a'] }))).toEqual({
      read: 'roster_members',
      target: { kind: 'params', params: { season_id: LEAGUE_ID, player_ids: ['a', 'b'] } },
    });
    expect(afterRead(facts('move_pin', { id: DEF }, { targets: [{ kind: 'season', id: SID.toUpperCase() }] }))).toEqual({
      read: 'pin_targets',
      target: { kind: 'params', params: { targets: [{ kind: 'season', id: SID }] } },
    });
    for (const op of ['phase_create', 'start_phase', 'generate_bracket', 'publish_ruleset']) expect(afterRead(facts(op, { id: SID }, {})), op).toBeNull();
    expect(afterRead(facts('league_create', {}, {}, null))).toBeNull();
    expect(afterRead(facts('roster_add', { id: 'nope' }, { player_ids: ['a'] }))).toBeNull();
  });

  it('keeps the state shapes in line: a roster state is sorted and lower case', () => {
    expect(rosterMembersState(['B', 'a', 'b'])).toEqual(['a', 'b']);
  });
});
