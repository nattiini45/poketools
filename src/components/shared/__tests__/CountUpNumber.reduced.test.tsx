/** @vitest-environment jsdom */
/**
 * `CountUpNumber` drives its own requestAnimationFrame loop, which motion's reduced-motion config cannot reach, so it
 * reads the preference itself and shows the final value at once.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/components/shared/motion', () => ({
  useInView: () => true,
  useReducedMotion: () => state.reduced,
}));

import CountUpNumber from '../CountUpNumber';

beforeEach(() => {
  state.reduced = false;
});

describe('CountUpNumber', () => {
  it('starts from zero and counts up by default', () => {
    render(<CountUpNumber value={42} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('shows the final value in the first frame under reduced motion', () => {
    state.reduced = true;
    render(<CountUpNumber value={42} />);
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('follows a changed value immediately under reduced motion', () => {
    state.reduced = true;
    const { rerender } = render(<CountUpNumber value={42} />);
    rerender(<CountUpNumber value={57} />);
    expect(screen.getByText('57')).toBeTruthy();
  });
});
