import { describe, expect, it } from 'vitest';
import { CAST_DEFECT_FILES, CAST_DEFECTS } from '../cast-defects';
import { readMirrorManifest } from './world-manifest-fixture';

const { manifest: TRACKED, present: HAS_MANIFEST } = readMirrorManifest();

describe('cast-defects (file-keyed data, flagged in the D18 lint header)', () => {
  it.skipIf(!HAS_MANIFEST)('every row is a tracked manifest file path, unique, with a measured reason', () => {
    const files = new Set(TRACKED.figures.map((f) => f.file));
    expect(CAST_DEFECTS.length).toBeGreaterThan(0);
    expect(new Set(CAST_DEFECTS.map((d) => d.file)).size).toBe(CAST_DEFECTS.length);
    for (const defect of CAST_DEFECTS) {
      expect(defect.file).toMatch(/^models\/(regular|alolan|galarian|hisuian|paldean)\/\d+\.glb$/);
      expect(files.has(defect.file), defect.file).toBe(true);
      expect(defect.reason).toMatch(/C-\d+/);
    }
  });

  it('the set mirrors the list', () => {
    expect([...CAST_DEFECT_FILES].sort()).toEqual(CAST_DEFECTS.map((d) => d.file).sort());
  });
});
