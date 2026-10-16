import { describe, expect, it } from 'vitest';
import {
  THEME_VEIL,
  THEME_VEIL_IDLE,
  planPaletteSwap,
  stepThemeVeil,
  veilActive,
  veilBallSettled,
  veilCommitDue,
  veilCommitsNow,
  type ThemeVeilState,
  type ThemeVeilTick,
} from '../theme-veil';

const tick = (over: Partial<ThemeVeilTick> & { now: number }): ThemeVeilTick & { type: 'tick' } => ({
  type: 'tick',
  generation: 2,
  armedAt: null,
  ballSettled: false,
  ballRevealing: false,
  frames: 0,
  ...over,
});

function toOpaqueCommitted(reducedMotion = false): ThemeVeilState {
  let s = stepThemeVeil(THEME_VEIL_IDLE, { type: 'request', now: 0, reducedMotion });
  s = stepThemeVeil(s, tick({ now: reducedMotion ? 0 : THEME_VEIL.inMs }));
  expect(s.phase).toBe('opaque');
  s = stepThemeVeil(s, { type: 'commit', now: THEME_VEIL.inMs + 16, generation: 2 });
  expect(s.committed).toBe(true);
  return s;
}

describe('D32 theme veil sequencer', () => {
  it('fades in over ~200-250 ms before anything is committed', () => {
    expect(THEME_VEIL.inMs).toBeGreaterThanOrEqual(200);
    expect(THEME_VEIL.inMs).toBeLessThanOrEqual(250);
    expect(THEME_VEIL.outMs).toBeGreaterThanOrEqual(200);
    expect(THEME_VEIL.outMs).toBeLessThanOrEqual(250);
    let s = stepThemeVeil(THEME_VEIL_IDLE, { type: 'request', now: 100, reducedMotion: false });
    expect(s.phase).toBe('in');
    expect(veilActive(s)).toBe(true);
    s = stepThemeVeil(s, tick({ now: 100 + THEME_VEIL.inMs - 1 }));
    expect(s.phase).toBe('in');
    expect(veilCommitDue(s, 100 + THEME_VEIL.inMs - 1)).toBe(false);
    s = stepThemeVeil(s, tick({ now: 100 + THEME_VEIL.inMs }));
    expect(s.phase).toBe('opaque');
    // The commit waits one frame past the opaque one.
    expect(veilCommitDue(s, 100 + THEME_VEIL.inMs)).toBe(false);
    expect(veilCommitDue(s, 100 + THEME_VEIL.inMs + 16)).toBe(true);
  });

  it('holds the opaque veil until the veiled generation armed, its ceremony settled and frames were drawn', () => {
    let s = toOpaqueCommitted();
    // Loading: nothing armed.
    s = stepThemeVeil(s, tick({ now: 5000, frames: 100 }));
    expect(s.phase).toBe('opaque');
    // Armed but the (invisible) ceremony still runs.
    s = stepThemeVeil(s, tick({ now: 6000, armedAt: 5900, ballSettled: false, frames: 150 }));
    expect(s.phase).toBe('opaque');
    expect(s.settledAt).toBeNull();
    // Settled: counted from here.
    s = stepThemeVeil(s, tick({ now: 7000, armedAt: 5900, ballSettled: true, frames: 200 }));
    expect(s.settledAt).toBe(7000);
    s = stepThemeVeil(s, tick({ now: 7016, armedAt: 5900, ballSettled: true, frames: 200 + THEME_VEIL.releaseFrames - 1 }));
    expect(s.phase).toBe('opaque');
    s = stepThemeVeil(s, tick({ now: 7050, armedAt: 5900, ballSettled: true, frames: 200 + THEME_VEIL.releaseFrames }));
    expect(s.phase).toBe('out');
    // Out, then idle once the fade ran and no ball reveal is left.
    s = stepThemeVeil(s, tick({ now: 7050 + THEME_VEIL.outMs, ballRevealing: true }));
    expect(s.phase).toBe('out');
    s = stepThemeVeil(s, tick({ now: 7050 + THEME_VEIL.outMs + 1 }));
    expect(s).toBe(THEME_VEIL_IDLE);
  });

  it('an arm for an OLDER generation never releases the veil', () => {
    let s = toOpaqueCommitted();
    s = stepThemeVeil(s, tick({ now: 5000, generation: 1, armedAt: 100, ballSettled: true, frames: 10 }));
    s = stepThemeVeil(s, tick({ now: 5100, generation: 1, armedAt: 100, ballSettled: true, frames: 50 }));
    expect(s.phase).toBe('opaque');
  });

  it('a settle that breaks restarts the frame count', () => {
    let s = toOpaqueCommitted();
    s = stepThemeVeil(s, tick({ now: 7000, armedAt: 6000, ballSettled: true, frames: 10 }));
    s = stepThemeVeil(s, tick({ now: 7010, armedAt: 6000, ballSettled: false, frames: 11 }));
    expect(s.settledAt).toBeNull();
    s = stepThemeVeil(s, tick({ now: 7020, armedAt: 6000, ballSettled: true, frames: 20 }));
    expect(s.framesAtSettle).toBe(20);
  });

  it('a stuck ceremony can never strand the veil', () => {
    let s = toOpaqueCommitted();
    s = stepThemeVeil(s, tick({ now: 6000 + THEME_VEIL.maxHoldAfterArmMs, armedAt: 6000, ballSettled: false }));
    expect(s.phase).toBe('out');
  });

  it('flipping back before the commit cancels to out; after the commit it stays', () => {
    let s = stepThemeVeil(THEME_VEIL_IDLE, { type: 'request', now: 0, reducedMotion: false });
    s = stepThemeVeil(s, { type: 'cancel', now: 50 });
    expect(s.phase).toBe('out');
    const committed = toOpaqueCommitted();
    expect(stepThemeVeil(committed, { type: 'cancel', now: 400 })).toBe(committed);
  });

  it('a flip while fading out turns it around; a flip while opaque is committed at once', () => {
    let s = toOpaqueCommitted();
    s = stepThemeVeil(s, tick({ now: 7000, armedAt: 6000, ballSettled: true, frames: 0 }));
    s = stepThemeVeil(s, tick({ now: 7050, armedAt: 6000, ballSettled: true, frames: 10 }));
    expect(s.phase).toBe('out');
    s = stepThemeVeil(s, { type: 'request', now: 7100, reducedMotion: false });
    expect(s.phase).toBe('in');
    expect(s.committed).toBe(false);
    expect(veilCommitsNow(toOpaqueCommitted())).toBe(true);
    expect(veilCommitsNow(THEME_VEIL_IDLE)).toBe(false);
  });

  it('reduced motion: no fade, but the opaque veil still precedes the commit by a frame', () => {
    let s = stepThemeVeil(THEME_VEIL_IDLE, { type: 'request', now: 0, reducedMotion: true });
    s = stepThemeVeil(s, tick({ now: 0 }));
    expect(s.phase).toBe('opaque');
    expect(veilCommitDue(s, 0)).toBe(false);
    expect(veilCommitDue(s, 16)).toBe(true);
    s = stepThemeVeil(s, { type: 'commit', now: 16, generation: 2 });
    s = stepThemeVeil(s, tick({ now: 5000, armedAt: 4000, ballSettled: true, frames: 0 }));
    s = stepThemeVeil(s, tick({ now: 5016, armedAt: 4000, ballSettled: true, frames: 5 }));
    expect(s.phase).toBe('out');
    s = stepThemeVeil(s, tick({ now: 5016 }));
    expect(s).toBe(THEME_VEIL_IDLE);
  });

  it('abort drops it at once (Lite)', () => {
    expect(stepThemeVeil(toOpaqueCommitted(), { type: 'abort' })).toBe(THEME_VEIL_IDLE);
    expect(stepThemeVeil(THEME_VEIL_IDLE, { type: 'abort' })).toBe(THEME_VEIL_IDLE);
  });
});

describe('D32 ball settle for the release', () => {
  it('waits past the ceremony render hold and DPR clamp after the ball is done', () => {
    expect(veilBallSettled({ hasBall: false, phase: 'loading', since: 0, now: 0 })).toBe(true);
    expect(veilBallSettled({ hasBall: true, phase: 'releasing', since: 0, now: 10_000 })).toBe(false);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 1000, now: 1000 + THEME_VEIL.releaseAfterBallMs - 1 })).toBe(false);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 1000, now: 1000 + THEME_VEIL.releaseAfterBallMs })).toBe(true);
    expect(veilBallSettled({ hasBall: true, phase: 'hidden', since: 0, now: 1000 })).toBe(true);
  });
});

describe('D32 palette swap plan', () => {
  const idle = { phase: 'idle' as const, committed: false };
  it('before the reveal (or under Lite) the swap is immediate, as before D32', () => {
    expect(planPaletteSwap({ swapping: true, worldLive: false, veil: idle })).toBe('immediate');
  });
  it('while the world is live the veil is asked for and the swap deferred', () => {
    expect(planPaletteSwap({ swapping: true, worldLive: true, veil: idle })).toBe('veil');
    expect(planPaletteSwap({ swapping: true, worldLive: true, veil: { phase: 'in', committed: false } })).toBe('none');
    expect(planPaletteSwap({ swapping: true, worldLive: true, veil: { phase: 'out', committed: false } })).toBe('veil');
  });
  it('under the opaque veil a further flip is committed at once', () => {
    expect(planPaletteSwap({ swapping: true, worldLive: false, veil: { phase: 'opaque', committed: true } })).toBe('commit');
  });
  it('flipping back while the veil fades in cancels it', () => {
    expect(planPaletteSwap({ swapping: false, worldLive: true, veil: { phase: 'in', committed: false } })).toBe('cancel');
    expect(planPaletteSwap({ swapping: false, worldLive: false, veil: { phase: 'opaque', committed: true } })).toBe('none');
    expect(planPaletteSwap({ swapping: false, worldLive: true, veil: idle })).toBe('none');
  });
});
