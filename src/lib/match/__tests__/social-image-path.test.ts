/**
 * Naming helpers of the `social-images` bucket that find a match's cards without the stored URL (used by the sweep
 * after a league left the league trash for good): strict uuid checks, so a path can never be built from other input.
 */
import { describe, expect, it } from 'vitest';
import { isSocialImageObjectName, legacySocialImagePath, socialImageFolder, socialImagePath } from '../social-image-path';

const MATCH = '11111111-1111-4111-8111-111111111111';
const OBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('socialImageFolder / legacySocialImagePath', () => {
  it('name the folder and the legacy object of a lowercase uuid match id', () => {
    expect(socialImageFolder(MATCH)).toBe(`matches/${MATCH}`);
    expect(legacySocialImagePath(MATCH)).toBe(`matches/${MATCH}.png`);
  });

  it('agree with the path an upload writes', () => {
    expect(socialImagePath(MATCH, OBJECT)).toBe(`${socialImageFolder(MATCH)}/${OBJECT}.png`);
  });

  it.each(['', 'abc', '../x', `${MATCH}/..`, `${MATCH}.png`, OBJECT.toUpperCase(), ` ${MATCH}`])(
    'return null for %j',
    (value) => {
      expect(socialImageFolder(value)).toBeNull();
      expect(legacySocialImagePath(value)).toBeNull();
    },
  );
});

describe('isSocialImageObjectName', () => {
  it('accepts <uuid>.png only', () => {
    expect(isSocialImageObjectName(`${OBJECT}.png`)).toBe(true);
    for (const name of ['', `${OBJECT}`, `${OBJECT}.jpg`, `${OBJECT}.png/x`, `../${OBJECT}.png`, `${OBJECT}xpng`, 'x.png']) {
      expect(isSocialImageObjectName(name)).toBe(false);
    }
  });
});
