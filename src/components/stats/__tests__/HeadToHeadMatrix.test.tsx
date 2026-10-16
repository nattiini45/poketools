/**
 * The Insights head-to-head card. It used to fetch `GET /api/matches?…`, a
 * route that does not exist (a 404 HTML page), so every pair showed
 * "0 matches". Rendered through react-dom/server (vitest 'node' env, no DOM);
 * the fetch runs against the real route handler with its cached read
 * (`publicReads.tournamentHeadToHead`) mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { tournamentHeadToHead: vi.fn() },
}));

import {
  HeadToHeadCard,
  HeadToHeadError,
  headToHeadUrl,
  loadHeadToHead,
  summarizeHeadToHead,
} from '../HeadToHeadMatrix';
import { GET } from '@/app/api/matches/head-to-head/route';
import { publicReads } from '@/lib/cache/public-reads';
import { toPublicMatch } from '@/lib/match/public-match';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';
import { renderWithI18n } from '@/test/i18n';

const T_ID = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function game(id: string, winner: string) {
  return { id, game_number: 1, winner_id: winner, replay_url: `https://replay.example.test/${id}`, source: 'manual' as const, stats_locked: false };
}

const MATCHES = [
  fullMatchRow({
    id: 'm-1', tournament_id: T_ID, player_1_id: ALICE, player_2_id: BOB, winner_id: ALICE,
    games: [game('g-1', ALICE), game('g-2', BOB), game('g-3', ALICE)],
  }),
  fullMatchRow({
    id: 'm-2', tournament_id: T_ID, player_1_id: BOB, player_2_id: ALICE, winner_id: BOB,
    games: [game('g-4', BOB), game('g-5', BOB)],
  }),
].map(toPublicMatch);

/** A `fetch` that hands the request to the real head-to-head route handler. */
const routeFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://localhost:3000');
  if (url.pathname !== '/api/matches/head-to-head') {
    return new Response('<html>404</html>', { status: 404 });
  }
  return GET(new Request(url) as unknown as NextRequest);
}) as unknown as typeof fetch;

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publicReads.tournamentHeadToHead).mockResolvedValue(MATCHES);
});

describe('headToHeadUrl', () => {
  it('names the public head-to-head route with the tournament and both players', () => {
    const url = new URL(headToHeadUrl(T_ID, ALICE, BOB), 'http://localhost');
    expect(url.pathname).toBe('/api/matches/head-to-head');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tournament_id: T_ID,
      player_1_id: ALICE,
      player_2_id: BOB,
    });
  });
});

describe('loadHeadToHead', () => {
  it("loads the pair's matches from the route", async () => {
    const result = await loadHeadToHead(T_ID, ALICE, BOB, routeFetch);

    expect(result.ok).toBe(true);
    expect(result.ok && result.matches.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(publicReads.tournamentHeadToHead).toHaveBeenCalledWith(T_ID, ALICE, BOB);
  });

  it('reports an error response as an error, not as no matches', async () => {
    const result = await loadHeadToHead(T_ID, ALICE, 'abc', routeFetch);
    // The API error body is kept as data (English `error`, plus `code`/`params`
    // when the route sends them) and translated at render.
    expect(result).toMatchObject({ ok: false, error: { error: 'player_2_id must be a valid UUID' } });
  });

  it('reports a failed request (network error, HTML page) as an error', async () => {
    const htmlFetch = vi.fn(async () => new Response('<html>404</html>', { status: 404 })) as unknown as typeof fetch;
    // `null`: no API message; the card shows its own "Failed to load head-to-head matches".
    expect(await loadHeadToHead(T_ID, ALICE, BOB, htmlFetch)).toEqual({ ok: false, error: null });
  });
});

describe('summarizeHeadToHead', () => {
  it('counts match and game wins from either seat', () => {
    expect(summarizeHeadToHead(MATCHES, ALICE, BOB)).toEqual({
      matches: 2,
      p1Wins: 1,
      p2Wins: 1,
      totalGames: 5,
      p1GameWins: 2,
      p2GameWins: 3,
    });
  });
});

describe('rendering', () => {
  it('shows the record of a pair that played', () => {
    const text = textOf(
      renderToStaticMarkup(
        <HeadToHeadCard player1Name="Alice" player2Name="Bob" summary={summarizeHeadToHead(MATCHES, ALICE, BOB)} />,
      ),
    );
    expect(text).toContain('Alice vs Bob');
    expect(text).toContain('2 matches');
    expect(text).toContain('5 games');
    expect(text).toContain('Game record: 2–3');
    expect(text).not.toContain('No matches between these players');
  });

  it('shows the error with a retry button', () => {
    const html = renderToStaticMarkup(<HeadToHeadError message="boom" onRetry={() => {}} />);
    expect(textOf(html)).toContain('Could not load head-to-head: boom');
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Retry');
  });

  it('uses the singular for one match and one game', () => {
    const one = summarizeHeadToHead(MATCHES.slice(1, 2), ALICE, BOB);
    const text = textOf(
      renderToStaticMarkup(<HeadToHeadCard player1Name="Alice" player2Name="Bob" summary={{ ...one, totalGames: 1 }} />),
    );
    expect(text).toContain('1 match ');
    expect(text).toContain('1 game ');
  });

  it('renders the card, the empty record and the error in German', () => {
    const played = textOf(
      renderWithI18n(
        <HeadToHeadCard player1Name="Alice" player2Name="Bob" summary={summarizeHeadToHead(MATCHES, ALICE, BOB)} />,
        { locale: 'de' },
      ),
    );
    expect(played).toContain('Alice vs. Bob');
    expect(played).toContain('2 Spiele');
    expect(played).toContain('5 Partien');
    expect(played).toContain('Partien: 2–3');

    const empty = textOf(
      renderWithI18n(<HeadToHeadCard player1Name="Alice" player2Name="Bob" summary={summarizeHeadToHead([], ALICE, BOB)} />, {
        locale: 'de',
      }),
    );
    expect(empty).toContain('0 Spiele');
    expect(empty).toContain('Diese Spieler sind noch nicht gegeneinander angetreten');

    const error = textOf(renderWithI18n(<HeadToHeadError message="boom" onRetry={() => {}} />, { locale: 'de' }));
    expect(error).toContain('Direkter Vergleich konnte nicht geladen werden: boom');
    expect(error).toContain('Erneut versuchen');
  });
});
