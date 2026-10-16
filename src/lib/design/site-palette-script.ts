import {
  DEFAULT_SITE_PALETTE,
  SITE_PALETTE_ATTRIBUTE,
  SITE_PALETTE_IDS,
  SITE_PALETTE_STORAGE_KEY,
} from './site-palettes';

/**
 * The site palette's pre-paint script (docs/design.md § Site palettes).
 *
 * The root layout inlines it as the first child of `<head>`. A head script
 * blocks the parser, so the stored pick lands on `<html data-palette>` before
 * `<body>` is parsed or painted: no flash. It never touches `data-theme`
 * (next-themes owns that) and exits early on `/broadcast/*`, whose OBS output
 * stays the same for every viewer.
 *
 * Only an allowlisted constant ever reaches `setAttribute`: the stored value
 * must exactly match one of the non-default ids, so `null`, `'plaza'`, junk or
 * hand-edited storage leave no attribute (= plaza). Storage that throws
 * (private mode, blocked site data) is caught and the page renders plaza.
 */

/** Build the inline pre-paint script. Pure: every interpolated value is a
 *  module constant passed through JSON.stringify, never request or user data,
 *  so it is safe for dangerouslySetInnerHTML (AGENTS.md: no USER content). */
export function buildSitePalettePrepaintScript(): string {
  const ids = JSON.stringify(SITE_PALETTE_IDS.filter((id) => id !== DEFAULT_SITE_PALETTE));
  const key = JSON.stringify(SITE_PALETTE_STORAGE_KEY);
  const attr = JSON.stringify(SITE_PALETTE_ATTRIBUTE);
  return (
    '(function(){try{' +
    'if(/^\\/broadcast(\\/|$)/.test(location.pathname))return;' +
    `var v=window.localStorage.getItem(${key});` +
    `if(${ids}.indexOf(v)!==-1)document.documentElement.setAttribute(${attr},v);` +
    '}catch(e){}})();'
  );
}

export const SITE_PALETTE_PREPAINT_SCRIPT = buildSitePalettePrepaintScript();
