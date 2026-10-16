import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isClampedFigureMetal, METAL_CLAMP } from '../../figures/Figure';

/**
 * D42 N9 wiring: every material that authors `envMapIntensity={0}` (the nine
 * data screens D47 names, and any later one) binds the scene environment —
 * otherwise three r185 draws it at the scene's intensity and the zero is
 * inert — and Figure binds the metals its clamp governs.
 */

const SRC = join(__dirname, '..', '..', '..', '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sources(path, out);
    } else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** Each self-closing `<meshStandardMaterial ... />` element of a file, as text (props may hold `=>`, never `/>`). */
function materialElements(text: string): string[] {
  const out: string[] = [];
  const re = /<meshStandardMaterial\b[\s\S]*?\/>/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[0]);
  return out;
}

describe('the data screens bind the scene environment (D42 N9, owner D47)', () => {
  const files = sources(SRC).filter((file) => readFileSync(file, 'utf8').includes('envMapIntensity={0}'));

  it('finds the nine sites', () => {
    const names = files.map((file) => relative(SRC, file).split('\\').join('/')).sort();
    expect(names).toEqual([
      'components/world/evoliga/route/plaza/ChallengeGate.tsx',
      'components/world/evoliga/route/plaza/DeskHolo.tsx',
      'components/world/themes/clouds/furniture/Airships.tsx',
      'components/world/themes/clouds/furniture/SkyGate.tsx',
      'components/world/themes/mountain/furniture/SummitCairn.tsx',
      'components/world/themes/mountain/furniture/TrailRegister.tsx',
      'components/world/themes/mountain/furniture/TrailSigns.tsx',
      'components/world/themes/sakura/furniture/FestivalBanners.tsx',
      'components/world/themes/sakura/furniture/JumbotronRock.tsx',
    ]);
  });

  it('every material authoring envMapIntensity={0} carries the binding ref, from useSceneEnvBinding', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const zeroed = materialElements(text).filter((element) => element.includes('envMapIntensity={0}'));
      expect(zeroed.length, file).toBeGreaterThan(0);
      for (const element of zeroed) expect(element, file).toContain('ref={bindEnv}');
      expect(text, file).toContain('const bindEnv = useSceneEnvBinding();');
    }
  });
});

describe('Figure binds the metals its clamp governs (D42 N9)', () => {
  it('isClampedFigureMetal is exactly the clamp predicate', () => {
    expect(isClampedFigureMetal(new THREE.MeshStandardMaterial({ metalness: 1 }))).toBe(true);
    expect(isClampedFigureMetal(new THREE.MeshStandardMaterial({ metalness: METAL_CLAMP.metalnessAbove }))).toBe(false);
    expect(isClampedFigureMetal(new THREE.MeshPhysicalMaterial({ metalness: 0.9 }))).toBe(true);
    expect(isClampedFigureMetal(new THREE.MeshBasicMaterial())).toBe(false);
  });

  it('binds them in a layout effect (the mounting commit, before the warm) and releases them at unmount', () => {
    const text = readFileSync(join(SRC, 'components/world/route/figures/Figure.tsx'), 'utf8');
    expect(text).toMatch(/useLayoutEffect\(\(\) => \{\s*const releases = clampedMetals\.map\(\(material\) => bindSceneEnvironment\(material, scene\)\);/);
    expect(text).toContain('for (const release of releases) release();');
  });
});
