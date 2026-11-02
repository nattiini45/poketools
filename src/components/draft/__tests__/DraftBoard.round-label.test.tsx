/** @vitest-environment jsdom */
/**
 * The status bar of the legacy draft board: a running draft of a known length shows "Round r of N",
 * and a complete one shows its result instead of the counter that ran past the last round
 * ("Round 7 · Pick #13" on a finished 6-round draft of two players), in English and German.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DraftBoard from '../DraftBoard';
import type { DraftBoardState } from '../draft-board-sync';
import { withI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const POOL_ID = '00000000-0000-4000-a000-000000000010';
const PLAYERS = { a: 'Alice', b: 'Bob' };

function pick(n: number): DraftBoardState['picks'][number] {
  const playerId = n % 2 === 1 ? 'a' : 'b';
  return {
    id: `pick-${n}`,
    player_id: playerId,
    player_name: PLAYERS[playerId],
    pokemon_name: `Mon${n}`,
    line_id: null,
    pick_number: n,
    round: Math.ceil(n / 2),
    points_spent: null,
    timestamp: '2026-11-01T10:00:00Z',
  };
}

function state(overrides: Partial<DraftBoardState> & { pickCount: number; status: DraftBoardState['pool']['status'] }): DraftBoardState {
  const { pickCount, status, ...rest } = overrides;
  return {
    pool: {
      id: POOL_ID,
      season_id: '00000000-0000-4000-a000-000000000001',
      draft_type: 'snake',
      pick_order: 'snake',
      point_budget: null,
      status,
      created_at: '2026-11-01T09:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    },
    picks: Array.from({ length: pickCount }, (_, i) => pick(i + 1)),
    rosters: { a: [], b: [] },
    budgets: null,
    pick_order: ['a', 'b'],
    current_picker: status === 'in_progress' ? 'a' : null,
    turn_enforced: true,
    stalled_picker: null,
    next_pick_number: pickCount + 1,
    current_round: Math.ceil((pickCount + 1) / 2),
    total_rounds: 6,
    taken_pokemon: [],
    ...rest,
  };
}

function serve(body: DraftBoardState) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ success: true, data: body }) })),
  );
}

const mount = (locale: 'en' | 'de' = 'en') =>
  render(
    withI18n(
      <DraftBoard poolId={POOL_ID} currentPlayerId="a" isAdmin={false} playerNames={PLAYERS} />,
      { locale },
    ),
  );

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The pick table's animated sprites observe their viewport; jsdom has no IntersectionObserver.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DraftBoard progress label', () => {
  it('shows the round denominator while the draft runs', async () => {
    serve(state({ pickCount: 5, status: 'in_progress' }));
    mount();

    expect(await screen.findByText('Round 3 of 6 · Pick #6')).toBeTruthy();
  });

  it('shows the result, not "Round 7 · Pick #13", on a complete 6-round draft', async () => {
    serve(state({ pickCount: 12, status: 'complete' }));
    mount();

    expect(await screen.findByText('Draft complete · 6 rounds · 12 picks')).toBeTruthy();
    expect(screen.queryByText(/Round 7/)).toBeNull();
    expect(screen.queryByText(/Pick #13/)).toBeNull();
  });

  it('uses the singular for a one-round draft', async () => {
    serve(state({ pickCount: 2, status: 'complete', total_rounds: 1 }));
    mount();

    expect(await screen.findByText('Draft complete · 1 round · 2 picks')).toBeTruthy();
  });

  it('shows what was picked when a draft was ended early', async () => {
    serve(state({ pickCount: 7, status: 'complete' }));
    mount();

    expect(await screen.findByText('Draft complete · 6 rounds · 7 picks')).toBeTruthy();
  });

  it('falls back to the pick count when an older server sends no round total', async () => {
    serve(state({ pickCount: 12, status: 'complete', total_rounds: undefined }));
    mount();

    expect(await screen.findByText('Draft complete · 12 picks')).toBeTruthy();
  });

  it('keeps the plain round counter for a running draft from an older server', async () => {
    serve(state({ pickCount: 5, status: 'in_progress', total_rounds: undefined }));
    mount();

    expect(await screen.findByText('Round 3 · Pick #6')).toBeTruthy();
  });

  it('is translated to German', async () => {
    serve(state({ pickCount: 12, status: 'complete' }));
    mount('de');

    expect(await screen.findByText('Draft abgeschlossen · 6 Runden · 12 Picks')).toBeTruthy();
  });

  it('shows the German round denominator while the draft runs', async () => {
    serve(state({ pickCount: 5, status: 'in_progress' }));
    mount('de');

    expect(await screen.findByText('Runde 3 von 6 · Pick Nr. 6')).toBeTruthy();
  });
});
