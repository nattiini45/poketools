import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StudioCastSession, PhaseCastSession } from '@/types/phase-cast-session';

const h = vi.hoisted(() => ({
  requireCreator: vi.fn(),
  legacy: vi.fn(),
  independent: vi.fn(),
  phase: vi.fn(),
  mode: vi.fn(),
  provider: vi.fn(),
  tools: vi.fn(),
  AuthError: class extends Error {
    constructor(public code: string) { super(code); }
  },
}));

vi.mock('@/lib/auth/helpers', () => ({ requireCreator: h.requireCreator, AuthError: h.AuthError }));
vi.mock('@/lib/auth/redirect-to-sign-in', () => ({
  redirectToSignIn: () => { throw new Error('sign-in'); },
}));
vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  getCastSessionById: h.legacy, getIndependentCastSession: h.independent,
}));
vi.mock('@/lib/supabase/queries/phase-cast-sessions', () => ({ getPhaseCastSessionById: h.phase }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: h.mode }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error('not found'); },
}));
vi.mock('@/components/creator/studio/CastStudioContext', () => ({
  CastStudioProvider: ({ session }: { session: StudioCastSession }) => { h.provider(session); return null; },
}));
vi.mock('@/components/creator/studio/tools/ToolsLayout', () => ({
  default: (props: unknown) => { h.tools(props); return null; },
}));
vi.mock('@/components/creator/studio/CastStudio', () => ({ default: () => null }));
vi.mock('@/components/creator/studio/solo/SoloLayout', () => ({ default: () => null }));

import Main from '../page';
import Solo from '../solo/page';
import Tools from '../tools/page';

const ID = '10000000-0000-4000-8000-000000000001';
const native = {
  id: ID, owner_id: 'fixture-caster', realtime_key: 'fixture-realtime-key',
  phase_id: 'fixture-phase', season_id: 'fixture-league', match_id: 'fixture-match',
  name: 'Fixture session', mode: 'cast', status: 'draft',
  player1_id: null, player1_name: null, player1_avatar_url: null,
  player2_id: null, player2_name: null, player2_avatar_url: null, player1_team: [], player2_team: [],
  tracker_state: null, overlay_config: {}, caster_notes: { match: 'Private fixture' },
  format: 'gen9ou', generation: 9, created_at: '2026-04-07T00:00:00Z', updated_at: '2026-04-07T00:00:00Z',
} satisfies PhaseCastSession;
const caster = { playerId: native.owner_id, isAdmin: false };
const props = { params: Promise.resolve({ sessionId: ID }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  h.requireCreator.mockResolvedValue(caster);
  h.mode.mockResolvedValue('phase');
  h.phase.mockResolvedValue(native);
});
afterEach(() => vi.unstubAllEnvs());

describe.each([['main', Main], ['tools', Tools], ['solo', Solo]] as const)('Studio %s page', (_name, Page) => {
  it('gates live creator access before any mode or session read', async () => {
    h.requireCreator.mockRejectedValueOnce(new h.AuthError('forbidden'));
    const denied = await Page(props);
    expect(denied.props).not.toHaveProperty('session');
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
    expect(h.phase).not.toHaveBeenCalled();
  });

  it('does not let a phase or resource admin read another caster’s private session', async () => {
    h.requireCreator.mockResolvedValue({ playerId: 'fixture-other', isAdmin: false, isResourceAdmin: true });
    await expect(Page(props)).rejects.toThrow('redirect:/creator/studio');
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.tools).not.toHaveBeenCalled();
  });

  it('keeps the private page owner-only for native sessions', async () => {
    h.requireCreator.mockResolvedValue({ playerId: 'fixture-site-admin', isAdmin: true });
    await expect(Page(props)).rejects.toThrow('redirect:/creator/studio');
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.tools).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'])('blocks %s before reading private data', async (mode) => {
    h.mode.mockResolvedValue(mode);
    await expect(Page(props)).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
    expect(h.phase).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('keeps the flag-off legacy reader and owner-only rule', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
    const { phase_id: _phase, ...common } = native;
    h.legacy.mockResolvedValue({ ...common, tournament_id: 'fixture-tournament' });
    const allowed = await Page(props);
    expect(allowed).toBeDefined();
    h.requireCreator.mockResolvedValue({ playerId: 'fixture-other', isAdmin: true });
    await expect(Page(props)).rejects.toThrow('redirect:/creator/studio');
    expect(h.legacy).toHaveBeenCalledTimes(2);
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.phase).not.toHaveBeenCalled();
  });
});

it('passes the complete typed native session only to the authorized studio and solo providers', async () => {
  renderToStaticMarkup(await Main(props));
  expect(h.provider).toHaveBeenLastCalledWith(native);
  const soloSession = { ...native, mode: 'solo' };
  h.phase.mockResolvedValue(soloSession);
  await expect(Main(props)).rejects.toThrow(`redirect:/creator/studio/${ID}/solo`);
  renderToStaticMarkup(await Solo(props));
  expect(h.provider).toHaveBeenLastCalledWith(soloSession);
  expect(native).not.toHaveProperty('tournament_id');
});

it('passes only the existing connection props to the tools page', async () => {
  renderToStaticMarkup(await Tools(props));
  expect(h.tools).toHaveBeenCalledExactlyOnceWith({
    sessionId: ID, realtimeKey: native.realtime_key, generation: native.generation,
  });
});

it('does not try the independent or legacy readers on native failure', async () => {
  h.phase.mockRejectedValue(new Error('fixture query failure'));
  await expect(Main(props)).rejects.toThrow('fixture query failure');
  expect(h.independent).not.toHaveBeenCalled();
  expect(h.legacy).not.toHaveBeenCalled();
});

it('returns not found when no native or active independent row exists', async () => {
  h.phase.mockResolvedValue(null);
  h.independent.mockResolvedValue(null);
  await expect(Main(props)).rejects.toThrow('not found');
  expect(h.independent).toHaveBeenCalledExactlyOnceWith(ID);
  expect(h.legacy).not.toHaveBeenCalled();
});
