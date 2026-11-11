/**
 * Source-level guards for the shared motion setup: one `MotionConfig reducedMotion="user"` at the root, re-exported by
 * the motion barrel, and no hard-coded durations in component transitions (they come from `src/lib/motion/tokens.ts`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFrozenSource } from '@/lib/design/frozen-surfaces';
import { isVendoredFluidSource } from '@/lib/design/vendored';

const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

const read = (relPath: string) => readFileSync(path.join(SRC, relPath), 'utf8');
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

/** Every non-test source file under `components` and `app`, read once for all the guards below. */
let cached: { file: string; text: string }[] | undefined;
function uiSources(): { file: string; text: string }[] {
  cached ??= [...sourceFiles(path.join(SRC, 'components')), ...sourceFiles(path.join(SRC, 'app'))].map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  }));
  return cached;
}

describe('motion setup', () => {
  it('re-exports MotionConfig from the barrel', () => {
    expect(read('components/shared/motion.tsx')).toMatch(/\bMotionConfig\b/);
  });

  it('mounts MotionConfig reducedMotion="user" in exactly one provider, used by the root layout', () => {
    const users = uiSources().filter(({ text }) => /<MotionConfig\b/.test(text));
    expect(users.map(({ file }) => rel(file))).toEqual(['components/shared/MotionProvider.tsx']);
    expect(read('components/shared/MotionProvider.tsx')).toContain('reducedMotion="user"');
    expect(read('app/layout.tsx')).toContain('<MotionProvider>');
  }, 30_000);

  it('leaves the broadcast overlays alone (they follow the caster, not the OS setting)', () => {
    const offenders = uiSources().filter(
      ({ file, text }) =>
        /^(components\/broadcast|app\/\(broadcast\))\//.test(rel(file)) && /MotionProvider|MotionConfig/.test(text),
    );
    expect(offenders).toEqual([]);
  });
});

describe('no hard-coded transition durations', () => {
  it('has no `transition={{ duration: <number> }}` literal under src/components (vendored @fluid code keeps its own)', () => {
    const offenders = uiSources().filter(
      ({ file, text }) =>
        rel(file).startsWith('components/') && !isVendoredFluidSource(rel(file)) && /transition=\{\{\s*duration:\s*[\d.]/.test(text),
    );
    expect(offenders.map(({ file }) => rel(file))).toEqual([]);
  });

  it.each([
    'components/shared/AnimatedList.tsx',
    'components/shared/BottomSheet.tsx',
    'components/shared/PageTransitionWrapper.tsx',
    'components/ui/Popover.tsx',
    'components/ui/CollapsibleSection.tsx',
    'components/ui/Table.tsx',
  ])('%s has no numeric duration literal', (relPath) => {
    expect(read(relPath)).not.toMatch(/\bduration:\s*[\d.]/);
  });

  it('has no literal transition or animation duration in a CSS module outside the frozen surfaces (use --motion-*)', () => {
    const cssModules = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : cssModules(full);
        return entry.name.endsWith('.css') ? [full] : [];
      });
    const offenders = cssModules(path.join(SRC, 'components'))
      .filter((file) => !isFrozenSource(rel(file)))
      .filter((file) => /(transition|animation)(-duration)?\s*:[^;]*\b\d*\.?\d+m?s\b/.test(readFileSync(file, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });
});
