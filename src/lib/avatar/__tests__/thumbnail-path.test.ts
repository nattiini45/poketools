import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_THUMB_SUFFIX,
  avatarOriginalPath,
  avatarOriginalUrl,
  avatarPublicUrlPrefix,
  avatarStoragePathFromUrl,
  avatarThumbPath,
  avatarThumbUrl,
  isAvatarOriginalPath,
  isAvatarThumbPath,
  isAvatarThumbUrl,
  supabasePublicOrigin,
} from '../thumbnail-path';
import { TEST_AVATAR_PUBLIC_BASE as BASE, TEST_SUPABASE_URL as ORIGIN, testUuid } from './avatar-test-helpers';

const PLAYER = testUuid(1);
const FILE = testUuid(2);
const GALLERY = `gallery/${PLAYER}/${FILE}.png`;
const HASHED = `${PLAYER}.0123456789abcdef.jpg`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('avatar thumbnail paths', () => {
  it('stores the thumbnail next to the original as <original>.thumb.webp', () => {
    expect(AVATAR_THUMB_SUFFIX).toBe('.thumb.webp');
    expect(avatarThumbPath(GALLERY)).toBe(`${GALLERY}.thumb.webp`);
    expect(avatarThumbPath(HASHED)).toBe(`${HASHED}.thumb.webp`);
  });

  it('leaves a thumbnail path unchanged', () => {
    expect(avatarThumbPath(`${GALLERY}.thumb.webp`)).toBe(`${GALLERY}.thumb.webp`);
  });

  it('maps a thumbnail back to its original, round trip', () => {
    for (const original of [GALLERY, `${PLAYER}.jpg`, `${PLAYER}.0123456789abcdef.webp`]) {
      expect(avatarOriginalPath(avatarThumbPath(original))).toBe(original);
    }
  });

  it('returns null for paths that are not thumbnails of a whitelisted original', () => {
    expect(avatarOriginalPath(GALLERY)).toBeNull();
    expect(avatarOriginalPath('notes.txt.thumb.webp')).toBeNull();
    expect(avatarOriginalPath('../world-assets/sky.png.thumb.webp')).toBeNull();
  });

  it('classifies thumbnails', () => {
    expect(isAvatarThumbPath('a.png.thumb.webp')).toBe(true);
    expect(isAvatarThumbPath('a.webp')).toBe(false);
  });
});

describe('isAvatarOriginalPath (strict whitelist)', () => {
  it.each([
    GALLERY,
    `gallery/${PLAYER}/${FILE}.jpg`,
    `gallery/${PLAYER}/${FILE}.jpeg`,
    `gallery/${PLAYER}/${FILE}.webp`,
    `${PLAYER}.png`,
    `${PLAYER}.0123456789abcdef.png`,
    HASHED,
  ])('accepts %s', (path) => {
    expect(isAvatarOriginalPath(path)).toBe(true);
  });

  it.each([
    ['a thumbnail', `${GALLERY}.thumb.webp`],
    ['an upper-case extension', `${PLAYER}.JPEG`],
    ['another extension', `${PLAYER}.gif`],
    ['a short name', 'a.webp'],
    ['a non-uuid player id', 'player-1.0123456789abcdef.png'],
    ['a traversal', `../world-assets/${FILE}.png`],
    ['a traversal inside gallery', `gallery/${PLAYER}/../../world-assets/x.png`],
    ['an absolute path', `/${PLAYER}.png`],
    ['a nested gallery path', `gallery/${PLAYER}/x/${FILE}.png`],
    ['a short hash', `${PLAYER}.0123.png`],
    ['an upper-case uuid', 'ABCDEF00-0000-4000-8000-00000000000A.png'],
    ['a trailing newline', `${PLAYER}.png\n`],
  ])('rejects %s', (_label, path) => {
    expect(isAvatarOriginalPath(path)).toBe(false);
  });
});

describe('supabasePublicOrigin', () => {
  it('normalises NEXT_PUBLIC_SUPABASE_URL to its origin', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co/');
    expect(supabasePublicOrigin()).toBe(ORIGIN);
    expect(avatarPublicUrlPrefix(ORIGIN)).toBe(`${BASE}/`);
  });

  it('is null when unset or not an http(s) URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(supabasePublicOrigin()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'javascript:alert(1)');
    expect(supabasePublicOrigin()).toBeNull();
  });
});

describe('avatarStoragePathFromUrl', () => {
  it('extracts and decodes the object path of a public avatars URL of the project', () => {
    expect(avatarStoragePathFromUrl(`${BASE}/gallery/p1/a%20b.png`, ORIGIN)).toBe('gallery/p1/a b.png');
    expect(avatarStoragePathFromUrl(`${BASE}/${PLAYER}.png?v=3`, ORIGIN)).toBe(`${PLAYER}.png`);
    expect(avatarStoragePathFromUrl(`${BASE}/${GALLERY}`, `${ORIGIN}/`)).toBe(GALLERY);
  });

  it('requires the expected origin exactly', () => {
    expect(avatarStoragePathFromUrl(`${BASE}/${GALLERY}`, 'https://other.supabase.co')).toBeNull();
    expect(avatarStoragePathFromUrl(`http://proj.supabase.co/storage/v1/object/public/avatars/${GALLERY}`, ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`https://proj.supabase.co:8443/storage/v1/object/public/avatars/${GALLERY}`, ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`https://user:pw@proj.supabase.co/storage/v1/object/public/avatars/${GALLERY}`, ORIGIN)).toBeNull();
  });

  it('fails closed without a valid origin', () => {
    expect(avatarStoragePathFromUrl(`${BASE}/${GALLERY}`, null)).toBeNull();
    expect(avatarStoragePathFromUrl(`${BASE}/${GALLERY}`, undefined)).toBeNull();
    expect(avatarStoragePathFromUrl(`${BASE}/${GALLERY}`, 'not a url')).toBeNull();
  });

  it('requires the pathname to START with the bucket marker', () => {
    const showdownPrefixed = 'https://play.pokemonshowdown.com/sprites/trainers/x/storage/v1/object/public/avatars/..%2Fworld-assets%2Fx.png';
    expect(avatarStoragePathFromUrl(showdownPrefixed, ORIGIN)).toBeNull();
    // Same trick on the right origin: the marker is present but not at the start.
    expect(avatarStoragePathFromUrl(`${ORIGIN}/x/storage/v1/object/public/avatars/${GALLERY}`, ORIGIN)).toBeNull();
  });

  it.each([
    ['an encoded ../', '..%2Fworld-assets%2Fx.png'],
    ['an encoded ../ with upper-case hex', '..%2fworld-assets%2Fsky.png'],
    ['an encoded ../ mid-path', `gallery%2F..%2F..%2Fworld-assets%2Fx.png`],
    ['an encoded ./ segment', '.%2Fx.png'],
    ['an encoded leading slash', '%2Fetc%2Fpasswd'],
    ['an empty segment', 'gallery%2F%2Fx.png'],
    ['a backslash', '..%5Cworld-assets%5Cx.png'],
    ['an encoded ?', `${PLAYER}.png%3Fx`],
    ['an encoded #', `${PLAYER}.png%23x`],
    ['double encoding', '..%252Fworld-assets%252Fx.png'],
    ['a control character', `${PLAYER}%00.png`],
    ['a newline', `${PLAYER}.png%0A`],
  ])('rejects %s', (_label, encodedPath) => {
    expect(avatarStoragePathFromUrl(`${BASE}/${encodedPath}`, ORIGIN)).toBeNull();
  });

  it('never lets a literal ../ escape (URL parsing resolves it out of the bucket)', () => {
    expect(avatarStoragePathFromUrl(`${BASE}/../world-assets/x.png`, ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`${BASE}/%2e%2e/world-assets/x.png`, ORIGIN)).toBeNull();
  });

  it('returns null for foreign, empty or malformed URLs', () => {
    expect(avatarStoragePathFromUrl('https://play.pokemonshowdown.com/sprites/trainers/red.png', ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`${ORIGIN}/storage/v1/object/public/other/a.png`, ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`${BASE}/`, ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl('not a url', ORIGIN)).toBeNull();
    expect(avatarStoragePathFromUrl(`${BASE}/%E0%A4%A.png`, ORIGIN)).toBeNull();
  });
});

describe('avatar thumbnail URLs', () => {
  it('derives the thumbnail URL of a bucket original', () => {
    expect(avatarThumbUrl(`${BASE}/${GALLERY}`, ORIGIN)).toBe(`${BASE}/${GALLERY}.thumb.webp`);
  });

  it('drops query strings and fragments when deriving', () => {
    expect(avatarThumbUrl(`${BASE}/${GALLERY}?x=1#y`, ORIGIN)).toBe(`${BASE}/${GALLERY}.thumb.webp`);
  });

  it('returns a thumbnail URL in canonical form', () => {
    const thumb = `${BASE}/${GALLERY}.thumb.webp`;
    expect(avatarThumbUrl(thumb, ORIGIN)).toBe(thumb);
    expect(avatarThumbUrl(`${thumb}?v=2`, ORIGIN)).toBe(thumb);
    expect(isAvatarThumbUrl(thumb, ORIGIN)).toBe(true);
  });

  it('returns null for URLs outside the bucket, of another origin, or off the whitelist', () => {
    expect(avatarThumbUrl('https://play.pokemonshowdown.com/sprites/trainers/red.png', ORIGIN)).toBeNull();
    expect(avatarThumbUrl(`${BASE}/${GALLERY}`, 'https://other.supabase.co')).toBeNull();
    expect(avatarThumbUrl(`${BASE}/gallery/p1/readme.txt`, ORIGIN)).toBeNull();
    expect(avatarThumbUrl(`${BASE}/gallery/p1/abc.png`, ORIGIN)).toBeNull();
    expect(avatarThumbUrl(`${BASE}/..%2Fworld-assets%2Fx.png`, ORIGIN)).toBeNull();
    expect(isAvatarThumbUrl('https://cdn.discordapp.com/avatars/1/2.png', ORIGIN)).toBe(false);
    expect(isAvatarThumbUrl(`${BASE}/${GALLERY}.thumb.webp`, null)).toBe(false);
  });

  it('maps a thumbnail URL back to the exact original URL', () => {
    const original = `${BASE}/${GALLERY}`;
    expect(avatarOriginalUrl(`${original}.thumb.webp`)).toBe(original);
  });

  it('leaves non-thumbnail URLs unchanged', () => {
    const original = `${BASE}/${GALLERY}`;
    expect(avatarOriginalUrl(original)).toBe(original);
    expect(avatarOriginalUrl('https://play.pokemonshowdown.com/sprites/trainers/red.png'))
      .toBe('https://play.pokemonshowdown.com/sprites/trainers/red.png');
  });
});
