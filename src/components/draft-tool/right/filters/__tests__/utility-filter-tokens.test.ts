import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Design rule: red means drafted only. A banned utility move is a warning,
// so its badge uses the amber warn tokens, never the danger palette.
const code = readFileSync(join(__dirname, '..', 'UtilityFilter.tsx'), 'utf8');

describe('UtilityFilter colour tokens', () => {
  it('draws the "banned" badge with the amber warn tokens', () => {
    expect(code).toContain('border-[var(--draft-warn-ink,var(--poke-amber-ink))]');
    expect(code).toContain('text-[var(--draft-warn-ink,var(--poke-amber-ink))]');
  });

  it('never reaches for the danger (red) palette', () => {
    expect(code).not.toMatch(/poke-danger/);
  });
});
