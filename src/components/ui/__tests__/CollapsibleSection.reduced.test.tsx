/**
 * The height tween of a collapsible body is instant under reduced motion:
 * `MotionConfig reducedMotion="user"` does not cover height, so the section cuts
 * its own transition. `motion.div` is replaced by a probe that records the
 * transition it was given; `useReducedMotion` is mocked for a deterministic run.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DURATION } from '@/lib/motion/tokens';

const state = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/components/shared/motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  useReducedMotion: () => state.reduced,
  motion: {
    div: ({
      transition,
      children,
      id,
    }: {
      transition?: unknown;
      children?: ReactNode;
      id?: string;
    }) => (
      <div id={id} data-transition={JSON.stringify(transition)}>
        {children}
      </div>
    ),
  },
}));

import CollapsibleSection from '../CollapsibleSection';

function transitionOf(html: string): { duration: number; ease?: unknown } {
  const raw = /data-transition="([^"]*)"/.exec(html)?.[1] ?? '';
  return JSON.parse(raw.replace(/&quot;/g, '"'));
}

const section = (
  <CollapsibleSection title="Heavy">
    <p>Body</p>
  </CollapsibleSection>
);

beforeEach(() => {
  state.reduced = false;
});

describe('CollapsibleSection motion', () => {
  it('tweens the height with the state token by default', () => {
    expect(transitionOf(renderToStaticMarkup(section))).toMatchObject({
      duration: DURATION.state,
    });
  });

  it('opens and closes instantly under reduced motion', () => {
    state.reduced = true;
    expect(transitionOf(renderToStaticMarkup(section))).toEqual({ duration: 0 });
    expect(DURATION.instant).toBe(0);
  });
});
