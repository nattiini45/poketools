import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { AdminPoolSummary, DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSeasonWithDetails: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getListEntries: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSessionPlayer: vi.fn(),
  getDraftSnapshot: vi.fn(),
  getOwnRedraftSubmission: vi.fn(),
  listRedraftSubmissions: vi.fn(),
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
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
// The secret submission reads must never run during the page render.
vi.mock('@/lib/supabase/queries/drafts-redraft', () => ({
  getOwnRedraftSubmission: mocks.getOwnRedraftSubmission,
  listRedraftSubmissions: mocks.listRedraftSubmissions,
}));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
vi.mock('@/lib/draft/snapshot', () => ({ getDraftSnapshot: mocks.getDraftSnapshot }));
vi.mock('@/components/draft-redraft/RedraftCenter', () => ({ default: function RedraftCenterStub() { return null; } }));

import RedraftPage from '../page';
import RedraftCenter from '@/components/draft-redraft/RedraftCenter';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

// ─── Fixtures ───────────────────────────────────────────────────────

const INITIAL_ID = '11111111-1111-4111-8111-111111111111';
const OLD_REDRAFT_ID = '22222222-2222-4222-8222-222222222222';
const REDRAFT_ID = '33333333-3333-4333-8333-333333333333';

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
  return { id: INITIAL_ID, engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', ...overrides } as AdminPoolSummary;
}

const SNAPSHOT = {
  state_version: 3,
  server_now: '2026-10-11T10:00:00.000Z',
  pool: { id: REDRAFT_ID, season_id: 's1', kind: 'redraft' },
  participants: [
    { player_id: 'p1', name: 'Ash' },
    { player_id: 'p2', name: 'Misty' },
  ],
  redraft: { phase: 'submissions', deadline_at: '2026-10-12T21:59:00.000Z', published_at: null, drops: null, viewer_slots: [] },
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

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function render() {
  return RedraftPage({ params: Promise.resolve({ id: 's1' }) });
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
  mocks.getDraftPoolsBySeason.mockResolvedValue([
    pool(),
    pool({ id: OLD_REDRAFT_ID, kind: 'redraft', phase: 'cancelled', status: 'complete' }),
    pool({ id: REDRAFT_ID, kind: 'redraft', phase: 'submissions', status: 'pending' }),
  ]);
  mocks.getListEntries.mockResolvedValue([entry()]);
  mocks.isResourceAdminFor.mockResolvedValue(false);
  mocks.getDraftSnapshot.mockResolvedValue({ dto: SNAPSHOT, publishedNow: false, seasonId: 's1' });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('RedraftPage: client boundary', () => {
  it('passes narrow RedraftCenter props for the latest redraft pool, with no PII and no list prose', async () => {
    const centers = findByType(await render(), RedraftCenter);
    expect(centers).toHaveLength(1);
    const props = centers[0].props;
    expect(Object.keys(props).sort()).toEqual(['catalog', 'initialSnapshot', 'links', 'poolId', 'seasonId', 'viewer'].sort());
    expect(props.poolId).toBe(REDRAFT_ID);
    expect(props.seasonId).toBe('s1');
    expect(props.initialSnapshot).toBe(SNAPSHOT);
    expect(props.viewer).toEqual({ playerId: 'p1' });
    expect(props.links).toEqual({ room: `/leagues/s1/draft-room?pool=${REDRAFT_ID}` });
    const catalog = props.catalog as { lines: { lineId: string }[] };
    expect(catalog.lines.map((l) => l.lineId)).toEqual(['charmander--charizard']);

    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('SECRET');
    expectNoPrivatePlayerData(props);
  });

  it('seeds the snapshot without a tick (critique B9)', async () => {
    await render();
    expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(REDRAFT_ID, { playerId: 'p1', isPoolAdmin: false }, { tick: false });
  });

  it('never reads or server-renders submission data', async () => {
    const tree = await render();
    expect(mocks.getOwnRedraftSubmission).not.toHaveBeenCalled();
    expect(mocks.listRedraftSubmissions).not.toHaveBeenCalled();
    const [center] = findByType(tree, RedraftCenter);
    const serialized = JSON.stringify(center.props);
    expect(serialized).not.toMatch(/line_ids|own_lines|leftover_budget|updated_at/);
  });

  it('seeds null when the snapshot read fails (the client polls)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getDraftSnapshot.mockRejectedValue(new Error('rpc down'));
    const [center] = findByType(await render(), RedraftCenter);
    expect(center.props.initialSnapshot).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('a resource admin of the season reads the snapshot as pool admin', async () => {
    mocks.getSessionPlayer.mockResolvedValue({ playerId: 'p9', name: 'Oak', isAdmin: false, isResourceAdmin: true });
    mocks.isResourceAdminFor.mockResolvedValue(true);
    await render();
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(REDRAFT_ID, { playerId: 'p9', isPoolAdmin: true }, { tick: false });
  });
});

describe('RedraftPage: sign-in prompt (EN/DE)', () => {
  it('signed-out viewers get the sign-in prompt and the public view', async () => {
    mocks.getSessionPlayer.mockResolvedValue(null);
    const tree = await render();
    expect(textOf(tree)).toContain('Sign in to choose the lines you drop.');
    const [center] = findByType(tree, RedraftCenter);
    expect(center.props.viewer).toEqual({ playerId: null });
    expect(mocks.getDraftSnapshot).toHaveBeenCalledWith(REDRAFT_ID, null, { tick: false });

    mocks.locale.current = 'de';
    expect(textOf(await render())).toContain('Melde dich an, um deine Abgaben auszuwählen.');
  });

  it('signed-in viewers get no sign-in prompt', async () => {
    expect(textOf(await render())).not.toContain('Sign in to choose');
  });
});

describe('RedraftPage: page states', () => {
  it('renders the heading in English and German', async () => {
    expect(textOf(await render())).toContain('Evo Liga – Redraft');
    mocks.locale.current = 'de';
    expect(textOf(await render())).toContain('Evo Liga – Redraft');
  });

  it('non-EPB leagues get the EPB-only message and no draft reads', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ id: 's1', name: 'Cup', format_type: 'draft', point_buy_list_id: null });
    expect(textOf(await render())).toContain('only exists in Evolution Point Buy leagues');
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
    mocks.locale.current = 'de';
    expect(textOf(await render())).toContain('Den Redraft gibt es nur in Evolution-Point-Buy-Ligen.');
  });

  it('no redraft pool yet: a notice and no snapshot read', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([pool()]);
    const tree = await render();
    expect(textOf(tree)).toContain('There is no redraft for this league yet.');
    expect(findByType(tree, RedraftCenter)).toHaveLength(0);
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('a legacy-engine (pre-M2) pool is never opened, even a redraft one', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      pool({ engine: 'legacy', status: 'complete', phase: 'complete' }),
      pool({ id: REDRAFT_ID, engine: 'legacy', kind: 'redraft', phase: 'submissions', status: 'pending' }),
    ]);
    const tree = await render();
    expect(textOf(tree)).toContain('There is no redraft for this league yet.');
    expect(findByType(tree, RedraftCenter)).toHaveLength(0);
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('mixed season: the queue redraft after a legacy initial pool is opened', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      pool({ engine: 'legacy', status: 'complete', phase: 'complete' }),
      pool({ id: REDRAFT_ID, engine: 'queue', kind: 'redraft', phase: 'submissions', status: 'pending' }),
    ]);
    const [center] = findByType(await render(), RedraftCenter);
    expect(center.props.poolId).toBe(REDRAFT_ID);
  });

  it('no bound list: a notice and no snapshot read', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ id: 's1', name: 'Evo Liga', format_type: 'evolution_point_buy', point_buy_list_id: null });
    expect(textOf(await render())).toContain('no Point Buy list');
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('a missing league is a 404', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
