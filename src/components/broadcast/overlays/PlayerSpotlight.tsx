'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import OverlayRatingBadge from '../shared/OverlayRatingBadge';
import OverlayStreakBadge from '../shared/OverlayStreakBadge';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig } from '@/types/broadcast';
import type { PlayerStreaks } from '@/types/streak';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { achievementText } from '@/i18n/content/achievements';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface PlayerSpotlightProps {
  config: OverlayConfig;
  playerId: string;
}

interface SpotlightData {
  /** null when the profile has no name; rendered as the translated 'Unknown'. */
  name: string | null;
  avatar_url: string | null;
  record: { wins: number; losses: number };
  rating: { rating: number; rd: number; peak: number } | null;
  signature_pokemon: {
    pokemon_name: string;
    kos: number;
    win_rate: number;
    games_played: number;
  }[];
  streaks: PlayerStreaks | null;
  /** `key` is the catalog key (absent on older responses); `name` the DB text fallback. */
  achievements: { key: string | null; name: string; tier: string }[];
}

/**
 * The slice of the profile response this overlay reads. The player part is
 * the public card only (name and avatar): the overlay renders nothing else
 * about the player, and nothing else of the row is kept in its state.
 */
interface SpotlightProfilePayload {
  player?: { name?: string; avatar_url?: string | null };
  overall_record?: { wins?: number; losses?: number };
  rating?: { rating: number; rd: number; peak_rating: number } | null;
  top_pokemon?: { pokemon_name: string; total_kos: number; win_rate?: number; games_played?: number }[];
  streaks?: PlayerStreaks | null;
  achievements?: { key?: string; name: string; tier: string }[];
}

export default function PlayerSpotlight({
  config,
  playerId,
}: PlayerSpotlightProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const locale = useLocale();
  const formatter = useFormatter();
  const [data, setData] = useState<SpotlightData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/players/${playerId}/profile`);
        const json = await res.json();
        if (!json.success) return;

        const profile: SpotlightProfilePayload = json.data ?? {};
        setData({
          name: profile.player?.name ?? null,
          avatar_url: profile.player?.avatar_url ?? null,
          record: {
            wins: profile.overall_record?.wins ?? 0,
            losses: profile.overall_record?.losses ?? 0,
          },
          rating: profile.rating
            ? { rating: profile.rating.rating, rd: profile.rating.rd, peak: profile.rating.peak_rating }
            : null,
          signature_pokemon: (profile.top_pokemon ?? []).slice(0, 3).map(
            (p: { pokemon_name: string; total_kos: number; win_rate?: number; games_played?: number }) => ({
              pokemon_name: p.pokemon_name,
              kos: p.total_kos,
              win_rate: p.win_rate ?? 0,
              games_played: p.games_played ?? 0,
            })
          ),
          streaks: profile.streaks ?? null,
          achievements: (profile.achievements ?? []).slice(0, 5).map(
            (a: { key?: string; name: string; tier: string }) => ({ key: a.key ?? null, name: a.name, tier: a.tier })
          ),
        });
      } catch {
        // Silently fail
      }
    }
    load();
  }, [playerId]);

  if (!data) return null;

  const recordStr = t('common.record', { wins: data.record.wins, losses: data.record.losses });
  const streakText = data.streaks?.current_win_streak && data.streaks.current_win_streak >= 2
    ? t('streak.win', { count: data.streaks.current_win_streak })
    : null;
  const playerName = data.name ?? t('common.unknownPlayer');

  return (
    <div className="relative w-full h-full flex items-center justify-center gap-12 p-8">
      {/* Left: Player identity */}
      <AnimatedReveal animation="slideInLeft" delay={300}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <OverlayPlayerBadge
            player={{ name: playerName, avatar_url: data.avatar_url, record: recordStr }}
            avatarSize={140}
            rating={data.rating ? { rating: data.rating.rating, peak: data.rating.peak } : null}
            streakText={streakText}
          />

          {/* Rating badge (larger, detailed) */}
          {data.rating && (
            <OverlayRatingBadge rating={data.rating} />
          )}

          {/* Streak badge */}
          <OverlayStreakBadge streaks={data.streaks} />

          {/* Achievement badges */}
          {data.achievements.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '240px' }}>
              {data.achievements.map((a) => (
                <AchievementBadge
                  key={a.key ?? a.name}
                  name={a.key ? achievementText({ key: a.key, name: a.name, description: '' }, locale).name : a.name}
                  tier={a.tier}
                />
              ))}
            </div>
          )}
        </div>
      </AnimatedReveal>

      {/* Right: Signature Pokemon */}
      <AnimatedReveal animation="slideInRight" delay={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: 'var(--broadcast-text-muted)',
            }}
          >
            {t('spotlight.signature')}
          </div>

          {data.signature_pokemon.map((sig, i) => (
            <div
              key={sig.pokemon_name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                animation: `broadcast-slideInRight 0.3s ease-out ${800 + i * 150}ms both`,
              }}
            >
              <OverlayPokemonSprite
                pokemon={sig.pokemon_name}
                size={i === 0 ? 80 : 64}
                glowColor={i === 0 ? 'rgba(234,179,8,0.5)' : undefined}
              />
              <div>
                <div
                  style={{
                    fontSize: i === 0 ? '18px' : '15px',
                    fontWeight: 800,
                    color: 'var(--broadcast-text)',
                  }}
                >
                  {localizeSpecies(sig.pokemon_name, dl)}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--broadcast-text-muted)',
                    display: 'flex',
                    gap: '8px',
                    marginTop: '2px',
                  }}
                >
                  <span style={{ color: 'var(--broadcast-accent)', fontWeight: 700 }}>
                    {t('common.kos', { count: sig.kos })}
                  </span>
                  {sig.win_rate > 0 && (
                    <span>{t('common.winRate', { rate: formatter.percent(sig.win_rate, 0) })}</span>
                  )}
                  {sig.games_played > 0 && (
                    <span>{t('common.games', { count: sig.games_played })}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </AnimatedReveal>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

function AchievementBadge({ name, tier }: { name: string; tier: string }) {
  const tierColors: Record<string, { bg: string; color: string }> = {
    bronze: { bg: 'rgba(180,83,9,0.15)', color: 'rgb(180,83,9)' },
    silver: { bg: 'rgba(156,163,175,0.15)', color: 'rgb(156,163,175)' },
    gold: { bg: 'rgba(234,179,8,0.15)', color: 'rgb(234,179,8)' },
    platinum: { bg: 'rgba(168,85,247,0.15)', color: 'rgb(168,85,247)' },
  };
  const style = tierColors[tier] ?? tierColors.bronze;

  return (
    <span
      style={{
        fontSize: '9px',
        fontWeight: 700,
        color: style.color,
        background: style.bg,
        padding: '2px 8px',
        borderRadius: '9999px',
        letterSpacing: '0.03em',
      }}
    >
      {name}
    </span>
  );
}
