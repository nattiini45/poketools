/**
 * RoundManager's bye line: "Bye: <name>" on a round that gave a bye,
 * names from the tournament's participants. Rendered through react-dom/server
 * (vitest 'node' env, no DOM, so effects do not run); the participant request
 * runs against a fake fetch.
 */
import { describe, expect, it, vi } from 'vitest';
import RoundManager, { fetchParticipantNames, RoundByeNotice } from '../RoundManager';
import { renderWithI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'r-1',
    tournament_id: 't-1',
    name: 'Round 1',
    round_number: 1,
    best_of: 3,
    status: 'active',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe('fetchParticipantNames', () => {
  it('maps participant ids to names from the public participants endpoint', async () => {
    const fetchImpl = jsonFetch({
      success: true,
      data: [
        { id: 'p1', name: 'Alice', seed: 1 },
        { id: 'p2', name: 'Bob', seed: 2 },
      ],
    });

    expect(await fetchParticipantNames('t-1', fetchImpl)).toEqual({ p1: 'Alice', p2: 'Bob' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/tournaments/t-1/participants');
  });

  it('returns null for an API failure or an offline request', async () => {
    expect(await fetchParticipantNames('t-1', jsonFetch({ success: false, error: 'no' }))).toBeNull();
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await fetchParticipantNames('t-1', offline)).toBeNull();
  });
});

describe('RoundByeNotice', () => {
  it('shows "Bye: <name>" once the names are known', () => {
    const html = renderWithI18n(<RoundByeNotice playerIds={['p2']} names={{ p2: 'Bob' }} settled />);
    expect(textOf(html)).toBe('Bye: Bob');
  });

  it('lists several byes', () => {
    const html = renderWithI18n(
      <RoundByeNotice playerIds={['p1', 'p2']} names={{ p1: 'Alice', p2: 'Bob' }} settled />,
    );
    expect(textOf(html)).toBe('Bye: Alice, Bob');
  });

  it('shows nothing for a round without a bye, and nothing while the names load', () => {
    expect(renderWithI18n(<RoundByeNotice playerIds={[]} names={{}} settled />)).toBe('');
    expect(renderWithI18n(<RoundByeNotice playerIds={['p2']} names={null} settled={false} />)).toBe('');
  });

  it('falls back to a placeholder when the participants could not be loaded', () => {
    const html = renderWithI18n(<RoundByeNotice playerIds={['p2']} names={null} settled />);
    expect(textOf(html)).toBe('Bye: Unknown player');
  });

  it('speaks German', () => {
    const html = renderWithI18n(<RoundByeNotice playerIds={['p2']} names={{ p2: 'Bob' }} settled />, {
      locale: 'de',
    });
    expect(textOf(html)).toBe('Freilos: Bob');
  });
});

// A static render runs no effects, so the participant names never arrive: this pins that the round card
// does not show a bye line (not even the "Unknown player" fallback) before they have settled. The line
// itself is covered by the RoundByeNotice tests above.
describe('RoundManager round card before the participants load', () => {
  const tournament = {
    id: 't-1',
    name: 'Weekly',
    bracket_type: 'swiss',
    best_of_default: 3,
    status: 'active',
  } as unknown as Tournament;

  it('renders the rounds without a bye line while the names load', () => {
    const html = renderWithI18n(
      <RoundManager
        tournament={tournament}
        initialRounds={[makeRound({ bye_player_ids: ['p5'] }), makeRound({ id: 'r-2', name: 'Round 2', round_number: 2 })]}
      />,
    );
    // No client effects in a static render: the participants are not loaded yet.
    expect(textOf(html)).not.toContain('Bye:');
    expect(textOf(html)).toContain('Round 1');
    expect(textOf(html)).toContain('Round 2');
  });
});
