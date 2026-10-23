import { describe, it, expect } from 'vitest';
import {
  serializeConfig,
  buildOverlayUrl,
  OVERLAY_TYPES,
  OVERLAY_CATEGORIES,
  OVERLAY_DEFAULTS,
  THEME_OPTIONS,
  ANIMATION_OPTIONS,
  BRAND_POSITION_OPTIONS,
} from '../url-builder';

// ── serializeConfig ─────────────────────────────────────────────────

describe('serializeConfig', () => {
  it('returns empty params when config matches all defaults', () => {
    const params = serializeConfig({
      theme: 'dark',
      accent: '#EF4444',
      accent2: '#3B82F6',
      anim: 'smooth',
      poll: 5000,
      w: 1920,
      h: 1080,
      brand: '',
      brandpos: 'br',
    });
    expect(params.toString()).toBe('');
  });

  it('returns empty params for empty config', () => {
    const params = serializeConfig({});
    expect(params.toString()).toBe('');
  });

  it('includes theme when different from default', () => {
    const params = serializeConfig({ theme: 'light' });
    expect(params.get('theme')).toBe('light');
  });

  it('omits theme when matching default', () => {
    const params = serializeConfig({ theme: 'dark' });
    expect(params.has('theme')).toBe(false);
  });

  it('strips # from accent color', () => {
    const params = serializeConfig({ accent: '#00FF00' });
    expect(params.get('accent')).toBe('00FF00');
  });

  it('strips # from accent2 color', () => {
    const params = serializeConfig({ accent2: '#AABBCC' });
    expect(params.get('accent2')).toBe('AABBCC');
  });

  it('omits accent when matching default', () => {
    const params = serializeConfig({ accent: '#EF4444' });
    expect(params.has('accent')).toBe(false);
  });

  it('omits accent2 when matching default', () => {
    const params = serializeConfig({ accent2: '#3B82F6' });
    expect(params.has('accent2')).toBe(false);
  });

  it('includes anim when different from default', () => {
    const params = serializeConfig({ anim: 'dramatic' });
    expect(params.get('anim')).toBe('dramatic');
  });

  it('omits anim when matching default', () => {
    const params = serializeConfig({ anim: 'smooth' });
    expect(params.has('anim')).toBe(false);
  });

  it('includes poll when different from default', () => {
    const params = serializeConfig({ poll: 3000 });
    expect(params.get('poll')).toBe('3000');
  });

  it('omits poll when matching default', () => {
    const params = serializeConfig({ poll: 5000 });
    expect(params.has('poll')).toBe(false);
  });

  it('includes w when different from default', () => {
    const params = serializeConfig({ w: 1280 });
    expect(params.get('w')).toBe('1280');
  });

  it('omits w when matching default', () => {
    const params = serializeConfig({ w: 1920 });
    expect(params.has('w')).toBe(false);
  });

  it('includes h when different from default', () => {
    const params = serializeConfig({ h: 720 });
    expect(params.get('h')).toBe('720');
  });

  it('omits h when matching default', () => {
    const params = serializeConfig({ h: 1080 });
    expect(params.has('h')).toBe(false);
  });

  it('includes brand when non-empty and different from default', () => {
    const params = serializeConfig({ brand: 'MyLeague' });
    expect(params.get('brand')).toBe('MyLeague');
  });

  it('omits brand when empty (matching default)', () => {
    const params = serializeConfig({ brand: '' });
    expect(params.has('brand')).toBe(false);
  });

  it('includes brandpos when different from default', () => {
    const params = serializeConfig({ brandpos: 'tl' });
    expect(params.get('brandpos')).toBe('tl');
  });

  it('omits brandpos when matching default', () => {
    const params = serializeConfig({ brandpos: 'br' });
    expect(params.has('brandpos')).toBe(false);
  });

  it('serializes multiple non-default fields', () => {
    const params = serializeConfig({ theme: 'light', anim: 'none', w: 1280 });
    expect(params.get('theme')).toBe('light');
    expect(params.get('anim')).toBe('none');
    expect(params.get('w')).toBe('1280');
  });

  // ── extras ──

  it('appends extras to params', () => {
    const params = serializeConfig({}, { showH2H: true, layout: 'vertical' });
    expect(params.get('showH2H')).toBe('true');
    expect(params.get('layout')).toBe('vertical');
  });

  it('appends numeric extras as strings', () => {
    const params = serializeConfig({}, { round: 3 });
    expect(params.get('round')).toBe('3');
  });

  it('omits extras with empty string value', () => {
    const params = serializeConfig({}, { empty: '' });
    expect(params.has('empty')).toBe(false);
  });

  it('omits extras with false value', () => {
    const params = serializeConfig({}, { disabled: false });
    expect(params.has('disabled')).toBe(false);
  });

  it('omits extras with undefined value', () => {
    const params = serializeConfig({}, { undef: undefined as unknown as string });
    expect(params.has('undef')).toBe(false);
  });

  it('includes extras with value 0 (truthy check: 0 is falsy but still a value)', () => {
    // 0 is falsy in JS, so the source code condition `value !== undefined && value !== '' && value !== false`
    // will skip 0 because it's falsy in the outer if check. Let's verify that behavior.
    const params = serializeConfig({}, { offset: 0 });
    // The source uses: if (value !== undefined && value !== '' && value !== false)
    // 0 passes all three checks, so it should be included
    expect(params.get('offset')).toBe('0');
  });
});

// ── buildOverlayUrl ─────────────────────────────────────────────────

describe('buildOverlayUrl', () => {
  it('builds a path with no query string when config is default', () => {
    const url = buildOverlayUrl('match_preview', 'abc123');
    expect(url).toBe('/broadcast/match/abc123/preview');
  });

  it('replaces [id] placeholder in path template', () => {
    const url = buildOverlayUrl('standings', 'season-42');
    expect(url).toBe('/broadcast/league/season-42/standings');
  });

  it('appends query string for non-default config', () => {
    const url = buildOverlayUrl('match_preview', 'abc123', { theme: 'light' });
    expect(url).toBe('/broadcast/match/abc123/preview?theme=light');
  });

  it('appends extras to query string', () => {
    const url = buildOverlayUrl('match_results', 'abc123', {}, { autoplay: true });
    expect(url).toBe('/broadcast/match/abc123/results?autoplay=true');
  });

  it('handles combined config and extras', () => {
    const url = buildOverlayUrl('match_preview', 'abc123', { theme: 'light' }, { showH2H: true });
    expect(url).toContain('theme=light');
    expect(url).toContain('showH2H=true');
    expect(url.startsWith('/broadcast/match/abc123/preview?')).toBe(true);
  });

  it('builds draft overlay paths correctly', () => {
    const url = buildOverlayUrl('draft_live', 'pool-1');
    expect(url).toBe('/broadcast/draft/pool-1/live');
  });

  it('builds player spotlight path correctly', () => {
    const url = buildOverlayUrl('player_spotlight', 'player-99');
    expect(url).toBe('/broadcast/player/player-99/spotlight');
  });

  it('builds wiki overlay paths correctly', () => {
    expect(buildOverlayUrl('wiki_move', 'earthquake')).toBe('/broadcast/wiki/moves/earthquake');
    expect(buildOverlayUrl('wiki_item', 'leftovers')).toBe('/broadcast/wiki/items/leftovers');
    expect(buildOverlayUrl('wiki_ability', 'intimidate')).toBe('/broadcast/wiki/abilities/intimidate');
    expect(buildOverlayUrl('wiki_pokemon', 'garchomp')).toBe('/broadcast/wiki/pokemon/garchomp');
    expect(buildOverlayUrl('wiki_tera', 'fire')).toBe('/broadcast/wiki/tera/fire');
  });

  it('builds usage chart path correctly', () => {
    const url = buildOverlayUrl('usage_chart', 'season-1');
    expect(url).toBe('/broadcast/league/season-1/usage');
  });

  it('uses empty config when none provided', () => {
    const url = buildOverlayUrl('match_live', 'abc123');
    expect(url).toBe('/broadcast/match/abc123/live');
  });

  it('encodes the entity id as one path segment', () => {
    expect(buildOverlayUrl('player_spotlight', '../a/b?x=1#y')).toBe('/broadcast/player/..%2Fa%2Fb%3Fx%3D1%23y/spotlight');
    expect(buildOverlayUrl('player_spotlight', '$&')).toBe('/broadcast/player/%24%26/spotlight');
  });

  it('never expands replacement patterns from the entity id', () => {
    expect(buildOverlayUrl('player_spotlight', 'A$&B')).toBe('/broadcast/player/A%24%26B/spotlight');
    expect(buildOverlayUrl('player_spotlight', "$'$`$$")).toBe('/broadcast/player/%24\'%24%60%24%24/spotlight');
  });

  it('replaces a lone surrogate instead of throwing', () => {
    expect(buildOverlayUrl('player_spotlight', 'a\uD800b')).toBe('/broadcast/player/a%EF%BF%BDb/spotlight');
    expect(buildOverlayUrl('player_spotlight', '😀')).toBe('/broadcast/player/%F0%9F%98%80/spotlight');
  });

  it('serializes a lone surrogate in a query value as U+FFFD instead of throwing', () => {
    expect(buildOverlayUrl('player_spotlight', 'p1', { brand: 'x\uD800y' })).toBe('/broadcast/player/p1/spotlight?brand=x%EF%BF%BDy');
  });
});

// ── OVERLAY_TYPES ───────────────────────────────────────────────────

describe('OVERLAY_TYPES', () => {
  it('has 20 overlay types defined', () => {
    expect(Object.keys(OVERLAY_TYPES)).toHaveLength(20);
  });

  it('every type definition has key matching its record key', () => {
    for (const [key, def] of Object.entries(OVERLAY_TYPES)) {
      expect(def.key).toBe(key);
    }
  });

  it('every type definition has a pathTemplate containing [id]', () => {
    for (const def of Object.values(OVERLAY_TYPES)) {
      expect(def.pathTemplate).toContain('[id]');
    }
  });
});

// ── OVERLAY_CATEGORIES ──────────────────────────────────────────────

describe('OVERLAY_CATEGORIES', () => {
  it('has 5 categories', () => {
    expect(OVERLAY_CATEGORIES).toHaveLength(5);
  });

  it('categories are Match, League, Draft, Player, Wiki', () => {
    const names = OVERLAY_CATEGORIES.map((c) => c.category);
    expect(names).toEqual(['Match', 'League', 'Draft', 'Player', 'Wiki']);
  });

  it('every type in categories references a valid OVERLAY_TYPES entry', () => {
    for (const cat of OVERLAY_CATEGORIES) {
      for (const t of cat.types) {
        expect(OVERLAY_TYPES[t.key]).toBe(t);
      }
    }
  });
});

// ── OVERLAY_DEFAULTS ────────────────────────────────────────────────

describe('OVERLAY_DEFAULTS', () => {
  it('has expected default values', () => {
    expect(OVERLAY_DEFAULTS.theme).toBe('dark');
    expect(OVERLAY_DEFAULTS.accent).toBe('#EF4444');
    expect(OVERLAY_DEFAULTS.accent2).toBe('#3B82F6');
    expect(OVERLAY_DEFAULTS.anim).toBe('smooth');
    expect(OVERLAY_DEFAULTS.poll).toBe(5000);
    expect(OVERLAY_DEFAULTS.w).toBe(1920);
    expect(OVERLAY_DEFAULTS.h).toBe(1080);
    expect(OVERLAY_DEFAULTS.brand).toBe('');
    expect(OVERLAY_DEFAULTS.brandpos).toBe('br');
    expect(OVERLAY_DEFAULTS.preset).toBeNull();
  });
});

// ── Option lists ────────────────────────────────────────────────────

describe('option lists', () => {
  it('THEME_OPTIONS has dark, light, custom', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['dark', 'light', 'custom']);
  });

  it('ANIMATION_OPTIONS has none, subtle, smooth, dramatic', () => {
    expect(ANIMATION_OPTIONS.map((o) => o.value)).toEqual(['none', 'subtle', 'smooth', 'dramatic']);
  });

  it('BRAND_POSITION_OPTIONS has tl, tr, bl, br', () => {
    expect(BRAND_POSITION_OPTIONS.map((o) => o.value)).toEqual(['tl', 'tr', 'bl', 'br']);
  });
});
