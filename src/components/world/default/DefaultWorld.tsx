import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import WorldShell from '@/components/world/WorldShell';
import WorldNav from '@/components/world/WorldNav';
import SectionShell from '@/components/world/SectionShell';
import { PANEL, PANEL_INSET, PANEL_NOTICE } from '@/components/world/panel';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import GymTypedName from '@/components/shared/GymTypedName';
import CoreLigaParticipants from '@/components/league/CoreLigaParticipants';
import TournamentReportCard from '@/components/tournament/TournamentReportCard';
import ScopedInsightsView from '@/components/insights/ScopedInsightsView';
import type { TournamentReport } from '@/types/tournament-report';
import type { CoreTriple } from '@/types/season';
import type { SeasonWorld, WorldSection } from '@/lib/worlds/types';
import type { LeagueFixture, LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { KillRankingRow, PokemonUsageRow } from '@/types/game';
import { getFormatter, getLocale } from '@/i18n/server';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { worldMessages } from '@/i18n/messages/world';
import { worldClientMessages } from '@/i18n/messages/world/client';

/** The report writer's name (a character, the same in every language). */
const KALE_NAME = 'Kale Cabbage';

const statusVariant: Record<string, 'green' | 'accent' | 'gray'> = {
  upcoming: 'accent',
  active: 'green',
  completed: 'gray',
};

interface StageGroup {
  stage: {
    id: string;
    name: string;
    bracket_type: string;
    best_of_default: number;
    participant_count: number;
    status: string;
    advancement_rule: { count: number; per_group?: boolean } | null;
  };
  groups: {
    name: string;
    members: { player_id: string; player_name: string; seed: number }[];
  }[];
}

interface DefaultWorldProps {
  world: SeasonWorld;
  league: {
    id: string;
    name: string;
    format_type: string;
    ruleset_name?: string | null;
    participant_count: number;
    status: string;
    start_date?: string | null;
    end_date?: string | null;
    description?: string | null;
  };
  stageGroups: StageGroup[];
  reports: TournamentReport[];
  phaseNames: Record<string, string>;
  rulesetContent?: ReactNode;
  usageRows: PokemonUsageRow[];
  killRanking: KillRankingRow[];
  isDoubles: boolean;
  standings: LeagueStanding[];
  fixtures: LeagueFixture[];
  typeCoreParticipants?: { id: string; name: string; coreTypes: CoreTriple | null }[];
  gymTypeMap: Map<string, string | null>;
  draftLinks: { href: string; label: string; variant: 'secondary' | 'ghost' }[];
}

/**
 * The default season world: the plaza-lite scrollworld every non-evoliga
 * league format gets. Same shell grammar as the EvoLiga arena (anchor nav,
 * section rhythm, reveal choreography) with the league's existing content
 * laid out as anchored sections instead of tabs. Server component; the
 * interactive islands (insights, report cards) mount inside.
 * Its words follow the viewer (i18n D11): the locale is read once here.
 */
export default async function DefaultWorld({
  world,
  league,
  stageGroups,
  reports,
  phaseNames,
  rulesetContent,
  usageRows,
  killRanking,
  isDoubles,
  standings,
  fixtures,
  typeCoreParticipants,
  gymTypeMap,
  draftLinks,
}: DefaultWorldProps) {
  const locale = await getLocale();
  const formatter = await getFormatter({ locale });
  const t = createTranslator(worldMessages, locale);
  const nav = createTranslator(worldClientMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const heading = (id: string, fallback: string) => nav.dynamic(`nav.worlds.default.${id}`, undefined, fallback);
  const hasStats = usageRows.length > 0 || killRanking.length > 0;
  const hasRules = rulesetContent != null || Boolean(league.description);

  const sections: WorldSection[] = world.sections.filter((section) => {
    if (section.id === 'stats') return hasStats;
    if (section.id === 'rules') return hasRules;
    return true;
  });

  const upcomingFixtures = fixtures
    .filter((f) => f.match.status !== 'completed')
    .slice(0, 5);

  const reportsByPhase = new Map<string, TournamentReport[]>();
  for (const report of reports) {
    const list = reportsByPhase.get(report.tournament_id) ?? [];
    list.push(report);
    reportsByPhase.set(report.tournament_id, list);
  }

  return (
    <WorldShell world={world}>
      <WorldNav sections={sections} label={nav('nav.sections')} brand={league.name} variant="lite" />

      <SectionShell id="pulse" heading={heading('pulse', 'Pulse')}>
        <div className="space-y-4">
          <div className={`${PANEL} p-5`}>
            <div className="flex flex-wrap gap-2 items-center text-sm text-arena-ink-secondary">
              <span>{enumLabel(enums, 'formatType', league.format_type)}</span>
              {league.ruleset_name && <span>{league.ruleset_name}</span>}
              <span>{common('units.players', { count: league.participant_count })}</span>
              <Badge variant={statusVariant[league.status] ?? 'gray'}>
                {enumLabel(enums, 'seasonStatus', league.status)}
              </Badge>
            </div>
            {(league.start_date || league.end_date) && (
              <p className="mt-2 text-xs text-arena-ink-secondary">
                {league.start_date && t('defaultWorld.start', { date: formatter.calendarDate(league.start_date) })}
                {league.start_date && league.end_date && ' — '}
                {league.end_date && t('defaultWorld.end', { date: formatter.calendarDate(league.end_date) })}
              </p>
            )}
            {draftLinks.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {draftLinks.map((link) => (
                  <Link key={link.href} href={link.href} className={getButtonClasses(link.variant, 'sm')}>
                    {link.label}
                  </Link>
                ))}
                <Link
                  href={`/insights?scope=league&id=${league.id}&tab=usage`}
                  className={getButtonClasses('ghost', 'sm')}
                >
                  {t('defaultWorld.leagueInsights')}
                </Link>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${PANEL} p-5`}>
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide text-arena-ink-secondary mb-3">
                {t('defaultWorld.standings')}
              </h3>
              {standings.length === 0 ? (
                <p className="text-sm text-arena-ink-secondary">{t('defaultWorld.noStandings')}</p>
              ) : (
                <ol className="space-y-1.5">
                  {standings.slice(0, 8).map((row, index) => (
                    <li key={row.player_id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-arena-ink-secondary font-heading w-6">
                        #{index + 1}
                      </span>
                      <span className="flex-1 truncate text-arena-ink font-medium">
                        <GymTypedName name={row.player_name} gymType={row.gym_type} />
                      </span>
                      <span className="shrink-0 text-xs text-arena-ink-secondary">
                        {t('defaultWorld.winLoss', { wins: row.wins, losses: row.losses })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className={`${PANEL} p-5`}>
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide text-arena-ink-secondary mb-3">
                {t('defaultWorld.nextUp')}
              </h3>
              {upcomingFixtures.length === 0 ? (
                <p className="text-sm text-arena-ink-secondary">{t('defaultWorld.noScheduled')}</p>
              ) : (
                <ul className="divide-y divide-arena-border">
                  {upcomingFixtures.map((fixture) => (
                    <li key={fixture.match.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-arena-ink">
                        {t('pairing', { home: fixture.match.player_1_name, away: fixture.match.player_2_name })}
                        <span className="ml-2 text-xs text-arena-ink-secondary">
                          {fixture.stageName}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-arena-ink-secondary">
                        {enumLabel(enums, 'matchStatus', fixture.match.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {typeCoreParticipants && typeCoreParticipants.length > 0 && (
            <CoreLigaParticipants participants={typeCoreParticipants} />
          )}
        </div>
      </SectionShell>

      <SectionShell id="phases" heading={heading('phases', 'Phases')}>
        {stageGroups.length === 0 ? (
          <p className={PANEL_NOTICE}>{t('defaultWorld.noPhases')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {stageGroups.map(({ stage, groups }, index) => (
              <Link key={stage.id} href={`/tournaments/${stage.id}`} className="block">
                <Card padding="md" hover className="h-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-heading font-semibold text-arena-ink">
                      {index + 1}. {stage.name}
                    </span>
                    <Badge variant={statusVariant[stage.status] ?? 'gray'}>
                      {enumLabel(enums, 'tournamentStatus', stage.status)}
                    </Badge>
                  </div>
                  <div className="flex gap-2 mt-1 text-xs text-arena-ink-secondary">
                    <span>{enumLabel(enums, 'bracketType', stage.bracket_type)}</span>
                    <span>{common('bestOf', { count: stage.best_of_default })}</span>
                    <span>{common('units.players', { count: stage.participant_count })}</span>
                  </div>
                  {stage.advancement_rule && (
                    <p className="text-xs text-arena-accent mt-2">
                      {stage.advancement_rule.per_group
                        ? t('defaultWorld.advancesPerGroup', { count: stage.advancement_rule.count })
                        : t('defaultWorld.advancesOverall', { count: stage.advancement_rule.count })}
                    </p>
                  )}
                  {groups.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {groups.map((group) => (
                        <div key={group.name} className={`${PANEL_INSET} p-2`}>
                          <h4 className="text-xs font-heading font-medium text-arena-ink mb-1">
                            {group.name}
                          </h4>
                          {group.members.length === 0 ? (
                            <p className="text-xs text-arena-ink-secondary">{t('defaultWorld.noMembers')}</p>
                          ) : (
                            <ul className="text-xs text-arena-ink-secondary space-y-0.5">
                              {group.members.map((m) => (
                                <li key={m.player_id}>
                                  {m.seed > 0 && (
                                    <span className="text-arena-ink-secondary mr-1">#{m.seed}</span>
                                  )}
                                  <GymTypedName
                                    name={m.player_name}
                                    gymType={gymTypeMap.get(m.player_id) ?? null}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </SectionShell>

      <SectionShell id="reports" heading={heading('reports', 'Reports')}>
        {reports.length === 0 ? (
          <div className={`${PANEL_NOTICE} flex flex-col items-center gap-3 text-center`}>
            <Image
              src="/characters/Kale-Cabbage.jpg"
              alt={KALE_NAME}
              width={64}
              height={64}
              className="rounded-full object-cover opacity-60"
              unoptimized
            />
            <p>{t('defaultWorld.noReports', { name: KALE_NAME })}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {[...reportsByPhase.entries()].map(([phaseId, phaseReports]) => (
              <div key={phaseId}>
                <h3 className="text-sm font-heading font-semibold text-arena-ink mb-2">
                  {phaseNames[phaseId] ?? t('defaultWorld.unknownPhase')}
                </h3>
                <div className="space-y-2">
                  {phaseReports
                    .sort(
                      (a, b) =>
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    )
                    .map((report) => (
                      <TournamentReportCard
                        key={report.id}
                        report={report}
                        tournamentId={report.tournament_id}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionShell>

      {hasStats && (
        <SectionShell id="stats" heading={heading('stats', 'Stats')}>
          <ScopedInsightsView
            usageRows={usageRows}
            isDoubles={isDoubles}
            killRanking={killRanking}
            aggregateScopeType="league"
            aggregateScopeId={league.id}
          />
        </SectionShell>
      )}

      {hasRules && (
        <SectionShell id="rules" heading={heading('rules', 'Rules')}>
          <div className="space-y-4 max-w-3xl">
            {league.description && (
              <p className="text-sm text-arena-ink-secondary whitespace-pre-wrap leading-relaxed">
                {league.description}
              </p>
            )}
            {rulesetContent}
          </div>
        </SectionShell>
      )}
    </WorldShell>
  );
}
