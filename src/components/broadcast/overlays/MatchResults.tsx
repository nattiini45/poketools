'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPlayerBadge from '../shared/OverlayPlayerBadge';
import OverlayScoreDisplay from '../shared/OverlayScoreDisplay';
import OverlayPokemonStatCard from '../shared/OverlayPokemonStatCard';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, EnrichedMatchState, EnrichedPokemonState } from '@/types/broadcast';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';

interface MatchResultsProps {
  config: OverlayConfig;
  matchId: string;
  spoiler?: boolean;
  showMVP?: boolean;
}

export default function MatchResults({
  config,
  matchId,
  spoiler = false,
  showMVP = true,
}: MatchResultsProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const [data, setData] = useState<EnrichedMatchState | null>(null);
  const [revealed, setRevealed] = useState(!spoiler);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/broadcast/state/${matchId}?enrich=true`);
      const json = await res.json();
      if (!json.success) return;
      setData(json.data);
    }
    load();
  }, [matchId]);

  if (!data) return null;

  // Spoiler mode: blurred until click
  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="w-full h-full flex items-center justify-center cursor-pointer"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        <div className="text-xl font-bold" style={{ color: 'var(--broadcast-text-muted)' }}>
          {t('results.reveal')}
        </div>
      </button>
    );
  }

  const winnerId = data.winner_id;
  if (!winnerId) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-xl" style={{ color: 'var(--broadcast-text-muted)' }}>
          {t('results.notCompleted')}
        </div>
      </div>
    );
  }

  const isP1Winner = winnerId === data.player1.id;
  const winner = isP1Winner ? data.enriched_player1 : data.enriched_player2;
  const loser = isP1Winner ? data.enriched_player2 : data.enriched_player1;
  const winnerRecord = t('common.record', { wins: winner.record.wins, losses: winner.record.losses });
  const loserRecord = t('common.record', { wins: loser.record.wins, losses: loser.record.losses });

  // Get team data from per_game_breakdown (aggregated across all games)
  const p1Team = data.per_game_breakdown.length > 0
    ? aggregateTeamAcrossGames(data.per_game_breakdown, data.player1.id, true, isP1Winner)
    : [];
  const p2Team = data.per_game_breakdown.length > 0
    ? aggregateTeamAcrossGames(data.per_game_breakdown, data.player2.id, false, !isP1Winner)
    : [];

  // Find MVP
  const allPokemon = [...p1Team, ...p2Team];
  const mvp = allPokemon.find((p) => p.is_mvp);
  const mvpPlayerName = mvp
    ? p1Team.some((p) => p.pokemon_name === mvp.pokemon_name && p.is_mvp)
      ? data.player1.name
      : data.player2.name
    : null;

  // Streak text
  const winnerStreakText = winner.streaks?.current_win_streak && winner.streaks.current_win_streak >= 2
    ? t('streak.win', { count: winner.streaks.current_win_streak })
    : null;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center gap-4 p-6 overflow-hidden">
      {/* Tournament context */}
      {data.tournament_name && (
        <AnimatedReveal animation="fadeIn" delay={200}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--broadcast-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            {data.season_name && `${data.season_name} · `}{data.tournament_name}
            {data.round_name && ` · ${translateEngineLabel('round', data.round_name, locale)}`}
          </div>
        </AnimatedReveal>
      )}

      {/* Winner header */}
      <AnimatedReveal animation="shakeSlam" delay={800}>
        <div
          style={{
            fontSize: '36px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            textAlign: 'center',
            color: 'var(--broadcast-accent)',
            textShadow: '0 0 40px var(--broadcast-accent)',
          }}
        >
          {t('common.winner')}
        </div>
      </AnimatedReveal>

      {/* Main content: Player1 | Score | Player2 */}
      <AnimatedReveal animation="fadeIn" delay={1200}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: '32px',
          }}
        >
          {/* Player 1 column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '280px' }}>
            <OverlayPlayerBadge
              player={{
                name: data.player1.name,
                avatar_url: data.player1.avatar_url,
                record: isP1Winner ? winnerRecord : loserRecord,
              }}
              avatarSize={56}
              align="left"
              isWinner={isP1Winner}
              rating={isP1Winner ? winner.rating : loser.rating}
              streakText={isP1Winner ? winnerStreakText : null}
            />

            {/* Team roster */}
            {p1Team.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', width: '100%' }}>
                {p1Team.map((p, i) => (
                  <div
                    key={p.pokemon_name}
                    style={{
                      animation: `broadcast-slideInLeft 0.3s ease-out ${1600 + i * 100}ms both`,
                    }}
                  >
                    <OverlayPokemonStatCard pokemon={p} size={48} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Score center */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '12px' }}>
            <AnimatedReveal animation="scaleReveal" delay={1400}>
              <OverlayScoreDisplay
                pokemonScore={data.pokemon_score}
                seriesScore={data.series_score}
                isP1Winner={isP1Winner}
              />
            </AnimatedReveal>
          </div>

          {/* Player 2 column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '280px' }}>
            <OverlayPlayerBadge
              player={{
                name: data.player2.name,
                avatar_url: data.player2.avatar_url,
                record: !isP1Winner ? winnerRecord : loserRecord,
              }}
              avatarSize={56}
              align="right"
              isWinner={!isP1Winner}
              rating={!isP1Winner ? winner.rating : loser.rating}
              streakText={!isP1Winner ? winnerStreakText : null}
            />

            {/* Team roster */}
            {p2Team.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', width: '100%' }}>
                {p2Team.map((p, i) => (
                  <div
                    key={p.pokemon_name}
                    style={{
                      animation: `broadcast-slideInRight 0.3s ease-out ${1600 + i * 100}ms both`,
                    }}
                  >
                    <OverlayPokemonStatCard pokemon={p} size={48} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AnimatedReveal>

      {/* MVP Spotlight */}
      {showMVP && mvp && mvpPlayerName && (
        <AnimatedReveal animation="scaleReveal" delay={2800}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '12px 24px',
              borderRadius: '16px',
              background: 'var(--broadcast-surface)',
              border: '2px solid rgba(234,179,8,0.4)',
              boxShadow: '0 0 20px rgba(234,179,8,0.15)',
            }}
          >
            <OverlayPokemonSprite
              pokemon={mvp.pokemon_name}
              size={64}
              glowColor="rgba(234,179,8,0.6)"
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    color: 'rgb(234,179,8)',
                    background: 'rgba(234,179,8,0.15)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('common.mvpBadge')}
                </span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--broadcast-text)' }}>
                  {localizeSpecies(mvp.pokemon_name, dl)}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--broadcast-text-muted)', marginTop: '4px' }}>
                {t('common.kos', { count: mvp.kos_dealt })}
                {mvp.moves_used.length > 0 &&
                  ` · ${mvp.moves_used.slice(0, 2).map((m) => localizeMove(m, dl)).join(', ')}`}
                {` · ${mvpPlayerName}`}
              </div>
            </div>
          </div>
        </AnimatedReveal>
      )}

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Aggregate pokemon states across all games in the match for a given player.
 * player1_pokemon/player2_pokemon in GameBreakdown always correspond to
 * match.player_1_id/player_2_id respectively (set by the API route).
 */
function aggregateTeamAcrossGames(
  breakdowns: EnrichedMatchState['per_game_breakdown'],
  _playerId: string,
  isPlayer1: boolean,
  isWinner: boolean,
): EnrichedPokemonState[] {
  const map = new Map<string, {
    kos: number;
    brought: number;
    koed: boolean;
    lead: boolean;
    moves: Set<string>;
    turns: number;
    spriteUrl: string;
  }>();

  for (const game of breakdowns) {
    const team = isPlayer1 ? game.player1_pokemon : game.player2_pokemon;

    for (const p of team) {
      const existing = map.get(p.pokemon_name);
      if (existing) {
        existing.kos += p.kos_dealt;
        if (p.was_brought) existing.brought += 1;
        if (p.was_koed) existing.koed = true;
        if (p.was_lead) existing.lead = true;
        for (const m of p.moves_used) existing.moves.add(m);
        existing.turns += p.turns_active;
      } else {
        map.set(p.pokemon_name, {
          kos: p.kos_dealt,
          brought: p.was_brought ? 1 : 0,
          koed: p.was_koed,
          lead: p.was_lead,
          moves: new Set(p.moves_used),
          turns: p.turns_active,
          spriteUrl: p.sprite_url,
        });
      }
    }
  }

  const result: EnrichedPokemonState[] = Array.from(map.entries()).map(([name, data]) => ({
    pokemon_name: name,
    was_brought: data.brought > 0,
    was_lead: data.lead,
    was_koed: data.koed,
    kos_dealt: data.kos,
    types: [],
    sprite_url: data.spriteUrl,
    moves_used: Array.from(data.moves),
    turns_active: data.turns,
    is_mvp: false,
    item: null,
    ability: null,
  }));

  // Sort: brought first, then by KOs descending
  result.sort((a, b) => {
    const aBrought = a.was_brought ? 1 : 0;
    const bBrought = b.was_brought ? 1 : 0;
    if (aBrought !== bBrought) return bBrought - aBrought;
    return b.kos_dealt - a.kos_dealt;
  });

  // Mark MVP on winner's team
  if (isWinner && result.length > 0) {
    const brought = result.filter((p) => p.was_brought);
    if (brought.length > 0) {
      brought[0].is_mvp = true;
    }
  }

  return result;
}
