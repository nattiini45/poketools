'use client';

import { useEffect, useState, useRef } from 'react';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import OverlayMomentBanner from '../shared/OverlayMomentBanner';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, LiveMatchState, LivePokemonState } from '@/types/broadcast';
import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

interface LiveStatBarProps {
  config: OverlayConfig;
  matchId: string;
}

export default function LiveStatBar({ config, matchId }: LiveStatBarProps) {
  const t = useT(broadcastOverlaysMessages);
  const [data, setData] = useState<LiveMatchState | null>(null);
  const [pulse, setPulse] = useState<'p1' | 'p2' | null>(null);
  const prevKosRef = useRef<{ p1: number; p2: number }>({ p1: 0, p2: 0 });

  // Polling
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/broadcast/state/${matchId}`);
        const json = await res.json();
        if (!active || !json.success) return;

        const state: LiveMatchState = json.data;
        setData(state);

        // Detect KO changes for pulse animation
        if (state.current_game) {
          const newP1 = state.current_game.player1_kos;
          const newP2 = state.current_game.player2_kos;
          if (newP1 > prevKosRef.current.p1) setPulse('p1');
          if (newP2 > prevKosRef.current.p2) setPulse('p2');
          prevKosRef.current = { p1: newP1, p2: newP2 };
        }
      } catch {
        // Silently fail
      }
    }

    poll();
    const interval = setInterval(poll, config.poll);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [matchId, config.poll]);

  // Clear pulse after animation
  useEffect(() => {
    if (pulse) {
      const timer = setTimeout(() => setPulse(null), 600);
      return () => clearTimeout(timer);
    }
  }, [pulse]);

  if (!data) return null;

  const game = data.current_game;
  const p1Kos = game?.player1_kos ?? 0;
  const p2Kos = game?.player2_kos ?? 0;
  const gameNum = game?.game_number ?? 0;
  const p1Pokemon = game?.player1_pokemon ?? [];
  const p2Pokemon = game?.player2_pokemon ?? [];

  // Latest moment
  const latestMoment = data.recent_moments[0];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Main bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          height: '80px',
          background: 'var(--broadcast-surface)',
          borderTop: '2px solid var(--broadcast-border)',
        }}
      >
        {/* Player 1 side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <OverlayPlayerBadge
            player={{ name: data.player1.name, avatar_url: data.player1.avatar_url }}
            avatarSize={36}
          />

          {/* P1 Pokemon strip */}
          <PokemonStrip pokemon={p1Pokemon} pulseSide={pulse === 'p1'} />

          {/* P1 KOs */}
          <div
            style={{
              fontSize: '28px',
              fontWeight: 900,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--broadcast-accent)',
              transition: 'transform 0.3s',
              transform: pulse === 'p1' ? 'scale(1.25)' : 'scale(1)',
              minWidth: '36px',
              textAlign: 'center',
            }}
          >
            {p1Kos}
          </div>
        </div>

        {/* Center: game info + series score */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            padding: '0 20px',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--broadcast-text-muted)',
            }}
          >
            {t('common.game', { n: gameNum })}
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              color: 'var(--broadcast-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {data.series_score.player1}-{data.series_score.player2}
          </div>
        </div>

        {/* Player 2 side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-end' }}>
          {/* P2 KOs */}
          <div
            style={{
              fontSize: '28px',
              fontWeight: 900,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--broadcast-accent2)',
              transition: 'transform 0.3s',
              transform: pulse === 'p2' ? 'scale(1.25)' : 'scale(1)',
              minWidth: '36px',
              textAlign: 'center',
            }}
          >
            {p2Kos}
          </div>

          {/* P2 Pokemon strip */}
          <PokemonStrip pokemon={p2Pokemon} pulseSide={pulse === 'p2'} />

          <OverlayPlayerBadge
            player={{ name: data.player2.name, avatar_url: data.player2.avatar_url }}
            avatarSize={36}
            align="right"
          />
        </div>
      </div>

      {/* Moment ticker (below the bar) */}
      {latestMoment && (
        <div style={{ padding: '4px 24px' }}>
          <OverlayMomentBanner moment={latestMoment} />
        </div>
      )}

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

// ─── Pokemon Strip ──────────────────────────────────────────────────

function PokemonStrip({
  pokemon,
  pulseSide,
}: {
  pokemon: LivePokemonState[];
  pulseSide: boolean;
}) {
  if (pokemon.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
      {pokemon.map((p) => {
        const isBrought = p.was_brought;
        const isKoed = p.was_koed;
        const isBenched = !isBrought;

        // Determine glow color
        let glowColor: string | undefined;
        if (isBrought && isKoed) {
          glowColor = 'rgba(239,68,68,0.5)';
        } else if (isBrought && !isKoed) {
          glowColor = 'rgba(34,197,94,0.5)';
        }

        return (
          <div
            key={p.pokemon_name}
            style={{
              transition: 'transform 0.3s',
              transform: pulseSide && isBrought && !isKoed ? 'scale(1.1)' : 'scale(1)',
            }}
          >
            <OverlayPokemonSprite
              pokemon={p.pokemon_name}
              size={28}
              glowColor={glowColor}
              grayscale={isBenched || isKoed}
              dimmed={isBenched}
            />
          </div>
        );
      })}
    </div>
  );
}
