/**
 * RoundManager's per-round best-of select: named by its round, with a status line for the save.
 * Rendered through react-dom/server (vitest 'node' env, no DOM, so effects do not run).
 */
import { describe, expect, it } from 'vitest';
import RoundManager from '../RoundManager';
import { renderWithI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

function roundN(n: number, status: Round['status']): Round {
  return {
    id: `r-${n}`,
    tournament_id: 't-1',
    name: `Round ${n}`,
    round_number: n,
    best_of: 3,
    status,
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const tournament = {
  id: 't-1',
  name: 'Weekly',
  bracket_type: 'swiss',
  best_of_default: 3,
  status: 'active',
} as unknown as Tournament;

function render(rounds: Round[], locale: 'en' | 'de' = 'en') {
  return renderWithI18n(<RoundManager tournament={tournament} initialRounds={rounds} />, { locale });
}

describe('RoundManager per-round best-of', () => {
  it('names the select of a pending round by its round, and announces a save', () => {
    const html = render([roundN(1, 'pending')]);
    const select = html.match(/<select[^>]*>/)?.[0] ?? '';

    expect(select).toContain('aria-label="Best of for Round 1"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('names it in German', () => {
    expect(render([roundN(1, 'pending')], 'de')).toMatch(/<select[^>]*aria-label="Best-of für Runde 1"/);
  });

  it('offers no select once the round has started', () => {
    expect(render([roundN(1, 'active')])).not.toContain('Best of for');
  });
});
