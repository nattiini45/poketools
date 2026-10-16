import type { PublicMatch } from '@/lib/match/public-match';
import type { MatchStatus } from '@/types/match';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import Link from 'next/link';
import type { EntryLosses } from './entry-losses';
import { DEFAULT_BRACKET_LABELS, type BracketLabels } from './labels';

interface BracketMatchCardProps {
  match: PublicMatch;
  tournamentId: string;
  /** Status chip labels in another language; absent keeps the English chip. */
  statusLabels?: Readonly<Record<MatchStatus, string>> | null;
  /**
   * Double elimination: each entrant's losses going into this match (see
   * `lossesEnteringMatches`). Absent (single elimination), no loss marks.
   */
  entryLosses?: EntryLosses;
  /** The loss mark's words; English by default. */
  lossLabels?: Pick<BracketLabels, 'lossesShort' | 'lossesEntering'>;
}

export default function BracketMatchCard({
  match,
  tournamentId,
  statusLabels,
  entryLosses,
  lossLabels = DEFAULT_BRACKET_LABELS,
}: BracketMatchCardProps) {
  const isP1Winner = match.winner_id === match.player_1_id;
  const isP2Winner = match.winner_id === match.player_2_id;

  return (
    <Link
      href={`/tournaments/${tournamentId}/matches/${match.id}`}
      className="block rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-card p-2 hover:shadow-poke-card-hover hover:-translate-y-0.5 transition-all duration-200 text-sm"
    >
      <div className="flex items-center justify-between mb-1">
        <MatchStatusBadge status={match.status} label={statusLabels?.[match.status]} />
      </div>
      <div
        className={`flex justify-between py-0.5 ${
          isP1Winner ? 'font-semibold text-poke-text-primary' : match.winner_id ? 'text-poke-text-muted' : ''
        }`}
      >
        <span className="flex items-center gap-1.5 truncate max-w-[140px]">
          <DecorativeAvatar avatarUrl={match.player_1_avatar_url} name={match.player_1_name} />
          {match.player_1_name}
        </span>
        <Score wins={countWins(match, match.player_1_id)} losses={entryLosses?.player1} labels={lossLabels} />
      </div>
      <div
        className={`flex justify-between py-0.5 ${
          isP2Winner ? 'font-semibold text-poke-text-primary' : match.winner_id ? 'text-poke-text-muted' : ''
        }`}
      >
        <span className="flex items-center gap-1.5 truncate max-w-[140px]">
          <DecorativeAvatar avatarUrl={match.player_2_avatar_url} name={match.player_2_name} />
          {match.player_2_name}
        </span>
        <Score wins={countWins(match, match.player_2_id)} losses={entryLosses?.player2} labels={lossLabels} />
      </div>
    </Link>
  );
}

/**
 * The avatar beside a printed player name. The card is a link, so anything
 * inside it joins the link's accessible name; PlayerAvatar labels itself
 * "X's avatar" in English, which a German hub (lang="de") would read out with
 * German pronunciation, and the name is already printed next to it. Hidden
 * from assistive technology, the avatar is purely decorative.
 */
function DecorativeAvatar({ avatarUrl, name }: { avatarUrl: string | null | undefined; name: string }) {
  return (
    <span aria-hidden="true" className="flex shrink-0">
      <PlayerAvatar avatarUrl={avatarUrl} name={name} size={16} />
    </span>
  );
}

/**
 * Games won, preceded on double-elimination cards by the entrant's losses
 * going into the match. Without a loss count the markup is the plain count,
 * exactly as single elimination has always rendered it.
 */
function Score({
  wins,
  losses,
  labels,
}: {
  wins: number;
  losses: number | undefined;
  labels: Pick<BracketLabels, 'lossesShort' | 'lossesEntering'>;
}) {
  if (losses === undefined) return <span>{wins}</span>;
  const meaning = `${labels.lossesEntering}: ${losses}`;
  return (
    <span className="flex items-center gap-2">
      <span
        data-entry-losses={losses}
        title={meaning}
        className="rounded-poke-sm border border-poke-border px-1 text-[10px] font-normal leading-4 text-poke-text-muted"
      >
        <span aria-hidden="true">
          {losses} {labels.lossesShort}
        </span>
        <span className="sr-only">{meaning}</span>
      </span>
      <span>{wins}</span>
    </span>
  );
}

function countWins(match: PublicMatch, playerId: string): number {
  return match.games.filter((g) => g.winner_id === playerId).length;
}
