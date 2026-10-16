import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { AdminPoolSummary, DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSeasonWithDetails: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getListEntries: vi.fn(),
  getFormatRules: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSessionPlayer: vi.fn(),
  getDraftSnapshot: vi.fn(),
  locale: { current: 'en' as 'en' | 'de' },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({ default: function LinkStub() { return null; } }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale.current,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale.current),
  };
});
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonWithDetails: mocks.getSeasonWithDetails }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolsBySeason: mocks.getDraftPoolsBySeason }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
vi.mock('@/lib/draft/snapshot', () => ({ getDraftSnapshot: mocks.getDraftSnapshot }));
vi.mock('@/lib/worlds/registry', () => ({
  resolveViewerWorld: vi.fn(() => 'default'),
  WORLD_OVERRIDE_URL_PARAM: 'world',
}));
// World components are only stubbed here; this seat never edits them.
vi.mock('@/components/world/WorldShell', () => ({ default: function WorldShellStub() { return null; } }));
vi.mock('@/components/world/route/WorldOverrideRedirect', () => ({
  default: function WorldOverrideRedirectStub() { return null; },
}));
vi.mock('../client', () => ({ default: function DraftRoomClientStub() { return null; } }));
vi.mock('@/components/draft-redraft/RedraftPhaseNotice', () => ({
  default: function RedraftPhaseNoticeStub() { return null; },
}));

import Link from 'next/link';
import { notFound } from 'next/navigation';
import DraftRoomPage from '../page';
import DraftRoomClient from '../client';
import RedraftPhaseNotice from '@/components/draft-redraft/RedraftPhaseNotice';
import { INDEX_SCHEMA_VERSION } from '@/lib/draft-finder/index-types';
import { hashCatalog } from '@/lib/draft-finder/line-catalog';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

// ─── Fixtures ───────────────────────────────────────────────────────

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const REDRAFT_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_ID = '33333333-3333-4333-8333-333333333333';

function entry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  return {
    id: 'e1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price: 30,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'mid' as PointBuyListEntry['price_group'],
    early_rating: 5,
    mid_rating: 5,
    late_rating: 5,
    rationale: 'SECRET rationale prose',
    historical_data: 'SECRET history',
    special_rules: null,
    special_rules_text: null,
    sources: 'SECRET sources',
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  } as PointBuyListEntry;
}

function pool(overrides: Partial<AdminPoolSummary> = {}): AdminPoolSummary {
  return { id: POOL_ID, engine: 'queue', kind: 'initial', phase: 'drafting', mode: 'live', status: 'in_progress', ...overrides } as AdminPoolSummary;
}

/** A DTO as the backend's allowlist mapper builds it: participants are { id, name, … } only. */
const SNAPSHOT = {
  state_version: 7,
  server_now: '2026-10-11T10:00:00.000Z',
  pool: { id: POOL_ID, season_id: 's1' },
  participants: [
    { player_id: 'p1', name: 'Ash' },
    { player_id: 'p2', name: 'Misty' },
  ],
} as unknown as DraftSnapshotDTO;

function findByType(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

/** Every string in an element tree (component elements are not invoked). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function render(query: Record<string, string> = {}) {
  return DraftRoomPage({ params: Promise.resolve({ id: 's1' }), searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale.current = 'en';
  mocks.getSessionPlayer.mockResolvedValue({ playerId: 'p1', name: 'Ash', isAdmin: false, isResourceAdmin: false });
  mocks.getSeasonWithDetails.mockResolvedValue({
    id: 's1',
    name: 'Evo Liga',
    format_type: 'evolution_point_buy',
    point_buy_list_id: 'list-1',
    participant_count: 2,
  });
  mocks.getDraftPoolsBySeason.mockResolvedValue([pool()]);
  mocks.getListEntries.mockResolvedValue([entry()]);
  mocks.getFormatRules.mockResolvedValue({ banned_moves: ['Swords Dance'] });
  mocks.isResourceAdminFor.mockResolvedValue(false);
  mocks.getDraftSnapshot.mockResolvedValue({ dto: SNAPSHOT, publishedNow: false, seasonId: 's1' });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('DraftRoomPage: client boundary', () => {
  it('passes the narrow DraftToolClient props, no PII and no list prose', async () => {
    const clients = findByType(await render(), DraftRoomClient);
    expect(clients).toHaveLength(1);
    const props = clients[0].props;

    expect(Object.keys(props).sort()).toEqual(
      ['catalog', 'indexUrl', 'initialSnapshot', 'leagueName', 'links', 'poolId', 'seasonId', 'viewer'].sort(),
    );
    expect(props.poolId).toBe(POOL_ID);
    expect(props.seasonId).toBe('s1');
    expect(props.initialSnapshot).toBe(SNAPSHOT);
    expect(props.viewer).toEqual({ playerId: 'p1', isSiteAdmin: false });
    expect(props.links).toEqual({
      redraft: '/leagues/s1/redraft',
      tokens: '/leagues/s1/tokens',
      admin: null,
      trainerCreator: '/draft-room/trainer-creator',
    });
    expect(props.indexUrl).toBe(
      `/api/point-buy-lists/list-1/search-index?v=${INDEX_SCHEMA_VERSION}&h=${hashCatalog([entry()])}`,
    );
    const catalog = props.catalog as { lines: { lineId: string }[]; bannedMoves: string[] };
    expect(catalog.lines.map((l) => l.lineId)).toEqual(['charmander--charizard']);
    expect(catalog.bannedMoves).toEqual(['swordsdance']);

    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('SECRET');
    expectNoPrivatePlayerData(props);
  });

  it('every link points at a real app route (DF6 handoff 4)', async () => {
    mocks.getSessionPlayer.mockResolvedValue({ playerId: 'p0', name: 'Admin', isAdmin: true, isResourceAdmin: false });
    const [client] = findByType(await render(), DraftRoomClient);
    const links = client.props.links as Record<string, string | null>;
    expect(links.tokens).toBe('/leagues/s1/tokens');
    const appDir = join(process.cwd(), 'src', 'app');
    const routeFile: Record<string, string> = {
      '/leagues/s1/redraft': join(appDir, '(public)', 'leagues', '[id]', 'redraft', 'page.tsx'),
      '/leagues/s1/tokens': join(appDir, '(public)', 'leagues', '[id]', 'tokens', 'page.tsx'),
      '/admin/leagues/s1/draft': join(appDir, 'admin', 'leagues', '[id]', 'draft', 'page.tsx'),
      '/draft-room/trainer-creator': join(appDir, '(public)', 'draft-room', 'trainer-creator', 'page.tsx'),
    };
    for (const href of Object.values(links)) {
      expect(href).not.toBeNull();
      expect(routeFile[href as string], `no route mapped for ${href}`).toBeDefined();
      expect(existsSync(routeFile[href as string]), `missing route file for ${href}`).toBe(true);
    }
  });

  it('seeds the snapshot without a tick, for the signed-in viewer', async () => {
    await render();
    expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(POOL_ID, { playerId: 'p1', isPoolAdmin: false }, { tick: false });
  });

  it('seeds anonymous spectators with a null viewer and no admin link', async () => {
    mocks.getSessionPlayer.mockResolvedValue(null);
    const [client] = findByType(await render(), DraftRoomClient);
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(POOL_ID, null, { tick: false });
    expect(client.props.viewer).toEqual({ playerId: null, isSiteAdmin: false });
    expect((client.props.links as { admin: string | null }).admin).toBeNull();
  });

  it('treats a resource admin of the season as pool admin (admin link, snapshot viewer)', async () => {
    mocks.getSessionPlayer.mockResolvedValue({ playerId: 'p9', name: 'Oak', isAdmin: false, isResourceAdmin: true });
    mocks.isResourceAdminFor.mockResolvedValue(true);
    const [client] = findByType(await render(), DraftRoomClient);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('p9', 'season', 's1');
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(POOL_ID, { playerId: 'p9', isPoolAdmin: true }, { tick: false });
    expect((client.props.links as { admin: string | null }).admin).toBe('/admin/leagues/s1/draft');
    expect(client.props.viewer).toEqual({ playerId: 'p9', isSiteAdmin: false });
  });

  it('seeds null when the snapshot read fails (the client polls)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getDraftSnapshot.mockRejectedValue(new Error('rpc down'));
    const [client] = findByType(await render(), DraftRoomClient);
    expect(client.props.initialSnapshot).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('falls back to the default ban list when the season has no format rules', async () => {
    mocks.getFormatRules.mockResolvedValue(null);
    const [client] = findByType(await render(), DraftRoomClient);
    expect((client.props.catalog as { bannedMoves: string[] }).bannedMoves.length).toBeGreaterThan(0);
  });
});

describe('DraftRoomPage: pool selection', () => {
  it('a valid ?pool= of this season wins', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      pool(),
      pool({ id: REDRAFT_ID, kind: 'redraft', status: 'complete', phase: 'complete' }),
    ]);
    const [client] = findByType(await render({ pool: REDRAFT_ID }), DraftRoomClient);
    expect(client.props.poolId).toBe(REDRAFT_ID);
  });

  it('shows the redraft notice above the room while drops are collected', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      pool({ status: 'complete', phase: 'complete' }),
      pool({ id: REDRAFT_ID, kind: 'redraft', status: 'pending', phase: 'submissions' }),
    ]);
    mocks.getDraftSnapshot.mockResolvedValue({
      dto: { ...SNAPSHOT, redraft: { phase: 'locked', deadline_at: '2026-10-12T18:00:00.000Z' } },
      publishedNow: false,
      seasonId: 's1',
    });
    const tree = await render();
    const [client] = findByType(tree, DraftRoomClient);
    expect(client.props.poolId).toBe(REDRAFT_ID);
    const notices = findByType(tree, RedraftPhaseNotice);
    expect(notices).toHaveLength(1);
    expect(notices[0].props).toEqual({
      phase: 'locked',
      deadlineAt: '2026-10-12T18:00:00.000Z',
      links: { redraft: '/leagues/s1/redraft' },
    });
  });

  it('the redraft notice falls back to "submissions" without a seeded snapshot', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      pool({ id: REDRAFT_ID, kind: 'redraft', status: 'pending', phase: 'submissions' }),
    ]);
    mocks.getDraftSnapshot.mockRejectedValue(new Error('rpc down'));
    const [notice] = findByType(await render(), RedraftPhaseNotice);
    expect(notice.props).toEqual({ phase: 'submissions', deadlineAt: null, links: { redraft: '/leagues/s1/redraft' } });
    error.mockRestore();
  });

  it('no redraft notice outside the submission phase', async () => {
    expect(findByType(await render(), RedraftPhaseNotice)).toHaveLength(0);
  });
});

describe('DraftRoomPage: legacy-engine pools (pre-M2)', () => {
  const legacy = () => pool({ id: LEGACY_ID, engine: 'legacy', status: 'complete', phase: 'complete' });
  const hrefs = (tree: ReactNode) => findByType(tree, Link).map((l) => l.props.href);

  it('legacy-only season: a bilingual note + link to the legacy board, no snapshot, no redirect', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([legacy()]);
    const tree = await render();
    expect(textOf(tree)).toContain('ran on the earlier draft board');
    expect(hrefs(tree)).toEqual(['/leagues/s1/draft?board=legacy']);
    expect(findByType(tree, DraftRoomClient)).toHaveLength(0);
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
    expect(mocks.getListEntries).not.toHaveBeenCalled();
    // The page module mocks only notFound: a redirect() call would throw "not a function".
    expect(notFound).not.toHaveBeenCalled();

    mocks.locale.current = 'de';
    const de = textOf(await render());
    expect(de).toContain('Der Draft dieser Liga lief noch über das alte Draft-Board.');
    expect(de).toContain('Zum Draft-Board');
  });

  it('a ?pool= naming a legacy pool is ignored', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([legacy()]);
    const tree = await render({ pool: LEGACY_ID });
    expect(findByType(tree, DraftRoomClient)).toHaveLength(0);
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();

    mocks.getDraftPoolsBySeason.mockResolvedValue([
      legacy(),
      pool({ id: REDRAFT_ID, kind: 'redraft', status: 'in_progress', phase: 'drafting' }),
    ]);
    const [client] = findByType(await render({ pool: LEGACY_ID }), DraftRoomClient);
    expect(client.props.poolId).toBe(REDRAFT_ID);
    expect(mocks.getDraftSnapshot).toHaveBeenLastCalledWith(REDRAFT_ID, expect.anything(), { tick: false });
  });

  it('mixed season: the room handles the queue redraft and links the legacy initial draft', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      legacy(),
      pool({ id: REDRAFT_ID, kind: 'redraft', status: 'in_progress', phase: 'drafting' }),
    ]);
    const tree = await render();
    const [client] = findByType(tree, DraftRoomClient);
    expect(client.props.poolId).toBe(REDRAFT_ID);
    expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(hrefs(tree)).toContain('/leagues/s1/draft?board=legacy');
    expect(textOf(tree)).toContain('The Initial draft ran on the earlier draft board.');
    expect(textOf(tree)).toContain('View the Initial draft');
  });

  it('queue-only season: no legacy link', async () => {
    const tree = await render();
    expect(hrefs(tree)).not.toContain('/leagues/s1/draft?board=legacy');
    expect(textOf(tree)).not.toContain('earlier draft board');
  });
});

describe('DraftRoomPage: page states (EN/DE)', () => {
  it('renders the heading in English and German', async () => {
    expect(textOf(await render())).toContain('Evo Liga – Draft room');
    mocks.locale.current = 'de';
    const de = textOf(await render());
    expect(de).toContain('Evo Liga – Draft-Raum');
    expect(de).toContain('2 Teilnehmer');
  });

  it('non-EPB leagues get the EPB-only message and no draft reads', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ id: 's1', name: 'Cup', format_type: 'draft', point_buy_list_id: null });
    expect(textOf(await render())).toContain('only available for Evolution Point Buy leagues');
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
    mocks.locale.current = 'de';
    expect(textOf(await render())).toContain('Den Draft-Raum gibt es nur für Evolution-Point-Buy-Ligen.');
  });

  it('no pool: the admin hint when a list is bound, else "not set up"', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([]);
    expect(textOf(await render())).toContain('hasn’t been created yet');
    mocks.getSeasonWithDetails.mockResolvedValue({
      id: 's1', name: 'Evo Liga', format_type: 'evolution_point_buy', point_buy_list_id: null, participant_count: 0,
    });
    expect(textOf(await render())).toContain('has not been set up yet');
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('a pool without a bound list explains the missing list', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({
      id: 's1', name: 'Evo Liga', format_type: 'evolution_point_buy', point_buy_list_id: null, participant_count: 2,
    });
    expect(textOf(await render())).toContain('no point-buy list bound yet');
    expect(mocks.getListEntries).not.toHaveBeenCalled();
  });

  it('a missing league is a 404', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
