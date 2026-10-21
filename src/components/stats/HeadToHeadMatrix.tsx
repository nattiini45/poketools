'use client';

import { useState, useEffect, useCallback } from 'react';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useT } from '@/i18n/client';
import { errorsMatches } from '@/i18n/messages/errors';
import { statsMessages } from '@/i18n/messages/stats';
import { supplementaryRecordsMessages } from '@/i18n/messages/supplementary-records';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { PublicMatch } from '@/lib/match/public-match';
import type { ApiResult } from '@/types/api';
import type { HeadToHeadSupplement } from '@/types/supplementary-records';

interface HeadToHeadMatrixProps {
  tournamentId: string;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
}

/** The public head-to-head read: the pair's completed matches in one tournament. */
export function headToHeadUrl(tournamentId: string, player1Id: string, player2Id: string): string {
  const query = new URLSearchParams({
    tournament_id: tournamentId,
    player_1_id: player1Id,
    player_2_id: player2Id,
  });
  return `/api/matches/head-to-head?${query.toString()}`;
}

/**
 * `error` is the API's error body (English `error`, `code`, `params`), shown
 * in the viewer's language at render; `null` when the request failed without
 * one (network failure, a non-JSON page): the card's own "failed to load".
 */
export type HeadToHeadLoad =
  | { ok: true; matches: PublicMatch[]; supplement?: HeadToHeadSupplement }
  | { ok: false; error: ApiErrorLike | null };

/**
 * Fetch the pair's matches. A failed request is returned as an error (shown
 * with a retry), never as "no matches": an empty list must mean the players
 * did not meet.
 */
export async function loadHeadToHead(
  tournamentId: string,
  player1Id: string,
  player2Id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HeadToHeadLoad> {
  try {
    const res = await fetchImpl(headToHeadUrl(tournamentId, player1Id, player2Id));
    const json = (await res.json()) as ApiResult<PublicMatch[]> & { supplement?: HeadToHeadSupplement };
    if (!json.success) return { ok: false, error: toApiErrorLike(json) };
    // `supplement` is sent only when the active pack has a head-to-head provider.
    return json.supplement
      ? { ok: true, matches: json.data, supplement: json.supplement }
      : { ok: true, matches: json.data };
  } catch {
    return { ok: false, error: null };
  }
}

export interface HeadToHeadSummary {
  matches: number;
  p1Wins: number;
  p2Wins: number;
  totalGames: number;
  p1GameWins: number;
  p2GameWins: number;
}

/** Match and game records of the pair, from player 1's and player 2's side. */
export function summarizeHeadToHead(
  matches: readonly PublicMatch[],
  player1Id: string,
  player2Id: string,
): HeadToHeadSummary {
  let totalGames = 0;
  let p1GameWins = 0;
  let p2GameWins = 0;
  for (const m of matches) {
    totalGames += m.games.length;
    p1GameWins += m.games.filter((g) => g.winner_id === player1Id).length;
    p2GameWins += m.games.filter((g) => g.winner_id === player2Id).length;
  }
  return {
    matches: matches.length,
    p1Wins: matches.filter((m) => m.winner_id === player1Id).length,
    p2Wins: matches.filter((m) => m.winner_id === player2Id).length,
    totalGames,
    p1GameWins,
    p2GameWins,
  };
}

interface HeadToHeadCardProps {
  player1Name: string;
  player2Name: string;
  summary: HeadToHeadSummary;
}

/** The record card (presentational). */
export function HeadToHeadCard({ player1Name, player2Name, summary }: HeadToHeadCardProps) {
  const t = useT(statsMessages);
  return (
    <Card padding="md">
      <h4 className="font-heading font-semibold text-sm text-poke-text-primary mb-3">
        {t('h2h.title', { player1: player1Name, player2: player2Name })}
      </h4>

      <div className="grid grid-cols-3 gap-4 text-center text-sm">
        <div>
          <div className="text-2xl font-bold text-poke-green">{summary.p1Wins}</div>
          <div className="text-poke-text-muted">{player1Name}</div>
        </div>
        <div>
          <div className="text-lg text-poke-text-muted pt-1">
            {t('h2h.matches', { count: summary.matches })}
          </div>
          <div className="text-xs text-poke-text-muted">{t('h2h.games', { count: summary.totalGames })}</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-poke-blue">{summary.p2Wins}</div>
          <div className="text-poke-text-muted">{player2Name}</div>
        </div>
      </div>

      {summary.totalGames > 0 && (
        <div className="mt-3 text-xs text-center text-poke-text-muted">
          {t('h2h.gameRecord', { wins: summary.p1GameWins, losses: summary.p2GameWins })}
        </div>
      )}

      {summary.matches === 0 && (
        <div className="text-center text-poke-text-muted text-sm mt-2">
          {t('h2h.noMatches')}
        </div>
      )}
    </Card>
  );
}

/**
 * The pair's supplementary record (docs/format-packs.md, "Pack extensions"), under the live
 * card and never added to it. Nothing when it does not count for the viewer or the pair never met.
 */
export function HeadToHeadSupplementLine({ supplement }: { supplement: HeadToHeadSupplement | undefined }) {
  const t = useT(supplementaryRecordsMessages);
  if (!supplement || supplement.state === 'excluded') return null;
  if (supplement.state === 'failed') {
    return (
      <p role="status" className="text-xs text-center text-poke-text-tertiary">
        {t('loadFailed')}
      </p>
    );
  }
  if (!supplement.record) return null;
  return (
    <p className="text-xs text-center text-poke-text-tertiary">
      {t('headToHead.record', {
        wins: supplement.record.wins,
        draws: supplement.record.draws,
        losses: supplement.record.losses,
      })}
    </p>
  );
}

/** The error state: what failed (already translated), and a retry. */
export function HeadToHeadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT(statsMessages);
  return (
    <Alert variant="error" className="flex items-center justify-between gap-3">
      <span>{t('h2h.loadError', { message })}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('h2h.retry')}
      </Button>
    </Alert>
  );
}

/**
 * On-demand head-to-head display: fetches the pair's completed matches in
 * the tournament (`GET /api/matches/head-to-head`) when rendered.
 */
export default function HeadToHeadMatrix({
  tournamentId,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
}: HeadToHeadMatrixProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const t = useT(statsMessages);
  const errorText = useApiErrorText(errorsMatches);
  // The result is kept with the request it answers: after the pair changes
  // (or on a retry) the old result no longer matches and the card shows
  // "Loading..." until the new one arrives.
  const requestKey = `${tournamentId}|${player1Id}|${player2Id}|${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: HeadToHeadLoad } | null>(null);

  useEffect(() => {
    // A response for a pair the viewer has since changed is dropped.
    let current = true;
    void loadHeadToHead(tournamentId, player1Id, player2Id).then((result) => {
      if (current) setLoaded({ key: requestKey, result });
    });
    return () => {
      current = false;
    };
  }, [requestKey, tournamentId, player1Id, player2Id]);

  const state = loaded?.key === requestKey ? loaded.result : null;
  if (!state) {
    return <div className="py-4 text-center text-poke-text-muted">{t('h2h.loading')}</div>;
  }
  if (!state.ok) {
    const message = state.error ? errorText(state.error) : t('h2h.loadFailed');
    return <HeadToHeadError message={message} onRetry={retry} />;
  }

  return (
    <HeadToHeadLoaded
      load={state}
      player1Id={player1Id}
      player2Id={player2Id}
      player1Name={player1Name}
      player2Name={player2Name}
    />
  );
}

/**
 * A loaded head-to-head: the live card, plus the supplementary line when the route sent one. Without a
 * supplement (every pack without a head-to-head provider) the markup is the bare card, exactly as before the
 * pack-extension seam; the wrapper appears only around a supplement line.
 */
export function HeadToHeadLoaded({
  load,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
}: {
  load: Extract<HeadToHeadLoad, { ok: true }>;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
}) {
  const card = (
    <HeadToHeadCard
      player1Name={player1Name}
      player2Name={player2Name}
      summary={summarizeHeadToHead(load.matches, player1Id, player2Id)}
    />
  );
  if (!load.supplement) return card;
  return (
    <div className="space-y-2">
      {card}
      <HeadToHeadSupplementLine supplement={load.supplement} />
    </div>
  );
}
