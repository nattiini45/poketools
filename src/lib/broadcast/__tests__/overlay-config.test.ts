import { describe, it, expect } from 'vitest';
import { parseOverlayConfig, getOverlayCSSVars, getOverlayStyle } from '../overlay-config';

// ── parseOverlayConfig ──────────────────────────────────────────────

describe('parseOverlayConfig', () => {
  it('returns all defaults for empty params', () => {
    const params = new URLSearchParams();
    const config = parseOverlayConfig(params);
    expect(config).toEqual({
      theme: 'dark',
      accent: '#EF4444',
      accent2: '#3B82F6',
      anim: 'smooth',
      poll: 5000,
      w: 1920,
      h: 1080,
      brand: '',
      brandpos: 'br',
      preset: null,
      lang: null,
    });
  });

  describe('theme', () => {
    it('accepts valid themes', () => {
      for (const theme of ['dark', 'light', 'custom']) {
        const config = parseOverlayConfig(new URLSearchParams({ theme }));
        expect(config.theme).toBe(theme);
      }
    });

    it('falls back to dark for invalid theme', () => {
      const config = parseOverlayConfig(new URLSearchParams({ theme: 'neon' }));
      expect(config.theme).toBe('dark');
    });
  });

  describe('accent colors', () => {
    it('accepts 6-digit hex with hash prefix', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent: '#00FF00' }));
      expect(config.accent).toBe('#00FF00');
    });

    it('accepts 6-digit hex without hash prefix', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent: 'AABBCC' }));
      expect(config.accent).toBe('#AABBCC');
    });

    it('falls back to default for invalid hex', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent: 'red' }));
      expect(config.accent).toBe('#EF4444');
    });

    it('falls back to default for 3-digit hex', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent: '#FFF' }));
      expect(config.accent).toBe('#EF4444');
    });

    it('parses accent2 independently', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent2: 'FF0000' }));
      expect(config.accent2).toBe('#FF0000');
    });

    it('falls back accent2 to default for invalid hex', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent2: 'invalid' }));
      expect(config.accent2).toBe('#3B82F6');
    });

    it('accepts lowercase hex', () => {
      const config = parseOverlayConfig(new URLSearchParams({ accent: 'aabbcc' }));
      expect(config.accent).toBe('#aabbcc');
    });
  });

  describe('anim', () => {
    it('accepts valid animation intensities', () => {
      for (const anim of ['none', 'subtle', 'smooth', 'dramatic']) {
        const config = parseOverlayConfig(new URLSearchParams({ anim }));
        expect(config.anim).toBe(anim);
      }
    });

    it('falls back to smooth for invalid anim', () => {
      const config = parseOverlayConfig(new URLSearchParams({ anim: 'turbo' }));
      expect(config.anim).toBe('smooth');
    });
  });

  describe('poll', () => {
    it('parses poll as integer', () => {
      const config = parseOverlayConfig(new URLSearchParams({ poll: '3000' }));
      expect(config.poll).toBe(3000);
    });

    it('clamps poll to minimum 1000', () => {
      const config = parseOverlayConfig(new URLSearchParams({ poll: '500' }));
      expect(config.poll).toBe(1000);
    });

    it('clamps poll to maximum 60000', () => {
      const config = parseOverlayConfig(new URLSearchParams({ poll: '99999' }));
      expect(config.poll).toBe(60000);
    });

    it('falls back to default for NaN poll', () => {
      const config = parseOverlayConfig(new URLSearchParams({ poll: 'fast' }));
      expect(config.poll).toBe(1000); // NaN clamps to min
    });

    it('uses default when poll is absent', () => {
      const config = parseOverlayConfig(new URLSearchParams());
      expect(config.poll).toBe(5000);
    });
  });

  describe('dimensions (w, h)', () => {
    it('parses w and h as integers', () => {
      const config = parseOverlayConfig(new URLSearchParams({ w: '1280', h: '720' }));
      expect(config.w).toBe(1280);
      expect(config.h).toBe(720);
    });

    it('clamps w to 320-3840', () => {
      expect(parseOverlayConfig(new URLSearchParams({ w: '100' })).w).toBe(320);
      expect(parseOverlayConfig(new URLSearchParams({ w: '5000' })).w).toBe(3840);
    });

    it('clamps h to 180-2160', () => {
      expect(parseOverlayConfig(new URLSearchParams({ h: '50' })).h).toBe(180);
      expect(parseOverlayConfig(new URLSearchParams({ h: '4000' })).h).toBe(2160);
    });

    it('falls back for NaN dimensions', () => {
      const config = parseOverlayConfig(new URLSearchParams({ w: 'wide', h: 'tall' }));
      expect(config.w).toBe(320); // NaN clamps to min
      expect(config.h).toBe(180); // NaN clamps to min
    });

    it('uses defaults when absent', () => {
      const config = parseOverlayConfig(new URLSearchParams());
      expect(config.w).toBe(1920);
      expect(config.h).toBe(1080);
    });
  });

  describe('brand and brandpos', () => {
    it('reads brand string', () => {
      const config = parseOverlayConfig(new URLSearchParams({ brand: 'MyLeague' }));
      expect(config.brand).toBe('MyLeague');
    });

    it('defaults brand to empty string', () => {
      const config = parseOverlayConfig(new URLSearchParams());
      expect(config.brand).toBe('');
    });

    it('accepts valid brand positions', () => {
      for (const pos of ['tl', 'tr', 'bl', 'br']) {
        const config = parseOverlayConfig(new URLSearchParams({ brandpos: pos }));
        expect(config.brandpos).toBe(pos);
      }
    });

    it('falls back to br for invalid brandpos', () => {
      const config = parseOverlayConfig(new URLSearchParams({ brandpos: 'center' }));
      expect(config.brandpos).toBe('br');
    });
  });

  describe('preset', () => {
    it('reads preset string', () => {
      const config = parseOverlayConfig(new URLSearchParams({ preset: 'match_preview' }));
      expect(config.preset).toBe('match_preview');
    });

    it('defaults preset to null', () => {
      const config = parseOverlayConfig(new URLSearchParams());
      expect(config.preset).toBeNull();
    });
  });

  it('handles all params at once', () => {
    const config = parseOverlayConfig(
      new URLSearchParams({
        theme: 'light',
        accent: 'FF0000',
        accent2: '00FF00',
        anim: 'dramatic',
        poll: '10000',
        w: '2560',
        h: '1440',
        brand: 'Test',
        brandpos: 'tl',
        preset: 'standings',
      }),
    );
    expect(config).toEqual({
      theme: 'light',
      accent: '#FF0000',
      accent2: '#00FF00',
      anim: 'dramatic',
      poll: 10000,
      w: 2560,
      h: 1440,
      brand: 'Test',
      brandpos: 'tl',
      preset: 'standings',
      lang: null,
    });
  });

  describe('lang (i18n-core §6.5)', () => {
    it('reads a valid ?lang=', () => {
      expect(parseOverlayConfig(new URLSearchParams({ lang: 'de' })).lang).toBe('de');
      expect(parseOverlayConfig(new URLSearchParams({ lang: 'en' })).lang).toBe('en');
    });

    it('ignores an invalid ?lang=', () => {
      expect(parseOverlayConfig(new URLSearchParams({ lang: 'fr' })).lang).toBeNull();
      expect(parseOverlayConfig(new URLSearchParams()).lang).toBeNull();
    });
  });
});

// ── getOverlayCSSVars ───────────────────────────────────────────────

describe('getOverlayCSSVars', () => {
  const darkConfig = parseOverlayConfig(new URLSearchParams({ theme: 'dark' }));
  const lightConfig = parseOverlayConfig(new URLSearchParams({ theme: 'light' }));

  it('returns accent colors from config', () => {
    const vars = getOverlayCSSVars(darkConfig);
    expect(vars['--broadcast-accent']).toBe('#EF4444');
    expect(vars['--broadcast-accent2']).toBe('#3B82F6');
  });

  it('returns transparent background', () => {
    const vars = getOverlayCSSVars(darkConfig);
    expect(vars['--broadcast-bg']).toBe('transparent');
  });

  it('uses dark surface for dark theme', () => {
    const vars = getOverlayCSSVars(darkConfig);
    expect(vars['--broadcast-surface']).toBe('rgba(0, 0, 0, 0.85)');
    expect(vars['--broadcast-text']).toBe('#FFFFFF');
    expect(vars['--broadcast-text-muted']).toBe('#9CA3AF');
    expect(vars['--broadcast-border']).toBe('rgba(255, 255, 255, 0.1)');
    expect(vars['--broadcast-surface-light']).toBe('rgba(255, 255, 255, 0.08)');
  });

  it('uses light surface for light theme', () => {
    const vars = getOverlayCSSVars(lightConfig);
    expect(vars['--broadcast-surface']).toBe('rgba(255, 255, 255, 0.92)');
    expect(vars['--broadcast-text']).toBe('#1A1714');
    expect(vars['--broadcast-text-muted']).toBe('#6B7280');
    expect(vars['--broadcast-border']).toBe('rgba(0, 0, 0, 0.1)');
    expect(vars['--broadcast-surface-light']).toBe('rgba(0, 0, 0, 0.05)');
  });

  it('uses dark surface for custom theme (isDark = theme !== light)', () => {
    const customConfig = parseOverlayConfig(new URLSearchParams({ theme: 'custom' }));
    const vars = getOverlayCSSVars(customConfig);
    expect(vars['--broadcast-surface']).toBe('rgba(0, 0, 0, 0.85)');
    expect(vars['--broadcast-text']).toBe('#FFFFFF');
  });

  it('returns tier colors', () => {
    const vars = getOverlayCSSVars(darkConfig);
    expect(vars['--tier-s']).toBe('#EF4444');
    expect(vars['--tier-a']).toBe('#F97316');
    expect(vars['--tier-b']).toBe('#3B82F6');
    expect(vars['--tier-c']).toBe('#6B7280');
  });

  it('maps animation intensity to speed value', () => {
    const noneConfig = parseOverlayConfig(new URLSearchParams({ anim: 'none' }));
    expect(getOverlayCSSVars(noneConfig)['--anim-speed']).toBe('0');

    const subtleConfig = parseOverlayConfig(new URLSearchParams({ anim: 'subtle' }));
    expect(getOverlayCSSVars(subtleConfig)['--anim-speed']).toBe('0.5');

    const smoothConfig = parseOverlayConfig(new URLSearchParams({ anim: 'smooth' }));
    expect(getOverlayCSSVars(smoothConfig)['--anim-speed']).toBe('1');

    const dramaticConfig = parseOverlayConfig(new URLSearchParams({ anim: 'dramatic' }));
    expect(getOverlayCSSVars(dramaticConfig)['--anim-speed']).toBe('1.5');
  });

  it('reflects custom accent colors', () => {
    const config = parseOverlayConfig(
      new URLSearchParams({ accent: 'AABBCC', accent2: '112233' }),
    );
    const vars = getOverlayCSSVars(config);
    expect(vars['--broadcast-accent']).toBe('#AABBCC');
    expect(vars['--broadcast-accent2']).toBe('#112233');
  });
});

// ── getOverlayStyle ─────────────────────────────────────────────────

describe('getOverlayStyle', () => {
  it('returns a React CSSProperties-compatible object', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const style = getOverlayStyle(config);
    // Should contain all the CSS vars as string-keyed properties
    expect(style).toHaveProperty('--broadcast-accent');
    expect(style).toHaveProperty('--broadcast-bg');
    expect(style).toHaveProperty('--anim-speed');
  });

  it('matches getOverlayCSSVars output exactly', () => {
    const config = parseOverlayConfig(new URLSearchParams({ theme: 'light', anim: 'dramatic' }));
    const vars = getOverlayCSSVars(config);
    const style = getOverlayStyle(config);
    for (const [key, value] of Object.entries(vars)) {
      expect((style as Record<string, string>)[key]).toBe(value);
    }
  });

  it('contains all expected CSS variable keys', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const style = getOverlayStyle(config);
    const keys = Object.keys(style);
    expect(keys).toContain('--broadcast-accent');
    expect(keys).toContain('--broadcast-accent2');
    expect(keys).toContain('--broadcast-bg');
    expect(keys).toContain('--broadcast-surface');
    expect(keys).toContain('--broadcast-surface-light');
    expect(keys).toContain('--broadcast-text');
    expect(keys).toContain('--broadcast-text-muted');
    expect(keys).toContain('--broadcast-border');
    expect(keys).toContain('--tier-s');
    expect(keys).toContain('--tier-a');
    expect(keys).toContain('--tier-b');
    expect(keys).toContain('--tier-c');
    expect(keys).toContain('--anim-speed');
  });
});
