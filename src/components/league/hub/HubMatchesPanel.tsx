import Link from 'next/link';
import { FOCUS_RING, PANEL_INSET } from '@/components/world/panel';
import { LocalTime } from '@/i18n/LocalTime';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import { gameScore, openRoundId, type HubRoundMatches, type HubStageMatches } from '@/lib/league-hub/views';
import type { BracketSide } from '@/types/match';
import type { PublicMatch } from '@/lib/match/public-match';
import { HubNotice, HubStageHeader, HubStatusChip } from './HubBits';

interface HubMatchesPanelProps {
  stages: HubStageMatches[];
  copy: LeagueHubCopy;
}

/** The words a round name uses for its side (the bracket engine names rounds in English). */
const SIDE_WORDS: Record<BracketSide, string> = { winners: 'winner', losers: 'loser', grand_finals: 'grand final' };

/**
 * A round's label: its name in the viewer's language (`copy.roundName`),
 * prefixed with the bracket side in a double elimination phase unless the
 * name already says which side it is on ("Losers Round 2", "Grand Finals").
 */
function roundLabel(round: HubRoundMatches, copy: LeagueHubCopy, doubleElim: boolean): string {
  const name = round.name !== null ? copy.roundName(round.name) : copy.round(round.position);
  // Single elimination stores every round on the winners side: no prefix.
  if (!round.bracketSide || !doubleElim) return name;
  const side = copy.bracketSide[round.bracketSide];
  const lower = name.toLowerCase();
  const named = lower.includes(side.toLowerCase()) || lower.includes(SIDE_WORDS[round.bracketSide]);
  return named ? name : `${side} · ${name}`;
}

/**
 * The centre cell of a match row: the game score; for a completed match with
 * no game rows (a result an admin set, a forfeit, a result confirmed before
 * the replays were imported) the outcome in the table's letters ("W : L",
 * "D : D"), since there is no score to show; else "vs".
 */
function resultCell(match: PublicMatch, copy: LeagueHubCopy): { text: string; title?: string } | null {
  const score = gameScore(match);
  if (score) return { text: `${score.player1} : ${score.player2}` };
  if (match.status !== 'completed') return null;
  const { wins, losses, draws } = copy.table;
  const text =
    match.winner_id === match.player_1_id
      ? `${wins} : ${losses}`
      : match.winner_id === match.player_2_id
        ? `${losses} : ${wins}`
        : `${draws} : ${draws}`;
  return { text, title: copy.resultWithoutGames };
}

function MatchRow({ match, copy }: { match: PublicMatch; copy: LeagueHubCopy }) {
  const result = resultCell(match, copy);
  const when = match.scheduled_at ?? match.date_played;
  const p1Won = match.winner_id !== null && match.winner_id === match.player_1_id;
  const p2Won = match.winner_id !== null && match.winner_id === match.player_2_id;
  return (
    <li>
      <Link
        href={`/tournaments/${match.tournament_id}/matches/${match.id}`}
        className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 hover:bg-arena-elevated motion-reduce:transition-none sm:grid-cols-[7.5rem_1fr_auto_1fr_auto] ${FOCUS_RING}`}
      >
        <span className="hidden text-xs text-arena-ink-secondary sm:block">
          {when ? <LocalTime value={when} preset="dateTime" /> : null}
        </span>
        <span className={`truncate text-right ${p1Won ? 'font-bold text-arena-ink' : 'text-arena-ink'}`}>
          {match.player_1_name}
        </span>
        <span
          title={result?.title}
          className="min-w-[3.5rem] text-center font-heading font-bold tabular-nums text-arena-ink"
        >
          {result ? result.text : <span className="text-arena-ink-secondary">{copy.versus}</span>}
        </span>
        <span className={`truncate ${p2Won ? 'font-bold text-arena-ink' : 'text-arena-ink'}`}>
          {match.player_2_name}
        </span>
        <span className="hidden justify-self-end sm:block">
          <HubStatusChip status={match.status} label={copy.matchStatus[match.status] ?? match.status} />
        </span>
      </Link>
    </li>
  );
}

/**
 * Match overview: every phase, round by round, with scores, kickoff (in the
 * viewer's time zone) and status, each match linking to its detail page. The active (or next open)
 * round of each phase starts expanded; finished rounds fold away.
 */
export default function HubMatchesPanel({ stages, copy }: HubMatchesPanelProps) {
  if (stages.length === 0) return <HubNotice>{copy.phasesEmpty}</HubNotice>;

  return (
    <div className="space-y-8">
      {stages.map(({ stage, rounds }) => {
        const open = openRoundId(rounds);
        return (
          <div key={stage.id} className="space-y-3">
            <HubStageHeader
              name={stage.name}
              meta={`${copy.bracketType[stage.bracket_type] ?? stage.bracket_type} · ${copy.bestOf(stage.best_of_default)}`}
              status={stage.status}
              statusLabel={copy.status[stage.status] ?? stage.status}
              href={`/tournaments/${stage.id}`}
              linkLabel={copy.links.phasePage}
            />
            {rounds.length === 0 ? (
              <HubNotice>{copy.noMatches}</HubNotice>
            ) : (
              <div className="space-y-2">
                {rounds.map((round) => (
                  <details
                    key={round.roundId}
                    open={round.roundId === open}
                    className={`${PANEL_INSET} group`}
                  >
                    <summary
                      className={`flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 ${FOCUS_RING}`}
                    >
                      <span className="flex items-center gap-2 font-heading text-sm font-bold text-arena-ink">
                        <span
                          aria-hidden="true"
                          className="text-arena-ink-secondary transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                        >
                          ›
                        </span>
                        {roundLabel(round, copy, stage.bracket_type === 'double_elim')}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-arena-ink-secondary">
                        {round.matches.filter((match) => match.status === 'completed').length}/{round.matches.length}
                        {round.status && (
                          <HubStatusChip status={round.status} label={copy.roundStatus[round.status] ?? round.status} />
                        )}
                      </span>
                    </summary>
                    <ul className="border-t border-arena-border px-1 py-1">
                      {round.matches.map((match) => (
                        <MatchRow key={match.id} match={match} copy={copy} />
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
