import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { SITE_PALETTE_PREPAINT_SCRIPT, buildSitePalettePrepaintScript } from '../site-palette-script';

/**
 * The inline pre-paint script runs before React, so it is exercised as the
 * browser runs it: the exact string, in an isolated `node:vm` context with a
 * stub `window`/`location`/`document` (never eval / new Function).
 */
function runScript(options: { stored?: string | null; pathname?: string; getItemThrows?: boolean } = {}) {
  const { stored = null, pathname = '/', getItemThrows = false } = options;
  const getItem = vi.fn((key: string): string | null => {
    if (getItemThrows) throw new Error(`SecurityError: storage blocked (${key})`);
    return stored;
  });
  const localStorage = { getItem };
  const setAttribute = vi.fn();
  const context = {
    window: { localStorage },
    localStorage,
    location: { pathname },
    document: { documentElement: { setAttribute } },
  };
  expect(() => vm.runInNewContext(SITE_PALETTE_PREPAINT_SCRIPT, context)).not.toThrow();
  return { getItem, setAttribute };
}

describe('site palette pre-paint script', () => {
  it.each(['sakura', 'mountain', 'clouds'])('applies a stored %s once', (id) => {
    const { getItem, setAttribute } = runScript({ stored: id });
    expect(getItem).toHaveBeenCalledWith('poketools:site-palette');
    expect(setAttribute).toHaveBeenCalledTimes(1);
    expect(setAttribute).toHaveBeenCalledWith('data-palette', id);
  });

  it.each([
    ['nothing stored', null],
    ['the default', 'plaza'],
    ['wrong case', 'SAKURA'],
    ['trailing space', 'sakura '],
    ['markup', '"><script>'],
    ['a prototype key', '__proto__'],
    ['a world namespace', 'evoliga'],
    ['an oversized value', 'x'.repeat(10_240)],
  ])('leaves no attribute for %s (plaza)', (_label, stored) => {
    const { setAttribute } = runScript({ stored });
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('survives storage that throws and renders plaza', () => {
    const { getItem, setAttribute } = runScript({ stored: 'sakura', getItemThrows: true });
    expect(getItem).toHaveBeenCalled();
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it.each(['/broadcast', '/broadcast/', '/broadcast/overlay/x'])('exits before reading storage on %s (I5)', (pathname) => {
    const { getItem, setAttribute } = runScript({ stored: 'sakura', pathname });
    expect(getItem).not.toHaveBeenCalled();
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('does not exempt paths that merely start with "broadcast"', () => {
    const { setAttribute } = runScript({ stored: 'clouds', pathname: '/broadcasting-tips' });
    expect(setAttribute).toHaveBeenCalledWith('data-palette', 'clouds');
  });

  it('never touches data-theme (next-themes owns it)', () => {
    for (const stored of ['sakura', 'mountain', 'clouds', 'plaza', null]) {
      const { setAttribute } = runScript({ stored });
      for (const call of setAttribute.mock.calls) expect(call[0]).not.toBe('data-theme');
    }
    expect(SITE_PALETTE_PREPAINT_SCRIPT).not.toContain('data-theme');
  });

  it('is a pure, script-safe constant built from module constants', () => {
    expect(SITE_PALETTE_PREPAINT_SCRIPT).not.toMatch(/<\/script/i);
    expect(SITE_PALETTE_PREPAINT_SCRIPT).not.toContain('${');
    expect(buildSitePalettePrepaintScript()).toBe(SITE_PALETTE_PREPAINT_SCRIPT);
    expect(buildSitePalettePrepaintScript()).toBe(buildSitePalettePrepaintScript());
    expect(SITE_PALETTE_PREPAINT_SCRIPT).toBe(
      '(function(){try{' +
        'if(/^\\/broadcast(\\/|$)/.test(location.pathname))return;' +
        'var v=window.localStorage.getItem("poketools:site-palette");' +
        'if(["sakura","mountain","clouds"].indexOf(v)!==-1)document.documentElement.setAttribute("data-palette",v);' +
        '}catch(e){}})();',
    );
  });

  it('reports its CSP hash (for a future nonce/hash CSP)', () => {
    const hash = createHash('sha256').update(SITE_PALETTE_PREPAINT_SCRIPT, 'utf8').digest('base64');
    console.info(`[site-palette] pre-paint script CSP hash: 'sha256-${hash}'`);
    expect(hash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});
