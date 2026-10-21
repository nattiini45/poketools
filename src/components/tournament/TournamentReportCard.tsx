'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import TypeSprite from '@/components/shared/TypeSprite';
import Badge from '@/components/ui/Badge';
import type {
  TournamentReport,
  RoundRecapContent,
  RoundForecastContent,
  RoundRecapMatchData,
} from '@/types/tournament-report';
import { useDataLocale, useT } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

const KALE_IMAGE = '/characters/Kale-Cabbage.jpg';
const LINDEN_IMAGE = '/characters/professor-linden.png';
const KALE_SIZE = 44;

function KalePortrait({ size = KALE_SIZE }: { size?: number }) {
  const t = useT(tournamentsMessages);
  return (
    <Image
      src={KALE_IMAGE}
      alt={t('report.kale')}
      width={size}
      height={size}
      className="rounded-full shrink-0 object-cover"
      unoptimized
    />
  );
}

interface TournamentReportCardProps {
  report: TournamentReport;
  isAdmin?: boolean;
  tournamentId: string;
}

export default function TournamentReportCard({
  report,
  isAdmin: isAdminProp,
  tournamentId,
}: TournamentReportCardProps) {
  const t = useT(tournamentsMessages);
  const { data: session } = useSession();
  const isAdmin = isAdminProp ?? session?.player?.isAdmin ?? false;
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const isRecap = report.report_type === 'round_recap';
  const content = report.content;
  const headline = 'headline' in content ? content.headline : '';

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch('/api/ai/tournament-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: tournamentId,
          round_id: report.round_id,
          report_type: report.report_type,
          force: true,
        }),
      });
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          if (text.includes('"status":"done"') || text.includes('"status":"failed"')) break;
        }
      }
      window.location.reload();
    } catch {
      setRegenerating(false);
    }
  }

  if (report.status === 'pending') {
    return (
      <div className="border border-poke-border rounded-poke-lg p-4">
        <div className="flex items-center gap-3">
          <KalePortrait />
          <div>
            <span className="text-sm font-heading font-semibold text-poke-text-secondary">{t('report.kale')}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-3 h-3 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
              <span className="text-xs text-poke-text-muted">
                {isRecap ? t('report.writingRecap') : t('report.writingForecast')}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (report.status === 'failed') {
    return (
      <div className="border border-red-500/30 rounded-poke-lg p-4">
        <div className="flex items-center gap-3">
          <KalePortrait />
          <span className="text-sm text-poke-text-muted">
            {t('report.failed')}
          </span>
        </div>
        {isAdmin && (
          <button onClick={handleRegenerate} disabled={regenerating} className="mt-2 text-xs text-poke-blue hover:underline disabled:opacity-50">
            {regenerating ? t('report.regenerating') : t('report.retry')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="border border-poke-border rounded-poke-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-poke-elevated transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <KalePortrait size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('report.kale')}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                isRecap ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
              }`}>
                {isRecap ? t('report.recap') : t('report.preview')}
              </span>
            </div>
            <p className="text-sm font-heading font-medium text-poke-text-primary truncate">{headline}</p>
          </div>
        </div>
        <span className="text-poke-text-muted text-xs shrink-0 ml-2">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {isRecap ? (
            <RecapContent content={content as RoundRecapContent} tournamentId={tournamentId} />
          ) : (
            <ForecastContent content={content as RoundForecastContent} />
          )}
          {isAdmin && (
            <div className="pt-2 border-t border-poke-border">
              <button onClick={handleRegenerate} disabled={regenerating} className="text-xs text-poke-text-muted hover:text-poke-text-secondary disabled:opacity-50">
                {regenerating ? t('report.regenerating') : t('report.regenerate')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Species display name ────────────────────────────────────────────

/**
 * A stored English species name in the viewer's data locale. Only the visible
 * text is localized: sprites, links and the type lookup keep the English value.
 */
function SpeciesName({ name }: { name: string }) {
  const dataLocale = useDataLocale();
  return <>{localizeSpecies(name, dataLocale)}</>;
}

// ─── Inline Pokémon Name (sprite + type badges + link) ──────────────

function InlinePokemon({
  name,
  types,
  showSprite = true,
}: {
  name: string;
  types?: string[];
  showSprite?: boolean;
}) {
  return (
    <Link
      href={`/pokemon/${encodeURIComponent(name)}`}
      className="inline-flex items-center gap-0.5 align-middle hover:text-poke-blue transition-colors"
      style={{ lineHeight: 'inherit' }}
    >
      {showSprite && <PokemonSprite name={name} size={13} className="shrink-0" />}
      {types?.map((t) => <TypeSprite key={t} type={t} size={12} className="shrink-0" />)}
      <span className="text-[13px] font-heading font-semibold text-poke-text-primary"><SpeciesName name={name} /></span>
    </Link>
  );
}

// ─── Player Name Link ───────────────────────────────────────────────

function PlayerNameLink({
  name,
  playerId,
  className = '',
}: {
  name: string;
  playerId: string;
  className?: string;
}) {
  if (!playerId) {
    return <span className={`font-heading font-semibold text-poke-text-primary ${className}`}>{name}</span>;
  }
  return (
    <Link
      href={`/players/${playerId}`}
      className={`font-heading font-semibold text-poke-text-primary hover:text-poke-blue transition-colors ${className}`}
    >
      {name}
    </Link>
  );
}

// ─── Enrich narrative text with Pokémon sprites + type badges ────────

/**
 * Scans text for known Pokémon names and replaces them with rich inline
 * components (sprite + type badges + link). Falls back to plain text for
 * names not in the pokemonTypes lookup.
 */
function EnrichedText({
  text,
  pokemonTypes,
}: {
  text: string;
  pokemonTypes: Record<string, string[]>;
}) {
  const pokemonNames = useMemo(
    () => Object.keys(pokemonTypes).sort((a, b) => b.length - a.length),
    [pokemonTypes]
  );

  // Build regex matching any known Pokémon name (longest first to avoid partial matches)
  const pattern = useMemo(() => {
    if (pokemonNames.length === 0) {
      return null;
    }
    const escaped = pokemonNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
  }, [pokemonNames]);

  if (!pattern) {
    return <span>{text}</span>;
  }

  const parts: (string | { name: string; key: number })[] = [];
  let lastIndex = 0;
  let keyCounter = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ name: match[1], key: keyCounter++ });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <span>
      {parts.map((part) =>
        typeof part === 'string' ? (
          part
        ) : (
          <InlinePokemon
            key={part.key}
            name={part.name}
            types={pokemonTypes[part.name]}
          />
        )
      )}
    </span>
  );
}

// ─── Recap Content ──────────────────────────────────────────────────

function RecapContent({ content, tournamentId }: { content: RoundRecapContent; tournamentId: string }) {
  const t = useT(tournamentsMessages);
  const matchData = content.match_data ?? [];
  const pokemonTypes = content.pokemon_types ?? {};

  return (
    <>
      {/* Narrative — with enriched Pokémon names */}
      <div className="text-sm text-poke-text-secondary leading-relaxed">
        {content.narrative.split('\n\n').map((paragraph, i) => (
          <p key={i} className="mb-3 last:mb-0">
            <EnrichedText text={paragraph} pokemonTypes={pokemonTypes} />
          </p>
        ))}
      </div>

      {/* Match Result Cards */}
      {matchData.length > 0 && (
        <div>
          <h4 className="text-xs font-heading font-semibold text-poke-text-primary mb-3 uppercase tracking-wider">
            {t('report.matchResults')}
          </h4>
          <div className="space-y-3">
            {matchData.map((md, i) => {
              // Use AI-generated one-liner + mvp_pokemon from match_summaries for Linden's analysis
              const summary = content.match_summaries[i];
              return (
                <MatchResultCard
                  key={i}
                  matchData={md}
                  oneLiner={summary?.one_liner}
                  lindenMvpName={summary?.mvp_pokemon}
                  pokemonTypes={pokemonTypes}
                  matchHref={md.match_id ? `/tournaments/${tournamentId}/matches/${md.match_id}` : undefined}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback for legacy reports without match_data */}
      {matchData.length === 0 && content.match_summaries.length > 0 && (
        <div>
          <h4 className="text-xs font-heading font-semibold text-poke-text-primary mb-2 uppercase tracking-wider">
            {t('report.matchResults')}
          </h4>
          <div className="space-y-1">
            {content.match_summaries.map((ms, i) => (
              <div key={i} className="text-sm flex items-center gap-2">
                <span className="text-poke-text-muted">{ms.score}</span>
                <span className="font-medium text-poke-text-primary">
                  {t('report.defeated', {
                    winner: ms.winner_name,
                    loser: ms.player_1_name === ms.winner_name ? ms.player_2_name : ms.player_1_name,
                  })}
                </span>
                <span className="text-xs text-poke-text-muted">— {ms.one_liner}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player Spotlight + Spicy Pick */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {content.player_spotlight.player_name && (
          <div className="bg-poke-elevated rounded-poke-md p-3">
            <h4 className="text-xs font-heading font-semibold text-poke-text-primary mb-2 uppercase tracking-wider">
              {t('report.playerSpotlight')}
            </h4>
            <div className="flex items-center gap-2 mb-1.5">
              <PlayerAvatar name={content.player_spotlight.player_name} size={28} />
              <PlayerNameLink
                name={content.player_spotlight.player_name}
                playerId={content.player_spotlight.player_id ?? ''}
              />
            </div>
            <p className="text-xs text-poke-text-secondary leading-relaxed">
              <EnrichedText text={content.player_spotlight.reason} pokemonTypes={pokemonTypes} />
            </p>
          </div>
        )}

        {content.spicy_pick && (
          <div className="bg-poke-elevated rounded-poke-md p-3">
            <h4 className="text-xs font-heading font-semibold text-poke-text-primary mb-2 uppercase tracking-wider">
              {t('report.spicyPick')}
            </h4>
            <div className="flex items-center gap-2 mb-1.5">
              <PokemonSprite name={content.spicy_pick.pokemon_name} size={28} />
              <PokemonLink name={content.spicy_pick.pokemon_name} className="inline-flex items-center gap-1">
                <span className="text-sm font-heading font-bold text-poke-text-primary">
                  <SpeciesName name={content.spicy_pick.pokemon_name} />
                </span>
                {pokemonTypes[content.spicy_pick.pokemon_name]?.map((t) => (
                  <TypeSprite key={t} type={t} size={12} />
                ))}
              </PokemonLink>
            </div>
            <p className="text-xs text-poke-text-muted mb-1">
              {t.rich('report.usedBy', {
                player: (
                  <PlayerNameLink
                    name={content.spicy_pick.player_name}
                    playerId={content.spicy_pick.player_id ?? ''}
                    className="text-xs"
                  />
                ),
              })}
            </p>
            <p className="text-xs text-poke-text-secondary leading-relaxed">
              <EnrichedText text={content.spicy_pick.context} pokemonTypes={pokemonTypes} />
            </p>
          </div>
        )}
      </div>

      {/* Standings + Meta */}
      {content.standings_story && (
        <div className="text-sm text-poke-text-secondary">
          <span className="font-heading font-semibold text-poke-text-primary">{t('report.standings')}{' '}</span>
          <EnrichedText text={content.standings_story} pokemonTypes={pokemonTypes} />
        </div>
      )}
      {content.meta_trends && (
        <div className="text-sm text-poke-text-secondary">
          <span className="font-heading font-semibold text-poke-text-primary">{t('report.meta')}{' '}</span>
          <EnrichedText text={content.meta_trends} pokemonTypes={pokemonTypes} />
        </div>
      )}
    </>
  );
}

// ─── Match Result Card ──────────────────────────────────────────────

function MatchResultCard({
  matchData,
  oneLiner,
  lindenMvpName,
  pokemonTypes,
  matchHref,
}: {
  matchData: RoundRecapMatchData;
  oneLiner?: string;
  lindenMvpName?: string;
  pokemonTypes: Record<string, string[]>;
  matchHref?: string;
}) {
  const t = useT(tournamentsMessages);
  const isP1Winner = matchData.winner_id === matchData.player_1_id;

  // Use Linden's AI-chosen MVP if available, otherwise fall back to data MVP
  const mvpName = lindenMvpName || matchData.mvp_pokemon;

  return (
    <div className={`relative border border-poke-border rounded-poke-md overflow-hidden${matchHref ? ' hover:border-poke-blue/50 transition-colors' : ''}`}>
      {matchHref && (
        <Link href={matchHref} className="absolute inset-0 z-0" aria-label={t('report.viewMatch', { player1: matchData.player_1_name, player2: matchData.player_2_name })} />
      )}
      {/* Score header — 3-column grid for perfect centering */}
      <div className="relative z-10 px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* Player 1 — left aligned */}
        <div className="flex items-center gap-2">
          <PlayerAvatar
            avatarUrl={matchData.player_1_avatar_url}
            name={matchData.player_1_name}
            size={36}
            className={isP1Winner ? '!ring-2 !ring-poke-green' : ''}
          />
          <div>
            <PlayerNameLink
              name={matchData.player_1_name}
              playerId={matchData.player_1_id}
              className={`text-sm ${isP1Winner ? '' : 'opacity-60'}`}
            />
            <p className="text-[10px] text-poke-text-muted">
              {t('report.kos', { count: matchData.p1_total_kos })}
            </p>
          </div>
        </div>

        {/* Score — always centered */}
        <div className="flex items-center gap-3">
          <span className={`text-xl font-heading font-bold tabular-nums ${isP1Winner ? 'text-poke-text-primary' : 'text-poke-text-muted'}`}>
            {matchData.p1_score}
          </span>
          <span className="text-poke-text-muted text-sm">—</span>
          <span className={`text-xl font-heading font-bold tabular-nums ${!isP1Winner ? 'text-poke-text-primary' : 'text-poke-text-muted'}`}>
            {matchData.p2_score}
          </span>
        </div>

        {/* Player 2 — right aligned */}
        <div className="flex items-center gap-2 justify-end">
          <div className="text-right">
            <PlayerNameLink
              name={matchData.player_2_name}
              playerId={matchData.player_2_id}
              className={`text-sm ${!isP1Winner ? '' : 'opacity-60'}`}
            />
            <p className="text-[10px] text-poke-text-muted text-right">
              {t('report.kos', { count: matchData.p2_total_kos })}
            </p>
          </div>
          <PlayerAvatar
            avatarUrl={matchData.player_2_avatar_url}
            name={matchData.player_2_name}
            size={36}
            className={!isP1Winner ? '!ring-2 !ring-poke-green' : ''}
          />
        </div>
      </div>

      {/* Professor Linden's MVP */}
      {mvpName && (
        <div className="relative z-10 px-4 pb-3">
          <div className="bg-poke-yellow-light rounded-poke-md p-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Image
                src={LINDEN_IMAGE}
                alt={t('report.linden')}
                width={20}
                height={20}
                className="rounded-full object-cover shrink-0"
                unoptimized
              />
              <span className="text-[10px] font-heading font-bold text-poke-yellow-ink uppercase tracking-wide">
                {t('report.lindenMvp')}
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="shrink-0 ring-2 ring-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.4)] rounded-full p-0.5">
                <PokemonSprite name={mvpName} size={36} animated />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="yellow" size="xs">{t('report.mvp')}</Badge>
                  {/* No minisprite here — the big animated sprite is right next to it */}
                  <PokemonLink name={mvpName} className="inline-flex items-center gap-1">
                    <span className="text-sm font-heading font-bold text-poke-text-primary"><SpeciesName name={mvpName} /></span>
                    {pokemonTypes[mvpName]?.map((t) => (
                      <TypeSprite key={t} type={t} size={12} />
                    ))}
                  </PokemonLink>
                  {matchData.mvp_kos > 0 && (
                    <span className="text-[10px] text-poke-text-muted">
                      {t('report.kos', { count: matchData.mvp_kos })}
                    </span>
                  )}
                </div>
                {oneLiner && (
                  <p className="text-xs text-poke-text-secondary mt-1 leading-relaxed">
                    <EnrichedText text={oneLiner} pokemonTypes={pokemonTypes} />
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Forecast Content ───────────────────────────────────────────────

function ForecastContent({ content }: { content: RoundForecastContent }) {
  const t = useT(tournamentsMessages);
  return (
    <>
      <div className="text-sm text-poke-text-secondary whitespace-pre-wrap leading-relaxed">
        {content.narrative}
      </div>

      {content.matchup_previews.length > 0 && (
        <div>
          <h4 className="text-xs font-heading font-semibold text-poke-text-primary mb-2 uppercase tracking-wider">
            {t('report.matchupPreviews')}
          </h4>
          <div className="space-y-3">
            {content.matchup_previews.map((mp, i) => (
              <div key={i} className="bg-poke-elevated rounded-poke-md p-3">
                <p className="text-sm font-medium text-poke-text-primary">
                  {t('report.matchup', { player1: mp.player_1_name, player2: mp.player_2_name })}
                </p>
                <p className="text-xs text-poke-text-secondary mt-1">{mp.storyline}</p>
                <p className="text-xs text-poke-text-muted mt-1">
                  {t('report.edgeWatch', { edge: mp.edge, pokemon: mp.key_pokemon })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.bold_prediction && (
        <div className="bg-poke-elevated rounded-poke-md p-3 border-l-2 border-poke-accent">
          <h4 className="text-xs font-heading font-semibold text-poke-accent mb-1 uppercase tracking-wider">
            {t('report.boldPrediction')}
          </h4>
          <p className="text-sm text-poke-text-secondary">{content.bold_prediction}</p>
        </div>
      )}

      {content.standings_context && (
        <div className="text-sm text-poke-text-secondary">
          <span className="font-heading font-semibold text-poke-text-primary">{t('report.stakes')}{' '}</span>
          {content.standings_context}
        </div>
      )}
    </>
  );
}
