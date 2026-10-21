import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSeasonWithDetails: vi.fn(),
  getListEntries: vi.fn(),
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
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
// The page must never read a snapshot (no tick during a render, critique B9).
vi.mock('@/lib/draft/snapshot', () => ({ getDraftSnapshot: mocks.getDraftSnapshot }));
vi.mock('@/components/draft-tokens/TokenCenter', () => ({ default: function TokenCenterStub() { return null; } }));

import TokensPage from '../page';
import TokenCenter from '@/components/draft-tokens/TokenCenter';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

// ─── Fixtures ───────────────────────────────────────────────────────

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
  return TokensPage({ params: Promise.resolve({ id: 's1' }) });
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
  mocks.getListEntries.mockResolvedValue([entry()]);
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('TokensPage: client boundary', () => {
  it('passes narrow TokenCenter props: the season id and the catalog, no PII, no list prose', async () => {
    const centers = findByType(await render(), TokenCenter);
    expect(centers).toHaveLength(1);
    const props = centers[0].props;
    expect(Object.keys(props).sort()).toEqual(['catalog', 'seasonId']);
    expect(props.seasonId).toBe('s1');
    const catalog = props.catalog as { lines: { lineId: string }[] };
    expect(catalog.lines.map((l) => l.lineId)).toEqual(['charmander--charizard']);

    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('SECRET');
    expectNoPrivatePlayerData(props);
  });

  it('never server-renders token data and never reads a snapshot', async () => {
    const tree = await render();
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
    const [center] = findByType(tree, TokenCenter);
    expect(JSON.stringify(center.props)).not.toMatch(/draft_kill|comeback|unspent|player_id/);
  });

  it('renders the title with the league name', async () => {
    expect(textOf(await render())).toContain('Evo Liga – Tokens');
  });
});

describe('TokensPage: sign-in prompt (EN/DE)', () => {
  it('signed-out viewers get the sign-in prompt and no TokenCenter', async () => {
    mocks.getSessionPlayer.mockResolvedValue(null);
    const tree = await render();
    expect(findByType(tree, TokenCenter)).toHaveLength(0);
    expect(textOf(tree)).toContain('Sign in to see and use your tokens.');
    expect(mocks.getListEntries).not.toHaveBeenCalled();
  });

  it('German sign-in prompt', async () => {
    mocks.locale.current = 'de';
    mocks.getSessionPlayer.mockResolvedValue(null);
    expect(textOf(await render())).toContain('Melde dich an, um deine Tokens zu sehen und einzusetzen.');
  });
});

describe('TokensPage: empty states', () => {
  it('404s for an unknown league', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('non-EPB leagues get the EPB-only message', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ id: 's1', name: 'Classic', format_type: 'standard', point_buy_list_id: null });
    const tree = await render();
    expect(findByType(tree, TokenCenter)).toHaveLength(0);
    expect(textOf(tree)).toContain('Tokens exist only in Evolution Point Buy leagues.');
  });

  it('a league without a bound list says so', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({
      id: 's1',
      name: 'Evo Liga',
      format_type: 'evolution_point_buy',
      point_buy_list_id: null,
    });
    const tree = await render();
    expect(findByType(tree, TokenCenter)).toHaveLength(0);
    expect(textOf(tree)).toContain('This league has no point-buy list yet');
  });
});
