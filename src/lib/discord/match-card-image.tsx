/* eslint-disable @next/next/no-img-element */
/**
 * Server-side match card image generator for Discord webhook spoiler attachments.
 *
 * Uses next/og ImageResponse (satori + resvg) to render JSX → PNG.
 * Combines the gradient VS aesthetic with full roster detail.
 *
 * satori decodes only PNG, APNG, JPEG, GIF and SVG. Player avatars are 256 px
 * WebP thumbnails (D37), so each avatar is fetched here and rasterised to a PNG
 * data URI before rendering (`avatarPngDataUri`). An avatar that cannot be
 * fetched or decoded renders as the initials fallback.
 */
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { loadFonts } from './fonts';
import { homeSpriteUrl } from '@/lib/pkmn/sprite-styles';
import { avatarStoragePathFromUrl, supabasePublicOrigin } from '@/lib/avatar/thumbnail-path';
import { parseShowdownTrainerSpriteUrl } from '@/lib/avatar/showdown-sprite';
import type { MatchConfirmedData } from '@/types/discord';
import type { Locale } from '@/i18n/config';
import { createTranslator, type Translator } from '@/i18n/core';
import { outboundDiscordMessages } from '@/i18n/messages/outbound/discord';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

type CardT = Translator<typeof outboundDiscordMessages.en>;

// ── Constants ────────────────────────────────────────────────────────

const CARD_WIDTH = 600;
/** The avatar slot is 44 px; rasterise at 2x so it stays crisp. */
const AVATAR_SLOT_PX = 44;
const AVATAR_RASTER_PX = AVATAR_SLOT_PX * 2;
const AVATAR_FETCH_TIMEOUT_MS = 5_000;
/** The largest avatar original is 5 MB; thumbnails are ≤ ~30 KB. */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Decompression-bomb guard, as in `src/lib/avatar/thumbnail.ts`. */
const AVATAR_MAX_INPUT_PIXELS = 25_000_000;

// ── Avatar rasterisation (satori cannot decode WebP) ──────────────────

/**
 * The URL to fetch for a stored avatar, or null when it is not one of the two
 * places a player avatar can live: this project's `avatars` bucket (origin and
 * path checked) or a canonical Showdown trainer sprite. Nothing else is fetched.
 */
function fetchableAvatarUrl(avatarUrl: string): string | null {
  const origin = supabasePublicOrigin();
  if (origin && avatarStoragePathFromUrl(avatarUrl, origin)) return new URL(avatarUrl).href;
  return parseShowdownTrainerSpriteUrl(avatarUrl)?.url ?? null;
}

/**
 * Fetch a player's avatar and rasterise it to a square PNG data URI that
 * satori can decode. Returns null (the card then shows the initials) when
 * there is no avatar, the URL is not an avatar location, or the fetch or
 * decode fails; each cause is logged with its own message.
 */
export async function avatarPngDataUri(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl) return null;

  const url = fetchableAvatarUrl(avatarUrl);
  if (!url) {
    console.warn('[Discord] Match card avatar skipped: not a project Storage or Showdown sprite URL');
    return null;
  }

  let body: Buffer;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      console.error(`[Discord] Match card avatar fetch failed: HTTP ${response.status} for ${url}`);
      return null;
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > AVATAR_MAX_BYTES) {
      console.error(`[Discord] Match card avatar too large (${declared} bytes declared): ${url}`);
      return null;
    }
    body = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error(`[Discord] Match card avatar fetch failed for ${url}:`, err);
    return null;
  }

  if (body.length > AVATAR_MAX_BYTES) {
    console.error(`[Discord] Match card avatar too large (${body.length} bytes): ${url}`);
    return null;
  }

  try {
    const png = await sharp(body, { limitInputPixels: AVATAR_MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_RASTER_PX, AVATAR_RASTER_PX, { fit: 'cover' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    console.error(`[Discord] Match card avatar could not be rasterised to PNG: ${url}`, err);
    return null;
  }
}

// ── Types ────────────────────────────────────────────────────────────

interface AggregatedPokemon {
  name: string;
  totalKos: number;
  wasKoed: boolean;
  isMvp: boolean;
}

interface PlayerSummary {
  name: string;
  avatarUrl: string | null;
  isWinner: boolean;
  score: number;
  pokemon: AggregatedPokemon[];
  totalKos: number;
}

// ── Data aggregation ─────────────────────────────────────────────────

function aggregatePlayerData(data: MatchConfirmedData): {
  player1: PlayerSummary;
  player2: PlayerSummary;
} {
  const [s1, s2] = data.game_score.split('-').map(Number);
  const p1Pokemon = new Map<string, { kos: number; koed: boolean }>();
  const p2Pokemon = new Map<string, { kos: number; koed: boolean }>();

  if (data.game_stats) {
    for (const game of data.game_stats) {
      for (const player of game.players) {
        const isP1 = player.player_name === data.player_1_name;
        const map = isP1 ? p1Pokemon : p2Pokemon;
        for (const p of player.pokemon) {
          const existing = map.get(p.pokemon_name);
          if (existing) {
            existing.kos += p.kos_dealt;
            existing.koed = existing.koed || p.was_koed;
          } else {
            map.set(p.pokemon_name, { kos: p.kos_dealt, koed: p.was_koed });
          }
        }
      }
    }
  }

  function toAggregated(map: Map<string, { kos: number; koed: boolean }>): AggregatedPokemon[] {
    const arr = Array.from(map.entries()).map(([name, stats]) => ({
      name,
      totalKos: stats.kos,
      wasKoed: stats.koed,
      isMvp: false,
    }));
    if (arr.length > 0) {
      const maxKos = Math.max(...arr.map((p) => p.totalKos));
      if (maxKos > 0) {
        const mvp = arr.find((p) => p.totalKos === maxKos);
        if (mvp) mvp.isMvp = true;
      }
    }
    arr.sort((a, b) => {
      if (a.isMvp !== b.isMvp) return a.isMvp ? -1 : 1;
      return b.totalKos - a.totalKos;
    });
    return arr;
  }

  const p1Agg = toAggregated(p1Pokemon);
  const p2Agg = toAggregated(p2Pokemon);

  return {
    player1: {
      name: data.player_1_name,
      avatarUrl: data.player_1_avatar_url ?? null,
      isWinner: data.winner_name === data.player_1_name,
      score: s1,
      pokemon: p1Agg,
      totalKos: p1Agg.reduce((sum, p) => sum + p.totalKos, 0),
    },
    player2: {
      name: data.player_2_name,
      avatarUrl: data.player_2_avatar_url ?? null,
      isWinner: data.winner_name === data.player_2_name,
      score: s2,
      pokemon: p2Agg,
      totalKos: p2Agg.reduce((sum, p) => sum + p.totalKos, 0),
    },
  };
}

// ── Sub-components (satori JSX, inline styles only) ──────────────────

function Badge({
  children,
  bg,
  color,
}: {
  children: string;
  bg: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: 'flex',
        padding: '3px 8px',
        borderRadius: 6,
        backgroundColor: bg,
        color,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: 'Nunito',
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

function PlayerAvatar({
  name,
  avatarUrl,
  isWinner,
}: {
  name: string;
  avatarUrl: string | null;
  isWinner: boolean;
}) {
  const borderColor = isWinner ? '#facc15' : 'rgba(255,255,255,0.2)';
  return (
    <div
      style={{
        display: 'flex',
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: `2px solid ${borderColor}`,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          width={44}
          height={44}
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontFamily: 'Nunito',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function PokemonRow({ p, t, lang }: { p: AggregatedPokemon; t: CardT; lang: Locale }) {
  // Sprites are keyed by the canonical English name; only the label is localized.
  // HOME PNG on purpose, not the site default: satori (next/og) cannot decode the
  // broadcast WebP renders and would drop the image (the AGENTS.md avatar rule).
  const spriteUrl = homeSpriteUrl(p.name);
  const ringColor = p.isMvp
    ? '#facc15'
    : p.wasKoed
      ? 'rgba(239,68,68,0.5)'
      : 'rgba(34,197,94,0.5)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: `2px solid ${ringColor}`,
          backgroundColor: 'rgba(0,0,0,0.3)',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <img src={spriteUrl} alt={localizeSpecies(p.name, lang)} width={36} height={36} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {p.isMvp && <Badge bg="rgba(250,204,21,0.25)" color="#facc15">{t('matchCard.mvp')}</Badge>}
        {p.totalKos > 0 && (
          <Badge bg="rgba(34,197,94,0.25)" color="#4ade80">
            {t('matchCard.kos', { count: p.totalKos })}
          </Badge>
        )}
        {p.wasKoed && (
          <Badge bg="rgba(239,68,68,0.25)" color="#f87171">{t('matchCard.fainted')}</Badge>
        )}
      </div>
    </div>
  );
}

function RosterColumn({ player, t, lang }: { player: PlayerSummary; t: CardT; lang: Locale }) {
  if (player.pokemon.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.25)',
        borderRadius: 12,
        padding: '10px 12px',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontFamily: 'Nunito',
            fontWeight: 700,
            color: player.isWinner ? '#facc15' : 'rgba(255,255,255,0.6)',
          }}
        >
          {player.name}
        </span>
        {player.isWinner && (
          <Badge bg="rgba(34,197,94,0.25)" color="#4ade80">{t('matchCard.winner')}</Badge>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {player.pokemon.map((p) => (
          <PokemonRow key={p.name} p={p} t={t} lang={lang} />
        ))}
      </div>
    </div>
  );
}

// ── Main card JSX ────────────────────────────────────────────────────

/** The card tree for satori. Exported for tests (text assertions without rasterising). */
export function MatchCard({ data, lang }: { data: MatchConfirmedData; lang: Locale }) {
  const t = createTranslator(outboundDiscordMessages, lang);
  const { player1, player2 } = aggregatePlayerData(data);
  const hasPokemon = player1.pokemon.length > 0 || player2.pokemon.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: CARD_WIDTH,
        background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 50%, #111827 100%)',
        borderRadius: 16,
        overflow: 'hidden',
        fontFamily: 'DM Sans',
        color: '#ffffff',
        position: 'relative',
      }}
    >
      {/* Decorative gradient overlays */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(88,101,242,0.15) 0%, transparent 70%)',
        }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: -30,
          left: -30,
          width: 150,
          height: 150,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
        }}
      />

      {/* Header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          backgroundColor: 'rgba(0,0,0,0.3)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: 'Nunito',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {data.tournament_name}
        </span>
        <Badge bg="rgba(34,197,94,0.2)" color="#4ade80">{t('matchCard.confirmed')}</Badge>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 18px 14px',
          gap: 14,
        }}
      >
        {/* Score row with avatars */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          {/* Player 1 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              gap: 4,
            }}
          >
            <PlayerAvatar
              name={player1.name}
              avatarUrl={player1.avatarUrl}
              isWinner={player1.isWinner}
            />
            <span
              style={{
                fontSize: 15,
                fontFamily: 'Nunito',
                fontWeight: player1.isWinner ? 800 : 600,
                color: player1.isWinner ? '#facc15' : 'rgba(255,255,255,0.85)',
              }}
            >
              {player1.name}
            </span>
            {player1.isWinner && (
              <span
                style={{
                  fontSize: 9,
                  fontFamily: 'Nunito',
                  fontWeight: 700,
                  color: 'rgba(250,204,21,0.5)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  marginTop: -2,
                }}
              >
                {t('matchCard.winner')}
              </span>
            )}
          </div>

          {/* Score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 36,
                fontFamily: 'Nunito',
                fontWeight: 800,
                color: player1.isWinner ? '#ffffff' : 'rgba(255,255,255,0.35)',
              }}
            >
              {player1.score}
            </span>
            <span
              style={{
                fontSize: 20,
                fontFamily: 'Nunito',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.2)',
              }}
            >
              :
            </span>
            <span
              style={{
                fontSize: 36,
                fontFamily: 'Nunito',
                fontWeight: 800,
                color: player2.isWinner ? '#ffffff' : 'rgba(255,255,255,0.35)',
              }}
            >
              {player2.score}
            </span>
          </div>

          {/* Player 2 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              gap: 4,
            }}
          >
            <PlayerAvatar
              name={player2.name}
              avatarUrl={player2.avatarUrl}
              isWinner={player2.isWinner}
            />
            <span
              style={{
                fontSize: 15,
                fontFamily: 'Nunito',
                fontWeight: player2.isWinner ? 800 : 600,
                color: player2.isWinner ? '#facc15' : 'rgba(255,255,255,0.85)',
              }}
            >
              {player2.name}
            </span>
            {player2.isWinner && (
              <span
                style={{
                  fontSize: 9,
                  fontFamily: 'Nunito',
                  fontWeight: 700,
                  color: 'rgba(250,204,21,0.5)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  marginTop: -2,
                }}
              >
                {t('matchCard.winner')}
              </span>
            )}
          </div>
        </div>

        {/* Roster strips — side-by-side columns */}
        {hasPokemon && (
          <div style={{ display: 'flex', gap: 10 }}>
            <RosterColumn player={player1} t={t} lang={lang} />
            <RosterColumn player={player2} t={t} lang={lang} />
          </div>
        )}

        {/* Quick stats footer */}
        {hasPokemon && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              paddingTop: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 11,
                fontFamily: 'Nunito',
                color: 'rgba(255,255,255,0.35)',
              }}
            >
              <span>
                <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>
                  {player1.name}:
                </span>{' '}
                {t('matchCard.totalKos', { count: player1.totalKos })}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.12)' }}>|</span>
              <span>
                <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.55)' }}>
                  {player2.name}:
                </span>{' '}
                {t('matchCard.totalKos', { count: player2.totalKos })}
              </span>
            </div>
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                fontFamily: 'Nunito',
                color: 'rgba(255,255,255,0.12)',
                textTransform: 'uppercase',
                letterSpacing: '0.3em',
              }}
            >
              PokéTools
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export: generate PNG buffer ───────────────────────────────────────

/**
 * Render the confirmed-match highlight card as a PNG, with its labels in
 * `lang` (the webhook's language, resolved by `emitAsync`; i18n-core §6.2).
 */
export async function generateMatchCardImage(
  data: MatchConfirmedData,
  lang: Locale,
): Promise<Buffer> {
  const [fonts, player1Avatar, player2Avatar] = await Promise.all([
    loadFonts(),
    avatarPngDataUri(data.player_1_avatar_url),
    avatarPngDataUri(data.player_2_avatar_url),
  ]);
  // satori gets PNG data URIs only, never a Storage URL it would fetch itself.
  const cardData: MatchConfirmedData = {
    ...data,
    player_1_avatar_url: player1Avatar,
    player_2_avatar_url: player2Avatar,
  };

  // Dynamic height based on roster size
  const { player1, player2 } = aggregatePlayerData(data);
  const maxPokemon = Math.max(player1.pokemon.length, player2.pokemon.length);
  const rosterHeight = maxPokemon > 0 ? maxPokemon * 50 + 36 : 0;
  const cardHeight = 170 + rosterHeight + (maxPokemon > 0 ? 40 : 0);

  const response = new ImageResponse(
    <MatchCard data={cardData} lang={lang} />,
    {
      width: CARD_WIDTH,
      height: Math.max(200, cardHeight),
      fonts: [
        { name: 'Nunito', data: fonts.nunito700, weight: 700 as const, style: 'normal' as const },
        { name: 'DM Sans', data: fonts.dmSans400, weight: 400 as const, style: 'normal' as const },
        { name: 'DM Sans', data: fonts.dmSans600, weight: 600 as const, style: 'normal' as const },
      ],
    },
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
