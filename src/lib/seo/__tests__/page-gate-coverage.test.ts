import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageSubjectCoverage } from '../page-gate';

/**
 * The 404 invariant of `src/lib/seo/page-gate.ts` made testable: every public page that can call `notFound()`
 * (the root `loading.tsx` commits a 200 before it runs) must sit under one of the mechanisms the proxy consults —
 * a subject the page gate reads, the phase gate, the wiki name checks, or a dev-only preview guard. Adding such a
 * page without covering its route fails here instead of answering soft-404s to crawlers.
 */

const APP_ROOT = join(__dirname, '../../../app');
const SCANNED_GROUPS = ['(public)', '(broadcast)'];
const SAMPLE_UUID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

function* pages(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(path);
    else if (entry.name === 'page.tsx') yield path;
  }
}

/** `(public)/leagues/[id]/teams/[pid]/page.tsx` → `/leagues/<uuid>/teams/<uuid>`, one sample per dynamic segment. */
function routePathOf(file: string): string {
  const route = relative(APP_ROOT, file).replace(/\\/g, '/').replace(/\/page\.tsx$/, '');
  const segments = route
    .split('/')
    .filter((segment) => segment !== '' && !segment.startsWith('('))
    .map((segment) => {
      const dynamic = /^\[(?:\.\.\.)?(.+)\]$/.exec(segment);
      if (!dynamic) return segment;
      return /name|type|preset|surface/.test(dynamic[1]) ? 'x' : SAMPLE_UUID;
    });
  return `/${segments.join('/')}`;
}

const ungated: string[] = [];
const gated = new Map<string, string>();

for (const group of SCANNED_GROUPS) {
  for (const file of pages(join(APP_ROOT, group))) {
    if (!readFileSync(file, 'utf8').includes('notFound()')) continue;
    const coverage = pageSubjectCoverage(routePathOf(file));
    const label = `${group}/${relative(join(APP_ROOT, group), file)}`;
    if (coverage === null) ungated.push(label);
    else gated.set(label, coverage.kind);
  }
}

describe('public 404 coverage', () => {
  it('gives every notFound-capable public page a covering mechanism', () => {
    expect(ungated, `these pages can call notFound() but no proxy mechanism guards them:\n${ungated.join('\n')}`).toEqual([]);
  });

  it('still finds the scanned pages, so an empty walk cannot pass silently', () => {
    expect(gated.size).toBeGreaterThan(10);
  });
});
