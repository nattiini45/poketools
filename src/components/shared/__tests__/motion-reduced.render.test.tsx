/**
 * Under `prefers-reduced-motion: reduce` the shared motion primitives keep their opacity cross-fade but drop
 * translation and stagger (docs/design.md, "Motion"). `useReducedMotion` is mocked so the markup is deterministic;
 * the real media query is exercised in the browser.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/components/shared/motion', async (importActual) => ({
  ...(await importActual<typeof import('@/components/shared/motion')>()),
  useReducedMotion: () => state.reduced,
}));

import { AnimatedList, AnimatedListItem } from '../AnimatedList';
import { pageTransition } from '@/lib/motion/page-transition';

beforeEach(() => {
  state.reduced = false;
});

describe('pageTransition', () => {
  it('slides vertically by default', () => {
    const { initial, exit } = pageTransition(false);
    expect(initial).toMatchObject({ opacity: 0, y: expect.any(Number) });
    expect(exit).toMatchObject({ opacity: 0, y: expect.any(Number) });
  });

  it('is opacity-only under reduced motion', () => {
    const { initial, animate, exit } = pageTransition(true);
    expect(initial).toEqual({ opacity: 0 });
    expect(animate).toEqual({ opacity: 1 });
    expect(exit).toEqual({ opacity: 0 });
  });

  it('takes its timing from the motion tokens', () => {
    expect(pageTransition(false).transition).toEqual(pageTransition(true).transition);
    expect(pageTransition(true).transition.duration).toBeGreaterThan(0);
  });
});

describe('AnimatedList', () => {
  const list = (
    <AnimatedList>
      <AnimatedListItem>One</AnimatedListItem>
      <AnimatedListItem>Two</AnimatedListItem>
    </AnimatedList>
  );

  it('rises into place by default', () => {
    expect(renderToStaticMarkup(list)).toContain('translateY');
  });

  it('only fades under reduced motion', () => {
    state.reduced = true;
    const html = renderToStaticMarkup(list);
    expect(html).not.toContain('translate');
    expect(html).toContain('opacity:0');
  });
});
