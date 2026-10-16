import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSeasonWithDetails: vi.fn(),
  getSeasonParticipants: vi.fn(),
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  pointBuyListToDraftPool: vi.fn(),
  getAllTiers: vi.fn(),
  getTierList: vi.fn(),
  getSeasonTrackers: vi.fn(),
  getTierLimits: vi.fn(),
  getPoolEntries: vi.fn(),
  getListEntries: vi.fn(),
  getSessionPlayer: vi.fn(),
  locale: { current: 'en' as 'en' | 'de' },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale.current,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale.current),
  };
});
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: mocks.getSeasonWithDetails,
  getSeasonParticipants: mocks.getSeasonParticipants,
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: mocks.getDraftPoolBySeason,
  getDraftPoolsBySeason: mocks.getDraftPoolsBySeason,
}));
vi.mock('@/lib/draft/point-buy-pool', () => ({ pointBuyListToDraftPool: mocks.pointBuyListToDraftPool }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getAllTiers: mocks.getAllTiers,
  getTierList: mocks.getTierList,
  getSeasonTrackers: mocks.getSeasonTrackers,
}));
vi.mock('@/lib/supabase/queries/draft-tier-limits', () => ({ getTierLimits: mocks.getTierLimits }));
vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({ getPoolEntries: mocks.getPoolEntries }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
vi.mock('@/components/draft/DraftBoard', () => ({ default: function DraftBoardStub() { return null; } }));
vi.mock('@/components/draft/TierListDisplay', () => ({ default: function TierListDisplayStub() { return null; } }));

import { redirect } from 'next/navigation';
import DraftPage from '../page';
import DraftBoard from '@/components/draft/DraftBoard';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

// ─── Helpers ────────────────────────────────────────────────────────

const PII_KEYS = [
  'discord_id',
  'auth_user_id',
  'ban_reason',
  'suspended_until',
  'is_admin',
  'is_creator',
  'is_guest',
  'is_test_account',
  'avatar_config',
];

function participantRow(id: string, name: string) {
  return {
    id,
    name,
    discord_id: `discord-${id}`,
    auth_user_id: `auth-${id}`,
    ps_username: `ps-${id}`,
    champions_username: null,
    is_admin: true,
    is_creator: true,
    is_guest: false,
    is_test_account: true,
    joined_date: '2026-01-01',
    avatar_url: null,
    avatar_config: null,
    status: 'suspended',
    suspended_until: '2027-01-01',
    ban_reason: 'secret moderation note',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    gym_type: null,
    core_types: null,
    core_assigned_at: null,
  };
}

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

/** Every object key anywhere in a props value. */
function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      keys.add(key);
      collectKeys(v, keys);
    }
  }
  return keys;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale.current = 'en';
  mocks.getSessionPlayer.mockResolvedValue({ playerId: 'p1', name: 'Ash', isAdmin: false });
  mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-1', season_id: 's1', status: 'in_progress' });
  mocks.getSeasonParticipants.mockResolvedValue([participantRow('p1', 'Ash'), participantRow('p2', 'Misty')]);
  mocks.getTierList.mockResolvedValue([]);
  mocks.getTierLimits.mockResolvedValue([]);
  mocks.getPoolEntries.mockResolvedValue([]);
  mocks.getAllTiers.mockResolvedValue([]);
  mocks.getSeasonTrackers.mockResolvedValue([]);
  mocks.getListEntries.mockResolvedValue([]);
  mocks.getDraftPoolsBySeason.mockResolvedValue([]);
  mocks.pointBuyListToDraftPool.mockReturnValue([]);
});

// ─── Tests ──────────────────────────────────────────────────────────

function season(format: string) {
  return {
    id: 's1',
    name: 'Evo Liga',
    format_type: format,
    point_buy_list_id: null,
    participant_count: 2,
    ruleset_name: null,
  };
}

/** Every string rendered anywhere in an element tree (server elements are not invoked). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

describe('DraftPage: client boundary', () => {
  it('passes DraftBoard player names only, no PII (draft)', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('draft'));

    const tree = await DraftPage({ params: Promise.resolve({ id: 's1' }) });
    const boards = findByType(tree, DraftBoard);

    expect(boards).toHaveLength(1);
    const props = boards[0].props;
    expect(props.playerNames).toEqual({ p1: 'Ash', p2: 'Misty' });
    expect(props.isEpb).toBe(false);

    const keys = collectKeys(props);
    for (const key of PII_KEYS) expect(keys.has(key)).toBe(false);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('discord-p1');
    expect(serialized).not.toContain('auth-p2');
    expect(serialized).not.toContain('secret moderation note');
    expect(serialized).not.toContain('"suspended"');
    expectNoPrivatePlayerData(props);
  });
});

const LEGACY_POOL = { id: 'pool-legacy', engine: 'legacy', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' };
const QUEUE_REDRAFT = { id: 'pool-queue', engine: 'queue', kind: 'redraft', phase: 'submissions', mode: 'slow', status: 'pending' };

describe('DraftPage: EPB redirect (draft-frontend §8.1)', () => {
  it('redirects an EPB league without any pool to the draft room before any board read', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('evolution_point_buy'));

    await expect(DraftPage({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/leagues/s1/draft-room',
    );
    expect(redirect).toHaveBeenCalledWith('/leagues/s1/draft-room');
    expect(mocks.getDraftPoolBySeason).not.toHaveBeenCalled();
    expect(mocks.getSeasonParticipants).not.toHaveBeenCalled();
  });

  it('redirects an EPB season whose only pool is an unstarted legacy placeholder to the draft room', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('evolution_point_buy'));
    mocks.getDraftPoolsBySeason.mockResolvedValue([{ ...LEGACY_POOL, status: 'pending', phase: 'setup' }]);

    await expect(DraftPage({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/leagues/s1/draft-room',
    );
    expect(mocks.getSeasonParticipants).not.toHaveBeenCalled();
  });

  it('redirects a queue-only EPB season to the draft room', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('evolution_point_buy'));
    mocks.getDraftPoolsBySeason.mockResolvedValue([{ ...QUEUE_REDRAFT, kind: 'initial', phase: 'drafting' }]);

    await expect(DraftPage({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/leagues/s1/draft-room',
    );
    expect(mocks.getSeasonParticipants).not.toHaveBeenCalled();
  });

  it('redirects a mixed season (legacy initial + queue redraft) to the draft room', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('evolution_point_buy'));
    mocks.getDraftPoolsBySeason.mockResolvedValue([LEGACY_POOL, QUEUE_REDRAFT]);

    await expect(DraftPage({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/leagues/s1/draft-room',
    );
  });

  it('renders the legacy EPB board for a legacy-only season and never redirects', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ ...season('evolution_point_buy'), point_buy_list_id: 'lv-1' });
    mocks.getDraftPoolsBySeason.mockResolvedValue([LEGACY_POOL]);
    mocks.getListEntries.mockResolvedValue([{ id: 'e1' }]);
    mocks.getSeasonTrackers.mockResolvedValue([{ id: 't1' }]);
    const epbEntries = [{ id: 'pe-1', pokemon_name: 'line-a' }];
    mocks.pointBuyListToDraftPool.mockReturnValue(epbEntries);

    const tree = await DraftPage({ params: Promise.resolve({ id: 's1' }) });

    expect(redirect).not.toHaveBeenCalled();
    const boards = findByType(tree, DraftBoard);
    expect(boards).toHaveLength(1);
    const props = boards[0].props;
    expect(props.poolId).toBe('pool-legacy');
    expect(mocks.getDraftPoolBySeason).not.toHaveBeenCalled();
    expect(props.isEpb).toBe(true);
    expect(props.poolEntries).toBe(epbEntries);
    expect(props.evoTiers).toBeUndefined();
    expect(props.tierLimits).toBeUndefined();
    expect(mocks.getListEntries).toHaveBeenCalledWith('lv-1');
    expect(mocks.pointBuyListToDraftPool).toHaveBeenCalledWith([{ id: 'e1' }], 's1', [{ id: 't1' }]);
    expectNoPrivatePlayerData(props);
  });

  it('mixed season: ?board=legacy (the draft room link) shows the legacy initial board instead', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ ...season('evolution_point_buy'), point_buy_list_id: 'lv-1' });
    mocks.getDraftPoolsBySeason.mockResolvedValue([LEGACY_POOL, QUEUE_REDRAFT]);

    const tree = await DraftPage({
      params: Promise.resolve({ id: 's1' }),
      searchParams: Promise.resolve({ board: 'legacy' }),
    });

    expect(redirect).not.toHaveBeenCalled();
    const [board] = findByType(tree, DraftBoard);
    expect(board.props.poolId).toBe('pool-legacy');
    expect(board.props.isEpb).toBe(true);
  });

  it('?board=legacy without a legacy pool still goes to the draft room (it never redirects back)', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('evolution_point_buy'));
    mocks.getDraftPoolsBySeason.mockResolvedValue([QUEUE_REDRAFT]);
    await expect(
      DraftPage({ params: Promise.resolve({ id: 's1' }), searchParams: Promise.resolve({ board: 'legacy' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/leagues/s1/draft-room');
  });

  it('does not read pools for a standard draft league', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('draft'));
    await DraftPage({ params: Promise.resolve({ id: 's1' }) });
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
    expect(mocks.pointBuyListToDraftPool).not.toHaveBeenCalled();
  });
});

describe('DraftPage: translated strings', () => {
  it('renders the heading and the not-a-draft message in English and German', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season('draft'));
    const en = textOf(await DraftPage({ params: Promise.resolve({ id: 's1' }) }));
    expect(en).toContain('Evo Liga – Draft room');
    expect(en).toContain('2 participants');

    mocks.locale.current = 'de';
    const de = textOf(await DraftPage({ params: Promise.resolve({ id: 's1' }) }));
    expect(de).toContain('Evo Liga – Draft-Raum');
    expect(de).toContain('2 Teilnehmer');

    mocks.getSeasonWithDetails.mockResolvedValue(season('round_robin'));
    const notDraft = textOf(await DraftPage({ params: Promise.resolve({ id: 's1' }) }));
    expect(notDraft).toContain('Diese Liga hat kein Draft-Format.');
  });

  it('shows the sign-in prompt to signed-out viewers', async () => {
    mocks.getSessionPlayer.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season('draft'));
    const text = textOf(await DraftPage({ params: Promise.resolve({ id: 's1' }) }));
    expect(text).toContain('Sign in to take part in the draft.');
  });
});
