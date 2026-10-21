/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState } from 'react';
import BrandWatermark from '../shared/BrandWatermark';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import type { OverlayConfig } from '@/types/broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface StandingsTickerProps {
  config: OverlayConfig;
  seasonId: string;
  layout?: 'full' | 'ticker';
  top?: number;
  highlight?: string;
  scrollSpeed?: 'slow' | 'normal' | 'fast';
}

interface StandingsEntry {
  player_name: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  diff: number;
  avatar_url: string | null;
  rating: number | null;
  signature_pokemon: string | null;
  signature_sprite_url: string | null;
}

export default function StandingsTicker({
  config,
  seasonId,
  layout = 'full',
  top = 0,
  highlight,
  scrollSpeed = 'normal',
}: StandingsTickerProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const [standings, setStandings] = useState<StandingsEntry[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(`/api/broadcast/standings/${seasonId}`);
        const json = await res.json();
        if (!active || !json.success) return;

        const rows: StandingsEntry[] = (json.data?.standings ?? []).map(
          (r: {
            player_name: string;
            wins: number;
            losses: number;
            draws?: number;
            points?: number;
            kill_differential?: number;
            player_avatar_url?: string | null;
            rating?: number | null;
            signature_pokemon?: string | null;
            signature_sprite_url?: string | null;
          }) => ({
            player_name: r.player_name,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws ?? 0,
            points: r.points ?? r.wins * 3,
            diff: r.kill_differential ?? 0,
            avatar_url: r.player_avatar_url ?? null,
            rating: r.rating ?? null,
            signature_pokemon: r.signature_pokemon ?? null,
            signature_sprite_url: r.signature_sprite_url ?? null,
          }),
        );

        setStandings(top > 0 ? rows.slice(0, top) : rows);
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
  }, [seasonId, config.poll, top]);

  if (standings.length === 0) return null;

  // ── Ticker mode ──
  if (layout === 'ticker') {
    const speed = scrollSpeed === 'slow' ? 40 : scrollSpeed === 'fast' ? 15 : 25;
    const tickerText = standings
      .map((s, i) => {
        const base = { rank: i + 1, name: s.player_name, wins: s.wins, losses: s.losses };
        return s.signature_pokemon
          ? t('standings.tickerEntryWithPokemon', { ...base, pokemon: localizeSpecies(s.signature_pokemon, dl) })
          : t('standings.tickerEntry', base);
      })
      .join(' · ');

    return (
      <div
        className="w-full h-full flex items-center overflow-hidden"
        style={{
          background: 'var(--broadcast-surface)',
          borderTop: '2px solid var(--broadcast-border)',
        }}
      >
        <div
          className="whitespace-nowrap font-bold text-lg"
          style={{
            color: 'var(--broadcast-text)',
            animation: `broadcast-scroll ${speed}s linear infinite`,
          }}
        >
          {tickerText} &nbsp;&middot;&nbsp; {tickerText}
        </div>
        <style>{`
          @keyframes broadcast-scroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </div>
    );
  }

  // ── Full-screen mode ──
  return (
    <div className="relative w-full h-full flex flex-col p-8">
      {/* Header */}
      <AnimatedReveal animation="fadeIn" delay={100}>
        <div className="text-center mb-6">
          <div
            className="text-xl font-bold uppercase tracking-widest"
            style={{ color: 'var(--broadcast-text)' }}
          >
            {t('standings.title')}
          </div>
        </div>
      </AnimatedReveal>

      {/* Table */}
      <div className="flex-1 flex flex-col gap-1">
        {standings.map((entry, i) => {
          const isHighlighted = highlight === entry.player_name;
          return (
            <AnimatedReveal key={entry.player_name} animation="slideInLeft" delay={200 + i * 80}>
              <div
                className="flex items-center gap-4 px-6 py-3 rounded-xl transition-all"
                style={{
                  background: isHighlighted
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'var(--broadcast-surface-light)',
                  border: isHighlighted
                    ? '1px solid var(--broadcast-accent)'
                    : '1px solid transparent',
                  boxShadow: isHighlighted ? '0 0 20px rgba(239, 68, 68, 0.2)' : 'none',
                }}
              >
                {/* Rank */}
                <div
                  className="w-8 text-center text-lg font-black"
                  style={{
                    color: i < 3 ? 'var(--broadcast-accent)' : 'var(--broadcast-text-muted)',
                  }}
                >
                  {i + 1}
                </div>

                {/* Avatar */}
                {entry.avatar_url && (
                  <img
                    src={entry.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    style={{ border: '2px solid var(--broadcast-border)' }}
                  />
                )}

                {/* Name */}
                <div className="flex-1 font-semibold text-lg" style={{ color: 'var(--broadcast-text)' }}>
                  {entry.player_name}
                </div>

                {/* Record */}
                <div className="tabular-nums font-mono text-base" style={{ color: 'var(--broadcast-text)' }}>
                  {entry.wins}-{entry.losses}{entry.draws > 0 ? `-${entry.draws}` : ''}
                </div>

                {/* Rating */}
                {entry.rating !== null && (
                  <div
                    className="tabular-nums text-sm"
                    style={{ color: 'var(--broadcast-text-muted)' }}
                  >
                    {Math.round(entry.rating)}
                  </div>
                )}

                {/* Points */}
                <div
                  className="w-16 text-right font-bold text-base"
                  style={{ color: 'var(--broadcast-accent)' }}
                >
                  {t('standings.points', { points: entry.points })}
                </div>

                {/* Diff */}
                <div
                  className="w-12 text-right text-sm tabular-nums"
                  style={{
                    color: entry.diff > 0
                      ? '#34D399'
                      : entry.diff < 0
                        ? '#F87171'
                        : 'var(--broadcast-text-muted)',
                  }}
                >
                  {entry.diff > 0 ? '+' : ''}{entry.diff}
                </div>

                {/* Signature Pokemon */}
                {entry.signature_pokemon && (
                  <div className="shrink-0">
                    <OverlayPokemonSprite
                      pokemon={entry.signature_pokemon}
                      size={28}
                      glowColor="rgba(234, 179, 8, 0.6)"
                    />
                  </div>
                )}
              </div>
            </AnimatedReveal>
          );
        })}
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
