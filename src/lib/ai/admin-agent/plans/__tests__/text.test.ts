import { describe, expect, it } from 'vitest';
import { disallowedTextReason, scanPlanText } from '../text';
import { parseOrThrow, workedExample, workedExampleUnpublished } from './fixtures';

const chr = (code: number) => String.fromCharCode(code);

describe('disallowedTextReason (plan 6.3 item 8)', () => {
  it('accepts ordinary names, accents, emoji and parentheses', () => {
    for (const text of ['Gen 9 OU League', 'Liga der Trainer', 'Pokémon Masters (Season 2)', 'A & B', 'Cup #3: Finals', 'Line one\nLine two', '🔥 Fire Cup']) {
      expect(disallowedTextReason(text), text).toBeNull();
    }
  });

  it('refuses bidi overrides, isolates and zero-width characters', () => {
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x200f, 0x061c, 0xfeff, 0x2060]) {
      expect(disallowedTextReason(`Liga${chr(code)}x`), code.toString(16)).toBe('bidi_characters');
    }
  });

  it('refuses control characters but allows tab and line breaks', () => {
    for (const code of [0x00, 0x07, 0x1b, 0x7f, 0x85, 0x2028]) {
      expect(disallowedTextReason(`a${chr(code)}b`), code.toString(16)).toBe('control_characters');
    }
    expect(disallowedTextReason('a\tb\r\nc')).toBeNull();
  });

  it('refuses links in the usual forms', () => {
    for (const text of ['https://example.com', 'see http://x.y/z', 'WWW.example.com', 'mailto:a@b.c', 'ftp://host/file', 'discord.gg/abc', 'join DISCORD.com/invite/x']) {
      expect(disallowedTextReason(text), text).toBe('url');
    }
  });

  it('refuses markdown link syntax', () => {
    for (const text of ['[click here](somewhere)', 'a [b] (c)', '[ref]: target']) {
      expect(disallowedTextReason(text), text).toBe('markdown_link');
    }
    expect(disallowedTextReason('array[0] is fine')).toBeNull();
  });
});

describe('scanPlanText', () => {
  it('finds nothing in the worked example', () => {
    expect(scanPlanText(workedExample())).toEqual([]);
    expect(scanPlanText(workedExampleUnpublished())).toEqual([]);
  });

  it('points at every stored or outward string and leaves the un-keyed prose alone', () => {
    const plan = parseOrThrow({
      ...workedExampleUnpublished(),
      title: 'see https://example.com',
      assumptions: [{ key: 'note', value: 'https://example.com', source: 'inferred', confirmed: false }],
      slots: {
        ...workedExampleUnpublished().slots,
        ruleset: { mode: 'new', name: `Rules${chr(0x202e)}`, base_locale: 'en' },
        league: { name: '[a](b)', description: 'www.x.de', format_type: 'singles', language: 'de' },
        phases: [{ key: 'p', name: `P${chr(0)}`, description: 'ok', bracket_type: 'swiss', best_of: 1, is_doubles: false, ruleset: 'plan' }],
        tournament: { name: 'T', description: 'https://t.co', bracket_type: 'swiss', best_of: 1, is_doubles: false, team_visibility: 'hidden_until_match', ruleset: 'plan' },
      },
    });
    expect(scanPlanText(plan).map((f) => [f.path, f.reason])).toEqual([
      ['/slots/league/name', 'markdown_link'],
      ['/slots/league/description', 'url'],
      ['/slots/phases/0/name', 'control_characters'],
      ['/slots/tournament/description', 'url'],
      ['/slots/ruleset/name', 'bidi_characters'],
    ]);
  });
});
