import PokemonSprite from '@/components/shared/PokemonSprite';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { commonMessages } from '@/i18n/messages/common';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { compareTrackersForDisplay, displayKills } from '@/lib/draft-ui/progress-display';
import { progressChipLabels } from '@/lib/draft-ui/progress-labels';
import { progressSourcesOf } from '@/lib/draft/progress-sources';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { Standing } from '@/lib/tournament/types';
import type { EvoligaLocaleProps } from './types';

interface TeamFocusPanelProps extends EvoligaLocaleProps {
  /** The trainer behind the focused ace. */
  participant: PublicParticipant;
  /** The participant's drafted lines. */
  lines: EvolutionTracker[];
  /** Point-buy entries keyed by base Pokémon, for price and line shape. */
  entryByBase: Map<string, PointBuyListEntry>;
  /** League record, or `null` when this player has no rated match yet. */
  standing: Standing | null;
}

/** Party row of the SV summary: six slots, filled or empty. */
const PARTY_SLOTS = 6;

export function teamPanelTitle(participant: PublicParticipant, locale: Locale): string {
  return createTranslator(worldEvoligaMessages, locale)('team.title', { name: participant.name });
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg border border-arena-border bg-arena-surface px-3 py-1.5">
      <dt className="text-arena-ink-secondary">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-arena-ink">{value}</dd>
    </div>
  );
}

/** One party slot: the line's sprite in a round frame with its stage pip. */
function PartySlot({ tracker, form }: { tracker: EvolutionTracker; form: string }) {
  return (
    <li className="flex w-14 flex-col items-center gap-1">
      <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-arena-border bg-arena-elevated">
        <PokemonSprite name={tracker.current_form} size={44} />
        <span className="absolute -bottom-1 right-0 rounded-full border border-arena-border bg-arena-surface px-1.5 text-[10px] font-semibold leading-4 text-arena-ink">
          {tracker.current_stage}
        </span>
      </span>
      <span className="w-full truncate text-center text-[10px] leading-tight text-arena-ink-secondary">
        {form}
      </span>
    </li>
  );
}

function EmptySlot() {
  return (
    <li className="flex w-14 flex-col items-center gap-1" aria-hidden="true">
      <span className="h-14 w-14 rounded-full border border-dashed border-arena-border" />
      <span className="text-[10px] leading-tight text-arena-ink-secondary">—</span>
    </li>
  );
}

/**
 * Body of the `?team=<player id>` Focus panel (ADR-0003) behind a statue-row
 * ace, in SV-summary grammar: the team as six round-framed party slots, then
 * label / value rows with the values right-aligned, then the rest of the
 * draft. The trainer's name is the panel title, and the ace itself stays in
 * the world beside the panel — the panel never repeats the subject.
 *
 * Progress is shown by source (draft-frontend §8.3): the team's KOs are the
 * sum of self-earned kills (`real_kills`) only, each bench line carries the
 * compact source chips, and the party orders by stage, then self-earned KOs,
 * then total progress (`compareTrackersForDisplay`).
 *
 * Server component; owned by the `#teams` station card.
 */
export default function TeamFocusPanel({
  participant,
  lines,
  entryByBase,
  standing,
  locale,
  dataLocale = locale,
}: TeamFocusPanelProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const glossary = createTranslator(glossaryMessages, locale);
  const chipLabels = progressChipLabels(createTranslator(draftSharedMessages, locale));
  const species = (name: string) => localizeSpecies(name, dataLocale);

  const ordered = [...lines].sort(compareTrackersForDisplay);
  const party = ordered.slice(0, PARTY_SLOTS);
  const bench = ordered.slice(PARTY_SLOTS);

  const evolutionPoints = lines.reduce((sum, tracker) => sum + tracker.evolution_points_awarded, 0);
  // Only self-earned kills are kills; tokens and transferred progress never are.
  const kills = lines.reduce((sum, tracker) => sum + displayKills(tracker), 0);
  const value = lines.reduce(
    (sum, tracker) => sum + (entryByBase.get(tracker.base_pokemon)?.price ?? 0),
    0,
  );
  const evolved = lines.filter((tracker) => tracker.current_stage >= 3).length;
  // No standing means no rated match yet — an em dash, never a fabricated 0-0-0.
  const record = standing ? `${standing.wins}-${standing.losses}-${standing.draws}` : '—';
  const points = standing ? String(standing.points) : '—';

  return (
    <div className="space-y-4 text-sm">
      {lines.length > 0 ? (
        <ul className="flex flex-wrap justify-between gap-x-2 gap-y-3">
          {party.map((tracker) => (
            <PartySlot key={tracker.id} tracker={tracker} form={species(tracker.current_form)} />
          ))}
          {Array.from({ length: Math.max(0, PARTY_SLOTS - party.length) }, (_, i) => (
            <EmptySlot key={`slot-${i}`} />
          ))}
        </ul>
      ) : (
        <p className="text-arena-ink-secondary">{t('team.noLines')}</p>
      )}

      <dl className="space-y-1">
        <StatRow label={t('team.player')} value={participant.name} />
        <StatRow label={t('team.record')} value={record} />
        <StatRow label={t('team.points')} value={points} />
        <StatRow label={glossary('progress.evolutionPoints')} value={String(evolutionPoints)} />
        <StatRow label={t('team.rosterValue')} value={t('team.rosterValueAmount', { value })} />
      </dl>

      <dl className="space-y-1">
        <StatRow label={t('team.lines')} value={String(lines.length)} />
        <StatRow label={glossary('roster.stage3')} value={String(evolved)} />
        <StatRow label={t('team.totalKos')} value={String(kills)} />
      </dl>

      {bench.length > 0 && (
        <div>
          <h3 className="font-heading text-xs font-semibold uppercase tracking-wide text-arena-ink-secondary">
            {t('team.moreLines')}
          </h3>
          <ul className="mt-1.5 space-y-1">
            {bench.map((tracker) => {
              const entry = entryByBase.get(tracker.base_pokemon) ?? null;
              return (
                <li
                  key={tracker.id}
                  className="flex items-center gap-2 rounded-lg border border-arena-border bg-arena-surface px-2 py-1"
                >
                  <PokemonSprite name={tracker.current_form} size={24} />
                  <span className="min-w-0 flex-1 truncate text-arena-ink">
                    {species(tracker.current_form)}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-1 text-right tabular-nums text-arena-ink-secondary">
                    {t('team.benchStage', { stage: tracker.current_stage })} ·{' '}
                    <ProgressSourceChips sources={progressSourcesOf(tracker)} compact labels={chipLabels} />
                    {entry ? ` · ${common('units.points', { n: entry.price })}` : ''}
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
