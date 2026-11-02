import { describe, expect, it } from 'vitest';
import { normalizeReplayUrlOrId, parseReplayReference } from '../replay-reference';

describe('parseReplayReference', () => {
  it.each([
    ['gen9ou-2255712345', 'gen9ou-2255712345'],
    ['https://replay.pokemonshowdown.com/gen9ou-123', 'gen9ou-123'],
    ['http://replay.pokemonshowdown.com/gen9ou-123/', 'gen9ou-123'],
    ['replay.pokemonshowdown.com/gen9ou-123.json', 'gen9ou-123'],
    ['https://replay.pokemonshowdown.com/gen9ou-123?p2#turn-4', 'gen9ou-123'],
    ['  gen9vgc2025regg-77 ', 'gen9vgc2025regg-77'],
    ['smogtours-gen9ou-812345', 'smogtours-gen9ou-812345'],
    ['gen9ou-123-abcdef0123456789abcdef0123456789pw', 'gen9ou-123-abcdef0123456789abcdef0123456789pw'],
  ])('accepts %s', (input, id) => {
    expect(parseReplayReference(input)).toBe(id);
  });

  it.each([
    'not-a-replay',
    'https://example.invalid/x',
    'https://example.invalid/gen9ou-123',
    'https://replay.pokemonshowdown.com/',
    'https://replay.pokemonshowdown.com/a/b-1',
    '../gen9ou-1',
    'gen9ou-',
    '-123',
    'gen9ou_123',
    `gen9ou-${'1'.repeat(300)}`,
  ])('refuses %s with replay_url_invalid', (input) => {
    expect(() => parseReplayReference(input)).toThrowError(
      expect.objectContaining({ code: 'replay_url_invalid', statusCode: 400 }),
    );
  });
});

describe('normalizeReplayUrlOrId', () => {
  it('leaves a foreign URL untouched so it can be refused', () => {
    expect(normalizeReplayUrlOrId('https://example.invalid/x')).toBe('https://example.invalid/x');
  });
});
