'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, MatchPreviewData, EnrichedPokemonState } from '@/types/broadcast';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { localizeAbility, localizeItem, localizeMove, localizeSpecies } from '@/lib/pkmn/i18n/names';

interface TeamComparisonProps {
  config: OverlayConfig;
  matchId: string;
}

/**
 * Side-by-side 6v6 team comparison overlay.
 * Shows both players' registered teams with sprites, items, abilities, and moves.
 */
export default function TeamComparison({
  config,
  matchId,
}: TeamComparisonProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const [data, setData] = useState<MatchPreviewData | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/broadcast/preview/${matchId}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    }
    load();
  }, [matchId]);

  if (!data) return null;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-8 gap-6 overflow-hidden">
      {/* Header */}
      <AnimatedReveal animation="fadeIn" delay={0}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--broadcast-text-muted)' }}>
            {t('teams.title')}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--broadcast-text)', marginTop: '4px' }}>
            {translateEngineLabel('round', data.round_name, locale)}
            {data.best_of > 1 && ` · ${t('common.bestOf', { count: data.best_of })}`}
          </div>
        </div>
      </AnimatedReveal>

      {/* Player names */}
      <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', paddingInline: '40px' }}>
        <AnimatedReveal animation="slideInLeft" delay={200}>
          <OverlayPlayerBadge
            player={{ name: data.player1.name, avatar_url: data.player1.avatar_url }}
            avatarSize={48}
          />
        </AnimatedReveal>
        <AnimatedReveal animation="slideInRight" delay={200}>
          <OverlayPlayerBadge
            player={{ name: data.player2.name, avatar_url: data.player2.avatar_url }}
            avatarSize={48}
            align="right"
          />
        </AnimatedReveal>
      </div>

      {/* Side-by-side teams */}
      <div style={{ display: 'flex', gap: '32px', width: '100%', paddingInline: '40px' }}>
        {/* P1 Team */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.player1_team.map((p, i) => (
            <div
              key={p.pokemon_name}
              style={{ animation: `broadcast-slideInLeft 0.3s ease-out ${500 + i * 100}ms both` }}
            >
              <TeamPokemonCard pokemon={p} />
            </div>
          ))}
        </div>

        {/* Divider */}
        <div
          style={{
            width: '2px',
            background: 'var(--broadcast-border)',
            alignSelf: 'stretch',
          }}
        />

        {/* P2 Team */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.player2_team.map((p, i) => (
            <div
              key={p.pokemon_name}
              style={{ animation: `broadcast-slideInRight 0.3s ease-out ${500 + i * 100}ms both` }}
            >
              <TeamPokemonCard pokemon={p} />
            </div>
          ))}
        </div>
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

function TeamPokemonCard({ pokemon: p }: { pokemon: EnrichedPokemonState }) {
  const dl = useDataLocale();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        borderRadius: '10px',
        background: 'var(--broadcast-surface-light)',
      }}
    >
      <OverlayPokemonSprite pokemon={p.pokemon_name} size={56} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--broadcast-text)' }}>
          {localizeSpecies(p.pokemon_name, dl)}
        </div>
        <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--broadcast-text-muted)', marginTop: '2px' }}>
          {p.ability && <span>{localizeAbility(p.ability, dl)}</span>}
          {p.item && <span>@ {localizeItem(p.item, dl)}</span>}
        </div>
        {p.moves_used.length > 0 && (
          <div style={{ fontSize: '10px', color: 'var(--broadcast-text-muted)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {p.moves_used.map((m) => localizeMove(m, dl)).join(' / ')}
          </div>
        )}
      </div>
    </div>
  );
}
