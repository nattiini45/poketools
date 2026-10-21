'use client';

import { useEffect, useState } from 'react';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import AnimatedReveal from '../shared/AnimatedReveal';
import BrandWatermark from '../shared/BrandWatermark';
import { getAnimationStyle } from '@/lib/broadcast/animations';
import { typeColors } from '@/lib/design/tokens';
import type { OverlayConfig, PokemonUsageStat } from '@/types/broadcast';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface UsageChartProps {
  config: OverlayConfig;
  seasonId: string;
  tournamentId?: string;
  roundId?: string;
  top?: number;
}

export default function UsageChart({
  config,
  seasonId,
  tournamentId,
  roundId,
  top = 10,
}: UsageChartProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const formatter = useFormatter();
  const [usage, setUsage] = useState<PokemonUsageStat[]>([]);
  const [context, setContext] = useState<{ tournament_name: string; round_name: string }>({
    tournament_name: '',
    round_name: '',
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const params = new URLSearchParams();
        if (tournamentId) params.set('tournament_id', tournamentId);
        if (roundId) params.set('round_id', roundId);

        const res = await fetch(`/api/broadcast/recap/${seasonId}?${params.toString()}`);
        const json = await res.json();
        if (!active || !json.success) return;

        setUsage((json.data?.pokemon_usage ?? []).slice(0, top));
        setContext({
          tournament_name: json.data?.tournament_name ?? '',
          round_name: json.data?.round_name ?? '',
        });
      } catch {
        // Silently fail
      }
    }

    load();
    const interval = setInterval(load, config.poll);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [seasonId, tournamentId, roundId, config.poll, top]);

  if (usage.length === 0) return null;

  const maxGames = Math.max(...usage.map((u) => u.games), 1);

  return (
    <div className="relative w-full h-full flex flex-col p-8">
      {/* Header */}
      <AnimatedReveal animation="fadeIn" delay={100}>
        <div className="text-center mb-6">
          {context.tournament_name && (
            <div
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'var(--broadcast-text-muted)' }}
            >
              {context.tournament_name}
              {context.round_name ? ` · ${translateEngineLabel('round', context.round_name, locale)}` : ''}
            </div>
          )}
          <div
            className="text-2xl font-black uppercase tracking-wider mt-1"
            style={{ color: 'var(--broadcast-text)' }}
          >
            {t('usage.title')}
          </div>
        </div>
      </AnimatedReveal>

      {/* Bars */}
      <div className="flex-1 flex flex-col gap-2 justify-center">
        {usage.map((pokemon, i) => {
          const barWidth = (pokemon.games / maxGames) * 100;
          const primaryType = pokemon.types?.[0] ?? 'Normal';
          const barColor = typeColors[primaryType]?.bg ?? 'var(--broadcast-accent)';

          return (
            <div key={pokemon.pokemon_name} className="flex items-center gap-3">
              {/* Sprite */}
              <AnimatedReveal animation="scaleReveal" delay={200 + i * 100}>
                <OverlayPokemonSprite
                  pokemon={pokemon.pokemon_name}
                  size={36}
                  glowColor={barColor}
                />
              </AnimatedReveal>

              {/* Name */}
              <div
                className="w-28 text-sm font-semibold truncate"
                style={{
                  color: 'var(--broadcast-text)',
                  opacity: 0,
                  ...getAnimationStyle('fadeIn', 250 + i * 100),
                }}
              >
                {localizeSpecies(pokemon.pokemon_name, dl)}
              </div>

              {/* Bar container */}
              <div className="flex-1 h-6 rounded-md overflow-hidden" style={{ background: 'var(--broadcast-surface-light)' }}>
                <div
                  className="h-full rounded-md"
                  style={{
                    width: `${barWidth}%`,
                    background: barColor,
                    transformOrigin: 'left center',
                    opacity: 0,
                    ...getAnimationStyle('barGrow', 300 + i * 100),
                  }}
                />
              </div>

              {/* Stats */}
              <div
                className="w-36 text-right text-xs tabular-nums whitespace-nowrap"
                style={{
                  color: 'var(--broadcast-text-muted)',
                  opacity: 0,
                  ...getAnimationStyle('fadeIn', 400 + i * 100),
                }}
              >
                {t('common.games', { count: pokemon.games })}
                {' · '}
                {t('common.winRate', { rate: formatter.percent(pokemon.win_rate, 0) })}
                {' · '}
                {t('common.kos', { count: pokemon.total_kos })}
              </div>
            </div>
          );
        })}
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
