import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Design rule: red means drafted only. The submission panel's error text is
// a warning, so it uses the amber warn ink, never the danger palette.
const code = readFileSync(join(__dirname, '..', 'RedraftSubmissionPanel.tsx'), 'utf8');

describe('RedraftSubmissionPanel colour tokens', () => {
  it('shows the error text in amber', () => {
    expect(code).toMatch(/role="alert" className="[^"]*text-poke-amber-ink/);
  });

  it('keeps the danger (red) palette off the panel text', () => {
    expect(code).not.toMatch(/text-poke-danger/);
  });
});
