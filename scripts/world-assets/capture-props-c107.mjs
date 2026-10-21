#!/usr/bin/env node
/**
 * C-107 — station-exact probe stills for the prop gallery / focused props.
 *
 * capture.mjs's `#fragment` scroll lands at the section TOP, which for
 * mid-list stations overshoots the scroll conductor's anchor
 * (top − ACTIVATION·viewport, ACTIVATION = 0.35, useScrollConductor.ts:26)
 * and leaves the dolly mid-tween between stations. This helper loads the
 * probe world WITHOUT a fragment, scrolls to the computed anchor itself
 * (+20 px into the station, well inside the conductor's 12 px start-align
 * slack), waits out the camera tween, then screenshots.
 *
 * Usage:
 *   node scripts/world-assets/capture-props-c107.mjs --station teams \
 *        --out gauntlet/evidence/still.png \
 *        [--focus <prop-slug>] [--width 1440] [--height 900] [--wait-ms 8000]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const base = arg('url', 'http://localhost:3111/route-preview?world=c100probe');
const station = arg('station', 'pulse');
const focus = arg('focus', null);
const out = arg('out');
const width = Number(arg('width', 1440));
const height = Number(arg('height', 900));
const waitMs = Number(arg('wait-ms', 8000));

if (!out) {
  console.error('capture-props: --out is required');
  process.exit(2);
}
const outPath = resolve(out);
await mkdir(dirname(outPath), { recursive: true });

const url = focus ? `${base}&propFocus=${encodeURIComponent(focus)}` : base;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((t) => window.localStorage.setItem('theme', t), 'light');
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500); // hydration + prop manifest fetch
  const landed = await page.evaluate((stationId) => {
    const el = document.getElementById(stationId);
    if (!el) return null;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const target = Math.max(0, Math.round(top - 0.35 * window.innerHeight) + 20);
    window.scrollTo(0, target);
    return { top: Math.round(top), target };
  }, station);
  if (!landed) {
    console.error(`capture-props: no section #${station}`);
    process.exit(1);
  }
  await page.waitForTimeout(waitMs); // camera dolly tween + prop GLB loads
  const settled = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: outPath });
  console.log(
    `capture-props: OK station=${station}${focus ? ` focus=${focus}` : ''} ` +
      `scroll ${landed.top} -> ${settled} ${width}x${height} -> ${outPath}`,
  );
} finally {
  await browser.close();
}
