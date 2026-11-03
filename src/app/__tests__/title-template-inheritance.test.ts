/**
 * Next hands a child segment only the title template that the segment above it resolved, and a layout whose title is a
 * plain string resolves none (`resolveMetadata`, `titleTemplates`). A layout that sets a title therefore strips the
 * brand suffix from every page below it (VAL-CROSS-004: `/teams/library/[id]`). Only the root layout, which defines the
 * template itself, may set one; a page owns its own title.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('../(public)/teams/library/LibraryClient', () => ({ default: () => null }));

import { generateMetadata as libraryIndexMetadata } from '../(public)/teams/library/page';

const APP_DIR = join(process.cwd(), 'src', 'app');

function layoutFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return layoutFiles(path);
    return /^layout\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('title template inheritance', () => {
  it('no layout but the root sets a title, so the root template reaches every page', () => {
    const offenders = layoutFiles(APP_DIR)
      .filter((file) => relative(APP_DIR, file).replace(/\\/g, '/') !== 'layout.tsx')
      .filter((file) => /\btitle\s*:/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(APP_DIR, file));
    expect(offenders).toEqual([]);
  });

  it('the library index keeps its own title on the page', async () => {
    expect(await libraryIndexMetadata()).toEqual({ title: 'Team Library' });
  });
});
