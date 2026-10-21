'use client';

import { useId } from 'react';
import { useMessages, useT } from '@/i18n/client';
import { useDataLocale } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { spriteStyleMessages } from '@/i18n/messages/sprite-style';
import {
  SITE_DEFAULT_SPRITE_STYLE,
  SPRITE_PREVIEW_SPECIES,
  SPRITE_STYLE_PREFERENCES,
  resolveSpriteStyle,
  spriteResolver,
  type SpriteStylePreference,
} from '@/lib/pkmn/sprite-styles';
import PokemonSprite from './PokemonSprite';

/**
 * The sprite-style radio group (docs/pkmn.md, "Sprite styles").
 *
 * - `cards` (settings page): one card per option with a live preview of the
 *   preview species in that style, the label and a one-line help text.
 * - `compact` (NavBar menu, mobile drawer): plain rows beside the language
 *   options, no previews.
 *
 * Native radios inside labels: arrow keys move the choice, the label is the
 * whole row (at least 44 px tall), screen readers get the legend and the help
 * text. Theme tokens only; the checked state uses the accent token (no red,
 * no dark slab). Colour transitions run only without reduced motion.
 */
export default function SpriteStyleOptions({
  name,
  value,
  onChange,
  variant,
  legendClassName,
  disabled = false,
}: {
  /** Radio group name; unique per mounted instance. */
  name: string;
  value: SpriteStylePreference;
  onChange: (next: SpriteStylePreference) => void;
  variant: 'cards' | 'compact';
  legendClassName?: string;
  disabled?: boolean;
}) {
  const t = useT(spriteStyleMessages);
  const copy = useMessages(spriteStyleMessages);
  const dataLocale = useDataLocale();
  const baseId = useId();
  const broadcastAvailable = spriteResolver.hasBroadcast(SPRITE_PREVIEW_SPECIES);
  const species = localizeSpecies(SPRITE_PREVIEW_SPECIES, dataLocale);

  const helpFor = (option: SpriteStylePreference): string => {
    if (option === 'site') {
      return t('options.site.help', { style: copy.options[SITE_DEFAULT_SPRITE_STYLE].label });
    }
    if (option === 'broadcast' && !broadcastAvailable) return t('broadcastUnavailable');
    return copy.options[option].help;
  };

  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={legendClassName}>{variant === 'cards' ? t('legend') : t('menuLegend')}</legend>
      <div className={variant === 'cards' ? 'grid gap-2 sm:grid-cols-2' : 'space-y-1'}>
        {SPRITE_STYLE_PREFERENCES.map((option) => {
          const checked = value === option;
          const helpId = `${baseId}-${option}-help`;
          const label = copy.options[option].label;
          if (variant === 'compact') {
            return (
              <label key={option} className={COMPACT_ROW}>
                <input
                  type="radio"
                  className="sr-only"
                  name={name}
                  value={option}
                  checked={checked}
                  aria-describedby={helpId}
                  onChange={() => onChange(option)}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-heading font-semibold leading-tight">{label}</span>
                  <span id={helpId} className="sr-only">
                    {helpFor(option)}
                  </span>
                </span>
                <CheckMark checked={checked} />
              </label>
            );
          }
          return (
            <label key={option} className={CARD}>
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option}
                checked={checked}
                aria-describedby={helpId}
                onChange={() => onChange(option)}
              />
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-poke-md bg-poke-elevated"
                role="img"
                aria-label={t('previewAlt', { style: label, species })}
              >
                <PokemonSprite
                  name={SPRITE_PREVIEW_SPECIES}
                  size={56}
                  spriteStyle={resolveSpriteStyle(option)}
                  className="h-14 w-14"
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-heading font-semibold leading-tight text-poke-text-primary">{label}</span>
                <span id={helpId} className="text-xs leading-snug text-poke-text-secondary">
                  {helpFor(option)}
                </span>
              </span>
              <CheckMark checked={checked} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const FOCUS_WITHIN =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-poke-focus';

const COMPACT_ROW =
  'flex min-h-11 items-center gap-3 rounded-poke-md px-2 py-2 cursor-pointer text-sm text-poke-text-primary ' +
  'hover:bg-poke-elevated has-[:checked]:bg-poke-accent-light motion-safe:transition-colors ' +
  FOCUS_WITHIN;

const CARD =
  'flex min-h-11 items-center gap-3 rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 ' +
  'cursor-pointer text-sm hover:bg-poke-elevated has-[:checked]:border-poke-accent has-[:checked]:bg-poke-accent-light ' +
  'motion-safe:transition-colors ' +
  FOCUS_WITHIN;

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={checked ? 'h-4 w-4 shrink-0 text-poke-accent-strong' : 'h-4 w-4 shrink-0 invisible'}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
