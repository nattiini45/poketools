/**
 * Source-level guards for the shared motion setup: one `MotionConfig reducedMotion="user"` at the root, re-exported by
 * the motion barrel, and no hard-coded durations in component transitions (they come from `src/lib/motion/tokens.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
  });
}

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

describe('motion setup', () => {
  it('re-exports MotionConfig from the barrel', () => {
    expect(read('components/shared/motion.tsx')).toMatch(/\bMotionConfig\b/);
  });

  it('mounts MotionConfig reducedMotion="user" in exactly one provider, used by the root layout', () => {
    const users = sourceFiles(SRC).filter((f) => /<MotionConfig\b/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(SRC, f).replaceAll('\\', '/'))).toEqual(['components/shared/MotionProvider.tsx']);
    expect(read('components/shared/MotionProvider.tsx')).toContain('reducedMotion="user"');
    expect(read('app/layout.tsx')).toContain('<MotionProvider>');
  });

  it('leaves the broadcast overlays alone (they follow the caster, not the OS setting)', () => {
    const offenders = [...sourceFiles(path.join(SRC, 'components/broadcast')), ...sourceFiles(path.join(SRC, 'app/(broadcast)'))].filter(
      (f) => /MotionProvider|MotionConfig/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('no hard-coded transition durations', () => {
  it('has no `transition={{ duration: <number> }}` literal under src/components', () => {
    const offenders = sourceFiles(path.join(SRC, 'components')).filter((f) =>
      /transition=\{\{\s*duration:\s*[\d.]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f).replaceAll('\\', '/'))).toEqual([]);
  });

  it.each([
    'components/shared/AnimatedList.tsx',
    'components/shared/BottomSheet.tsx',
    'components/shared/PageTransitionWrapper.tsx',
    'components/ui/Popover.tsx',
    'components/ui/CollapsibleSection.tsx',
    'components/ui/Table.tsx',
  ])('%s has no numeric duration literal', (rel) => {
    expect(read(rel)).not.toMatch(/\bduration:\s*[\d.]/);
  });
});
