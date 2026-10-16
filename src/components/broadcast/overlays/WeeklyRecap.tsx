'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayMatchCard from '../shared/OverlayMatchCard';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, EnrichedRecap } from '@/types/broadcast';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface WeeklyRecapProps {
  config: OverlayConfig;
  seasonId: string;
  tournamentId?: string;
  roundId?: string;
}

type RecapSection = 'headline' | 'results' | 'standings' | 'leaders' | 'narrative';

export default function WeeklyRecap({
  config,
  seasonId,
  tournamentId,
  roundId,
}: WeeklyRecapProps) {
  const t = useT(broadcastOverlaysMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const formatter = useFormatter();
  const [data, setData] = useState<EnrichedRecap | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);

  const sections: RecapSection[] = ['headline', 'results', 'standings', 'leaders', 'narrative'];

  useEffect(() => {
    async function load() {
      if (!tournamentId || !roundId) return;
      try {
        // `lang` lets the recap route write its generated text (why / narrative) in the overlay language.
        const url = `/api/broadcast/recap/${seasonId}?tournament_id=${tournamentId}&round_id=${roundId}&lang=${locale}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.success) setData(json.data);
      } catch {
        // Silently fail
      }
    }
    load();
  }, [seasonId, tournamentId, roundId, locale]);

  // Auto-advance sections
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => {
      setSectionIndex((prev) => (prev + 1) % sections.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [data, sections.length]);

  if (!data) return null;

  const currentSection = sections[sectionIndex];
  const displayTitle = data.round_name
    ? translateEngineLabel('round', data.round_name, locale)
    : t('recap.roundFallback', { n: data.round_number ?? '' });

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-8">
      {/* Header */}
      <div className="absolute top-6 left-0 right-0 text-center">
        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: 'var(--broadcast-text-muted)',
          }}
        >
          {data.league_name}
          {data.tournament_name && ` · ${data.tournament_name}`}
        </div>
        <div
          style={{
            fontSize: '28px',
            fontWeight: 900,
            color: 'var(--broadcast-accent)',
            marginTop: '4px',
          }}
        >
          {t('recap.title', { round: displayTitle })}
        </div>
      </div>

      {/* Section dots (progress indicator) */}
      <div
        className="absolute top-[72px] left-0 right-0 flex justify-center gap-2"
      >
        {sections.map((s, i) => (
          <div
            key={s}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: i === sectionIndex ? 'var(--broadcast-accent)' : 'var(--broadcast-text-muted)',
              opacity: i === sectionIndex ? 1 : 0.3,
              transition: 'background 0.3s, opacity 0.3s',
            }}
          />
        ))}
      </div>

      {/* Section content */}
      <AnimatedReveal key={currentSection} animation="fadeIn">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', maxWidth: '800px', width: '100%' }}>

          {/* ── Headline ── */}
          {currentSection === 'headline' && data.headline_result && (
            <>
              <SectionLabel>{t('recap.matchOfRound')}</SectionLabel>
              <OverlayMatchCard
                match={data.headline_result.match}
                showTeams
                avatarSize={48}
                teamSpriteSize={32}
              />
              {data.headline_result.why && (
                <div
                  style={{
                    fontSize: '14px',
                    fontStyle: 'italic',
                    color: 'var(--broadcast-text-muted)',
                    textAlign: 'center',
                    maxWidth: '500px',
                  }}
                >
                  {data.headline_result.why}
                </div>
              )}
            </>
          )}

          {/* ── Results ── */}
          {currentSection === 'results' && (
            <>
              <SectionLabel>{t('recap.results')}</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                {data.results.map((r) => (
                  <ResultRow key={r.match_id} match={r} />
                ))}
              </div>
            </>
          )}

          {/* ── Standings ── */}
          {currentSection === 'standings' && (
            <>
              <SectionLabel>{t('recap.movement')}</SectionLabel>
              {data.standings_movement.risers.length > 0 || data.standings_movement.fallers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  {data.standings_movement.risers.map((r) => (
                    <MovementRow
                      key={r.player_name}
                      name={r.player_name}
                      oldRank={r.old_rank}
                      newRank={r.new_rank}
                      direction="up"
                    />
                  ))}
                  {data.standings_movement.fallers.map((f) => (
                    <MovementRow
                      key={f.player_name}
                      name={f.player_name}
                      oldRank={f.old_rank}
                      newRank={f.new_rank}
                      direction="down"
                    />
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--broadcast-text-muted)', fontSize: '16px' }}>
                  {t('recap.noMovement')}
                </div>
              )}
            </>
          )}

          {/* ── Leaders ── */}
          {currentSection === 'leaders' && (
            <>
              <SectionLabel>{t('leaders.title')}</SectionLabel>
              <div style={{ display: 'flex', gap: '32px', justifyContent: 'center', flexWrap: 'wrap' }}>
                {data.stat_leaders.most_kos && (
                  <LeaderCard
                    label={t('leaders.mostKos')}
                    pokemon={localizeSpecies(data.stat_leaders.most_kos.pokemon_name, dl)}
                    spriteName={data.stat_leaders.most_kos.pokemon_name}
                    value={t('common.kos', { count: data.stat_leaders.most_kos.kos })}
                  />
                )}
                {data.stat_leaders.pokemon_mvp && (
                  <LeaderCard
                    label={t('leaders.pokemonMvp')}
                    pokemon={localizeSpecies(data.stat_leaders.pokemon_mvp.pokemon_name, dl)}
                    spriteName={data.stat_leaders.pokemon_mvp.pokemon_name}
                    value={t('common.winRate', { rate: formatter.percent(data.stat_leaders.pokemon_mvp.win_rate, 0) })}
                  />
                )}
                {data.stat_leaders.best_record && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--broadcast-text-muted)' }}>
                      {t('leaders.bestRecord')}
                    </span>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--broadcast-text)' }}>
                      {data.stat_leaders.best_record.player_name}
                    </span>
                    <span style={{ fontSize: '14px', color: 'var(--broadcast-accent)' }}>
                      {t('common.record', {
                        wins: data.stat_leaders.best_record.wins,
                        losses: data.stat_leaders.best_record.losses,
                      })}
                    </span>
                  </div>
                )}
              </div>
              {!data.stat_leaders.most_kos && !data.stat_leaders.pokemon_mvp && !data.stat_leaders.best_record && (
                <div style={{ color: 'var(--broadcast-text-muted)', fontSize: '16px' }}>
                  {t('leaders.notEnough')}
                </div>
              )}
            </>
          )}

          {/* ── Narrative ── */}
          {currentSection === 'narrative' && (
            <>
              <SectionLabel>{t('recap.story')}</SectionLabel>
              {data.narrative ? (
                <div
                  style={{
                    fontSize: '18px',
                    lineHeight: 1.6,
                    textAlign: 'center',
                    fontStyle: 'italic',
                    color: 'var(--broadcast-text)',
                    maxWidth: '600px',
                  }}
                >
                  {data.narrative}
                </div>
              ) : (
                <div style={{ color: 'var(--broadcast-text-muted)', fontSize: '16px' }}>
                  {t('recap.noStory')}
                </div>
              )}
            </>
          )}
        </div>
      </AnimatedReveal>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.15em',
        color: 'var(--broadcast-text-muted)',
      }}
    >
      {children}
    </div>
  );
}

function ResultRow({ match }: { match: EnrichedRecap['results'][0] }) {
  const isP1Winner = match.winner_id === match.player1_id;
  const isP2Winner = match.winner_id === match.player2_id;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        borderRadius: '8px',
        background: 'var(--broadcast-surface-light)',
      }}
    >
      {/* P1 avatar + name */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
        <span
          style={{
            fontSize: '14px',
            fontWeight: isP1Winner ? 800 : 500,
            color: isP1Winner ? 'var(--broadcast-text)' : 'var(--broadcast-text-muted)',
          }}
        >
          {match.player1_name}
        </span>
        <div style={{ position: 'relative' }}>
          <PlayerAvatar
            avatarUrl={match.player1_avatar_url}
            name={match.player1_name}
            size={32}
          />
          {isP1Winner && (
            <div
              style={{
                position: 'absolute',
                inset: '-2px',
                borderRadius: '50%',
                border: '2px solid var(--broadcast-accent)',
              }}
            />
          )}
        </div>
      </div>

      {/* Scores */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
        <span
          style={{
            fontSize: '18px',
            fontWeight: 900,
            color: 'var(--broadcast-accent)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {match.pokemon_score}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--broadcast-text-muted)' }}>
          ({match.series_score})
        </span>
      </div>

      {/* P2 avatar + name */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ position: 'relative' }}>
          <PlayerAvatar
            avatarUrl={match.player2_avatar_url}
            name={match.player2_name}
            size={32}
          />
          {isP2Winner && (
            <div
              style={{
                position: 'absolute',
                inset: '-2px',
                borderRadius: '50%',
                border: '2px solid var(--broadcast-accent)',
              }}
            />
          )}
        </div>
        <span
          style={{
            fontSize: '14px',
            fontWeight: isP2Winner ? 800 : 500,
            color: isP2Winner ? 'var(--broadcast-text)' : 'var(--broadcast-text-muted)',
          }}
        >
          {match.player2_name}
        </span>
      </div>
    </div>
  );
}

function MovementRow({
  name,
  oldRank,
  newRank,
  direction,
}: {
  name: string;
  oldRank: number;
  newRank: number;
  direction: 'up' | 'down';
}) {
  const color = direction === 'up' ? 'rgb(34,197,94)' : 'rgb(239,68,68)';
  const arrow = direction === 'up' ? '\u25B2' : '\u25BC';
  const diff = Math.abs(oldRank - newRank);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 16px',
        borderRadius: '8px',
        background: 'var(--broadcast-surface-light)',
      }}
    >
      <span style={{ fontSize: '18px', color, fontWeight: 800 }}>{arrow}</span>
      <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--broadcast-text)', flex: 1 }}>
        {name}
      </span>
      <span style={{ fontSize: '14px', color: 'var(--broadcast-text-muted)' }}>
        #{oldRank}
      </span>
      <span style={{ fontSize: '14px', color }}>→</span>
      <span style={{ fontSize: '14px', fontWeight: 700, color }}>
        #{newRank}
      </span>
      <span style={{ fontSize: '11px', color, fontWeight: 700 }}>
        (+{diff})
      </span>
    </div>
  );
}

function LeaderCard({
  label,
  pokemon,
  spriteName,
  value,
}: {
  label: string;
  /** Display name (already localized). */
  pokemon: string;
  /** English species name for the sprite. */
  spriteName: string;
  value: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--broadcast-text-muted)',
        }}
      >
        {label}
      </span>
      <OverlayPokemonSprite
        pokemon={spriteName}
        size={64}
        glowColor="rgba(234,179,8,0.5)"
      />
      <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--broadcast-text)' }}>
        {pokemon}
      </span>
      <span style={{ fontSize: '14px', color: 'var(--broadcast-accent)' }}>
        {value}
      </span>
    </div>
  );
}
