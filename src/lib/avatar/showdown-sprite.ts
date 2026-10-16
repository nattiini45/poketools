/**
 * Pokémon Showdown trainer sprites as player avatars.
 *
 * A Showdown avatar is stored as the sprite's CDN URL in `players.avatar_url`.
 * That URL comes from the client, so it is parsed with `new URL()` and only a
 * canonical `https://play.pokemonshowdown.com/sprites/trainers/<id>.png` is
 * accepted; the value stored is rebuilt from the parsed parts, never the raw
 * string. Client-safe (no Node imports).
 */

export const SHOWDOWN_TRAINER_SPRITE_ORIGIN = 'https://play.pokemonshowdown.com';
const SHOWDOWN_TRAINER_SPRITE_HOST = 'play.pokemonshowdown.com';

/** Sprite ids as `showdown-trainers.json` lists them (all 1455 match). */
const SHOWDOWN_SPRITE_ID_RE = /^[a-z0-9-]{1,64}$/;
const SHOWDOWN_TRAINER_PATH_RE = /^\/sprites\/trainers\/([a-z0-9-]+)\.png$/;

/** True for a well-formed Showdown trainer sprite id. */
export function isShowdownSpriteId(value: unknown): value is string {
  return typeof value === 'string' && SHOWDOWN_SPRITE_ID_RE.test(value);
}

/**
 * Parse a Showdown trainer sprite URL. Returns the canonical URL and the sprite
 * id it names, or null unless it is `https:` on play.pokemonshowdown.com (no
 * port or credentials), its path is `/sprites/trainers/<id>.png`, and it has no
 * query string or fragment.
 */
export function parseShowdownTrainerSpriteUrl(raw: string): { url: string; spriteId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== SHOWDOWN_TRAINER_SPRITE_HOST
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    // `new URL` drops an empty `?` or `#` from search/hash but keeps it in href.
    || /[?#]/.test(raw)
  ) {
    return null;
  }

  const match = SHOWDOWN_TRAINER_PATH_RE.exec(parsed.pathname);
  if (!match || !isShowdownSpriteId(match[1])) return null;

  return { url: `${SHOWDOWN_TRAINER_SPRITE_ORIGIN}${parsed.pathname}`, spriteId: match[1] };
}
