/**
 * RoundManager's overdue badge follows the shared minute clock: it renders from
 * the request time on the server and during hydration, then from the wall clock,
 * so a deadline that passes while the page stays open is flagged without a
 * reload. `useSyncExternalStore` is stubbed to pick the server or the client
 * snapshot (vitest 'node' env, no DOM).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

const mode = vi.hoisted(() => ({ server: true }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      _subscribe: (cb: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T => (mode.server && getServerSnapshot ? getServerSnapshot() : getSnapshot()),
  };
});

import RoundManager from '../RoundManager';

/** The provider's request time: 2026-10-09 12:00 UTC. */
const REQUEST_TIME = Date.UTC(2026, 9, 9, 12);
/** The wall clock once the page is open: half an hour later than the request. */
const WALL_CLOCK = Date.UTC(2026, 9, 9, 12, 30);
/** Between the two: still ahead of the request, already behind the wall clock. */
const DEADLINE = '2026-10-09T12:15:00.000Z';

const tournament = {
  id: 't-1',
  bracket_type: 'round_robin',
  status: 'active',
  best_of_default: 3,
  bracket_reset_enabled: true,
} as unknown as Tournament;

const round: Round = {
  id: 'r-1',
  tournament_id: 't-1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'active',
  pairings_generated: true,
  deadline: DEADLINE,
  bracket_side: null,
  bye_player_ids: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function render(): string {
  return renderWithI18n(<RoundManager tournament={tournament} initialRounds={[round]} />, {
    requestTime: REQUEST_TIME,
  });
}

describe('RoundManager overdue badge clock', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(WALL_CLOCK);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('renders from the request time on the server and during hydration', () => {
    mode.server = true;
    expect(render()).not.toContain('Overdue');
  });

  it('flags a deadline the wall clock has passed once the page runs on the client', () => {
    mode.server = false;
    expect(render()).toContain('Overdue');
  });
});
