/**
 * The phase card's action row must wrap and be allowed to shrink: with a fixed-size (`flex-shrink-0`)
 * unwrapped row the Delete button of an upcoming phase overhung the card on a phone.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { PHASE_ACTIONS_CLASS } = await import('../PhaseTimeline');

describe('PhaseTimeline action row', () => {
  it('wraps inside the card and does not refuse to shrink', () => {
    const classes = PHASE_ACTIONS_CLASS.split(/\s+/);
    expect(classes).toContain('flex-wrap');
    expect(classes).toContain('min-w-0');
    expect(classes).not.toContain('flex-shrink-0');
  });
});
