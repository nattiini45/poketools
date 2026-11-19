import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const q = vi.hoisted(() => ({
  creator: vi.fn(),
  from: vi.fn(),
  match: vi.fn(),
  tournament: vi.fn(),
  nativePopulate: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requireCreator: q.creator, AuthError: class extends Error {} }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: q.match }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: q.tournament }));
vi.mock('@/lib/broadcast/phase-populate', () => ({ loadPhaseCastMatch: q.nativePopulate }));

import { GET as list, POST as create } from '../route';
import { DELETE as remove, GET as get, PATCH as update } from '../[id]/route';
import { POST as populate } from '../[id]/populate/route';

const ID = '10000000-0000-4000-8000-000000000001';
const MATCH = '10000000-0000-4000-8000-000000000002';
const PHASE = '10000000-0000-4000-8000-000000000003';
const LEAGUE = '10000000-0000-4000-8000-000000000004';
const OTHER = '10000000-0000-4000-8000-000000000005';
const REF = { phase_id: PHASE, season_id: LEAGUE, match_id: MATCH };
const CREATOR = { playerId: 'fixture-creator', isCreator: true, isAdmin: false, name: 'Fixture Caster', avatarUrl: null };
const COMMON = {
  id: ID, owner_id: CREATOR.playerId, realtime_key: 'fixture-realtime-key', match_id: null,
  season_id: null, name: 'Fixture session', mode: 'cast', status: 'draft',
  player1_id: null, player1_name: null, player1_avatar_url: null, player2_id: null,
  player2_name: null, player2_avatar_url: null, player1_team: [], player2_team: [],
  tracker_state: { fixture: true }, overlay_config: {}, caster_notes: { match: 'Private fixture' },
  format: 'gen9ou', generation: 9, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
};
const INDEPENDENT = {
  ...COMMON, tournament_id: null, phase_id: null, phase_match_id: null, tournament: null,
  legacy_match: null, phase: null, phase_match: null,
};
const NATIVE = {
  ...COMMON, ...REF, phase: { season_id: LEAGUE }, match: { id: MATCH, phase_id: PHASE },
};
const BOUND = {
  ...INDEPENDENT, phase_id: PHASE, phase_match_id: MATCH, phase: NATIVE.phase, phase_match: NATIVE.match,
};
const TARGET = { phase_id: PHASE, phase: { season_id: LEAGUE } };

type Read = { data: unknown; error?: unknown };
const results = new Map<string, Read[]>();
const calls: { table: string; method: string; args: unknown[] }[] = [];

function reply(table: string, ...data: unknown[]) {
  results.set(table, data.map((item) => ({ data: item })));
}

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/cast-sessions', {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const context = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  results.clear();
  calls.length = 0;
  q.creator.mockResolvedValue(CREATOR);
  q.from.mockImplementation((table: string) => {
    const resolve = () => {
      const result = results.get(table)?.shift();
      if (!result) throw new Error(`Unexpected test query: ${table}`);
      return Promise.resolve(result);
    };
    const builder = Object.fromEntries(
      ['select', 'eq', 'is', 'order', 'insert', 'update', 'delete'].map((method) => [
        method, (...args: unknown[]) => { calls.push({ table, method, args }); return builder; },
      ]),
    );
    return Object.assign(builder, {
      single: resolve, maybeSingle: resolve, range: resolve,
      then: (onfulfilled: (result: Read) => unknown, onrejected: (reason: unknown) => unknown) =>
        resolve().then(onfulfilled, onrejected),
    });
  });
  reply('phase_storage_state', { mode: 'phase' });
});

afterEach(() => vi.unstubAllEnvs());

describe('Cast Studio session storage generation', () => {
  it('lists only the creator’s valid native and independent sessions, with their private editor fields', async () => {
    const leagueOnly = { ...INDEPENDENT, id: OTHER, season_id: LEAGUE };
    const retired = { ...INDEPENDENT, tournament_id: PHASE, tournament: { season_id: LEAGUE } };
    reply('cast_sessions', [leagueOnly, retired], []);
    reply('phase_cast_sessions', [NATIVE], []);
    const response = await list();
    const { data } = await response.json();
    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ ...REF, caster_notes: COMMON.caster_notes, realtime_key: COMMON.realtime_key });
    expect(data[0]).not.toHaveProperty('tournament_id');
    expect(data[1]).toMatchObject({ id: OTHER, season_id: LEAGUE, tournament_id: null, match_id: null });
    expect(data[1]).not.toHaveProperty('phase_ref');
    const ownerFilters = calls.filter((x) => x.method === 'eq' && x.args[0] === 'owner_id');
    expect(new Set(ownerFilters.map((x) => x.table))).toEqual(new Set(['cast_sessions', 'phase_cast_sessions']));
    expect(ownerFilters.every((x) => x.args[1] === CREATOR.playerId)).toBe(true);
  });

  it('opens the same migrated session ID only for its creator or site admin', async () => {
    reply('phase_storage_state', { mode: 'phase' }, { mode: 'phase' });
    reply('phase_cast_sessions', NATIVE, NATIVE);
    q.creator
      .mockResolvedValueOnce({ ...CREATOR, playerId: OTHER, isResourceAdmin: true })
      .mockResolvedValueOnce({ ...CREATOR, playerId: OTHER, isAdmin: true });
    expect((await get(request('GET'), context)).status).toBe(403);
    const allowed = await get(request('GET'), context);
    expect((await allowed.json()).data).toMatchObject({ id: ID, realtime_key: COMMON.realtime_key });
    expect(q.from).not.toHaveBeenCalledWith('cast_sessions');
  });

  it('never falls back to the legacy store after a native query failure', async () => {
    results.set('phase_cast_sessions', [{ data: null, error: new Error('Fixture query failed') }]);
    expect((await get(request('GET'), context)).status).toBe(500);
    expect(q.from).not.toHaveBeenCalledWith('cast_sessions');
  });

  it('does not serve a retired legacy match-linked session even when its own tournament pointer is null', async () => {
    reply('phase_cast_sessions', null);
    reply('cast_sessions', {
      ...INDEPENDENT, match_id: MATCH, legacy_match: { tournament_id: PHASE, tournament: { season_id: LEAGUE } },
    });
    expect((await get(request('GET'), context)).status).toBe(404);
  });

  it.each(['frozen_legacy', 'frozen_phase', 'invalid'])('blocks all session queries in unavailable mode %s', async (mode) => {
    reply('phase_storage_state', { mode });
    expect((await remove(request('DELETE'), context)).status).toBe(mode === 'invalid' ? 500 : 503);
    expect(q.from.mock.calls).toEqual([['phase_storage_state']]);
  });

  it('keeps legacy session shape and never reads the mode or native rows with the flag off', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
    reply('cast_sessions', INDEPENDENT);
    const response = await get(request('GET'), context);
    expect((await response.json()).data).not.toHaveProperty('phase_ref');
    expect(q.from.mock.calls).toEqual([['cast_sessions']]);
  });

  it('creates an unbound independent session or a phase-owned one from a verified explicit ref', async () => {
    reply('phase_storage_state', { mode: 'phase' }, { mode: 'phase' });
    reply('cast_sessions', INDEPENDENT);
    reply('phase_matches', TARGET);
    reply('league_phases', { id: PHASE, season_id: LEAGUE });
    reply('phase_cast_sessions', NATIVE);
    expect((await create(request('POST', { name: 'Unbound' }))).status).toBe(201);
    expect((await create(request('POST', { mode: 'solo', phase_ref: REF }))).status).toBe(201);
    expect(calls).toContainEqual({
      table: 'phase_cast_sessions', method: 'insert',
      args: [expect.objectContaining({ ...REF, owner_id: CREATOR.playerId, player1_name: CREATOR.name })],
    });
  });

  it('populates before binding, then writes native pointers in place and keeps the key and notes', async () => {
    reply('phase_storage_state', { mode: 'phase' }, { mode: 'phase' });
    reply('phase_cast_sessions', null, null);
    reply('cast_sessions', INDEPENDENT, INDEPENDENT, BOUND);
    reply('phase_matches', TARGET, TARGET);
    q.nativePopulate.mockResolvedValue({ match: { id: MATCH, phase_id: PHASE, season_id: LEAGUE }, player1_team: [] });
    const populated = await populate(request('POST', { phase_ref: REF }), context);
    expect((await populated.json()).data.match).not.toHaveProperty('tournament_id');
    expect(q.nativePopulate).toHaveBeenCalledWith(PHASE, MATCH, CREATOR);
    expect(calls.some((x) => x.method === 'update')).toBe(false);
    const saved = await update(request('PATCH', { phase_ref: REF, name: 'Saved' }), context);
    expect(saved.status).toBe(200);
    expect((await saved.json()).data).toMatchObject({
      phase_ref: REF, id: ID, match_id: null, caster_notes: COMMON.caster_notes, realtime_key: COMMON.realtime_key,
    });
    const write = calls.find((x) => x.method === 'update');
    expect(write).toMatchObject({
      table: 'cast_sessions', args: [expect.objectContaining({ phase_id: PHASE, phase_match_id: MATCH })],
    });
    expect(write?.args[0]).not.toHaveProperty('caster_notes');
    expect(write?.args[0]).not.toHaveProperty('realtime_key');
    expect(calls).toContainEqual({ table: 'cast_sessions', method: 'is', args: ['phase_match_id', null] });
  });

  it('rejects a ref in another league before writing or loading rosters', async () => {
    reply('phase_cast_sessions', null);
    reply('cast_sessions', INDEPENDENT);
    reply('phase_matches', TARGET);
    const response = await populate(request('POST', { phase_ref: { ...REF, season_id: OTHER } }), context);
    expect(response.status).toBe(404);
    expect(q.nativePopulate).not.toHaveBeenCalled();
    expect(q.match).not.toHaveBeenCalled();
  });

  it('does not treat a native match submitted in the legacy shape as a native owner', async () => {
    reply('phase_cast_sessions', null);
    reply('cast_sessions', INDEPENDENT);
    reply('matches', null);
    const response = await update(request('PATCH', { match_id: MATCH }), context);
    expect(response.status).toBe(404);
    expect(q.from).not.toHaveBeenCalledWith('phase_matches');
    expect(calls.some((x) => x.method === 'update')).toBe(false);
  });

  it('keeps a standalone binding on its existing row and refuses to replace it implicitly', async () => {
    const standalone = {
      ...INDEPENDENT, tournament_id: OTHER, match_id: MATCH, tournament: { season_id: null },
      legacy_match: { tournament_id: OTHER, tournament: { season_id: null } },
    };
    reply('phase_storage_state', { mode: 'phase' }, { mode: 'phase' });
    reply('phase_cast_sessions', null, null);
    reply('cast_sessions', standalone, { ...standalone, name: 'Saved' }, standalone);
    const saved = await update(request('PATCH', { name: 'Saved' }), context);
    expect((await saved.json()).data).toMatchObject({ tournament_id: OTHER, match_id: MATCH, name: 'Saved' });
    const conflicted = await update(request('PATCH', { phase_ref: REF }), context);
    expect(conflicted.status).toBe(409);
    expect(q.from).not.toHaveBeenCalledWith('phase_matches');
    expect(calls.filter((x) => x.method === 'update')).toHaveLength(1);
  });

  it('can explicitly reparent a native-owned session to a verified native phase without changing its key', async () => {
    const target = { ...REF, phase_id: OTHER, match_id: null };
    reply('phase_cast_sessions', NATIVE, { ...NATIVE, ...target, match: null });
    reply('league_phases', { id: OTHER, season_id: LEAGUE }, { id: OTHER, season_id: LEAGUE });
    const response = await update(request('PATCH', { phase_ref: target }), context);
    expect((await response.json()).data).toMatchObject({
      ...target, realtime_key: COMMON.realtime_key, caster_notes: COMMON.caster_notes,
    });
    expect(calls).toContainEqual({
      table: 'phase_cast_sessions', method: 'update',
      args: [expect.objectContaining({ phase_id: OTHER, season_id: LEAGUE, match_id: null })],
    });
    expect(calls).toContainEqual({ table: 'phase_cast_sessions', method: 'eq', args: ['phase_id', PHASE] });
  });

  it('refuses old autosave fields on a migrated session rather than dropping its native pointer', async () => {
    reply('phase_cast_sessions', NATIVE);
    const response = await update(request('PATCH', { match_id: null, tournament_id: null }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('cast_session_binding_conflict');
    expect(calls.some((x) => x.method === 'update')).toBe(false);
  });

  it('clears only the native match using an explicit null match ref and detects version conflicts', async () => {
    reply('phase_cast_sessions', NATIVE, null);
    reply('league_phases', { id: PHASE, season_id: LEAGUE });
    const response = await update(request('PATCH', { phase_ref: { ...REF, match_id: null }, status: 'live' }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('cast_session_changed');
    expect(calls).toContainEqual({
      table: 'phase_cast_sessions', method: 'update', args: [expect.objectContaining({ match_id: null, status: 'live' })],
    });
    expect(calls).toContainEqual({ table: 'phase_cast_sessions', method: 'eq', args: ['status', 'draft'] });
    expect(calls).toContainEqual({ table: 'phase_cast_sessions', method: 'eq', args: ['match_id', MATCH] });
  });

  it('deletes from the matched native store with no independent write', async () => {
    reply('phase_cast_sessions', NATIVE, [{ id: ID }]);
    const response = await remove(request('DELETE'), context);
    expect((await response.json()).data).toEqual({ deleted: true });
    expect(calls).toContainEqual({ table: 'phase_cast_sessions', method: 'delete', args: [] });
    expect(q.from).not.toHaveBeenCalledWith('cast_sessions');
  });
});
