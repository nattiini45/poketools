'use client';

import { useState, useEffect } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { EvolutionEvent } from '@/types/evolution';

interface EvolutionEventBannerProps {
  events: EvolutionEvent[];
  playerNames: Record<string, string>;
  /** Auto-dismiss after this many milliseconds (0 = manual dismiss) */
  autoDismissMs?: number;
}

/**
 * Inline banner showing recent evolution events.
 * Displays with a highlight effect, then fades after timeout.
 */
export default function EvolutionEventBanner({
  events,
  playerNames,
  autoDismissMs = 15000,
}: EvolutionEventBannerProps) {
  const eventKey = events
    .map((event) => `${event.player_id}:${event.previous_form}:${event.new_form}:${event.total_kos}`)
    .join('|');

  return (
    <EvolutionEventBannerInner
      key={eventKey}
      events={events}
      playerNames={playerNames}
      autoDismissMs={autoDismissMs}
    />
  );
}

function EvolutionEventBannerInner({
  events,
  playerNames,
  autoDismissMs = 15000,
}: EvolutionEventBannerProps) {
  const t = useT(draftLegacyBoardMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tCommon = useT(commonMessages);
  const dataLocale = useDataLocale();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (events.length === 0) return;

    if (autoDismissMs > 0) {
      const timer = setTimeout(() => setVisible(false), autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [events, autoDismissMs]);

  if (!visible || events.length === 0) return null;

  return (
    <div className="space-y-2">
      {events.map((event, i) => (
        <div
          key={`${event.player_id}-${event.base_pokemon}-${i}`}
          className={`flex items-center gap-3 p-3 rounded-poke-lg border-2 text-sm ${
            event.is_devolution
              ? 'bg-poke-yellow-light border-yellow-600'
              : 'bg-gradient-to-r from-poke-yellow-light to-orange-50 border-poke-yellow'
          }`}
        >
          {/* Arrow visual: old form → new form */}
          <div className="flex items-center gap-2 flex-1">
            <PokemonSprite name={event.previous_form} size={36} />
            <span className="text-lg">{event.is_devolution ? '\u2B07' : '\u2B06'}</span>
            <PokemonSprite name={event.new_form} size={36} />
            <div>
              <div className="font-heading font-bold text-poke-text-primary">
                {event.is_devolution ? t('evolutionEvent.devolved') : t('evolutionEvent.evolved')}
              </div>
              <div className="text-xs text-poke-text-secondary">
                {/* `total_kos` is the total progress (all sources), never labelled KOs (§8.3). */}
                {t.rich(event.is_devolution ? 'evolutionEvent.revertedTo' : 'evolutionEvent.evolvedInto', {
                  player: playerNames[event.player_id] ?? tLegacy('unknownPlayer'),
                  from: localizeSpecies(event.previous_form, dataLocale),
                  to: localizeSpecies(event.new_form, dataLocale),
                  total: event.total_kos,
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setVisible(false)}
            aria-label={tCommon('a11y.dismiss')}
            className="text-poke-text-muted hover:text-poke-text-primary text-lg transition-colors"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
