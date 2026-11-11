'use client';

import { useState, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import RoundRobinTable from '@/components/bracket/RoundRobinTable';
import GroupStandingsTable from '@/components/bracket/GroupStandingsTable';
import DecisionMatchPanel from '@/components/evolution/DecisionMatchPanel';
import ScopedInsightsView from '@/components/insights/ScopedInsightsView';
import TournamentReportTab from './TournamentReportTab';
import { computeStandingsForFormat } from '@/lib/tournament/standings';
import { roundRobinMatchPoints } from '@/lib/tournament/standings-rules';
import type { MatchRecord } from '@/lib/tournament/types';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';
import type { PublicMatch } from '@/lib/match/public-match';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { TournamentReport } from '@/types/tournament-report';
import type { KillRankingRow, PokemonUsageRow } from '@/types/game';
import type { TiebreakerStep } from '@/types/format-rules';
import type { KitStandingsData } from '@/lib/format-engine/context';
import type { TournamentPageTab } from '@/lib/tournament/page-view';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import { cn } from '@/lib/utils/cn';
import { useLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { contentMessages } from '@/i18n/messages/content';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

type BracketType = 'round_robin' | 'swiss' | 'single_elim' | 'double_elim';

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

interface TournamentTabsUnifiedProps {
  bracketType: BracketType;
  participants: Participant[];
  rounds: Round[];
  matches: PublicMatch[];
  matchRecords: MatchRecord[];
  matchesByRound: Record<string, PublicMatch[]>;
  battleStats: TournamentBattleStat[];
  tournamentId: string;
  totalRounds: number;
  reports: TournamentReport[];
  /** Pre-rendered bracket component for single_elim / double_elim */
  bracketContent?: ReactNode;
  /** Pre-rendered standings for swiss */
  standingsContent?: ReactNode;
  /** Pre-rendered ruleset content */
  rulesetContent?: ReactNode;
  /** Pre-computed Pokémon usage rows for the inline Stats tab */
  usageRows: PokemonUsageRow[];
  /** Pre-computed kill ranking for the inline Stats tab */
  killRanking: KillRankingRow[];
  /** Whether the tournament uses the doubles format (affects usage columns) */
  isDoubles: boolean;
  /** Season format (drives standings tiebreaker dispatch); null for standalone tournaments */
  seasonFormatType?: string | null;
  /** Parent season ID (for admin links) */
  seasonId?: string | null;
  /** Per-player evolution points (evolution_point_buy seasons only) */
  evolutionPoints?: Record<string, number>;
  /** The season's stored tiebreaker order (evolution_point_buy seasons only); an unusable one falls back to the pack's */
  tiebreakerOrder?: readonly TiebreakerStep[];
  /** A stage of a kit league: the kit's standings data of this stage (`kitForPhase`), no seed. */
  kit?: KitStandingsData;
  /** The panel to show: the page's `?tab=` (the link-tab strip above is the page's). */
  activeTab: TournamentPageTab;
}

const ROUND_TONE: Record<Round['status'], SkewChipTone> = { active: 'live', pending: 'accent', completed: 'neutral' };

export default function TournamentTabsUnified({
  bracketType,
  participants,
  rounds,
  matches,
  matchRecords,
  matchesByRound,
  battleStats,
  tournamentId,
  totalRounds,
  reports,
  bracketContent,
  standingsContent,
  rulesetContent,
  usageRows,
  killRanking,
  isDoubles,
  seasonFormatType = null,
  seasonId = null,
  evolutionPoints,
  tiebreakerOrder,
  kit,
  activeTab,
}: TournamentTabsUnifiedProps) {
  const { data: session } = useSession();
  const sessionIsAdmin = session?.player?.isAdmin ?? false;
  const locale = useLocale();
  const t = useT(tournamentsMessages);
  const tContent = useT(contentMessages);
  const tEnum = useT(enumMessages);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  // Default round filter to the active round, not the latest generated
  const activeRoundNumber = useMemo(() => {
    const active = rounds.find((r) => r.status === 'active');
    return active ? active.round_number : totalRounds;
  }, [rounds, totalRounds]);

  const [selectedRound, setSelectedRound] = useState<number>(activeRoundNumber);

  const maxRound = selectedRound < totalRounds ? selectedRound : undefined;

  // ── Lookup maps ─────────────────────────────────────────────────
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

  // ── Round Robin specific computations ──────────────────────────
  const gamesByMatch = useMemo(() => {
    if (bracketType !== 'round_robin') return {};
    const map: Record<string, string[]> = {};
    for (const match of matches) {
      if (match.status !== 'completed') continue;
      map[match.id] = match.games.map((g) => g.winner_id ?? '');
    }
    return map;
  }, [matches, bracketType]);

  const rrStandings = useMemo(() => {
    if (bracketType !== 'round_robin') return [];
    return computeStandingsForFormat(seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, {
      // 3 / 0 for every league type except Evolution Point Buy, which scores the format pack's match points.
      ...roundRobinMatchPoints(seasonFormatType),
      battleStats,
      gamesByMatch,
      maxRound,
    }, participantGymTypes, { evolutionPoints, tiebreakerOrder, kit });
  }, [bracketType, seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, battleStats, gamesByMatch, maxRound, participantGymTypes, evolutionPoints, tiebreakerOrder, kit]);

  const epbTiedPlayers = useMemo(() => {
    if (seasonFormatType !== 'evolution_point_buy') return [];
    return rrStandings.filter(
      (s): s is EvolutionStanding =>
        'needs_decision_match' in s && (s as EvolutionStanding).needs_decision_match,
    );
  }, [rrStandings, seasonFormatType]);

  const filteredMatches = useMemo(
    () => (maxRound ? matches.filter((m) => {
      const round = rounds.find((r) => r.id === m.round_id);
      return round ? round.round_number <= maxRound : false;
    }) : matches),
    [matches, rounds, maxRound]
  );

  // ── Report lookup for Rounds tab generate buttons ───────────────
  const reportsByRound = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of reports) {
      const set = map.get(r.round_id) ?? new Set();
      set.add(r.report_type);
      map.set(r.round_id, set);
    }
    return map;
  }, [reports]);

  async function handleGenerateReport(roundId: string, reportType: 'round_recap' | 'round_forecast') {
    const key = `${roundId}-${reportType}`;
    setGeneratingFor(key);
    try {
      const res = await fetch('/api/ai/tournament-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament_id: tournamentId, round_id: roundId, report_type: reportType }),
      });
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes('"status":"done"') || text.includes('"status":"failed"')) break;
        }
      }
      window.location.reload();
    } catch {
      setGeneratingFor(null);
    }
  }

  const show = (key: TournamentPageTab) => activeTab === key;

  // The round filter recomputes the table and the result matrix; the other panels do not read it.
  const showRoundFilter = bracketType === 'round_robin' && totalRounds > 1 && (activeTab === 'standings' || activeTab === 'matrix');

  return (
    <div className="space-y-4">
      {/* Round filter — own row below tabs on mobile */}
      {showRoundFilter && (
        <div className="flex items-center gap-2">
          <label htmlFor="tournament-round-filter" className="text-body text-fg-muted">{t('roundFilter.label')}</label>
          <select
            id="tournament-round-filter"
            value={selectedRound}
            onChange={(e) => setSelectedRound(Number(e.target.value))}
            className="min-h-9 rounded-poke-sm border border-hairline-strong bg-surface px-2 py-1 text-body text-fg max-sm:min-h-11"
          >
            {Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => (
              <option key={r} value={r}>
                {r === activeRoundNumber
                  ? t('roundFilter.active', { round: tContent('round.round', { n: r }) })
                  : tContent('round.round', { n: r })}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('bracket') && bracketContent}

      {show('standings') && standingsContent}

      {/* Round robin table */}
      {show('standings') && bracketType === 'round_robin' && (
        <div className="space-y-4">
          {epbTiedPlayers.length > 0 && (
            <DecisionMatchPanel
              tiedPlayers={epbTiedPlayers}
              tournamentId={tournamentId}
              seasonId={seasonId ?? undefined}
              isAdmin={sessionIsAdmin}
            />
          )}
          <GroupStandingsTable
            standings={rrStandings}
            showEvolutionColumns={seasonFormatType === 'evolution_point_buy'}
          />
        </div>
      )}

      {/* Inline insights tables (usage / kills / moves / h2h) */}
      {show('stats') && (
        <ScopedInsightsView
          usageRows={usageRows}
          isDoubles={isDoubles}
          killRanking={killRanking}
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          tournamentId={tournamentId}
          aggregateScopeType="tournament"
          aggregateScopeId={tournamentId}
        />
      )}

      {/* Result matrix — round robin */}
      {show('matrix') && (
        <RoundRobinTable
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          matches={filteredMatches}
        />
      )}

      {/* Rounds tab — all formats */}
      {show('rounds') && (
        <div className="space-y-3">
          {rounds
            .slice()
            .sort((a, b) => {
              const priority: Record<string, number> = { active: 0, pending: 1, completed: 2 };
              const sp = (priority[a.status] ?? 1) - (priority[b.status] ?? 1);
              return sp !== 0 ? sp : a.round_number - b.round_number;
            })
            .map((round) => {
              const roundMatches = matchesByRound[round.id] ?? [];
              const roundReportTypes = reportsByRound.get(round.id) ?? new Set();
              const hasRecap = roundReportTypes.has('round_recap');
              const hasForecast = roundReportTypes.has('round_forecast');
              return (
                <details
                  key={round.id}
                  open={round.status === 'active'}
                  className="overflow-hidden rounded-poke-lg border border-hairline bg-surface"
                >
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 py-3 text-body transition-colors hover:bg-elevated">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-heading text-title text-fg">{translateEngineLabel('round', round.name, locale)}</span>
                      <SkewChip tone={ROUND_TONE[round.status]}>{enumLabel(tEnum, 'roundStatus', round.status)}</SkewChip>
                      {/* Admin generate buttons (hidden when Kale Cabbage disabled) */}
                      {ENABLE_KALE_CABBAGE && sessionIsAdmin && (
                        <>
                          {!hasForecast && (
                            <button
                              onClick={(e) => { e.preventDefault(); handleGenerateReport(round.id, 'round_forecast'); }}
                              disabled={generatingFor === `${round.id}-round_forecast`}
                              className="rounded-[3px] border border-hairline-strong px-2 py-0.5 text-caption text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-50"
                            >
                              {generatingFor === `${round.id}-round_forecast` ? '...' : t('rounds.generateForecast')}
                            </button>
                          )}
                          {!hasRecap && round.status === 'completed' && (
                            <button
                              onClick={(e) => { e.preventDefault(); handleGenerateReport(round.id, 'round_recap'); }}
                              disabled={generatingFor === `${round.id}-round_recap`}
                              className="rounded-[3px] border border-hairline-strong px-2 py-0.5 text-caption text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-50"
                            >
                              {generatingFor === `${round.id}-round_recap` ? '...' : t('rounds.generateRecap')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </summary>
                  <div className="border-t border-hairline px-4 py-3">
                    {roundMatches.length === 0 ? (
                      <p className="text-body text-fg-muted">{t('rounds.noMatches')}</p>
                    ) : (
                      <div className="grid gap-2 lg:grid-cols-2">
                        {roundMatches.map((m) => (
                          <Link
                            key={m.id}
                            href={`/tournaments/${tournamentId}/matches/${m.id}`}
                            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-poke-md border border-hairline px-3 py-2 text-body transition-colors hover:bg-elevated focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
                          >
                            <span
                              className={cn('min-w-0 truncate text-right', m.winner_id === m.player_1_id ? 'font-[650] text-fg' : m.winner_id ? 'text-fg-muted' : 'text-fg')}
                            >
                              {m.player_1_name}
                            </span>
                            <span className="font-heading text-caption text-fg-muted">{t('rounds.versus')}</span>
                            <span
                              className={cn('min-w-0 truncate', m.winner_id === m.player_2_id ? 'font-[650] text-fg' : m.winner_id ? 'text-fg-muted' : 'text-fg')}
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

      {show('ruleset') && rulesetContent && <div className="rounded-poke-lg border border-hairline bg-surface p-5">{rulesetContent}</div>}

      {show('report') && (
        <TournamentReportTab
          reports={reports}
          rounds={rounds.map((r) => ({
            id: r.id,
            name: translateEngineLabel('round', r.name, locale),
            round_number: r.round_number,
            status: r.status,
          }))}
          tournamentId={tournamentId}
        />
      )}
    </div>
  );
}
