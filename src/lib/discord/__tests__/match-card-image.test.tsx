/* eslint-disable @next/next/no-img-element */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import type { MatchConfirmedData } from '@/types/discord';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatchCard, avatarPngDataUri, generateMatchCardImage } from '../match-card-image';

/**
 * No network: `fetch` is stubbed for every test, and the card data carries no
 * Pokémon, so satori itself has nothing to fetch. Fonts are read from
 * public/fonts on disk.
 */

const SUPABASE_URL = 'https://proj.supabase.co';
const PLAYER_1 = '10000000-0000-4000-8000-000000000001';
const PLAYER_2 = '10000000-0000-4000-8000-000000000002';
const P1_THUMB_URL = `${SUPABASE_URL}/storage/v1/object/public/avatars/${PLAYER_1}.0123456789abcdef.png.thumb.webp`;
const P2_THUMB_URL = `${SUPABASE_URL}/storage/v1/object/public/avatars/gallery/${PLAYER_2}/20000000-0000-4000-8000-000000000001.png.thumb.webp`;
const SHOWDOWN_URL = 'https://play.pokemonshowdown.com/sprites/trainers/red.png';
/** Used only by the control test: satori caches image results per URL, so it must not share one. */
const CONTROL_THUMB_URL = `${SUPABASE_URL}/storage/v1/object/public/avatars/${PLAYER_1}.fedcba9876543210.png.thumb.webp`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let webpAvatar: Buffer;
let pngAvatar: Buffer;
let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

/** A 256 px WebP, exactly what avatar_url points at since the thumbnail wave. */
async function makeWebp(): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .webp({ quality: 80 })
    .toBuffer();
}

function imageResponse(body: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(body.length) },
  });
}

function matchData(overrides: Partial<MatchConfirmedData> = {}): MatchConfirmedData {
  return {
    kind: 'match_confirmed',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    player_1_avatar_url: P1_THUMB_URL,
    player_2_avatar_url: P2_THUMB_URL,
    winner_name: 'Alice',
    game_score: '2-1',
    tournament_name: 'Spring Cup',
    ...overrides,
  };
}

/** Every console.error / console.warn line, joined, to search for satori's image errors. */
function loggedText(): string {
  return [...consoleError.mock.calls, ...consoleWarn.mock.calls]
    .map((args: unknown[]) => args.map((a: unknown) => (a instanceof Error ? a.message : String(a))).join(' '))
    .join('\n');
}

beforeAll(async () => {
  webpAvatar = await makeWebp();
  pngAvatar = await sharp(webpAvatar).png().toBuffer();
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SHOWDOWN_URL) return imageResponse(pngAvatar, 'image/png');
    if (url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/avatars/`)) {
      return imageResponse(webpAvatar, 'image/webp');
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── avatarPngDataUri ──────────────────────────────────────────────────

describe('avatarPngDataUri', () => {
  it('rasterises a WebP thumbnail from the avatars bucket to an 88 px PNG data URI', async () => {
    const uri = await avatarPngDataUri(P1_THUMB_URL);

    expect(uri).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from((uri as string).slice('data:image/png;base64,'.length), 'base64');
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 88, 88]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(P1_THUMB_URL);
  });

  it('also converts a Showdown trainer sprite', async () => {
    const uri = await avatarPngDataUri(SHOWDOWN_URL);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null without fetching when there is no avatar', async () => {
    expect(await avatarPngDataUri(null)).toBeNull();
    expect(await avatarPngDataUri(undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a foreign host', 'https://evil.example/avatar.png'],
    ['another Supabase project', 'https://other.supabase.co/storage/v1/object/public/avatars/x.png'],
    ['another bucket of this project', `${SUPABASE_URL}/storage/v1/object/public/world-assets/sky.png`],
    ['an encoded traversal out of the bucket', `${SUPABASE_URL}/storage/v1/object/public/avatars/..%2Fworld-assets%2Fsky.png`],
    [
      'a Showdown-prefixed traversal URL',
      'https://play.pokemonshowdown.com/sprites/trainers/x/storage/v1/object/public/avatars/..%2Fworld-assets%2Fx.png',
    ],
    ['plain http', 'http://play.pokemonshowdown.com/sprites/trainers/red.png'],
  ])('never fetches %s', async (_label, url) => {
    expect(await avatarPngDataUri(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('Match card avatar skipped'));
  });

  it('returns null and logs the status when the fetch is not ok', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));

    expect(await avatarPngDataUri(P1_THUMB_URL)).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'));
  });

  it('returns null and logs when the fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    expect(await avatarPngDataUri(P1_THUMB_URL)).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Match card avatar fetch failed'),
      expect.any(Error),
    );
  });

  it('returns null for a body declared larger than 5 MB, without reading it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } }));

    expect(await avatarPngDataUri(P1_THUMB_URL)).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('too large'));
  });

  it('returns null and logs when the bytes are not a decodable image', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(Buffer.from('definitely not an image'), 'image/webp'));

    expect(await avatarPngDataUri(P1_THUMB_URL)).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('could not be rasterised to PNG'),
      expect.anything(),
    );
  });
});

// ── generateMatchCardImage ────────────────────────────────────────────

describe('generateMatchCardImage with WebP avatars', () => {
  it('control: satori cannot decode a WebP avatar URL on its own', async () => {
    // Documents the bug this module works around (satori logs, then drops the image).
    const response = new ImageResponse(
      <div style={{ display: 'flex', width: 64, height: 64 }}>
        <img src={CONTROL_THUMB_URL} width={44} height={44} alt="" />
      </div>,
      { width: 64, height: 64 },
    );
    await response.arrayBuffer();

    expect(loggedText()).toContain('Unsupported image type');
  });

  it('renders the card with PNG data URIs: no satori image errors, and satori fetches nothing', async () => {
    const card = await generateMatchCardImage(matchData(), 'en');

    expect(card.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect((await sharp(card).metadata()).width).toBe(600);

    const logged = loggedText();
    expect(logged).not.toContain('Unsupported image type');
    expect(logged).not.toContain("Can't load image");
    // Exactly one fetch per avatar, both ours; satori received data URIs.
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([P1_THUMB_URL, P2_THUMB_URL].sort());
  });

  it('still renders (initials fallback) when an avatar cannot be fetched', async () => {
    fetchMock.mockImplementation(async () => new Response('gone', { status: 404 }));

    const card = await generateMatchCardImage(matchData(), 'en');

    expect(card.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(loggedText()).not.toContain("Can't load image");
  });

  it('never hands satori a URL it would fetch itself, even for a rejected avatar URL', async () => {
    await generateMatchCardImage(matchData({
      player_1_avatar_url: 'https://evil.example/avatar.webp',
      player_2_avatar_url: null,
    }), 'en');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain("Can't load image");
  });
});

// ── Card labels by language (i18n-core §6.2) ──────────────────────────

describe('MatchCard labels', () => {
  const withRoster = matchData({
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    game_stats: [
      {
        game_number: 1,
        winner_id: 'p1',
        players: [
          {
            player_id: 'p1',
            player_name: 'Alice',
            pokemon: [
              { pokemon_name: 'Garchomp', kos_dealt: 2, was_koed: false },
              { pokemon_name: 'Pikachu', kos_dealt: 1, was_koed: true },
            ],
          },
          {
            player_id: 'p2',
            player_name: 'Bob',
            pokemon: [{ pokemon_name: 'Charizard', kos_dealt: 1, was_koed: true }],
          },
        ],
      },
    ],
  });

  it('renders the English labels verbatim', () => {
    const html = renderToStaticMarkup(<MatchCard data={withRoster} lang="en" />);

    expect(html).toContain('Confirmed');
    expect(html).toContain('Winner');
    expect(html).toContain('MVP');
    expect(html).toContain('2 KOs');
    expect(html).toContain('1 KO<');
    expect(html).toContain('Fainted');
    expect(html).toContain('alt="Garchomp"');
  });

  it('renders German labels and German Pokémon names (sprites stay keyed by English name)', () => {
    const html = renderToStaticMarkup(<MatchCard data={withRoster} lang="de" />);

    expect(html).toContain('Bestätigt');
    expect(html).toContain('Sieger');
    expect(html).toContain('Besiegt');
    expect(html).not.toContain('Fainted');
    expect(html).not.toContain('Winner');
    expect(html).toContain('alt="Knakrack"');
    expect(html).toContain('alt="Glurak"');
    expect(html).toContain('garchomp');
  });
});
