'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import RoundRobinTable from '@/components/bracket/RoundRobinTable';
import GroupStandingsTable from '@/components/bracket/GroupStandingsTable';
import KillRankingTable from '@/components/stats/KillRankingTable';
import { computeStandings } from '@/lib/tournament/standings';
import type { MatchRecord } from '@/lib/tournament/types';
import type { PublicMatch } from '@/lib/match/public-match';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { KillRankingRow } from '@/types/game';
import { useLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { contentMessages } from '@/i18n/messages/content';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

type Tab = 'overview' | 'rankings' | 'kills' | 'rounds';

interface Round {
  id: string;
  name: string;
  round_number: number;
  status: 'pending' | 'active' | 'completed';
}

interface Participant {
  id: string;
  name: string;
  avatar_url: string | null;
  gym_type: string | null;
}

interface TournamentTabsClientProps {
  participants: Participant[];
  rounds: Round[];
  matches: PublicMatch[];
  matchRecords: MatchRecord[];
  matchesByRound: Record<string, PublicMatch[]>;
  battleStats: TournamentBattleStat[];
  tournamentId: string;
  totalRounds: number;
}

export default function TournamentTabsClient({
  participants,
  rounds,
  matches,
  matchRecords,
  matchesByRound,
  battleStats,
  tournamentId,
  totalRounds,
}: TournamentTabsClientProps) {
  const locale = useLocale();
  const t = useT(tournamentsMessages);
  const tContent = useT(contentMessages);
  const tEnum = useT(enumMessages);
  const [activeTab, setActiveTab] = useState<Tab>('rankings');
  const [selectedRound, setSelectedRound] = useState<number>(totalRounds);

  const maxRound = selectedRound < totalRounds ? selectedRound : undefined;

  // Build lookup maps
  const participantIds = useMemo(() => participants.map((p) => p.id), [participants]);
  const participantNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of participants) map[p.id] = p.name;
    return map;
  }, [participants]);
  const participantAvatars = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of participants) map[p.id] = p.avatar_url;
    return map;
  }, [participants]);
  const participantGymTypes = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const p of participants) map[p.id] = p.gym_type;
    return map;
  }, [participants]);

  // Build games-per-match lookup for games_played computation
  const gamesByMatch = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const match of matches) {
      if (match.status !== 'completed') continue;
      map[match.id] = match.games.map((g) => g.winner_id ?? '');
    }
    return map;
  }, [matches]);

  // Compute standings with round filter
  const standings = useMemo(
    () =>
      computeStandings(participantIds, participantNames, matchRecords, participantAvatars, {
        pointsPerWin: 3,
        pointsPerDraw: 0,
        battleStats,
        gamesByMatch,
        maxRound,
      }, participantGymTypes),
    [participantIds, participantNames, matchRecords, participantAvatars, battleStats, gamesByMatch, maxRound, participantGymTypes]
  );

  // Compute kill ranking from battle stats (pokemon-level)
  // times_in_team = brought to match (was_brought); participations = had active turns
  const killRanking: KillRankingRow[] = useMemo(() => {
    const filtered = maxRound
      ? battleStats.filter((bs) => bs.round_number <= maxRound)
      : battleStats;

    const pokemonMap = new Map<string, { dealt: number; koed: number; inTeam: number; brought: number }>();
    for (const stat of filtered) {
      const existing = pokemonMap.get(stat.pokemon_name) ?? { dealt: 0, koed: 0, inTeam: 0, brought: 0 };
      existing.dealt += stat.kos_dealt;
      if (stat.was_koed) existing.koed += 1;
      existing.inTeam += 1; // every battle_stats row = on the team
      if (stat.was_brought) existing.brought += 1; // switched in at least once
      pokemonMap.set(stat.pokemon_name, existing);
    }

    return Array.from(pokemonMap.entries()).map(([name, stats]) => ({
      pokemon_name: name,
      kos_dealt: stats.dealt,
      times_koed: stats.koed,
      kill_differential: stats.dealt - stats.koed,
      participations: stats.brought,
      times_in_team: stats.inTeam,
      efficiency: stats.brought > 0 ? stats.dealt / stats.brought : 0,
    }));
  }, [battleStats, maxRound]);

  // Filter matches for RR table by round
  const filteredMatches = useMemo(
    () => (maxRound ? matches.filter((m) => {
      const round = rounds.find((r) => r.id === m.round_id);
      return round ? round.round_number <= maxRound : false;
    }) : matches),
    [matches, rounds, maxRound]
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'rankings', label: t('tabs.rankings') },
    { key: 'kills', label: t('tabs.killRanking') },
    { key: 'rounds', label: t('tabs.rounds') },
    { key: 'overview', label: t('tabs.overview') },
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar + round filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 border-b border-poke-border flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-heading font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-poke-accent text-poke-accent'
                  : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Round filter — shown on rankings/kills tabs */}
        {(activeTab === 'rankings' || activeTab === 'kills' || activeTab === 'overview') && totalRounds > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-poke-text-secondary">{t('roundFilter.label')}</label>
            <select
              value={selectedRound}
              onChange={(e) => setSelectedRound(Number(e.target.value))}
              className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
            >
              {Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => (
                <option key={r} value={r}>
                  {r === totalRounds
                    ? t('roundFilter.latest', { round: tContent('round.round', { n: r }) })
                    : tContent('round.round', { n: r })}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <RoundRobinTable
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          matches={filteredMatches}
        />
      )}

      {activeTab === 'rankings' && (
        <GroupStandingsTable standings={standings} />
      )}

      {activeTab === 'kills' && (
        <KillRankingTable data={killRanking} />
      )}

      {activeTab === 'rounds' && (
        <div className="space-y-4">
          {rounds
            .slice()
            .sort((a, b) => {
              const priority: Record<string, number> = { active: 0, pending: 1, completed: 2 };
              const sp = (priority[a.status] ?? 1) - (priority[b.status] ?? 1);
              return sp !== 0 ? sp : a.round_number - b.round_number;
            })
            .map((round) => {
              const roundMatches = matchesByRound[round.id] ?? [];
              return (
                <details
                  key={round.id}
                  open={round.status === 'active'}
                  className="border border-poke-border rounded-poke-lg overflow-hidden"
                >
                  <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-medium hover:bg-poke-elevated transition-colors flex items-center justify-between">
                    <span>{translateEngineLabel('round', round.name, locale)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      round.status === 'active'
                        ? 'bg-green-500/15 text-green-400'
                        : round.status === 'completed'
                          ? 'bg-poke-text-muted/15 text-poke-text-muted'
                          : 'bg-yellow-500/15 text-yellow-400'
                    }`}>
                      {enumLabel(tEnum, 'roundStatus', round.status)}
                    </span>
                  </summary>
                  <div className="px-4 pb-3">
                    {roundMatches.length === 0 ? (
                      <p className="text-xs text-poke-text-muted">{t('rounds.noMatches')}</p>
                    ) : (
                      <div className="space-y-1">
                        {roundMatches.map((m) => (
                          <Link
                            key={m.id}
                            href={`/tournaments/${tournamentId}/matches/${m.id}`}
                            className="flex items-center gap-3 p-2 border border-poke-border rounded-poke-md hover:bg-poke-elevated transition-colors text-sm"
                          >
                            <span
                              className={
                                m.winner_id === m.player_1_id
                                  ? 'font-semibold text-poke-text-primary'
                                  : m.winner_id
                                    ? 'text-poke-text-muted'
                                    : ''
                              }
                            >
                              {m.player_1_name}
                            </span>
                            <span className="text-poke-text-muted">{t('rounds.versus')}</span>
                            <span
                              className={
                                m.winner_id === m.player_2_id
                                  ? 'font-semibold text-poke-text-primary'
                                  : m.winner_id
                                    ? 'text-poke-text-muted'
                                    : ''
                              }
                            >
                              {m.player_2_name}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
        </div>
      )}
    </div>
  );
}
