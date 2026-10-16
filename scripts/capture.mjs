#!/usr/bin/env node
/**
 * Headless screenshot capture for visual QA (gauntlet-board visual cards).
 *
 * Usage:
 *   node scripts/capture.mjs --url http://localhost:3000/leagues/<id> \
 *        --out board/captures/hub-dark.png --theme dark \
 *        [--width 1440] [--height 900] [--wait-ms 3000] [--full-page]
 *
 * Theme forcing: the app uses next-themes with attribute="data-theme"
 * and defaultTheme="system"; setting localStorage.theme before navigation
 * deterministically pins light/dark regardless of the host's color scheme.
 * C-106 r2 dev-overlay hygiene: `next dev` injects a `nextjs-portal`
 * custom element (shadow DOM) holding the dev-tools button + red "Issues"
 * badge — dev chrome, not app UI. It is hidden before every screenshot
 * (C-106 r1 panel P2: the badge leaked into delivered captures).
 * Exits non-zero on any failure. Screenshots land ONLY at --out (pass a
 * path under board/captures/ or a temp dir — never source trees).
 */
import { chromium } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg('url');
const out = arg('out');
const theme = arg('theme', 'light');
const width = Number(arg('width', 1440));
const height = Number(arg('height', 900));
const waitMs = Number(arg('wait-ms', 3000));
const fullPage = process.argv.includes('--full-page');

if (!url || !out) {
  console.error('capture: --url and --out are required');
  process.exit(2);
}
if (!['light', 'dark'].includes(theme)) {
  console.error('capture: --theme must be light|dark');
  process.exit(2);
}

const outPath = resolve(out);
await mkdir(dirname(outPath), { recursive: true });

// C-106 r2: the Next.js dev-tools overlay host (`nextjs-portal`, injected by
// `next dev` with a shadow root carrying the dev-tools button and the red
// "Issues" count badge) is dev chrome, not app UI. A viewport screenshot
// includes whatever is painted in the region, so the badge leaks into
// delivered captures whenever the overlay counts an issue (C-106 r1 panel
// P2). A stylesheet rule on the HOST element covers late mounts (shadow-DOM
// internals render through the host), so one rule + an explicit hide before
// the screenshot is sufficient; nothing else about the run changes.
const DEV_OVERLAY_HIDE_CSS = 'nextjs-portal { display: none !important; }';
function hideNextDevOverlay(page) {
  return page.evaluate((css) => {
    let style = document.querySelector('style[data-capture-hide-dev-overlay]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-capture-hide-dev-overlay', '');
      style.textContent = css;
      document.head.appendChild(style);
    }
    let hidden = 0;
    for (const portal of document.querySelectorAll('nextjs-portal')) {
      portal.style.display = 'none';
      hidden += 1;
    }
    return hidden;
  }, DEV_OVERLAY_HIDE_CSS);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme, // belt-and-braces with the localStorage pin below
  });
  await context.addInitScript(
    (t) => window.localStorage.setItem('theme', t),
    theme,
  );
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(waitMs); // fonts, entrance animations, sprite loads
  const devOverlaysHidden = await hideNextDevOverlay(page); // C-106 r2, BEFORE any screenshot
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.screenshot({ path: outPath, fullPage });
  const { size } = await stat(outPath);
  console.log(
    `capture: OK theme=${theme} data-theme=${applied} dev-overlay-hidden=${devOverlaysHidden} ${width}x${height}${fullPage ? ' full-page' : ''} -> ${outPath} (${size} bytes)`,
  );
} finally {
  await browser.close();
}
