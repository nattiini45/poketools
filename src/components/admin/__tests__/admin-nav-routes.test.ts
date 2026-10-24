/**
 * Every in-app admin link must land on a page that exists. The first case walks the nav config
 * (plus the dashboard link); the second scans the admin sources for literal and template `/admin/...`
 * hrefs, so a renamed route or a link to a page nobody wrote fails here instead of in production.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV } from '../adminNav';

const SRC_DIR = path.join(process.cwd(), 'src');
const ADMIN_APP_DIR = path.join(SRC_DIR, 'app', 'admin');

/** The marker a template placeholder turns into: one path segment of unknown value. */
const PARAM = '\u0000param';

function walk(dir: string, visit: (file: string) => void): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}

/** The URL segment patterns of every page under src/app/admin; route groups `(x)` are not URL segments. */
function pagePatterns(): string[][] {
  const patterns: string[][] = [];
  walk(ADMIN_APP_DIR, (file) => {
    if (path.basename(file) !== 'page.tsx') return;
    const segments = path
      .relative(ADMIN_APP_DIR, path.dirname(file))
      .split(path.sep)
      .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment));
    patterns.push(segments);
  });
  return patterns;
}

const PATTERNS = pagePatterns();

function segmentMatches(pattern: string, segment: string): boolean {
  if (/^\[.+\]$/.test(pattern)) return true; // [id]: any value, a placeholder included
  return segment !== PARAM && pattern === segment;
}

/** Whether a page exists for this `/admin/...` path (bracket directories are wildcards). */
function resolves(href: string): boolean {
  const pathOnly = href.split(/[?#]/)[0];
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments[0] !== 'admin') return false;
  const rest = segments.slice(1);
  return PATTERNS.some((pattern) => {
    const last = pattern.at(-1);
    if (last !== undefined && /^\[\[?\.\.\..+\]\]?$/.test(last)) {
      const fixed = pattern.slice(0, -1);
      return rest.length >= fixed.length && fixed.every((p, i) => segmentMatches(p, rest[i]));
    }
    return pattern.length === rest.length && pattern.every((p, i) => segmentMatches(p, rest[i]));
  });
}

/** `/admin/...` strings in the admin sources: quote, path made of plain or `${...}` segments, optional query, same quote. */
const ADMIN_HREF = /(['"`])(\/admin(?:\/(?:[A-Za-z0-9_.-]|\$\{[^}`'"]*\})+)*\/?)(?:[?#][^'"`\n]*)?\1/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  walk(dir, (file) => {
    if (/\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file)) out.push(file);
  });
  return out;
}

describe('admin routes', () => {
  it('finds the admin pages to resolve against', () => {
    expect(PATTERNS.length).toBeGreaterThan(10);
    expect(resolves('/admin')).toBe(true);
    expect(resolves('/admin/leagues/some-id')).toBe(true);
    expect(resolves('/admin/leagues/some-id/missing-page')).toBe(false);
    expect(resolves('/admin/not-a-page')).toBe(false);
    expect(resolves(`/admin/leagues/${PARAM}`)).toBe(true);
    expect(resolves(`/admin/${PARAM}`)).toBe(false);
  });

  it('every nav item and the dashboard link point at an existing page', () => {
    const hrefs = ['/admin', ...ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href))];
    expect(hrefs).toContain('/admin/kale');
    for (const href of hrefs) {
      expect(resolves(href), `${href} has no page.tsx under src/app/admin`).toBe(true);
    }
  });

  it('every /admin href written in the admin sources points at an existing page', () => {
    const found: { file: string; href: string }[] = [];
    for (const file of [...sourceFiles(ADMIN_APP_DIR), ...sourceFiles(path.join(SRC_DIR, 'components'))]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ADMIN_HREF)) {
        found.push({ file: path.relative(SRC_DIR, file).split(path.sep).join('/'), href: match[2].replaceAll(/\$\{[^}]*\}/g, PARAM) });
      }
    }
    // The scan has to see the links it guards: nav items, sidebar and list buttons.
    expect(found.length).toBeGreaterThan(20);
    const broken = found.filter(({ href }) => !resolves(href));
    expect(broken.map(({ file, href }) => `${file}: ${href.replaceAll(PARAM, '${...}')}`)).toEqual([]);
  });
});
