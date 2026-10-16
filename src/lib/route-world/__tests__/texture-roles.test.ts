import { describe, expect, it } from 'vitest';
import { EMPTY_MANIFEST, type WorldManifest } from '../model-manifest';
import { envTextureSetUrls, hasEnvTextureSet, textureSetUrls } from '../world-env';
import { planThemeTextureRoles } from '../texture-roles';

/**
 * C-100 criterion 2 — the theme textureRoles consumer's pure half: a
 * declaration resolves to exactly the env/tex URLs the pipeline wrote, an
 * EMPTY declaration resolves ZERO loads (the no-op proof), and the typed
 * plaza path (`textureSetUrls`) and the generic path (`envTextureSetUrls`)
 * are one resolution.
 */

/** Fixture manifest with three complete sets in mixed encodings. */
const MANIFEST: WorldManifest = {
  ...EMPTY_MANIFEST,
  environment: [
    { file: 'env/tex/cobble/diff.ktx2', kb: 100 },
    { file: 'env/tex/cobble/nor.ktx2', kb: 100 },
    { file: 'env/tex/cobble/arm.ktx2', kb: 100 },
    { file: 'env/tex/limestone/diff.webp', kb: 100 },
    { file: 'env/tex/limestone/nor.webp', kb: 100 },
    { file: 'env/tex/slate/diff.ktx2', kb: 100 },
    { file: 'env/tex/slate/nor.ktx2', kb: 100 },
    { file: 'env/tex/slate/arm.ktx2', kb: 100 },
  ],
};

describe('planThemeTextureRoles', () => {
  it('an EMPTY declaration resolves ZERO texture loads — the no-op proof', () => {
    const plan = planThemeTextureRoles(MANIFEST, []);
    expect(plan.resolved).toHaveLength(0);
    expect(plan.loadCount).toBe(0);
    expect(plan.urls).toHaveLength(0);
  });

  it('resolves a declared role to the exact env/tex URLs, deduped', () => {
    const plan = planThemeTextureRoles(MANIFEST, ['cobble']);
    expect(plan.loadCount).toBe(3);
    expect(plan.urls).toEqual([
      '/models/world/env/tex/cobble/diff.ktx2',
      '/models/world/env/tex/cobble/nor.ktx2',
      '/models/world/env/tex/cobble/arm.ktx2',
    ]);
    expect(plan.resolved[0]?.role).toBe('cobble');
    expect(plan.resolved[0]?.urls?.ktx2).toBe(true);
  });

  it('matches the typed plaza union path URL-for-URL (fileMaps parity depends on it)', () => {
    for (const role of ['cobble', 'limestone', 'slate'] as const) {
      const plan = planThemeTextureRoles(MANIFEST, [role]);
      const typed = textureSetUrls(MANIFEST, role);
      expect(plan.resolved[0]?.urls).toEqual(typed);
      // The generic body is the SAME resolution the typed path delegates to.
      expect(envTextureSetUrls(MANIFEST, role)).toEqual(typed);
      expect(hasEnvTextureSet(MANIFEST, role)).toBe(true);
    }
  });

  it('a declared role the manifest does not ship resolves to null and loads nothing', () => {
    const plan = planThemeTextureRoles(MANIFEST, ['basalt']);
    expect(plan.resolved).toEqual([{ role: 'basalt', urls: null }]);
    expect(plan.loadCount).toBe(0);
    expect(plan.urls).toHaveLength(0);
  });

  it('resolution order follows the declaration order and counts each set once', () => {
    const plan = planThemeTextureRoles(MANIFEST, ['slate', 'limestone', 'cobble']);
    expect(plan.resolved.map((entry) => entry.role)).toEqual(['slate', 'limestone', 'cobble']);
    expect(plan.loadCount).toBe(3 + 2 + 3);
  });

  it('an empty manifest degrades every declared role to null without throwing', () => {
    const plan = planThemeTextureRoles(EMPTY_MANIFEST, ['cobble']);
    expect(plan.resolved[0]?.urls).toBeNull();
    expect(plan.loadCount).toBe(0);
  });
});
