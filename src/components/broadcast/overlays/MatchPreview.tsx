'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayTeamStrip from '../shared/OverlayTeamStrip';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, MatchPreviewData } from '@/types/broadcast';
import { useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';

interface MatchPreviewProps {
  config: OverlayConfig;
  matchId: string;
  showH2H?: boolean;
  showSig?: boolean;
  duration?: number;
}

export default function MatchPreview({
  config,
  matchId,
  showH2H = true,
  showSig = true,
}: MatchPreviewProps) {
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

  const { player1, player2 } = data;
  const p1Record = t('common.record', { wins: player1.record.wins, losses: player1.record.losses });
  const p2Record = t('common.record', { wins: player2.record.wins, losses: player2.record.losses });
  const p1StreakText = player1.streaks?.current_win_streak && player1.streaks.current_win_streak >= 2
    ? t('streak.win', { count: player1.streaks.current_win_streak })
    : null;
  const p2StreakText = player2.streaks?.current_win_streak && player2.streaks.current_win_streak >= 2
    ? t('streak.win', { count: player2.streaks.current_win_streak })
    : null;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center gap-6 p-8 overflow-hidden">
      {/* Tournament context header */}
      <AnimatedReveal animation="fadeIn" delay={0}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: 'var(--broadcast-text-muted)',
            }}
          >
            {data.season_name && `${data.season_name} · `}{data.tournament_name}
          </div>
          <div
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--broadcast-text)',
              marginTop: '4px',
            }}
          >
            {translateEngineLabel('round', data.round_name, locale)}
            {data.best_of > 1 && ` · ${t('common.bestOf', { count: data.best_of })}`}
          </div>
        </div>
      </AnimatedReveal>

      {/* Main matchup: Player1 | VS | Player2 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '40px',
          justifyContent: 'center',
        }}
      >
        {/* Player 1 */}
        <AnimatedReveal animation="slideInLeft" delay={300}>
          <PlayerPreviewCard
            name={player1.name}
            avatarUrl={player1.avatar_url}
            record={p1Record}
            rating={player1.rating}
            rank={player1.rank}
            streakText={p1StreakText}
            align="left"
          />
        </AnimatedReveal>

        {/* VS */}
        <AnimatedReveal animation="scaleReveal" delay={600}>
          <div
            style={{
              fontSize: '40px',
              fontWeight: 900,
              color: 'var(--broadcast-accent)',
              textShadow: '0 0 30px var(--broadcast-accent)',
              paddingTop: '24px',
            }}
          >
            {t('common.vs')}
          </div>
        </AnimatedReveal>

        {/* Player 2 */}
        <AnimatedReveal animation="slideInRight" delay={300}>
          <PlayerPreviewCard
            name={player2.name}
            avatarUrl={player2.avatar_url}
            record={p2Record}
            rating={player2.rating}
            rank={player2.rank}
            streakText={p2StreakText}
            align="right"
          />
        </AnimatedReveal>
      </div>

      {/* Signatures */}
      {showSig && (player1.signatures.length > 0 || player2.signatures.length > 0) && (
        <AnimatedReveal animation="fadeIn" delay={900}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '60px',
              justifyContent: 'center',
            }}
          >
            {/* P1 signatures */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {player1.signatures.slice(0, 3).map((sig, i) => (
                <div
                  key={sig.pokemon_name}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    animation: `broadcast-fadeIn 0.3s ease-out ${1000 + i * 150}ms both`,
                  }}
                >
                  <OverlayPokemonSprite
                    pokemon={sig.pokemon_name}
                    size={56}
                    glowColor={i === 0 ? 'rgba(234,179,8,0.5)' : undefined}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--broadcast-text-muted)', fontWeight: 600 }}>
                    {t('common.kos', { count: sig.total_kos })}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ width: '40px' }} />

            {/* P2 signatures */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {player2.signatures.slice(0, 3).map((sig, i) => (
                <div
                  key={sig.pokemon_name}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    animation: `broadcast-fadeIn 0.3s ease-out ${1000 + i * 150}ms both`,
                  }}
                >
                  <OverlayPokemonSprite
                    pokemon={sig.pokemon_name}
                    size={56}
                    glowColor={i === 0 ? 'rgba(234,179,8,0.5)' : undefined}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--broadcast-text-muted)', fontWeight: 600 }}>
                    {t('common.kos', { count: sig.total_kos })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </AnimatedReveal>
      )}

      {/* H2H record */}
      {showH2H && data.h2h && data.h2h.total_matches > 0 && (
        <AnimatedReveal animation="fadeIn" delay={1400}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--broadcast-text)',
              textAlign: 'center',
            }}
          >
            {t('preview.h2h', { p1: data.h2h.player1_wins, p2: data.h2h.player2_wins })}
            <span style={{ color: 'var(--broadcast-text-muted)', fontWeight: 500, marginLeft: '8px' }}>
              ({data.h2h.player1_wins > data.h2h.player2_wins
                ? t('preview.leads', { name: player1.name })
                : data.h2h.player2_wins > data.h2h.player1_wins
                  ? t('preview.leads', { name: player2.name })
                  : t('preview.even')})
            </span>
          </div>
        </AnimatedReveal>
      )}

      {/* Team rosters */}
      {(data.player1_team.length > 0 || data.player2_team.length > 0) && (
        <AnimatedReveal animation="fadeIn" delay={1600}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '40px',
              justifyContent: 'center',
            }}
          >
            {data.player1_team.length > 0 && (
              <OverlayTeamStrip
                pokemon={data.player1_team}
                size={40}
                showAura={false}
                dimBenched={false}
                staggerDelay={100}
              />
            )}
            <div style={{ width: '40px' }} />
            {data.player2_team.length > 0 && (
              <OverlayTeamStrip
                pokemon={data.player2_team}
                size={40}
                showAura={false}
                dimBenched={false}
                staggerDelay={100}
              />
            )}
          </div>
        </AnimatedReveal>
      )}

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

function PlayerPreviewCard({
  name,
  avatarUrl,
  record,
  rating,
  rank,
  streakText,
  align,
}: {
  name: string;
  avatarUrl: string | null;
  record: string;
  rating: { rating: number; rd: number; peak: number } | null;
  rank: number | null;
  streakText: string | null;
  align: 'left' | 'right';
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        minWidth: '200px',
      }}
    >
      <OverlayPlayerBadge
        player={{ name, avatar_url: avatarUrl, record }}
        avatarSize={100}
        align={align}
        rating={rating ? { rating: rating.rating, peak: rating.peak } : null}
        rank={rank}
        streakText={streakText}
      />
    </div>
  );
}
