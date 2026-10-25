'use client';

import { useState, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import WorldNav from '@/components/world/WorldNav';
import SectionShell from '@/components/world/SectionShell';
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
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import { useLocale, useT } from '@/i18n/client';
import type { Translator } from '@/i18n/core';
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
  /** 'tabs' (legacy single-panel) or 'sections' — anchored scrollworld. */
  layout?: 'tabs' | 'sections';
}

type TournamentsT = Translator<typeof tournamentsMessages.en>;

// Tab definitions per bracket type — primary content first, Report second, Ruleset last
function getTabsForBracketType(bracketType: BracketType, hasRuleset: boolean, t: TournamentsT) {
  const base: { key: string; label: string }[] = [];
  const report = ENABLE_KALE_CABBAGE ? [{ key: 'report', label: t('tabs.report') }] : [];

  switch (bracketType) {
    case 'round_robin':
      base.push(
        { key: 'rankings', label: t('tabs.rankings') },
        ...report,
        { key: 'kills', label: t('tabs.stats') },
        { key: 'rounds', label: t('tabs.rounds') },
        { key: 'overview', label: t('tabs.overview') },
      );
      break;
    case 'swiss':
      base.push(
        { key: 'standings', label: t('tabs.standings') },
        ...report,
        { key: 'kills', label: t('tabs.stats') },
        { key: 'rounds', label: t('tabs.rounds') },
      );
      break;
    case 'single_elim':
    case 'double_elim':
      base.push(
        { key: 'bracket', label: t('tabs.bracket') },
        ...report,
        { key: 'kills', label: t('tabs.stats') },
        { key: 'rounds', label: t('tabs.rounds') },
      );
      break;
  }

  if (hasRuleset) {
    base.push({ key: 'ruleset', label: t('tabs.ruleset') });
  }

  return base;
}


/** Layout-aware wrapper: plain passthrough in tabs mode, anchored
 *  SectionShell (heading + reveal rhythm) in sections mode. */
function SectionBlock({
  sections,
  id,
  heading,
  children,
}: {
  sections: boolean;
  id: string;
  heading: string;
  children: ReactNode;
}) {
  if (!sections) return <>{children}</>;
  return (
    <SectionShell id={id} heading={heading}>
      {children}
    </SectionShell>
  );
}

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
  layout = 'tabs',
}: TournamentTabsUnifiedProps) {
  const { data: session } = useSession();
  const sessionIsAdmin = session?.player?.isAdmin ?? false;
  const locale = useLocale();
  const t = useT(tournamentsMessages);
  const tContent = useT(contentMessages);
  const tEnum = useT(enumMessages);
  const tabs = getTabsForBracketType(bracketType, !!rulesetContent, t);
  const [activeTab, setActiveTab] = useState<string>(tabs[0].key);
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
      const key = `${match.player_1_id}::${match.player_2_id}`;
      map[key] = match.games.map((g) => g.winner_id ?? '');
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
    }, participantGymTypes, { evolutionPoints, tiebreakerOrder });
  }, [bracketType, seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, battleStats, gamesByMatch, maxRound, participantGymTypes, evolutionPoints, tiebreakerOrder]);

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

  // Sections layout renders every panel stacked with anchor nav; tabs
  // layout keeps the legacy single-panel switch.
  const show = (key: string) => layout === 'sections' || activeTab === key;

  // Sections mode drops panels that have no content so the anchor nav never
  // points at a section that isn't on the page.
  const hasContent: Record<string, boolean> = {
    bracket: bracketContent != null,
    standings: standingsContent != null,
    ruleset: rulesetContent != null,
  };
  const sectionTabs = tabs.filter((tab) => hasContent[tab.key] !== false);

  // ── Round filter visibility ────────────────────────────────────
  const showRoundFilter =
    bracketType === 'round_robin' &&
    totalRounds > 1 &&
    (layout === 'sections' ||
      activeTab === 'rankings' ||
      activeTab === 'kills' ||
      activeTab === 'overview');

  return (
    <div className="space-y-4">
      {layout === 'sections' && (
        <WorldNav
          sections={sectionTabs.map((tab) => ({ id: tab.key, navLabel: tab.label }))}
          label={t('tabs.sections')}
          variant="lite"
        />
      )}
      {/* Tab bar */}
      <div className={`${layout === 'sections' ? 'hidden' : 'flex'} gap-1 border-b border-poke-border overflow-x-auto`}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Round filter — own row below tabs on mobile */}
      {showRoundFilter && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-poke-text-secondary">{t('roundFilter.label')}</label>
          <select
            value={selectedRound}
            onChange={(e) => setSelectedRound(Number(e.target.value))}
            className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
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

      {/* Tab content */}
      {/* Content: stacked anchored sections in sections mode, single panel in tabs mode */}
      {/* Bracket tab — single/double elim */}
      {show('bracket') && bracketContent && (layout === 'sections' ? <SectionShell id="bracket" heading={t('tabs.bracket')}>{bracketContent}</SectionShell> : bracketContent)}

      {/* Standings tab — swiss */}
      {show('standings') && standingsContent && (layout === 'sections' ? <SectionShell id="standings" heading={t('tabs.standings')}>{standingsContent}</SectionShell> : standingsContent)}

      {/* Rankings tab — round robin */}
      {show('rankings') && (
        <SectionBlock sections={layout === 'sections'} id="rankings" heading={t('tabs.rankings')}>
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
        </SectionBlock>
      )}

      {/* Stats tab — inline insights tables (usage / kills / moves / h2h) */}
      {show('kills') && (
        <SectionBlock sections={layout === 'sections'} id="kills" heading={t('tabs.stats')}>
        <ScopedInsightsView
          usageRows={usageRows}
          isDoubles={isDoubles}
          killRanking={killRanking}
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          tournamentId={tournamentId}
          aggregateScopeType="tournament"
          aggregateScopeId={tournamentId}
        />
        </SectionBlock>
      )}

      {/* Match overview tab — round robin */}
      {show('overview') && (
        <SectionBlock sections={layout === 'sections'} id="overview" heading={t('tabs.overview')}>
        <RoundRobinTable
          participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          matches={filteredMatches}
        />
        </SectionBlock>
      )}

      {/* Rounds tab — all formats */}
      {show('rounds') && (
        <SectionBlock sections={layout === 'sections'} id="rounds" heading={t('tabs.rounds')}>
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
              const roundReportTypes = reportsByRound.get(round.id) ?? new Set();
              const hasRecap = roundReportTypes.has('round_recap');
              const hasForecast = roundReportTypes.has('round_forecast');
              return (
                <details
                  key={round.id}
                  open={round.status === 'active'}
                  className="border border-poke-border rounded-poke-lg overflow-hidden"
                >
                  <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-medium hover:bg-poke-elevated transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
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
                      {/* Admin generate buttons (hidden when Kale Cabbage disabled) */}
                      {ENABLE_KALE_CABBAGE && sessionIsAdmin && (
                        <>
                          {!hasForecast && (
                            <button
                              onClick={(e) => { e.preventDefault(); handleGenerateReport(round.id, 'round_forecast'); }}
                              disabled={generatingFor === `${round.id}-round_forecast`}
                              className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
                            >
                              {generatingFor === `${round.id}-round_forecast` ? '...' : t('rounds.generateForecast')}
                            </button>
                          )}
                          {!hasRecap && round.status === 'completed' && (
                            <button
                              onClick={(e) => { e.preventDefault(); handleGenerateReport(round.id, 'round_recap'); }}
                              disabled={generatingFor === `${round.id}-round_recap`}
                              className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 disabled:opacity-50 transition-colors"
                            >
                              {generatingFor === `${round.id}-round_recap` ? '...' : t('rounds.generateRecap')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
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
        </SectionBlock>
      )}

      {/* Ruleset tab */}
      {show('ruleset') && rulesetContent && (
        <SectionBlock sections={layout === 'sections'} id="ruleset" heading={t('tabs.ruleset')}>
        <div className="max-w-3xl">
          {rulesetContent}
        </div>
        </SectionBlock>
      )}

      {/* Report tab — all formats */}
      {show('report') && (
        <SectionBlock sections={layout === 'sections'} id="report" heading={t('tabs.report')}>
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
        </SectionBlock>
      )}
    </div>
  );
}
