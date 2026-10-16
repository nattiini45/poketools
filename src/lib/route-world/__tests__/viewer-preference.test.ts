import { describe, expect, it } from 'vitest';
import {
  isRetryableLiteReason,
  resolveTierDecision,
  RETRYABLE_LITE_REASONS,
  type UrlTierOverride,
  type ViewerCapabilities,
} from '../quality';
import { DEFAULT_WORLD_EXPERIENCE, WORLD_EXPERIENCE_VALUES, type WorldExperience } from '@/types/player';

/**
 * Precedence contract for the viewer's persisted 3D world preference
 * (`players.world_experience`) against the URL override, the HARD capability
 * floors (no WebGL, prefers-reduced-motion) and the advisory heuristics
 * (save-data, low-memory, low-cores).
 *
 * 1. `?tier=lite` → Lite; `?tier=route` / `?routeDebug=1` → forced route.
 * 2. preference 'off' → Lite ('viewer-preference', NOT retryable).
 * 3. HARD floors beat a preference of 'on'.
 * 4. preference 'on' → route, skipping ONLY the advisory checks.
 * 5. otherwise today's advisory ladder, unchanged.
 */

const CAPABLE: ViewerCapabilities = {
  saveData: false,
  reducedMotion: false,
  lowMemory: false,
  lowCores: false,
  hasWebGL: true,
};

function caps(overrides: Partial<ViewerCapabilities> = {}): ViewerCapabilities {
  return { ...CAPABLE, ...overrides };
}

const URL_OVERRIDES: readonly UrlTierOverride[] = [null, 'lite', 'route'];

describe('resolveTierDecision — URL override wins over everything', () => {
  it('?tier=lite forces Lite for every preference, ignoring all signals', () => {
    for (const preference of WORLD_EXPERIENCE_VALUES) {
      expect(resolveTierDecision('lite', preference, caps())).toEqual({
        tier: 'lite',
        reason: null,
      });
      // Even a device that would otherwise qualify gets Lite.
      expect(
        resolveTierDecision('lite', preference, caps({ saveData: true, hasWebGL: false })),
      ).toEqual({ tier: 'lite', reason: null });
    }
  });

  it('?tier=route forces the route tier for every preference and every floor', () => {
    for (const preference of WORLD_EXPERIENCE_VALUES) {
      expect(resolveTierDecision('route', preference, caps())).toEqual({
        tier: 'route',
        reason: null,
      });
      // The URL is an explicit debug/share override: it beats 'off' …
      expect(resolveTierDecision('route', 'off', caps())).toEqual({ tier: 'route', reason: null });
      // … and it beats the hard floors and advisory checks.
      expect(
        resolveTierDecision(
          'route',
          preference,
          caps({ saveData: true, reducedMotion: true, lowMemory: true, lowCores: true, hasWebGL: false }),
        ),
      ).toEqual({ tier: 'route', reason: null });
    }
  });
});

describe('resolveTierDecision — viewer preference off', () => {
  it('resolves to Lite with reason viewer-preference', () => {
    expect(resolveTierDecision(null, 'off', caps())).toEqual({
      tier: 'lite',
      reason: 'viewer-preference',
    });
  });

  it('wins over a fully capable device and over advisory signals alike', () => {
    expect(resolveTierDecision(null, 'off', caps({ saveData: true }))).toEqual({
      tier: 'lite',
      reason: 'viewer-preference',
    });
  });

  it('is checked before the hard floors (an opt-out stays an opt-out)', () => {
    expect(resolveTierDecision(null, 'off', caps({ hasWebGL: false }))).toEqual({
      tier: 'lite',
      reason: 'viewer-preference',
    });
    expect(resolveTierDecision(null, 'off', caps({ reducedMotion: true }))).toEqual({
      tier: 'lite',
      reason: 'viewer-preference',
    });
  });

  it('viewer-preference is NOT retryable', () => {
    expect(RETRYABLE_LITE_REASONS).not.toContain('viewer-preference');
    expect(isRetryableLiteReason('viewer-preference')).toBe(false);
  });
});

describe('resolveTierDecision — hard floors beat preference on', () => {
  it('no WebGL → Lite with reason no-webgl', () => {
    expect(resolveTierDecision(null, 'on', caps({ hasWebGL: false }))).toEqual({
      tier: 'lite',
      reason: 'no-webgl',
    });
  });

  it('prefers-reduced-motion → Lite with reason reduced-motion', () => {
    expect(resolveTierDecision(null, 'on', caps({ reducedMotion: true }))).toEqual({
      tier: 'lite',
      reason: 'reduced-motion',
    });
  });

  it('both floors present still refuses the route tier', () => {
    const decision = resolveTierDecision(
      null,
      'on',
      caps({ hasWebGL: false, reducedMotion: true }),
    );
    expect(decision.tier).toBe('lite');
    expect(decision.reason === 'no-webgl' || decision.reason === 'reduced-motion').toBe(true);
  });
});

describe('resolveTierDecision — preference on skips only advisory checks', () => {
  it('routes past save-data, low-memory and low-cores on a WebGL device', () => {
    expect(
      resolveTierDecision(
        null,
        'on',
        caps({ saveData: true, lowMemory: true, lowCores: true }),
      ),
    ).toEqual({ tier: 'route', reason: null });
  });

  it('routes on a fully capable device', () => {
    expect(resolveTierDecision(null, 'on', caps())).toEqual({ tier: 'route', reason: null });
  });
});

describe('resolveTierDecision — preference auto keeps today\'s ladder', () => {
  const AUTO_LADDER: { override: Partial<ViewerCapabilities>; reason: string }[] = [
    { override: { saveData: true }, reason: 'save-data' },
    { override: { reducedMotion: true }, reason: 'reduced-motion' },
    { override: { lowMemory: true }, reason: 'low-memory' },
    { override: { lowCores: true }, reason: 'low-cores' },
    { override: { hasWebGL: false }, reason: 'no-webgl' },
  ];

  it.each(AUTO_LADDER)('degrades to Lite on $reason', ({ override, reason }) => {
    expect(resolveTierDecision(null, 'auto', caps(override))).toEqual({
      tier: 'lite',
      reason,
    });
  });

  it('preserves the historical detectTier check order (save-data before reduced-motion)', () => {
    expect(
      resolveTierDecision(null, 'auto', caps({ saveData: true, reducedMotion: true })),
    ).toEqual({ tier: 'lite', reason: 'save-data' });
    expect(
      resolveTierDecision(null, 'auto', caps({ reducedMotion: true, hasWebGL: false })),
    ).toEqual({ tier: 'lite', reason: 'reduced-motion' });
  });

  it('routes on a fully capable device', () => {
    expect(resolveTierDecision(null, 'auto', caps())).toEqual({ tier: 'route', reason: null });
  });
});

describe('resolveTierDecision — type-level preference coverage', () => {
  it('handles every WorldExperience value without throwing', () => {
    for (const preference of WORLD_EXPERIENCE_VALUES as readonly WorldExperience[]) {
      for (const urlOverride of URL_OVERRIDES) {
        expect(() => resolveTierDecision(urlOverride, preference, caps())).not.toThrow();
      }
    }
  });
});

describe('DEFAULT_WORLD_EXPERIENCE — the 3D world is opt-in', () => {
  it('is off', () => {
    expect(DEFAULT_WORLD_EXPERIENCE).toBe('off');
  });

  it('gives a viewer without a stored choice the simple version on a capable device', () => {
    expect(resolveTierDecision(null, DEFAULT_WORLD_EXPERIENCE, caps())).toEqual({
      tier: 'lite',
      reason: 'viewer-preference',
    });
  });

  it('still yields to the URL route override', () => {
    expect(resolveTierDecision('route', DEFAULT_WORLD_EXPERIENCE, caps())).toEqual({
      tier: 'route',
      reason: null,
    });
  });
});
