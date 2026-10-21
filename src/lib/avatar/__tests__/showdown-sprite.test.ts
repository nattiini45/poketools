import { describe, expect, it } from 'vitest';
import trainers from '../showdown-trainers.json';
import { isShowdownSpriteId, parseShowdownTrainerSpriteUrl } from '../showdown-sprite';

const RED = 'https://play.pokemonshowdown.com/sprites/trainers/red.png';

describe('isShowdownSpriteId', () => {
  it('accepts every sprite id in the picker catalog', () => {
    const ids = (trainers as Array<{ sprites: Array<{ id: string }> }>).flatMap((c) => c.sprites.map((s) => s.id));
    expect(ids.length).toBeGreaterThan(1000);
    expect(ids.filter((id) => !isShowdownSpriteId(id))).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['upper case', 'Red'],
    ['a slash', 'x/../y'],
    ['a dot', 'red.png'],
    ['encoded', 'red%2F'],
    ['not a string', 42],
  ])('rejects %s', (_label, value) => {
    expect(isShowdownSpriteId(value)).toBe(false);
  });
});

describe('parseShowdownTrainerSpriteUrl', () => {
  it('accepts a canonical trainer sprite URL', () => {
    expect(parseShowdownTrainerSpriteUrl(RED)).toEqual({ url: RED, spriteId: 'red' });
    expect(parseShowdownTrainerSpriteUrl('https://play.pokemonshowdown.com/sprites/trainers/acetrainer-gen4.png'))
      .toEqual({ url: 'https://play.pokemonshowdown.com/sprites/trainers/acetrainer-gen4.png', spriteId: 'acetrainer-gen4' });
  });

  it('returns the canonical form, not the raw string', () => {
    expect(parseShowdownTrainerSpriteUrl('HTTPS://PLAY.POKEMONSHOWDOWN.COM/sprites/trainers/red.png')?.url).toBe(RED);
  });

  it.each([
    ['the Showdown-prefixed traversal', 'https://play.pokemonshowdown.com/sprites/trainers/x/storage/v1/object/public/avatars/..%2Fworld-assets%2Fx.png'],
    ['an encoded traversal', 'https://play.pokemonshowdown.com/sprites/trainers/..%2F..%2Fx.png'],
    ['a nested path', 'https://play.pokemonshowdown.com/sprites/trainers/x/red.png'],
    ['http', 'http://play.pokemonshowdown.com/sprites/trainers/red.png'],
    ['another host', 'https://evil.com/sprites/trainers/red.png'],
    ['a look-alike host', 'https://play.pokemonshowdown.com.evil.com/sprites/trainers/red.png'],
    ['credentials', 'https://user@play.pokemonshowdown.com/sprites/trainers/red.png'],
    ['a port', 'https://play.pokemonshowdown.com:8443/sprites/trainers/red.png'],
    ['a query string', `${RED}?x=1`],
    ['an empty query string', `${RED}?`],
    ['a fragment', `${RED}#x`],
    ['an empty fragment', `${RED}#`],
    ['another extension', 'https://play.pokemonshowdown.com/sprites/trainers/red.gif'],
    ['another sprite folder', 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png'],
    ['upper-case id', 'https://play.pokemonshowdown.com/sprites/trainers/Red.png'],
    ['not a URL', 'red.png'],
  ])('rejects %s', (_label, url) => {
    expect(parseShowdownTrainerSpriteUrl(url)).toBeNull();
  });
});
