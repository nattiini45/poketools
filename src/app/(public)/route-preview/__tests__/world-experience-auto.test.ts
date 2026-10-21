/**
 * The product default is 'off' (DEFAULT_WORLD_EXPERIENCE), but the dev-only
 * /route-preview harness keeps capability detection: every world it mounts
 * passes worldExperience="auto", so captures without ?tier=route still see the
 * route tier. Source contract (the files are read, not rendered).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('route-preview keeps worldExperience="auto"', () => {
  it('every themed world element on the page passes auto', () => {
    const page = read('src/app/(public)/route-preview/page.tsx');
    for (const name of ['SakuraWorld', 'MountainWorld', 'CloudsWorld', 'EvoligaWorld']) {
      const tags = page.split(/\r?\n/).filter((line) => line.includes(`<${name} `));
      expect(tags.length, name).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, name).toContain('worldExperience="auto"');
    }
  });

  it.each([
    'src/app/(public)/route-preview/ProbeWorld.tsx',
    'src/components/world/route/gallery/GalleryWorld.tsx',
  ])('%s mounts its provider with auto', (rel) => {
    const tags = read(rel).match(/<WorldStateProvider\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toContain('worldExperience="auto"');
  });

  it('the provider itself defaults to DEFAULT_WORLD_EXPERIENCE', () => {
    expect(read('src/components/world/route/WorldStateProvider.tsx')).toContain(
      'worldExperience = DEFAULT_WORLD_EXPERIENCE',
    );
  });
});
