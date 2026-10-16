import SectionShell from '@/components/world/SectionShell';
import { PANEL_NOTICE } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { TournamentWithDetails } from '@/types/tournament';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import type { EvoligaLocaleProps } from './types';

interface ScheduleSectionProps extends EvoligaLocaleProps {
  stages: TournamentWithDetails[];
  fixtures: LeagueFixture[];
  standings: Standing[];
}

/**
 * #schedule — fixtures grouped by stage/matchday plus the live season-wide
 * standings table (format-aware tiebreakers via the standings query). Server
 * component rendering page-loaded data, in the viewer's language.
 */
export default function ScheduleSection({ stages, fixtures, standings, locale }: ScheduleSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  return (
    <SectionShell id="schedule" heading={t('schedule.heading')}>
      {stages.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('schedule.noStages')}</p>
      ) : (
        <div className="space-y-6">
          {stages.map((stage) => (
            <div key={stage.id}>
              <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-arena-ink-secondary">
                {stage.name}
              </h3>
              <FixtureList fixtures={fixtures.filter((f) => f.stageId === stage.id)} locale={locale} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-arena-ink-secondary">
          {t('schedule.currentTable')}
        </h3>
        <StandingsTable standings={standings} locale={locale} />
      </div>
    </SectionShell>
  );
}
