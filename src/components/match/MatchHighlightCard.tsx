'use client';

import { useState, useMemo } from 'react';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import MatchScoreDisplay from '@/components/match/MatchScoreDisplay';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import MovesOverflowList from '@/components/match/MovesOverflowList';
import StreakIndicator from '@/components/gamification/StreakIndicator';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Link from 'next/link';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { matchMessages } from '@/i18n/messages/match';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchStatus, GameSummary } from '@/types/match';
import type { MatchAnalysis, BattleStat } from '@/types/game';
import type { PlayerStanding } from '@/types/tournament';
import type { PlayerStreaks } from '@/types/streak';
import {
  aggregateTeamFromGame,
  computePokemonScoreForGame,
  computeQuickStatsForGame,
  type AggregatedPokemon,
  type QuickStats,
} from '@/lib/match/aggregation';

/** Standings rank: "1st" | "1." */
function ordinal(n: number, locale: Locale): string {
  if (locale === 'de') return `${n}.`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type TabKey = 'overview' | `game-${string}`;

interface CardView {
  score1: number;
  score2: number;
  team1: AggregatedPokemon[];
  team2: AggregatedPokemon[];
  p1IsWinner: boolean;
  p2IsWinner: boolean;
  hasWinner: boolean;
  isOverview: boolean;
  gameNumber: number | null;
  perGameKos: { p1: number; p2: number } | null;
}

// ─── Props ──────────────────────────────────────────────────────────

interface MatchHighlightCardProps {
  player1Name: string;
  player2Name: string;
  player1AvatarUrl: string | null;
  player2AvatarUrl: string | null;
  player1Standing: PlayerStanding | null;
  player2Standing: PlayerStanding | null;
  player1Streaks: PlayerStreaks | null;
  player2Streaks: PlayerStreaks | null;
  winnerId: string | null;
  player1Id: string;
  player2Id: string;
  score1: number;
  score2: number;
  status: MatchStatus;
  datePlayed: string | null;
  tournamentName: string;
  seasonName: string | null;
  formatName: string;
  roundName: string | null;
  player1Team: AggregatedPokemon[];
  player2Team: AggregatedPokemon[];
  analysis: MatchAnalysis | null;
  quickStats: QuickStats | null;
  bestOf: number;
  games: GameSummary[];
  battleStatsByGame: Record<string, BattleStat[]>;
  matchGamesWon: { p1: number; p2: number };
  /** When true, suppresses the turns-active display (EPB uses progress instead) */
  isEpb?: boolean;
  /**
   * Prefix of the element ids (card, panel, tabs). Default `'match'` gives
   * `match-highlight-card`; the social-image copy uses another prefix so the
   * two cards never share an id.
   */
  idPrefix?: string;
  /** Off-screen capture copy: render final numbers without the count-up animation. */
  forCapture?: boolean;
  /** Language of the stored AI analysis text (the league's content language). */
  aiLang?: Locale;
}

function formatContextLabel(seasonName: string | null, tournamentName: string): string | null {
  if (!tournamentName && !seasonName) return null;
  if (!seasonName) return tournamentName || null;
  if (!tournamentName) return seasonName;
  if (tournamentName.toLowerCase().includes(seasonName.toLowerCase())) {
    return tournamentName;
  }
  return `${seasonName} · ${tournamentName}`;
}

// ─── Metadata Strip ─────────────────────────────────────────────────

function MetadataStrip({
  tournamentName,
  seasonName,
  roundName,
  datePlayed,
  status,
}: {
  tournamentName: string;
  seasonName: string | null;
  roundName: string | null;
  datePlayed: string | null;
  status: MatchStatus;
}) {
  const locale = useLocale();
  const formatter = useFormatter();
  const contextLabel = formatContextLabel(seasonName, tournamentName);
  const dateStr = datePlayed ? formatter.instant(datePlayed, 'date') : null;
  const roundLabel = roundName ? translateEngineLabel('round', roundName, locale) : null;
  const roundDateText = [roundLabel, dateStr].filter(Boolean).join(' · ');
  const showStatus = status !== 'completed';

  if (!contextLabel && !roundDateText && !showStatus) return null;

  return (
    <div className="bg-poke-muted border-b border-poke-border rounded-t-poke-lg">
      {contextLabel && (
        <div className="px-4 py-2 border-b border-poke-border/50">
          <span className="text-[11px] font-heading font-semibold text-poke-text-secondary tracking-wide uppercase truncate block">
            {contextLabel}
          </span>
        </div>
      )}
      {(roundDateText || showStatus) && (
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          {roundDateText ? (
            <span className="text-[11px] font-heading text-poke-text-muted tracking-wide truncate min-w-0">
              {roundDateText}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {showStatus && (
            <div className="shrink-0">
              <MatchStatusBadge status={status} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab strip ──────────────────────────────────────────────────────

function MatchViewTabs({
  activeTab,
  onTabChange,
  games,
  idPrefix,
  panelId,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  games: GameSummary[];
  idPrefix: string;
  panelId: string;
}) {
  const t = useT(matchMessages);
  const tabs: { key: TabKey; label: string; id: string }[] = [
    { key: 'overview', label: t('card.overview'), id: `${idPrefix}-tab-overview` },
    ...games.map((g) => ({
      key: `game-${g.id}` as TabKey,
      label: t('shared.game', { n: g.game_number }),
      id: `${idPrefix}-tab-game-${g.id}`,
    })),
  ];

  return (
    <div
      data-export-hide
      className="border-b border-poke-border px-2 sm:px-4 overflow-x-auto"
      role="tablist"
      aria-label={t('card.matchView')}
    >
      <div className="flex gap-1 min-w-max">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            id={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={panelId}
            onClick={() => onTabChange(tab.key)}
            className={`px-3 sm:px-4 py-2 text-sm font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Standing Label ─────────────────────────────────────────────────

function StandingLabel({ standing }: { standing: PlayerStanding }) {
  const t = useT(matchMessages);
  const locale = useLocale();
  const record =
    standing.draws > 0
      ? t('card.recordWld', { w: standing.wins, l: standing.losses, d: standing.draws })
      : t('card.recordWl', { w: standing.wins, l: standing.losses });
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-heading font-semibold">
      <span className="text-poke-text-primary">{ordinal(standing.rank, locale)}</span>
      <span className="text-poke-text-muted">({record})</span>
    </span>
  );
}

// ─── Pokemon Stat Row ───────────────────────────────────────────────

function PokemonStatRow({ p, isBench, hideTurns }: { p: AggregatedPokemon; isBench: boolean; hideTurns?: boolean }) {
  const t = useT(matchMessages);
  const dataLocale = useDataLocale();
  const aura = isBench
    ? 'none' as const
    : p.isMvp
      ? 'gold' as const
      : p.wasKoed
        ? 'red' as const
        : 'green' as const;

  return (
    <div className={`flex items-center gap-1 sm:gap-2.5 ${isBench ? 'opacity-40 grayscale' : ''}`}>
      <PokemonLink name={p.pokemonName} className="shrink-0">
        <span className="inline-block scale-[0.82] sm:scale-100 origin-left">
          <PokemonSprite name={p.pokemonName} size={44} aura={aura} />
        </span>
      </PokemonLink>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <PokemonLink name={p.pokemonName}>
            <span className="text-xs font-heading font-semibold text-poke-text-primary hover:underline">
              {localizeSpecies(p.pokemonName, dataLocale)}
            </span>
          </PokemonLink>
          {!isBench && p.totalTurnsActive > 0 && !hideTurns && (
            <span className="text-[10px] text-poke-text-muted">{t('card.turnsShort', { n: p.totalTurnsActive })}</span>
          )}
        </div>
        {isBench ? (
          <p className="text-[10px] text-poke-text-muted italic mt-0.5">{t('card.notUsed')}</p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              {p.isMvp && <Badge variant="yellow" size="xs">{t('shared.mvpBadge')}</Badge>}
              {p.totalKos > 0 && (
                <Badge variant="green" size="xs">{t('shared.kos', { count: p.totalKos })}</Badge>
              )}
              {p.wasLead && <Badge variant="blue" size="xs" className="uppercase">{t('shared.lead')}</Badge>}
              {p.wasKoed && <Badge variant="red" size="xs">{t('shared.koed')}</Badge>}
            </div>
            {p.movesUsed.length > 0 && (
              <MovesOverflowList
                moves={p.movesUsed}
                className="text-[10px] text-poke-text-muted mt-0.5"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Unified Player Column ──────────────────────────────────────────

function PlayerColumn({
  name,
  avatarUrl,
  playerId,
  isWinner,
  isLoser,
  standing,
  streaks,
  team,
  showTeam,
  hideTurns,
}: {
  name: string;
  avatarUrl: string | null;
  playerId: string;
  isWinner: boolean;
  isLoser: boolean;
  standing: PlayerStanding | null;
  streaks: PlayerStreaks | null;
  team: AggregatedPokemon[];
  showTeam: boolean;
  hideTurns?: boolean;
}) {
  const t = useT(matchMessages);
  const hasActiveStreak = streaks != null && (
    streaks.current_win_streak >= 3 ||
    streaks.current_ko_streak > 0 ||
    streaks.current_flawless_streak > 0
  );

  return (
    <div className="flex-1 flex flex-col items-center text-center gap-1 min-w-0">
      <Link href={`/players/${playerId}`} className="flex flex-col items-center gap-1 group">
        <PlayerAvatar
          avatarUrl={avatarUrl}
          name={name}
          size={48}
          className={isWinner ? '!ring-poke-green' : ''}
        />
        <p className={`font-heading text-sm truncate max-w-full group-hover:underline ${
          isWinner ? 'font-bold text-poke-green' : 'font-semibold text-poke-text-primary'
        }`}>
          {name}
        </p>
      </Link>

      <p className={`text-[9px] font-heading font-bold tracking-[0.15em] uppercase ${
        isWinner ? 'text-poke-green/70' : isLoser ? 'text-poke-accent/50' : 'invisible'
      }`}>
        {isWinner ? t('card.winner') : t('card.loser')}
      </p>

      {standing && <StandingLabel standing={standing} />}

      <div className="min-h-[28px] flex items-center justify-center">
        {hasActiveStreak ? (
          <StreakIndicator streaks={streaks} compact />
        ) : (
          <span className="text-[10px] text-poke-text-muted font-heading italic">{t('card.noStreak')}</span>
        )}
      </div>

      {showTeam && team.length > 0 && (
        <div className={`mt-1.5 sm:mt-2 text-left ${!isWinner ? 'opacity-70' : ''}`}>
          <div className="space-y-2">
            {team.map((p) => (
              <PokemonStatRow key={p.pokemonName} p={p} isBench={p.timesBrought === 0} hideTurns={hideTurns} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Match Narrative ────────────────────────────────────────────────

function MatchNarrative({
  analysis,
  player1Team,
  player2Team,
  player1Name,
  player2Name,
  quickStats,
  aiLang,
}: {
  analysis: MatchAnalysis | null;
  player1Team: AggregatedPokemon[];
  player2Team: AggregatedPokemon[];
  player1Name: string;
  player2Name: string;
  quickStats: QuickStats | null;
  aiLang?: Locale;
}) {
  const t = useT(matchMessages);
  const dataLocale = useDataLocale();
  const hasAnalysis = analysis?.status === 'completed' && analysis.analysis;

  if (hasAnalysis) {
    const content = analysis.analysis;
    return (
      <div className="space-y-3 border-t border-poke-border pt-4">
        {content.mvp && (
          <div className="bg-poke-yellow-light rounded-poke-md p-3">
            <div className="flex items-center gap-2.5 mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/characters/professor-linden.png"
                alt={t('shared.profName')}
                className="w-7 h-7 rounded-full object-cover shrink-0"
              />
              <span className="text-[11px] font-heading font-bold text-poke-yellow-ink uppercase tracking-wide">
                {t('card.profMvp')}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <div className="shrink-0 ring-2 ring-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)] rounded-full p-0.5">
                <PokemonSprite name={content.mvp.pokemon} size={44} animated />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="yellow" size="sm">{t('shared.mvpBadge')}</Badge>
                  <PokemonLink name={content.mvp.pokemon}>
                    <span className="text-sm font-heading font-bold text-poke-text-primary">
                      {localizeSpecies(content.mvp.pokemon, dataLocale)}
                    </span>
                  </PokemonLink>
                </div>
                <p lang={aiLang} className="text-xs text-poke-text-secondary leading-relaxed">
                  {content.mvp.reasoning}
                </p>
              </div>
            </div>
          </div>
        )}

        {content.turning_point && (
          <div className="flex gap-2.5 items-start bg-poke-muted/50 rounded-poke-md p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/characters/professor-linden.png"
              alt={t('shared.profName')}
              className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
            />
            <div>
              <p className="text-[11px] font-heading font-bold text-poke-text-muted uppercase tracking-wide mb-1">
                {t('card.profTurningPoint')}
              </p>
              <p lang={aiLang} className="text-xs text-poke-text-secondary leading-relaxed">
                {content.turning_point}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  const mvp = [...player1Team, ...player2Team].find((p) => p.isMvp);
  if (!mvp && !quickStats) return null;

  return (
    <div className="border-t border-poke-border pt-3">
      <p className="text-[11px] font-heading font-bold text-poke-text-muted uppercase tracking-wide mb-2">
        {t('card.highlights')}
      </p>
      <div className="space-y-1.5">
        {mvp && (
          <div className="flex items-center gap-2">
            <div className="shrink-0 ring-2 ring-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)] rounded-full p-0.5">
              <PokemonSprite name={mvp.pokemonName} size={28} animated />
            </div>
            <span className="text-xs text-poke-text-secondary">
              <PokemonLink name={mvp.pokemonName} className="inline-flex">
                <span className="font-semibold text-poke-text-primary">
                  {t('card.mvpLine', { name: localizeSpecies(mvp.pokemonName, dataLocale) })}
                </span>
              </PokemonLink>
              {' — '}
              {t('card.mvpSummary', {
                kos: t('shared.kos', { count: mvp.totalKos }),
                games: t('shared.games', { count: mvp.timesBrought }),
              })}
            </span>
          </div>
        )}
        {quickStats && (
          <p className="text-xs text-poke-text-muted">
            {t('card.totalKos', {
              p1: player1Name,
              k1: quickStats.p1TotalKos,
              p2: player2Name,
              k2: quickStats.p2TotalKos,
            })}
            {quickStats.gamesPlayed > 1 && ` · ${t('shared.games', { count: quickStats.gamesPlayed })}`}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Quick Stats Bar ────────────────────────────────────────────────

function QuickStatsBar({
  quickStats,
  player1Name,
  player2Name,
}: {
  quickStats: QuickStats;
  player1Name: string;
  player2Name: string;
}) {
  const t = useT(matchMessages);
  return (
    <div className="flex items-center justify-center gap-4 text-[11px] font-heading text-poke-text-muted border-t border-poke-border pt-3">
      <span>
        <span className="font-semibold text-poke-text-secondary">{player1Name}:</span>{' '}
        {t('shared.kos', { count: quickStats.p1TotalKos })}
      </span>
      <span className="text-poke-border">|</span>
      <span>
        <span className="font-semibold text-poke-text-secondary">{player2Name}:</span>{' '}
        {t('shared.kos', { count: quickStats.p2TotalKos })}
      </span>
      {quickStats.gamesPlayed > 1 && (
        <>
          <span className="text-poke-border">|</span>
          <span>{t('shared.games', { count: quickStats.gamesPlayed })}</span>
        </>
      )}
    </div>
  );
}

function PerGameStatsBar({
  gameNumber,
  player1Name,
  player2Name,
  perGameKos,
}: {
  gameNumber: number;
  player1Name: string;
  player2Name: string;
  perGameKos: { p1: number; p2: number };
}) {
  const t = useT(matchMessages);
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 text-[11px] font-heading text-poke-text-muted border-t border-poke-border pt-3 flex-wrap text-center">
      <span className="font-semibold text-poke-text-secondary">{t('shared.game', { n: gameNumber })}</span>
      <span className="text-poke-border hidden sm:inline">|</span>
      <span>
        <span className="font-semibold text-poke-text-secondary">{player1Name}:</span>{' '}
        {t('shared.kos', { count: perGameKos.p1 })}
      </span>
      <span className="text-poke-border">|</span>
      <span>
        <span className="font-semibold text-poke-text-secondary">{player2Name}:</span>{' '}
        {t('shared.kos', { count: perGameKos.p2 })}
      </span>
    </div>
  );
}

function buildOverviewView(
  bestOf: number,
  score1: number,
  score2: number,
  matchGamesWon: { p1: number; p2: number },
  player1Team: AggregatedPokemon[],
  player2Team: AggregatedPokemon[],
  winnerId: string | null,
  player1Id: string,
  player2Id: string,
): CardView {
  return {
    score1: bestOf > 1 ? matchGamesWon.p1 : score1,
    score2: bestOf > 1 ? matchGamesWon.p2 : score2,
    team1: player1Team,
    team2: player2Team,
    p1IsWinner: winnerId === player1Id,
    p2IsWinner: winnerId === player2Id,
    hasWinner: winnerId !== null,
    isOverview: true,
    gameNumber: null,
    perGameKos: null,
  };
}

function buildPerGameView(
  game: GameSummary,
  gameStats: BattleStat[],
  player1Id: string,
  player2Id: string,
): CardView {
  const { p1Score, p2Score } = computePokemonScoreForGame(gameStats, player1Id, player2Id);
  const gameWinner = game.winner_id;
  const { p1TotalKos, p2TotalKos } = computeQuickStatsForGame(gameStats, player1Id, player2Id);
  return {
    score1: p1Score,
    score2: p2Score,
    team1: aggregateTeamFromGame(gameStats, player1Id, gameWinner === player1Id),
    team2: aggregateTeamFromGame(gameStats, player2Id, gameWinner === player2Id),
    p1IsWinner: gameWinner === player1Id,
    p2IsWinner: gameWinner === player2Id,
    hasWinner: gameWinner !== null,
    isOverview: false,
    gameNumber: game.game_number,
    perGameKos: { p1: p1TotalKos, p2: p2TotalKos },
  };
}

// ─── Main Component ─────────────────────────────────────────────────

export default function MatchHighlightCard({
  player1Name,
  player2Name,
  player1AvatarUrl,
  player2AvatarUrl,
  player1Standing,
  player2Standing,
  player1Streaks,
  player2Streaks,
  winnerId,
  player1Id,
  player2Id,
  score1,
  score2,
  status,
  datePlayed,
  tournamentName,
  seasonName,
  formatName: _formatName,
  roundName,
  player1Team,
  player2Team,
  analysis,
  quickStats,
  bestOf,
  games,
  battleStatsByGame,
  matchGamesWon,
  isEpb,
  idPrefix = 'match',
  forCapture = false,
  aiLang,
}: MatchHighlightCardProps) {
  const t = useT(matchMessages);
  const panelId = `${idPrefix}-highlight-panel`;
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const showTabs = bestOf > 1 && games.length >= 1;

  const resolvedTab = ((): TabKey => {
    if (activeTab === 'overview') return 'overview';
    const gameId = activeTab.slice('game-'.length);
    return games.some((g) => g.id === gameId) ? activeTab : 'overview';
  })();

  if (resolvedTab !== activeTab) {
    setActiveTab(resolvedTab);
  }

  const view = useMemo((): CardView => {
    if (resolvedTab === 'overview') {
      return buildOverviewView(
        bestOf,
        score1,
        score2,
        matchGamesWon,
        player1Team,
        player2Team,
        winnerId,
        player1Id,
        player2Id,
      );
    }
    const gameId = resolvedTab.slice('game-'.length);
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      return buildOverviewView(
        bestOf,
        score1,
        score2,
        matchGamesWon,
        player1Team,
        player2Team,
        winnerId,
        player1Id,
        player2Id,
      );
    }
    const gameStats = battleStatsByGame[gameId] ?? [];
    return buildPerGameView(game, gameStats, player1Id, player2Id);
  }, [
    resolvedTab,
    bestOf,
    score1,
    score2,
    matchGamesWon,
    player1Team,
    player2Team,
    winnerId,
    player1Id,
    player2Id,
    games,
    battleStatsByGame,
  ]);

  const hasGames =
    games.length > 0 || view.score1 > 0 || view.score2 > 0;
  const showTeams =
    hasGames && (view.team1.length > 0 || view.team2.length > 0);
  const isFinished = status === 'completed' || status === 'pending_confirmation';

  const activeTabId =
    resolvedTab === 'overview'
      ? `${idPrefix}-tab-overview`
      : `${idPrefix}-tab-${resolvedTab}`;

  return (
    <Card id={`${idPrefix}-highlight-card`} variant="elevated" padding="none" className="relative overflow-hidden">
      <MetadataStrip
        tournamentName={tournamentName}
        seasonName={seasonName}
        roundName={roundName}
        datePlayed={datePlayed}
        status={status}
      />

      {showTabs && (
        <MatchViewTabs
          activeTab={resolvedTab}
          onTabChange={setActiveTab}
          games={games}
          idPrefix={idPrefix}
          panelId={panelId}
        />
      )}

      <div
        id={panelId}
        className="p-3 sm:p-5 space-y-4"
        role="tabpanel"
        aria-labelledby={activeTabId}
      >
        <div className="flex items-start justify-center gap-1 sm:gap-6">
          <PlayerColumn
            name={player1Name}
            avatarUrl={player1AvatarUrl}
            playerId={player1Id}
            isWinner={view.p1IsWinner}
            isLoser={view.hasWinner && !view.p1IsWinner}
            standing={player1Standing}
            streaks={player1Streaks}
            team={view.team1}
            showTeam={showTeams}
            hideTurns={isEpb}
          />

          <div className="flex flex-col items-center justify-center shrink-0 pt-4 sm:pt-6">
            {hasGames ? (
              <MatchScoreDisplay score1={view.score1} score2={view.score2} animate={!forCapture} />
            ) : (
              <span className="text-xl font-heading font-bold text-poke-text-muted">{t('shared.vs')}</span>
            )}
          </div>

          <PlayerColumn
            name={player2Name}
            avatarUrl={player2AvatarUrl}
            playerId={player2Id}
            isWinner={view.p2IsWinner}
            isLoser={view.hasWinner && !view.p2IsWinner}
            standing={player2Standing}
            streaks={player2Streaks}
            team={view.team2}
            showTeam={showTeams}
            hideTurns={isEpb}
          />
        </div>

        {hasGames && isFinished && !showTeams && (
          <p className="text-center text-xs text-poke-text-muted">
            {t('card.noTeamData')}
          </p>
        )}

        {view.isOverview && isFinished && (player1Team.length > 0 || analysis) && (
          <MatchNarrative
            analysis={analysis}
            player1Team={player1Team}
            player2Team={player2Team}
            player1Name={player1Name}
            player2Name={player2Name}
            quickStats={quickStats}
            aiLang={aiLang}
          />
        )}

        {view.isOverview &&
          quickStats &&
          hasGames &&
          isFinished &&
          quickStats.p1TotalKos + quickStats.p2TotalKos > 0 && (
            <QuickStatsBar
              quickStats={quickStats}
              player1Name={player1Name}
              player2Name={player2Name}
            />
          )}

        {!view.isOverview &&
          view.gameNumber !== null &&
          view.perGameKos &&
          hasGames && (
            <PerGameStatsBar
              gameNumber={view.gameNumber}
              player1Name={player1Name}
              player2Name={player2Name}
              perGameKos={view.perGameKos}
            />
          )}
      </div>
    </Card>
  );
}
