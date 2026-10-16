import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { PANEL_INSET } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { worldMessages } from '@/i18n/messages/world';
import { compareTrackersForDisplay } from '@/lib/draft-ui/progress-display';
import { progressChipLabels } from '@/lib/draft-ui/progress-labels';
import { progressSourcesOf } from '@/lib/draft/progress-sources';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { ThemeRouteData, WorldLocaleProps } from '../types';

type StandingRow = ThemeRouteData['standings'][number];

interface TeamPanelProps extends WorldLocaleProps {
  participant: PublicParticipant;
  /** League record row, or `null` when this trainer has no rated match yet. */
  standing: StandingRow | null;
  /** 1-based table position, or `null` alongside a missing standing. */
  rank: number | null;
  /** Ace species — best evolved line where tracked, else the team-derived ace. */
  ace: string | null;
  /** The trainer's drafted lines; empty on leagues without evolution tracking. */
  lines: EvolutionTracker[];
  /** Point-buy entries keyed by base Pokémon, for each line's price. */
  entryByBase: Map<string, PointBuyListEntry>;
}

export function teamPanelTitle(participant: PublicParticipant, locale: Locale = 'en'): string {
  return createTranslator(worldMessages, locale)('team.title', { name: participant.name });
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 px-3 py-1.5 ${PANEL_INSET}`}>
      <dt className="text-arena-ink-secondary">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-arena-ink">{value}</dd>
    </div>
  );
}

/**
 * Body of the `?team=<player id>` overlay for the isle route themes: a
 * trainer card with gym type, league record, ace, and — only when the league
 * actually runs evolution tracking for this trainer — the drafted lines with
 * their stage and progress by source and the evolution points. A non-EPB
 * league renders the clean card, never an empty EPB stats table.
 *
 * Only self-earned kills are labelled KOs; transferred progress and the
 * tokens are their own chips (draft-frontend §8.3), and the lines sort by
 * stage, then self-earned KOs, then total progress (`compareTrackersForDisplay`).
 *
 * Server component; pure props-in, no data fetching.
 */
export default function TeamPanel({
  participant,
  standing,
  rank,
  ace,
  lines,
  entryByBase,
  locale = 'en',
  dataLocale = locale,
}: TeamPanelProps) {
  const t = createTranslator(worldMessages, locale);
  const chipLabels = progressChipLabels(createTranslator(draftSharedMessages, locale));
  // No standing means no rated match yet — an em dash, never a fabricated 0-0-0.
  const record = standing ? `${standing.wins}–${standing.losses}–${standing.draws}` : '—';
  const points = standing ? String(standing.points) : '—';
  const rankLabel = rank === null ? '—' : String(rank);
  const evolutionPoints = lines.reduce((sum, tracker) => sum + tracker.evolution_points_awarded, 0);
  const ordered = [...lines].sort(compareTrackersForDisplay);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-base font-bold tracking-tight text-arena-ink">
            {participant.name}
          </p>
          {participant.gym_type && <TypeBadge type={participant.gym_type} className="mt-1.5" />}
        </div>
        <div className="flex flex-none items-center gap-2">
          {ace ? (
            <>
              <PokemonSprite name={ace} size={40} />
              <span className="min-w-0 text-right">
                <span className="block text-xs uppercase tracking-wide text-arena-ink-secondary">
                  {t('teams.ace')}
                </span>
                <span className="block font-heading font-bold text-arena-accent-strong">
                  {localizeSpecies(ace, dataLocale)}
                </span>
              </span>
            </>
          ) : (
            <span className="text-right">
              <span className="block text-xs uppercase tracking-wide text-arena-ink-secondary">
                {t('teams.ace')}
              </span>
              <span className="block font-heading font-bold text-arena-ink">—</span>
            </span>
          )}
        </div>
      </div>

      <dl className="space-y-1">
        <StatRow label={t('team.record')} value={record} />
        <StatRow label={t('team.points')} value={points} />
        <StatRow label={t('team.rank')} value={rankLabel} />
      </dl>

      {ordered.length > 0 && (
        <div>
          <h3 className="font-heading text-xs font-semibold uppercase tracking-wide text-arena-ink-secondary">
            {t('team.draftedLines', { points: evolutionPoints })}
          </h3>
          <ul className="mt-1.5 space-y-1">
            {ordered.map((tracker) => {
              const entry = entryByBase.get(tracker.base_pokemon) ?? null;
              return (
                <li
                  key={tracker.id}
                  className={`flex items-center gap-2 px-2 py-1 ${PANEL_INSET}`}
                >
                  <PokemonSprite name={tracker.current_form} size={24} />
                  <span className="min-w-0 flex-1 truncate text-arena-ink">
                    {localizeSpecies(tracker.current_form, dataLocale)}
                  </span>
                  <span className="flex flex-none flex-wrap items-center justify-end gap-x-1 text-right tabular-nums text-arena-ink-secondary">
                    {t('team.stage', { stage: tracker.current_stage })} ·{' '}
                    <ProgressSourceChips sources={progressSourcesOf(tracker)} compact labels={chipLabels} />
                    {entry ? ` · ${t('team.price', { price: entry.price })}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
