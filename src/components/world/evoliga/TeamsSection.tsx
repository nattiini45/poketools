import Link from 'next/link';
import SectionShell from '@/components/world/SectionShell';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { PANEL, PANEL_NOTICE, PANEL_HOVER, FOCUS_RING } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { progressChipLabels, type ProgressChipLabels } from '@/lib/draft-ui/progress-labels';
import { progressSourcesOf } from '@/lib/draft/progress-sources';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { EvoligaLocaleProps } from './types';

interface TeamsSectionProps extends EvoligaLocaleProps {
  participants: PublicParticipant[];
  trackers: EvolutionTracker[];
  entries: PointBuyListEntry[];
}

/**
 * #teams — the team wall: every participant with their drafted evolution
 * lines, evolution progress and evolution points. Player names open the
 * TeamOverlay via `?team=<player id>`, individual lines the LineOverlay via
 * `?mon=<line id>` — both shareable URLs, both rendered from page data.
 *
 * Each line shows its stage and its progress by source: only the self-earned
 * kills are labelled KOs, every other source is its own chip
 * (draft-frontend §8.3 — never the merged `total_kos`).
 *
 * Gym type lives in its own identity slot (the `TypeBadge` beside the name)
 * rather than tinting the whole card, so type color never competes with the
 * arena palette for the card's meaning.
 */
export default function TeamsSection({ participants, trackers, entries, locale, dataLocale = locale }: TeamsSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const chipLabels = progressChipLabels(createTranslator(draftSharedMessages, locale));
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

  const evolutionPointsByPlayer = new Map<string, number>();
  for (const tracker of trackers) {
    evolutionPointsByPlayer.set(
      tracker.player_id,
      (evolutionPointsByPlayer.get(tracker.player_id) ?? 0) + tracker.evolution_points_awarded,
    );
  }

  const summary = (tracker: EvolutionTracker) => (
    <LineSummary
      form={localizeSpecies(tracker.current_form, dataLocale)}
      stage={t('teams.stage', { stage: tracker.current_stage })}
      tracker={tracker}
      chipLabels={chipLabels}
    />
  );

  return (
    <SectionShell id="teams" heading={t('teams.heading')}>
      {participants.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('teams.noParticipants')}</p>
      ) : trackers.length === 0 ? (
        <p className={PANEL_NOTICE}>{t('teams.noDraft')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {participants.map((participant) => {
            const lines = trackersByPlayer.get(participant.id) ?? [];
            const points = evolutionPointsByPlayer.get(participant.id) ?? 0;
            return (
              <article
                key={participant.id}
                data-team-gym={participant.id}
                className={`${PANEL} ${PANEL_HOVER} p-4`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-heading text-sm font-semibold">
                      <Link
                        href={`?team=${participant.id}`}
                        className={`text-arena-ink underline-offset-2 hover:underline ${FOCUS_RING}`}
                      >
                        {participant.name}
                      </Link>
                    </h3>
                    {participant.gym_type && (
                      <TypeBadge type={participant.gym_type} className="mt-1.5" />
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-arena-ink-secondary">
                    {t.rich('teams.evolutionPoints', {
                      b: (chunks) => <span className="font-semibold text-arena-ink">{chunks}</span>,
                      points,
                    })}
                  </span>
                </div>

                {lines.length === 0 ? (
                  <p className="mt-3 text-xs text-arena-ink-secondary">{t('teams.noLines')}</p>
                ) : (
                  <ul className="mt-3 space-y-1">
                    {lines.map((tracker) => {
                      const entry = entryByBase.get(tracker.base_pokemon) ?? null;
                      const monHref = entry ? `?mon=${entry.id}` : null;
                      return (
                        <li key={tracker.id}>
                          {monHref ? (
                            <Link
                              href={monHref}
                              data-roster-line={entry?.id}
                              className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors duration-150 hover:bg-arena-elevated motion-reduce:transition-none ${FOCUS_RING}`}
                            >
                              <PokemonSprite name={tracker.current_form} size={28} />
                              {summary(tracker)}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-2 px-1.5 py-1 text-sm">
                              <PokemonSprite name={tracker.current_form} size={28} />
                              {summary(tracker)}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

/** Form, stage and progress by source (`Stage n · ` + the compact chips). */
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
