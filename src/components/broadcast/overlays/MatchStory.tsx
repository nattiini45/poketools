'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayScoreDisplay from '../shared/OverlayScoreDisplay';
import OverlayTeamStrip from '../shared/OverlayTeamStrip';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, EnrichedMatchState } from '@/types/broadcast';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';

interface MatchStoryProps {
  config: OverlayConfig;
  matchId: string;
  /** Total duration in seconds. Default: 60. */
  duration?: number;
}

type StoryAct = 'intro' | 'game_flow' | 'mvp' | 'result';

const ACT_TIMINGS = {
  intro: { start: 0, end: 10 },
  game_flow: { start: 10, end: 40 },
  mvp: { start: 40, end: 50 },
  result: { start: 50, end: 60 },
};

/**
 * Cinematic post-match breakdown overlay.
 * Auto-plays through 4 acts:
 * 1. Intro — matchup reveal with silhouette-fill
 * 2. Game Flow — per-game team reveals + KO timeline
 * 3. MVP Spotlight — featured pokemon with stats
 * 4. Final Result — winner reveal with standings impact
 */
export default function MatchStory({
  config,
  matchId,
  duration = 60,
}: MatchStoryProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const [data, setData] = useState<EnrichedMatchState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/broadcast/state/${matchId}?enrich=true`);
      const json = await res.json();
      if (json.success) setData(json.data);
    }
    load();
  }, [matchId]);

  // Timer
  useEffect(() => {
    if (!data) return;
    const interval = setInterval(() => {
      setElapsed((prev) => {
        if (prev >= duration) {
          clearInterval(interval);
          return duration;
        }
        return prev + 0.1;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [data, duration]);

  if (!data || !data.winner_id) return null;

  const scale = duration / 60;
  const currentAct: StoryAct =
    elapsed < ACT_TIMINGS.intro.end * scale
      ? 'intro'
      : elapsed < ACT_TIMINGS.game_flow.end * scale
        ? 'game_flow'
        : elapsed < ACT_TIMINGS.mvp.end * scale
          ? 'mvp'
          : 'result';

  const isP1Winner = data.winner_id === data.player1.id;
  const winner = isP1Winner ? data.enriched_player1 : data.enriched_player2;
  const winnerRecord = t('common.record', { wins: winner.record.wins, losses: winner.record.losses });

  // Find MVP from breakdown
  const allPokemon = data.per_game_breakdown.flatMap((g) => [
    ...g.player1_pokemon,
    ...g.player2_pokemon,
  ]);
  const mvp = allPokemon.reduce(
    (best, p) => (p.kos_dealt > (best?.kos_dealt ?? 0) ? p : best),
    null as typeof allPokemon[0] | null,
  );

  // Current game for game_flow act
  const gameFlowElapsed = elapsed - ACT_TIMINGS.game_flow.start * scale;
  const gameFlowDuration = (ACT_TIMINGS.game_flow.end - ACT_TIMINGS.game_flow.start) * scale;
  const gameCount = data.per_game_breakdown.length;
  const gameFlowIndex = gameCount > 0
    ? Math.min(Math.floor((gameFlowElapsed / gameFlowDuration) * gameCount), gameCount - 1)
    : 0;
  const currentGame = data.per_game_breakdown[gameFlowIndex];

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      {/* Progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '3px',
          width: `${(elapsed / duration) * 100}%`,
          background: 'var(--broadcast-accent)',
          transition: 'width 0.1s linear',
        }}
      />

      {/* ── Act 1: Intro ── */}
      {currentAct === 'intro' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
          {/* Context */}
          <AnimatedReveal animation="fadeIn" delay={0}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--broadcast-text-muted)' }}>
                {data.season_name && `${data.season_name} · `}{data.tournament_name}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--broadcast-text)', marginTop: '4px' }}>
                {translateEngineLabel('round', data.round_name, locale)}
              </div>
            </div>
          </AnimatedReveal>

          {/* Matchup */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
            <AnimatedReveal animation="slideInLeft" delay={500}>
              <OverlayPlayerBadge
                player={{
                  name: data.player1.name,
                  avatar_url: data.player1.avatar_url,
                }}
                avatarSize={100}
              />
            </AnimatedReveal>

            <AnimatedReveal animation="scaleReveal" delay={1000}>
              <div style={{ fontSize: '36px', fontWeight: 900, color: 'var(--broadcast-accent)', textShadow: '0 0 30px var(--broadcast-accent)' }}>
                {t('common.vs')}
              </div>
            </AnimatedReveal>

            <AnimatedReveal animation="slideInRight" delay={500}>
              <OverlayPlayerBadge
                player={{
                  name: data.player2.name,
                  avatar_url: data.player2.avatar_url,
                }}
                avatarSize={100}
                align="right"
              />
            </AnimatedReveal>
          </div>
        </div>
      )}

      {/* ── Act 2: Game Flow ── */}
      {currentAct === 'game_flow' && currentGame && (
        <AnimatedReveal key={`game-${gameFlowIndex}`} animation="fadeIn">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--broadcast-accent)' }}>
              {t('common.game', { n: currentGame.game_number })}
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '40px' }}>
              {/* P1 team */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--broadcast-text)' }}>
                  {data.player1.name}
                </span>
                <OverlayTeamStrip
                  pokemon={currentGame.player1_pokemon}
                  size={48}
                  showAura
                  showBadges
                  staggerDelay={100}
                />
                <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--broadcast-accent)', fontWeight: 800 }}>
                    {t('common.kos', { count: currentGame.player1_kos })}
                  </span>
                  <span style={{ color: 'rgb(34,197,94)', fontWeight: 700 }}>
                    {t('common.alive', { count: currentGame.player1_alive })}
                  </span>
                </div>
              </div>

              {/* Score */}
              <div style={{ fontSize: '32px', fontWeight: 900, color: 'var(--broadcast-text-muted)', paddingTop: '20px' }}>
                {t('common.vsLower')}
              </div>

              {/* P2 team */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--broadcast-text)' }}>
                  {data.player2.name}
                </span>
                <OverlayTeamStrip
                  pokemon={currentGame.player2_pokemon}
                  size={48}
                  showAura
                  showBadges
                  staggerDelay={100}
                />
                <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
                  <span style={{ color: 'var(--broadcast-accent2)', fontWeight: 800 }}>
                    {t('common.kos', { count: currentGame.player2_kos })}
                  </span>
                  <span style={{ color: 'rgb(34,197,94)', fontWeight: 700 }}>
                    {t('common.alive', { count: currentGame.player2_alive })}
                  </span>
                </div>
              </div>
            </div>

            {/* Game winner */}
            {currentGame.winner_id && (
              <AnimatedReveal animation="fadeIn" delay={1000}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--broadcast-accent)' }}>
                  {t('common.gameWinner', {
                    name: currentGame.winner_id === data.player1.id ? data.player1.name : data.player2.name,
                    n: currentGame.game_number,
                  })}
                </div>
              </AnimatedReveal>
            )}
          </div>
        </AnimatedReveal>
      )}

      {/* ── Act 3: MVP Spotlight ── */}
      {currentAct === 'mvp' && mvp && (
        <AnimatedReveal animation="scaleReveal">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgb(234,179,8)' }}>
              {t('story.matchMvp')}
            </div>

            <div
              style={{
                padding: '24px',
                borderRadius: '20px',
                background: 'var(--broadcast-surface)',
                border: '2px solid rgba(234,179,8,0.4)',
                boxShadow: '0 0 40px rgba(234,179,8,0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: '24px',
              }}
            >
              <OverlayPokemonSprite
                pokemon={mvp.pokemon_name}
                size={120}
                glowColor="rgba(234,179,8,0.6)"
              />
              <div>
                <div style={{ fontSize: '28px', fontWeight: 900, color: 'var(--broadcast-text)' }}>
                  {localizeSpecies(mvp.pokemon_name, dl)}
                </div>
                <div style={{ fontSize: '16px', color: 'var(--broadcast-text-muted)', marginTop: '4px' }}>
                  {t('common.kos', { count: mvp.kos_dealt })}
                  {mvp.moves_used.length > 0 && ` · ${mvp.moves_used.map((m) => localizeMove(m, dl)).join(', ')}`}
                </div>
              </div>
            </div>
          </div>
        </AnimatedReveal>
      )}

      {/* ── Act 4: Final Result ── */}
      {currentAct === 'result' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <AnimatedReveal animation="shakeSlam" delay={0}>
            <div style={{ fontSize: '36px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--broadcast-accent)', textShadow: '0 0 40px var(--broadcast-accent)' }}>
              {t('common.winner')}
            </div>
          </AnimatedReveal>

          <AnimatedReveal animation="slideInUp" delay={500}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <OverlayPlayerBadge
                player={{
                  name: winner.name,
                  avatar_url: winner.avatar_url,
                  record: winnerRecord,
                }}
                avatarSize={80}
                isWinner
              />
              <OverlayScoreDisplay
                pokemonScore={data.pokemon_score}
                seriesScore={data.series_score}
                isP1Winner={isP1Winner}
              />
            </div>
          </AnimatedReveal>
        </div>
      )}

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
