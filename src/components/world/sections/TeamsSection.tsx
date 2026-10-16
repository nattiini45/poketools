import Link from 'next/link';
import SectionShell from '@/components/world/SectionShell';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { PANEL, PANEL_HOVER, PANEL_NOTICE, FOCUS_RING } from '@/components/world/panel';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { createTranslator } from '@/i18n/core';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { worldMessages } from '@/i18n/messages/world';
import { compareTrackersForDisplay } from '@/lib/draft-ui/progress-display';
import { progressChipLabels, type ProgressChipLabels } from '@/lib/draft-ui/progress-labels';
import { progressSourcesOf } from '@/lib/draft/progress-sources';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { ThemeRouteData, ThemeSectionCopy, WorldLocaleProps } from './types';

/**
 * #teams — one card per trainer: name as a `?team=` focus link, gym type in
 * its own identity slot, the ace with its sprite, and — where the league
 * actually runs evolution tracking — the drafted lines with stage/KO summaries
 * and evolution points.
 *
 * The EPB affordances follow capability, not theme identity: a league with no
 * trackers renders trainers and aces only, never an empty points table. Gym
 * type sits beside the name as a `TypeBadge` rather than tinting the card, so
 * type colour never competes with the arena palette for the card's meaning.
 */
export default function TeamsSection({
  data,
  copy,
  locale = 'en',
  dataLocale = locale,
}: {
  data: ThemeRouteData;
  copy: ThemeSectionCopy;
} & WorldLocaleProps) {
  const t = createTranslator(worldMessages, locale);
  const chipLabels = progressChipLabels(createTranslator(draftSharedMessages, locale));
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const { participants, trackers, entries, teamAces } = data;
  const hasEvolution = trackers.length > 0;

  const trackersByPlayer = new Map<string, EvolutionTracker[]>();
  for (const tracker of trackers) {
    const list = trackersByPlayer.get(tracker.player_id) ?? [];
    list.push(tracker);
    trackersByPlayer.set(tracker.player_id, list);
  }

  const entryByBase = new Map<string, PointBuyListEntry>();
  for (const entry of entries) {
    if (!entryByBase.has(entry.base_pokemon)) entryByBase.set(entry.base_pokemon, entry);
  }

  const pointsByPlayer = new Map<string, number>();
  for (const tracker of trackers) {
    pointsByPlayer.set(
      tracker.player_id,
      (pointsByPlayer.get(tracker.player_id) ?? 0) + tracker.evolution_points_awarded,
    );
  }

  /**
   * Most evolved line, ties broken by self-earned KOs and then total progress
   * (`compareTrackersForDisplay`, draft-frontend §8.3), falling back to the
   * base species. Leagues without evolution tracking use the contract's
   * team-derived ace instead, so a non-EPB league still names — and sprites —
   * an ace rather than rendering a dash for every trainer.
   */
  const aceOf = (playerId: string): string | null => {
    const owned = trackersByPlayer.get(playerId) ?? [];
    if (owned.length === 0) return teamAces[playerId] ?? null;
    const best = [...owned].sort(compareTrackersForDisplay)[0];
    return best.current_form ?? best.base_pokemon;
  };

  return (
    <SectionShell id="teams" heading={t('teams.heading')}>
      <p className="mb-4 max-w-4xl text-sm text-arena-ink-secondary">{copy.teamsIntro}</p>
      {participants.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('teams.noTrainers')}</p>
      ) : (
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {participants.map((player) => {
            const ace = aceOf(player.id);
            const lines = hasEvolution ? (trackersByPlayer.get(player.id) ?? []) : [];
            const points = pointsByPlayer.get(player.id) ?? 0;
            return (
              <article
                key={player.id}
                data-team-gym={player.id}
                className={`${PANEL} ${PANEL_HOVER} p-4`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-heading text-sm font-semibold">
                      <Link
                        href={`?team=${player.id}`}
                        className={`text-arena-ink underline-offset-2 hover:underline ${FOCUS_RING}`}
                      >
                        {player.name}
                      </Link>
                    </h3>
                    {player.gym_type && <TypeBadge type={player.gym_type} className="mt-1.5" />}
                  </div>
                  {hasEvolution && (
                    <span className="shrink-0 text-xs text-arena-ink-secondary">
                      {t.rich('teams.evoPoints', {
                        b: (chunks) => <span className="font-semibold text-arena-ink">{chunks}</span>,
                        points,
                      })}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {ace ? (
                    <>
                      <PokemonSprite name={ace} size={32} />
                      <span className="min-w-0 text-sm">
                        <span className="block text-xs uppercase tracking-wide text-arena-ink-secondary">
                          {t('teams.ace')}
                        </span>
                        <span className="block font-heading font-bold text-arena-accent-strong">
                          {species(ace)}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-arena-ink-secondary">
                      <span className="block text-xs uppercase tracking-wide">{t('teams.ace')}</span>
                      <span className="block font-heading font-bold">—</span>
                    </span>
                  )}
                </div>

                {hasEvolution &&
                  (lines.length === 0 ? (
                    <p className="mt-3 text-xs text-arena-ink-secondary">{t('teams.noLines')}</p>
                  ) : (
                    <ul className="mt-3 space-y-1">
                      {lines.map((tracker) => {
                        const entry = entryByBase.get(tracker.base_pokemon) ?? null;
                        const body = (
                          <LineSummary
                            form={species(tracker.current_form)}
                            stage={t('teams.stage', { stage: tracker.current_stage })}
                            tracker={tracker}
                            chipLabels={chipLabels}
                          />
                        );
                        return (
                          <li key={tracker.id}>
                            {entry ? (
                              <Link
                                href={`?mon=${entry.id}`}
                                data-roster-line={entry.id}
                                className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors duration-150 hover:bg-arena-elevated motion-reduce:transition-none ${FOCUS_RING}`}
                              >
                                <PokemonSprite name={tracker.current_form} size={28} />
                                {body}
                              </Link>
                            ) : (
                              <div className="flex items-center gap-2 px-1.5 py-1 text-sm">
                                <PokemonSprite name={tracker.current_form} size={28} />
                                {body}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </article>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

/**
 * One drafted line: its form, stage and progress by source. Only the
 * self-earned kills are labelled KOs; transferred progress and the three
 * tokens are their own chips (draft-frontend §8.3 — no merged `total_kos`).
 */
function LineSummary({
  form,
  stage,
  tracker,
  chipLabels,
}: {
  form: string;
  stage: string;
  tracker: EvolutionTracker;
  chipLabels: ProgressChipLabels;
}) {
  return (
    <span className="min-w-0">
      <span className="text-arena-ink">{form}</span>
      <span className="ml-2 text-xs text-arena-ink-secondary">
        {stage} ·{' '}
        <ProgressSourceChips sources={progressSourcesOf(tracker)} compact labels={chipLabels} />
      </span>
    </span>
  );
}
