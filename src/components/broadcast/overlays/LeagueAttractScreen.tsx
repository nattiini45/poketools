/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, useCallback } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import BrandWatermark from '../shared/BrandWatermark';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import type { OverlayConfig, SeasonLeaders } from '@/types/broadcast';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface LeagueAttractScreenProps {
  config: OverlayConfig;
  seasonId: string;
  cardDuration?: number;
  transition?: 'fade' | 'slide' | 'none';
}

type CardType = 'branding' | 'standings' | 'recent' | 'leaders';

interface StandingsRow {
  name: string;
  record: string;
  rank: number;
  avatar_url: string | null;
  rating: number | null;
}

interface RecentResult {
  match_id: string;
  player1_name: string;
  player2_name: string;
  winner_name: string | null;
  player1_avatar_url: string | null;
  player2_avatar_url: string | null;
  pokemon_score: string;
}

interface AttractData {
  /** null when the API sends none; rendered as the translated 'League'. */
  league_name: string | null;
  standings: StandingsRow[];
  recent_results: RecentResult[];
  leaders: SeasonLeaders;
}

export default function LeagueAttractScreen({
  config,
  seasonId,
  cardDuration = 12000,
  transition = 'fade',
}: LeagueAttractScreenProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  const [data, setData] = useState<AttractData | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const cards: CardType[] = ['branding', 'standings', 'recent', 'leaders'];

  // Load data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/broadcast/standings/${seasonId}`);
        const json = await res.json();
        if (!json.success) return;

        const standingsData = (json.data?.standings ?? []).slice(0, 5);
        setData({
          league_name: json.data?.league_name ?? null,
          standings: standingsData.map(
            (s: {
              player_name: string;
              wins: number;
              losses: number;
              player_avatar_url?: string | null;
              rating?: number | null;
            }, i: number) => ({
              name: s.player_name,
              record: `${s.wins}-${s.losses}`,
              rank: i + 1,
              avatar_url: s.player_avatar_url ?? null,
              rating: s.rating ?? null,
            }),
          ),
          recent_results: (json.data?.recent_results ?? []).slice(0, 3),
          leaders: json.data?.leaders ?? { season_id: seasonId, most_kos: null, best_record: null, pokemon_mvp: null },
        });
      } catch {
        // Silently fail
      }
    }
    load();
  }, [seasonId]);

  // Auto-rotate cards
  useEffect(() => {
    const timer = setInterval(() => {
      setCardIndex((prev) => (prev + 1) % cards.length);
    }, cardDuration);
    return () => clearInterval(timer);
  }, [cardDuration, cards.length]);

  const transitionClass =
    transition === 'fade'
      ? 'transition-opacity duration-700'
      : transition === 'slide'
        ? 'transition-transform duration-500'
        : '';

  const renderCard = useCallback(
    (type: CardType) => {
      if (!data) return null;

      switch (type) {
        case 'branding':
          return (
            <div className="flex flex-col items-center justify-center gap-4">
              <div
                className="text-5xl font-black uppercase tracking-wider"
                style={{ color: 'var(--broadcast-accent)' }}
              >
                {data.league_name ?? t('common.league')}
              </div>
              <div className="text-lg" style={{ color: 'var(--broadcast-text-muted)' }}>
                {t('attract.tagline')}
              </div>
            </div>
          );

        case 'standings':
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-lg">
              <div
                className="text-xl font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--broadcast-text-muted)' }}
              >
                {t('attract.currentStandings')}
              </div>
              {data.standings.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center w-full px-6 py-2 rounded-lg gap-3"
                  style={{ background: 'var(--broadcast-surface-light)' }}
                >
                  <span
                    className="w-8 font-black"
                    style={{
                      color: s.rank <= 3 ? 'var(--broadcast-accent)' : 'var(--broadcast-text-muted)',
                    }}
                  >
                    {s.rank}
                  </span>
                  {s.avatar_url && (
                    <img
                      src={s.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover shrink-0"
                      style={{ border: '2px solid var(--broadcast-border)' }}
                    />
                  )}
                  <span className="flex-1 font-semibold" style={{ color: 'var(--broadcast-text)' }}>
                    {s.name}
                  </span>
                  <span className="font-mono tabular-nums" style={{ color: 'var(--broadcast-text)' }}>
                    {s.record}
                  </span>
                  {s.rating !== null && (
                    <span className="tabular-nums text-sm" style={{ color: 'var(--broadcast-text-muted)' }}>
                      {Math.round(s.rating)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );

        case 'recent':
          if (data.recent_results.length === 0) {
            return (
              <div className="text-lg" style={{ color: 'var(--broadcast-text-muted)' }}>
                {t('attract.inProgress')}
              </div>
            );
          }
          return (
            <div className="flex flex-col items-center gap-4 w-full max-w-lg">
              <div
                className="text-xl font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--broadcast-text-muted)' }}
              >
                {t('attract.recentResults')}
              </div>
              {data.recent_results.map((r) => (
                <div
                  key={r.match_id}
                  className="flex items-center w-full px-6 py-3 rounded-lg gap-3"
                  style={{ background: 'var(--broadcast-surface-light)' }}
                >
                  {/* Player 1 */}
                  <div className="flex items-center gap-2 flex-1">
                    {r.player1_avatar_url && (
                      <img
                        src={r.player1_avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                        style={{
                          border: r.winner_name === r.player1_name
                            ? '2px solid var(--broadcast-accent)'
                            : '2px solid var(--broadcast-border)',
                        }}
                      />
                    )}
                    <span
                      className={r.winner_name === r.player1_name ? 'font-bold' : ''}
                      style={{ color: 'var(--broadcast-text)' }}
                    >
                      {r.player1_name}
                    </span>
                  </div>

                  {/* Score */}
                  <div
                    className="font-mono font-bold tabular-nums px-3"
                    style={{ color: 'var(--broadcast-accent)' }}
                  >
                    {r.pokemon_score}
                  </div>

                  {/* Player 2 */}
                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <span
                      className={r.winner_name === r.player2_name ? 'font-bold' : ''}
                      style={{ color: 'var(--broadcast-text)' }}
                    >
                      {r.player2_name}
                    </span>
                    {r.player2_avatar_url && (
                      <img
                        src={r.player2_avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                        style={{
                          border: r.winner_name === r.player2_name
                            ? '2px solid var(--broadcast-accent)'
                            : '2px solid var(--broadcast-border)',
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          );

        case 'leaders':
          return (
            <div className="flex flex-col items-center gap-5">
              <div
                className="text-xl font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--broadcast-text-muted)' }}
              >
                {t('leaders.title')}
              </div>
              {data.leaders.most_kos && (
                <div className="flex items-center gap-3">
                  <OverlayPokemonSprite
                    pokemon={data.leaders.most_kos.pokemon_name}
                    size={40}
                    glowColor="rgba(239, 68, 68, 0.6)"
                  />
                  <div>
                    <div className="text-sm" style={{ color: 'var(--broadcast-accent)' }}>
                      {t('leaders.mostKos')}
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--broadcast-text)' }}>
                      {t('leaders.kosValue', {
                        pokemon: localizeSpecies(data.leaders.most_kos.pokemon_name, dl),
                        kos: data.leaders.most_kos.kos,
                      })}
                    </div>
                  </div>
                </div>
              )}
              {data.leaders.pokemon_mvp && (
                <div className="flex items-center gap-3">
                  <OverlayPokemonSprite
                    pokemon={data.leaders.pokemon_mvp.pokemon_name}
                    size={40}
                    glowColor="rgba(234, 179, 8, 0.6)"
                  />
                  <div>
                    <div className="text-sm" style={{ color: 'var(--broadcast-accent)' }}>
                      {t('leaders.pokemonMvp')}
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--broadcast-text)' }}>
                      {t('leaders.winRateValue', {
                        pokemon: localizeSpecies(data.leaders.pokemon_mvp.pokemon_name, dl),
                        rate: formatter.percentOf(data.leaders.pokemon_mvp.win_rate, 0),
                      })}
                    </div>
                  </div>
                </div>
              )}
              {data.leaders.best_record && (
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                    style={{ background: 'var(--broadcast-surface-light)', color: 'var(--broadcast-accent)' }}
                  >
                    #1
                  </div>
                  <div>
                    <div className="text-sm" style={{ color: 'var(--broadcast-accent)' }}>
                      {t('leaders.bestRecord')}
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--broadcast-text)' }}>
                      {t('leaders.recordValue', {
                        name: data.leaders.best_record.player_name,
                        wins: data.leaders.best_record.wins,
                        losses: data.leaders.best_record.losses,
                      })}
                    </div>
                  </div>
                </div>
              )}
              {!data.leaders.most_kos && !data.leaders.best_record && !data.leaders.pokemon_mvp && (
                <div style={{ color: 'var(--broadcast-text-muted)' }}>{t('leaders.none')}</div>
              )}
            </div>
          );

        default:
          return null;
      }
    },
    [data, t, dl, formatter],
  );

  if (!data) return null;

  const currentCard = cards[cardIndex];

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <AnimatedReveal
        key={currentCard}
        animation="fadeIn"
        className={`flex items-center justify-center ${transitionClass}`}
      >
        {renderCard(currentCard)}
      </AnimatedReveal>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
