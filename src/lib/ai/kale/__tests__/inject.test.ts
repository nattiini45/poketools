import { describe, expect, it } from 'vitest';
import { injectOneLinerResults } from '../inject';

describe('injectOneLinerResults', () => {
  it('appends only the match one-liners, trimmed, after the prompt', () => {
    const results = new Map([['match_one_liner_0', ' One. '], ['headline', 'Ignored'], ['match_one_liner_1', 'Two.']]);
    expect(injectOneLinerResults('P', results)).toBe(
      'P\n\nMatch summaries (written by you in the previous step — reference these):\n- One.\n- Two.',
    );
  });

  it('returns the prompt unchanged when no one-liner exists', () => {
    expect(injectOneLinerResults('P', new Map([['headline', 'x']]))).toBe('P');
  });
});