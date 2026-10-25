import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The integration rows only render once the list has loaded (no DOM here), so
 * the narrow-width contract is checked on the source: the row stacks below md,
 * the action group wraps instead of shrink-0 pushing the page sideways, and the
 * badge line wraps (German labels are long).
 */
const FILES = [
  '../SocialIntegrationManager.tsx',
  '../../discord/DiscordWebhookManager.tsx',
];

describe.each(FILES)('integration row layout: %s', (file) => {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8');

  it('stacks the title block and the actions below md', () => {
    expect(src).toContain('flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4');
  });

  it('lets the action group wrap and only stops it shrinking from md', () => {
    expect(src).toContain('flex flex-wrap gap-1.5 md:shrink-0');
    expect(src).not.toMatch(/"flex gap-1\.5 shrink-0"/);
  });

  it('wraps the label and badge line', () => {
    expect(src).toContain('flex flex-wrap items-center gap-2 mb-1');
  });
});
