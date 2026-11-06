/**
 * The loaders: what they read, what they hand to the pure mappers, and what they leave unread. The mappers' privacy rules
 * are in `views.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, link, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
  loadMaskContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageTable: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-challenges', () => ({ listFormatChallenges: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime-reads', () => ({ listFormatAdjustments: vi.fn(), listFormatChecks: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getPublicSeasonParticipants: vi.fn() }));

import { listFormatChallenges } from '@/lib/supabase/queries/format-challenges';
import { listFormatAdjustments, listFormatChecks } from '@/lib/supabase/queries/format-runtime-reads';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { loadFreshKitContext, loadMaskContext, type KitContext } from '../load';
import { loadStageTable } from '../stage-table';
import { loadAdjustmentsPage, loadAdminOverview, loadChecksPage, loadPlayerView, loadUnmasked } from '../views-server';
import { NOT_RUNNING_OVERVIEW } from '../views';

const SEASON = 's-1';
const NOW = new Date('2026-11-05T12:00:00Z');

function context(ladder = false): KitContext {
  const def = giftDef();
  const stage = ladder
    ? ({ ...def.stages[0], pairing: { kind: 'challenge', rounds: 8, rank_range: 3, max_open: 2, cooldown_rounds: 1, accept_window_hours: 72 } } as unknown as KitContext['phases'][number]['stage'])
    : def.stages[0];
  return {
    seasonId: SEASON,
    seed: SEED,
    def,
    state: stateFor(def, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')] }),
    tunableIssues: [],
    phases: [{ id: 'phase-1', stage, members: PLAYERS }],
  };
}

const challengeRow = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  season_id: SEASON,
  phase_id: 'phase-1',
  challenger_id: 'p3',
  defender_id: 'p1',
  status: 'open',
  round: 2,
  created_at: '2026-11-05T10:00:00Z',
  expires_at: '2026-11-06T10:00:00Z',
  responded_at: null,
  match_id: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPublicSeasonParticipants).mockResolvedValue(PLAYERS.map((id) => ({ id, name: `Name ${id}`, gym_type: null, avatar_url: null, core_types: null })) as never);
  vi.mocked(listFormatChallenges).mockResolvedValue([]);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(loadStageTable).mockResolvedValue([]);
  vi.mocked(resolvePlayerNames).mockResolvedValue({});
  vi.mocked(loadMaskContext).mockResolvedValue(null);
});

describe('loadPlayerView', () => {
  it('is not running for a league without a kit format, and reads nothing else', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(loadPlayerView(SEASON, 'p1', NOW)).resolves.toEqual({ running: false });
    expect(getPublicSeasonParticipants).not.toHaveBeenCalled();
    expect(listFormatChallenges).not.toHaveBeenCalled();
  });

  it('builds the view of a league with no ladder without reading challenges, tables or rounds', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context());
    const view = await loadPlayerView(SEASON, 'p1', NOW);
    expect(view).toMatchObject({ running: true, ladders: [] });
    expect(loadStageTable).not.toHaveBeenCalled();
    expect(listFormatChallenges).not.toHaveBeenCalled();
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('reads only the viewer’s own challenges of a ladder phase and derives the open round and the targets', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(true));
    vi.mocked(loadStageTable).mockResolvedValue([
      { player_id: 'p1', rank: 1 },
      { player_id: 'p2', rank: 2 },
      { player_id: 'p3', rank: 3 },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
      { round_number: 2, status: 'in_progress' },
      { round_number: 3, status: 'pending' },
    ] as never);
    vi.mocked(listFormatChallenges).mockResolvedValue([challengeRow()] as never);

    const view = await loadPlayerView(SEASON, 'p3', NOW);

    expect(listFormatChallenges).toHaveBeenCalledWith(SEASON, { phaseId: 'phase-1', playerId: 'p3' });
    if (!view.running) throw new Error('running');
    const [ladder] = view.ladders;
    expect(ladder.round).toBe(3);
    expect(ladder.my_rank).toBe(3);
    // p3 already has an open challenge against p1 (the reverse pair): only p2 is left to challenge.
    expect(ladder.targets).toEqual(['p2']);
    expect(ladder.challenges).toHaveLength(1);
  });

  it('has no targets and no round when every round is completed', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(true));
    vi.mocked(loadStageTable).mockResolvedValue([{ player_id: 'p1', rank: 1 }, { player_id: 'p2', rank: 2 }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed' }] as never);
    const view = await loadPlayerView(SEASON, 'p2', NOW);
    if (!view.running) throw new Error('running');
    expect(view.ladders[0]).toMatchObject({ round: null, targets: [] });
  });
});

describe('the admin loaders', () => {
  it('answers the "not running" overview for a league without a kit format', async () => {
    await expect(loadAdminOverview(null, 'admin-1', NOW)).resolves.toBe(NOT_RUNNING_OVERVIEW);
    expect(listFormatChallenges).not.toHaveBeenCalled();
  });

  it('counts the open challenges that have not lapsed', async () => {
    vi.mocked(listFormatChallenges).mockResolvedValue([
      challengeRow(),
      challengeRow({ id: 'c-2', expires_at: '2026-11-05T11:00:00Z' }),
    ] as never);
    const overview = await loadAdminOverview(context(), 'admin-1', NOW);
    expect(listFormatChallenges).toHaveBeenCalledWith(SEASON, { status: 'open' });
    expect(overview).toMatchObject({ running: true, open_challenges: 1 });
    expect(overview.relations[0]).toMatchObject({ masked: true, links: [] });
  });

  it('unmasks through the same participants read', async () => {
    const unmasked = await loadUnmasked(context(), 'admin-1');
    expect(unmasked.relations[0]).toMatchObject({ masked: false, links: [expect.objectContaining({ from: { id: 'p1', name: 'Name p1' } })] });
  });

  it('pages the adjustments, names an admin who does not play, and keeps relation links out', async () => {
    vi.mocked(listFormatAdjustments).mockResolvedValue({
      rows: [
        { id: 'a-1', kind: 'relation', target: { relation: 'santa' }, delta: { links: [{ from: 'p1', to: 'p2' }] }, reason: 'fix', admin_id: 'admin-9', created_at: 't', season_id: SEASON },
      ],
      total: 41,
    } as never);
    vi.mocked(resolvePlayerNames).mockResolvedValue({ 'admin-9': 'The Admin' });
    const page = await loadAdjustmentsPage(SEASON, context(), { limit: 25, offset: 25 }, 'admin-9');
    expect(listFormatAdjustments).toHaveBeenCalledWith(SEASON, { limit: 25, offset: 25 });
    expect(resolvePlayerNames).toHaveBeenCalledWith(['admin-9']);
    expect(page.total).toBe(41);
    expect(page.history[0]).toMatchObject({ admin: { id: 'admin-9', name: 'The Admin' }, delta: { link_count: 1 } });
    expect(page.allowed).toEqual(['points', 'resource', 'relation', 'action', 'domain', 'rank']);
    expect(page.targets.players).toHaveLength(PLAYERS.length);
    expect(JSON.stringify(page)).not.toContain('"to"');
  });

  it('does not look up the names of admins who are participants', async () => {
    vi.mocked(listFormatAdjustments).mockResolvedValue({ rows: [{ id: 'a', kind: 'points', target: {}, delta: {}, reason: 'r', admin_id: 'p1', created_at: 't' }], total: 1 } as never);
    await loadAdjustmentsPage(SEASON, context(), { limit: 25, offset: 0 }, 'p1');
    expect(resolvePlayerNames).not.toHaveBeenCalled();
  });

  it('keeps the holdings of other players out of the history of an admin who plays, and shows them to one who does not', async () => {
    const ctx = context();
    ctx.def = { ...ctx.def, resources: [{ key: 'picks', visibility: 'own', holds: { kind: 'counter' }, label: { en: 'Picks', de: 'Picks' } }] } as never;
    const row = { id: 'a', kind: 'resource', target: { resource: 'picks', player_id: 'p2', item_id: 'garchomp' }, delta: { amount: 1 }, reason: 'r', admin_id: 'admin-9', created_at: 't', season_id: SEASON };
    vi.mocked(listFormatAdjustments).mockResolvedValue({ rows: [row], total: 1 } as never);
    vi.mocked(resolvePlayerNames).mockResolvedValue({ 'admin-9': 'The Admin' });

    const playing = await loadAdjustmentsPage(SEASON, ctx, { limit: 25, offset: 0 }, 'p1');
    expect(playing.history[0]).toMatchObject({ kind: 'resource', target: {}, delta: {}, reason: 'r' });
    expect(JSON.stringify(playing)).not.toContain('garchomp');

    const outside = await loadAdjustmentsPage(SEASON, ctx, { limit: 25, offset: 0 }, 'admin-9');
    expect(outside.history[0]).toMatchObject({ target: { resource: 'picks', player_id: 'p2', item_id: 'garchomp' }, delta: { amount: 1 } });
  });

  it('gives only the history, with nothing allowed, when the league does not run a kit format', async () => {
    vi.mocked(listFormatAdjustments).mockResolvedValue({ rows: [], total: 0 });
    await expect(loadAdjustmentsPage(SEASON, null, { limit: 25, offset: 0 }, 'admin-9')).resolves.toEqual({
      allowed: [],
      targets: { stages: [], players: [], resources: [], relations: [], actions: [] },
      history: [],
      total: 0,
    });
  });

  it('pages the checks with their rule labels, and without labels when no format runs', async () => {
    const row = { id: 'k', season_id: SEASON, source: 'standings_tie', rule_id: 'ties', dedupe_key: 'd', subject: { stage: 'main' }, status: 'open', note: null, opened_at: 't', resolved_at: null, resolved_by: null };
    vi.mocked(listFormatChecks).mockResolvedValue({ rows: [row], total: 3 } as never);
    const page = await loadChecksPage(SEASON, context(), 'open', { limit: 50, offset: 0 }, 'admin-1');
    expect(listFormatChecks).toHaveBeenCalledWith(SEASON, { status: 'open', limit: 50, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.checks[0]).toMatchObject({ id: 'k', state: 'open', rule_label: expect.objectContaining({ base: 'en' }), subject: { stage: 'main' } });
    expect((await loadChecksPage(SEASON, null, 'all', { limit: 50, offset: 0 }, 'admin-1')).checks[0].rule_label).toBeNull();
    expect(JSON.stringify(page)).not.toContain('"status"');
  });

  it('leaves the planned team of a team_audit check out unless the reader is a site admin', async () => {
    const row = {
      id: 'k',
      season_id: SEASON,
      source: 'team_audit',
      rule_id: 'team.audit',
      dedupe_key: 'd',
      subject: { player_id: 'p2', team_id: 'team-9', team_source: 'planned', reasons: ['rules'], issues: [{ code: 'kit_not_allowed', params: { species: 'Mewtwo' } }], off_team: [] },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    };
    vi.mocked(listFormatChecks).mockResolvedValue({ rows: [row], total: 1 } as never);
    const asLeagueAdmin = await loadChecksPage(SEASON, context(), 'open', { limit: 50, offset: 0 }, 'admin-1');
    expect(JSON.stringify(asLeagueAdmin)).not.toMatch(/Mewtwo|team-9/);
    expect(asLeagueAdmin.checks[0].subject).toMatchObject({ team_hidden: true });
    const asSiteAdmin = await loadChecksPage(SEASON, context(), 'open', { limit: 50, offset: 0 }, 'admin-1', true);
    expect(asSiteAdmin.checks[0].subject).toMatchObject({ team_id: 'team-9', issues: [{ params: { species: 'Mewtwo' } }] });
  });

  it('leaves the waiting giver of a hidden relation out for an admin who plays, and names it for one who does not', async () => {
    const row = {
      id: 'k',
      season_id: SEASON,
      source: 'deadline_missed',
      rule_id: 'deadline:swiss:0',
      dedupe_key: 'd',
      subject: { stage: 'swiss', applies: 'action', action: 'choose_gift', player_id: 'p2', reason: 'admin_review' },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    };
    vi.mocked(listFormatChecks).mockResolvedValue({ rows: [row], total: 1 } as never);
    const asPlayer = await loadChecksPage(SEASON, context(), 'open', { limit: 50, offset: 0 }, 'p1');
    expect(asPlayer.checks[0].subject).toMatchObject({ action: 'choose_gift', giver_masked: true });
    expect(JSON.stringify(asPlayer)).not.toContain('p2');
    const asOutsider = await loadChecksPage(SEASON, context(), 'open', { limit: 50, offset: 0 }, 'admin-1');
    expect(asOutsider.checks[0].subject).toMatchObject({ player_id: 'p2' });

    // Removed from every phase after the draw, the recipient admin still holds a link: the giver stays masked.
    const removed = { ...context(), phases: [{ id: 'phase-1', members: [] }] } as unknown as KitContext;
    const asRemoved = await loadChecksPage(SEASON, removed, 'open', { limit: 50, offset: 0 }, 'p1');
    expect(asRemoved.checks[0].subject).toMatchObject({ action: 'choose_gift', giver_masked: true });
    expect(JSON.stringify(asRemoved)).not.toContain('p2');
  });

  it('keeps the masks when the engine is not kit (no kit context), so switching the engine does not lift them', async () => {
    const kit = context();
    // The kit context is null for another engine; the mask context still reads the attached format.
    vi.mocked(loadMaskContext).mockResolvedValue({ def: kit.def, state: kit.state, phases: [{ members: PLAYERS }] });
    const check = {
      id: 'k',
      season_id: SEASON,
      source: 'deadline_missed',
      rule_id: 'deadline:swiss:0',
      dedupe_key: 'd',
      subject: { stage: 'swiss', applies: 'action', action: 'choose_gift', player_id: 'p2', reason: 'admin_review' },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    };
    vi.mocked(listFormatChecks).mockResolvedValue({ rows: [check], total: 1 } as never);
    const asPlayer = await loadChecksPage(SEASON, null, 'open', { limit: 50, offset: 0 }, 'p1');
    expect(asPlayer.checks[0].subject).toMatchObject({ action: 'choose_gift', giver_masked: true });
    expect(JSON.stringify(asPlayer)).not.toContain('p2');
    const asOutsider = await loadChecksPage(SEASON, null, 'open', { limit: 50, offset: 0 }, 'admin-1');
    expect(asOutsider.checks[0].subject).toMatchObject({ player_id: 'p2' });

    const def = { ...kit.def, resources: [{ key: 'picks', visibility: 'own', holds: { kind: 'counter' }, label: { en: 'Picks', de: 'Picks' } }] } as never;
    vi.mocked(loadMaskContext).mockResolvedValue({ def, state: kit.state, phases: [{ members: PLAYERS }] });
    const row = { id: 'a', kind: 'resource', target: { resource: 'picks', player_id: 'p2', item_id: 'garchomp' }, delta: { amount: 1 }, reason: 'r', admin_id: 'admin-9', created_at: 't', season_id: SEASON };
    vi.mocked(listFormatAdjustments).mockResolvedValue({ rows: [row], total: 1 } as never);
    vi.mocked(resolvePlayerNames).mockResolvedValue({ 'admin-9': 'The Admin' });
    const playing = await loadAdjustmentsPage(SEASON, null, { limit: 25, offset: 0 }, 'p1');
    expect(playing.history[0]).toMatchObject({ kind: 'resource', target: {}, delta: {} });
    expect(JSON.stringify(playing)).not.toContain('garchomp');
    const outside = await loadAdjustmentsPage(SEASON, null, { limit: 25, offset: 0 }, 'admin-9');
    expect(outside.history[0]).toMatchObject({ target: { player_id: 'p2', item_id: 'garchomp' } });
  });
});
