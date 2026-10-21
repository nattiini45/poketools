'use client';

import { useEffect, useState } from 'react';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import AnimatedReveal from '../shared/AnimatedReveal';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, EnrichedMatchState } from '@/types/broadcast';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';

interface H2HHistoryProps {
  config: OverlayConfig;
  matchId: string;
}

export default function H2HHistory({ config, matchId }: H2HHistoryProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const formatter = useFormatter();
  const [data, setData] = useState<EnrichedMatchState | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(`/api/broadcast/state/${matchId}?enrich=true`);
        const json = await res.json();
        if (active && json.success) {
          setData(json.data);
        }
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
  }, [matchId, config.poll]);

  if (!data || !data.enriched_player1 || !data.enriched_player2) return null;

  const p1 = data.enriched_player1;
  const p2 = data.enriched_player2;
  const h2h = data.h2h;
  const timeline = data.h2h_matches ?? [];
  const p1Sigs = p1.signatures?.slice(0, 3) ?? [];
  const p2Sigs = p2.signatures?.slice(0, 3) ?? [];

  return (
    <div className="relative w-full h-full flex flex-col p-8">
      {/* Header */}
      <AnimatedReveal animation="fadeIn" delay={100}>
        <div className="text-center mb-2">
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--broadcast-text-muted)' }}
          >
            {data.tournament_name} · {translateEngineLabel('round', data.round_name, locale)}
          </div>
          <div
            className="text-2xl font-black uppercase tracking-wider mt-1"
            style={{ color: 'var(--broadcast-text)' }}
          >
            {t('h2h.title')}
          </div>
        </div>
      </AnimatedReveal>

      {/* Player comparison + H2H record */}
      <AnimatedReveal animation="slideInUp" delay={300}>
        <div className="flex items-center justify-center gap-8 my-6">
          <OverlayPlayerBadge
            player={{
              name: p1.name,
              avatar_url: p1.avatar_url,
              record: p1.record ? `${p1.record.wins}-${p1.record.losses}${p1.record.draws ? `-${p1.record.draws}` : ''}` : undefined,
            }}
            avatarSize={80}
            align="right"
            rating={p1.rating}
            rank={p1.rank}
          />

          {/* H2H Score */}
          <div className="flex flex-col items-center gap-1">
            {h2h ? (
              <>
                <div
                  className="text-4xl font-black tabular-nums"
                  style={{ color: 'var(--broadcast-accent)' }}
                >
                  {h2h.player1_wins} - {h2h.player2_wins}
                </div>
                <div
                  className="text-xs uppercase tracking-wider"
                  style={{ color: 'var(--broadcast-text-muted)' }}
                >
                  {t('h2h.matches', { count: h2h.total_matches })}
                </div>
              </>
            ) : (
              <div
                className="text-lg font-semibold"
                style={{ color: 'var(--broadcast-text-muted)' }}
              >
                {t('h2h.firstMeeting')}
              </div>
            )}
          </div>

          <OverlayPlayerBadge
            player={{
              name: p2.name,
              avatar_url: p2.avatar_url,
              record: p2.record ? `${p2.record.wins}-${p2.record.losses}${p2.record.draws ? `-${p2.record.draws}` : ''}` : undefined,
            }}
            avatarSize={80}
            align="left"
            rating={p2.rating}
            rank={p2.rank}
          />
        </div>
      </AnimatedReveal>

      {/* Match Timeline */}
      {timeline.length > 0 && (
        <div className="flex-1 flex flex-col gap-2 my-4 overflow-hidden">
          <div
            className="text-xs font-semibold uppercase tracking-widest text-center mb-2"
            style={{ color: 'var(--broadcast-text-muted)' }}
          >
            {t('h2h.history')}
          </div>
          {timeline.slice(0, 5).map((match, i) => (
            <AnimatedReveal key={match.match_id} animation="slideInUp" delay={600 + i * 100}>
              <div
                className="flex items-center justify-between px-6 py-2 rounded-lg"
                style={{ background: 'var(--broadcast-surface-light)' }}
              >
                <div className="text-sm tabular-nums" style={{ color: 'var(--broadcast-text-muted)' }}>
                  {formatter.instant(match.date, 'date')}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="font-semibold"
                    style={{
                      color: match.winner_name === p1.name
                        ? 'var(--broadcast-accent)'
                        : 'var(--broadcast-text)',
                    }}
                  >
                    {p1.name}
                  </span>
                  <span
                    className="font-mono font-bold tabular-nums px-2"
                    style={{ color: 'var(--broadcast-text)' }}
                  >
                    {match.score}
                  </span>
                  <span
                    className="font-semibold"
                    style={{
                      color: match.winner_name === p2.name
                        ? 'var(--broadcast-accent)'
                        : 'var(--broadcast-text)',
                    }}
                  >
                    {p2.name}
                  </span>
                </div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: 'var(--broadcast-accent)' }}
                >
                  {match.draw ? t('common.draw') : match.winner_name}
                </div>
              </div>
            </AnimatedReveal>
          ))}
        </div>
      )}

      {/* Signature Face-off */}
      {(p1Sigs.length > 0 || p2Sigs.length > 0) && (
        <AnimatedReveal animation="scaleReveal" delay={timeline.length > 0 ? 1100 : 600}>
          <div className="flex items-center justify-center gap-8 mt-4">
            {/* P1 Signatures */}
            <div className="flex gap-2">
              {p1Sigs.map((sig) => (
                <OverlayPokemonSprite
                  key={sig.pokemon_name}
                  pokemon={sig.pokemon_name}
                  size={64}
                  glowColor="rgba(234, 179, 8, 0.6)"
                />
              ))}
            </div>

            <div
              className="text-2xl font-black"
              style={{ color: 'var(--broadcast-text-muted)' }}
            >
              {t('common.vs')}
            </div>

            {/* P2 Signatures */}
            <div className="flex gap-2">
              {p2Sigs.map((sig) => (
                <OverlayPokemonSprite
                  key={sig.pokemon_name}
                  pokemon={sig.pokemon_name}
                  size={64}
                  glowColor="rgba(234, 179, 8, 0.6)"
                />
              ))}
            </div>
          </div>
        </AnimatedReveal>
      )}

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
