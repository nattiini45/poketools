import { describe, it, expect } from 'vitest';
import {
  BROADCAST_KEYFRAMES,
  getAnimationStyle,
  getStaggeredStyles,
} from '../animations';
import type { BroadcastAnimation } from '../animations';

// ─── BROADCAST_KEYFRAMES constant ─────────────────────────────────

describe('BROADCAST_KEYFRAMES', () => {
  it('is a non-empty string', () => {
    expect(typeof BROADCAST_KEYFRAMES).toBe('string');
    expect(BROADCAST_KEYFRAMES.length).toBeGreaterThan(0);
  });

  const expectedKeyframes = [
    'broadcast-slideInLeft',
    'broadcast-slideInRight',
    'broadcast-slideInUp',
    'broadcast-slideInDown',
    'broadcast-scaleReveal',
    'broadcast-fadeIn',
    'broadcast-fadeOut',
    'broadcast-pulseGlow',
    'broadcast-tickUp',
    'broadcast-shakeSlam',
    'broadcast-silhouetteFill',
    'broadcast-scrollLeft',
    'broadcast-typeFlash',
    'broadcast-barGrow',
    'broadcast-actTransition',
  ];

  it.each(expectedKeyframes)(
    'contains @keyframes %s definition',
    (name) => {
      expect(BROADCAST_KEYFRAMES).toContain(`@keyframes ${name}`);
    },
  );
});

// ─── getAnimationStyle ────────────────────────────────────────────

describe('getAnimationStyle', () => {
  it('returns an object with an animation property', () => {
    const style = getAnimationStyle('fadeIn');
    expect(style).toHaveProperty('animation');
    expect(typeof style.animation).toBe('string');
  });

  it('uses the correct keyframe name', () => {
    const style = getAnimationStyle('slideInLeft');
    expect(style.animation).toContain('broadcast-slideInLeft');
  });

  it('sets opacity: 0 for non-looping animations', () => {
    const style = getAnimationStyle('fadeIn');
    expect(style.opacity).toBe(0);
  });

  it('does not set opacity for looping animations (pulseGlow)', () => {
    const style = getAnimationStyle('pulseGlow');
    expect(style.opacity).toBeUndefined();
  });

  it('does not set opacity for looping animations (scrollLeft)', () => {
    const style = getAnimationStyle('scrollLeft');
    expect(style.opacity).toBeUndefined();
  });

  it('includes calc() for CSS variable-driven duration', () => {
    const style = getAnimationStyle('fadeIn');
    expect(style.animation).toContain('calc(');
    expect(style.animation).toContain('var(--anim-speed, 1)');
  });

  it('includes delay in the animation string', () => {
    const style = getAnimationStyle('fadeIn', 200);
    expect(style.animation).toContain('calc(200ms');
  });

  it('defaults delay to 0ms', () => {
    const style = getAnimationStyle('fadeIn');
    expect(style.animation).toContain('calc(0ms');
  });

  it('uses "infinite" iteration count for looping animations', () => {
    const style = getAnimationStyle('pulseGlow');
    expect(style.animation).toContain('infinite');
  });

  it('uses "1" iteration count for non-looping animations', () => {
    const style = getAnimationStyle('fadeIn');
    const anim = style.animation as string;
    // The animation string contains "1" as iteration count (not "infinite")
    // Format: name duration ease-out delay iterationCount direction fill
    expect(anim).not.toContain('infinite');
    // After the delay calc(), the next token should start with "1"
    expect(anim).toMatch(/\)\s+1\s/);
  });

  it('respects custom iterationCount option', () => {
    const style = getAnimationStyle('fadeIn', 0, { iterationCount: '3' });
    expect(style.animation).toContain('3');
  });

  it('respects custom direction option', () => {
    const style = getAnimationStyle('fadeIn', 0, { direction: 'reverse' });
    expect(style.animation).toContain('reverse');
  });

  it('uses forwards fill for non-looping animations', () => {
    const style = getAnimationStyle('slideInUp');
    expect(style.animation).toContain('forwards');
  });

  it('uses normal fill for looping animations', () => {
    const style = getAnimationStyle('scrollLeft');
    const parts = (style.animation as string).split(' ');
    // fill mode is the last part
    expect(parts[parts.length - 1]).toBe('normal');
  });

  it('includes ease-out timing function', () => {
    const style = getAnimationStyle('fadeIn');
    expect(style.animation).toContain('ease-out');
  });

  it('handles all animation types without error', () => {
    const allAnimations: BroadcastAnimation[] = [
      'slideInLeft', 'slideInRight', 'slideInUp', 'slideInDown',
      'scaleReveal', 'fadeIn', 'fadeOut', 'pulseGlow', 'tickUp',
      'shakeSlam', 'silhouetteFill', 'scrollLeft', 'typeFlash',
      'barGrow', 'actTransition',
    ];

    for (const anim of allAnimations) {
      const style = getAnimationStyle(anim);
      expect(style).toHaveProperty('animation');
    }
  });
});

// ─── getStaggeredStyles ───────────────────────────────────────────

describe('getStaggeredStyles', () => {
  it('returns an array with the requested count', () => {
    const styles = getStaggeredStyles('fadeIn', 5);
    expect(styles).toHaveLength(5);
  });

  it('returns an empty array for count 0', () => {
    const styles = getStaggeredStyles('fadeIn', 0);
    expect(styles).toHaveLength(0);
  });

  it('each item has an animation property', () => {
    const styles = getStaggeredStyles('slideInLeft', 3);
    for (const s of styles) {
      expect(s).toHaveProperty('animation');
    }
  });

  it('applies increasing delays for each item', () => {
    const styles = getStaggeredStyles('fadeIn', 3, 0, 100);
    // First item: delay 0ms, second: 100ms, third: 200ms
    expect(styles[0].animation).toContain('calc(0ms');
    expect(styles[1].animation).toContain('calc(100ms');
    expect(styles[2].animation).toContain('calc(200ms');
  });

  it('applies baseDelay offset', () => {
    const styles = getStaggeredStyles('fadeIn', 2, 500, 100);
    // First item: delay 500ms, second: 600ms
    expect(styles[0].animation).toContain('calc(500ms');
    expect(styles[1].animation).toContain('calc(600ms');
  });

  it('defaults baseDelay to 0 and stagger to 100', () => {
    const styles = getStaggeredStyles('fadeIn', 3);
    expect(styles[0].animation).toContain('calc(0ms');
    expect(styles[1].animation).toContain('calc(100ms');
    expect(styles[2].animation).toContain('calc(200ms');
  });
});
