import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_VEIL } from '@/lib/route-world/theme-veil';
import { NAV_REVEAL } from '@/lib/route-world/nav-reveal';
import { CEREMONY_RENDER_HOLD } from '../scene-progress';
import { cssSection, inReducedMotion, keyframesOf, parseCssRules, readGlobalsCss, type CssRule } from '@/test/css-rules';

/**
 * CHROME seat (D32 theme veil, D33 NavBar reveal) — source-level contract.
 *
 * - Every rule the two blocks add to globals.css is scoped to the route
 *   marks (`html.world-route-live`, `html[data-route-handoff]`,
 *   `html[data-route-veil]`), so Lite and every non-world page are
 *   byte-for-byte unaffected.
 * - The NavBar keeps its sticky flow slot: the rules only move it with
 *   transform / opacity (plus pointer events, will-change, transition,
 *   scroll-margin) — never position, display, height, margin or top.
 * - The veil is the page background token, never a fixed dark colour (D25).
 * - The veil's release waits past the ceremony render hold and the ceremony
 *   DPR clamp, so the restored buffer is drawn before the veil lifts.
 *
 * Honest limit: parsed source rules (src/test/css-rules.ts), not a cascade; the runtime proof is the capture probe
 * (`--nav-reveal-probe`, the judged `--quiet-theme` leg).
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

const ROUTE_SCOPE = /^html(\.world-route-live|\[data-route-handoff\]|\[data-route-veil(="[a-z]+")?\]|:is\(\s*(\.world-route-live|\[data-route-handoff\]|\[data-route-veil\])(\s*,\s*(\.world-route-live|\[data-route-handoff\]|\[data-route-veil\]))*\s*\))/;

const globals = readGlobalsCss();
const sectionRules = (name: string) => parseCssRules(cssSection(globals, name));
const selectors = (rule: CssRule) => rule.selector.split(/,(?![^(]*\))/).map((part) => part.trim());

describe('CHROME D32/D33 — every new rule is scoped to the route marks', () => {
  for (const name of ['D33 nav reveal', 'D32 theme veil']) {
    it(`${name}: each selector starts at a route mark`, () => {
      const found = sectionRules(name).filter((rule) => keyframesOf(rule) === null);
      expect(found.length).toBeGreaterThan(4);
      for (const rule of found) {
        for (const selector of selectors(rule)) {
          expect(selector, `${name}: "${selector}"`).toMatch(ROUTE_SCOPE);
        }
      }
    });
  }

  it('the route-live NavBar is no longer visibility-hidden (Tab must reach it) and keeps its flow slot', () => {
    const all = parseCssRules(globals);
    const navRules = all.filter((rule) => /body > nav/.test(rule.selector));
    expect(navRules.length).toBeGreaterThan(0);
    for (const rule of navRules) {
      expect(rule.body, rule.selector).not.toMatch(/(?<![-\w])(position|display|height|min-height|max-height|margin(-\w+)?|top|bottom|inset)\s*:/);
      if (/world-route-live/.test(rule.selector)) expect(rule.body, rule.selector).not.toMatch(/visibility\s*:\s*hidden/);
    }
    const live = all.find((rule) => rule.selector === 'html.world-route-live body > nav');
    expect(live?.body).toMatch(/transform\s*:\s*translate3d\(0,\s*calc\(-100% - \d+px\),\s*0\)/);
    // Pre-raster opacity (E8's dialect), fully above the viewport.
    expect(live?.body).toMatch(/opacity\s*:\s*0\.002/);
    expect(live?.body).toMatch(/will-change\s*:\s*transform,\s*opacity/);
  });

  it('the reveal is transform/opacity only, with reduced-motion instant', () => {
    const nav = sectionRules('D33 nav reveal');
    expect(nav.some((rule) => /\[data-route-nav="open"\] body > nav/.test(rule.selector))).toBe(true);
    expect(nav.some((rule) => /body > nav:has\(:focus-visible\)/.test(rule.selector))).toBe(true);
    expect(nav.some((rule) => inReducedMotion(rule) && rule.decls.get('transition') === 'none')).toBe(true);
    // The menu chip is for coarse pointers only (the desktop HUD is unchanged).
    expect(nav.some((rule) => rule.context.includes('@media (hover: none), (any-pointer: coarse)'))).toBe(true);
  });

  it('the veil is the page background token, never a fixed dark colour (D25)', () => {
    const veil = sectionRules('D32 theme veil');
    const base = veil.find((rule) => rule.selector.includes('.route-theme-veil') && /background\s*:/.test(rule.body));
    expect(base?.body).toMatch(/background\s*:\s*var\(--world-ground,\s*var\(--poke-base\)\)/);
    for (const rule of veil) {
      expect(rule.body, rule.selector).not.toMatch(/background[^;]*(#[0-9a-f]{3,8}|rgba?\()/i);
    }
    const loader = veil.filter((rule) => rule.selector === 'html[data-route-veil] [data-ball-loader]');
    expect(loader.some((rule) => rule.decls.get('visibility') === 'hidden')).toBe(true);
    expect(
      veil.some(
        (rule) =>
          inReducedMotion(rule) &&
          rule.selector === 'html[data-route-veil] .route-theme-veil' &&
          rule.decls.get('transition') === 'none',
      ),
    ).toBe(true);
    // The fades match the sequencer.
    expect(veil.some((rule) => rule.body.includes(`transition: opacity ${THEME_VEIL.inMs}ms`))).toBe(true);
    expect(veil.some((rule) => rule.body.includes(`transition: opacity ${THEME_VEIL.outMs}ms`))).toBe(true);
  });

  it('the Station Card goes with the world under the veil: filter fade, hidden while opaque, animations untouched', () => {
    const veil = sectionRules('D32 theme veil');
    const hide = veil.find(
      (rule) => rule.selector.includes('html[data-route-veil="in"] .world-station-card') && /filter\s*:\s*opacity\(0\)/.test(rule.body),
    );
    expect(hide?.selector).toMatch(/html\[data-route-veil="opaque"\] \.world-station-card/);
    // ENGINE-A4: the card's fade starts after the veil's first frame and ends with the veil's fade-in.
    const fade = hide?.body.match(/transition: filter (\d+)ms [^;]*?(\d+)ms;/);
    expect(fade, 'delayed card fade').not.toBeNull();
    const [duration, delay] = [Number(fade?.[1]), Number(fade?.[2])];
    expect(delay).toBeGreaterThanOrEqual(17);
    expect(delay).toBeLessThanOrEqual(50);
    expect(duration + delay).toBe(THEME_VEIL.inMs);
    expect(
      veil.some(
        (rule) =>
          selectors(rule).some((selector) => selector.endsWith('.world-station-card')) &&
          (rule.decls.get('transition') ?? '').startsWith(`filter ${THEME_VEIL.outMs}ms`),
      ),
    ).toBe(true);
    expect(
      veil.some(
        (rule) =>
          selectors(rule).includes('html[data-route-veil="opaque"] .world-station-card') &&
          rule.decls.get('visibility') === 'hidden',
      ),
    ).toBe(true);
    // The card's own enter / exit animations keep running (animationend still fires).
    const cardRules = veil.filter((r) => r.selector.includes('.world-station-card'));
    expect(cardRules.length).toBeGreaterThanOrEqual(3);
    for (const rule of cardRules) {
      expect(rule.body, rule.selector).not.toMatch(/animation|(?<![-\w])opacity\s*:/);
    }
  });

  it('the canvas release and the loading spacer stand down under the veil', () => {
    const all = parseCssRules(globals).flatMap(selectors);
    expect(all.some((selector) => selector.startsWith('html[data-route-handoff]:not([data-route-veil]):has([data-ball-loader][data-revealing]:not([data-reduced])) [data-route-canvas]'))).toBe(true);
    expect(all).toContain('html:not([data-route-veil]):has([data-ball-loader][data-ball-phase="loading"]) [data-world-route]::after');
  });
});

describe('CHROME D32 — the veil lifts only after the ceremony hold and the DPR clamp', () => {
  it('releaseAfterBallMs outlasts both', () => {
    const governor = read(join(SRC, 'components', 'world', 'route', 'QualityGovernor.tsx'));
    const dprRelease = Number(governor.match(/export const CEREMONY_DPR_RELEASE_MS = (\d+);/)?.[1]);
    expect(dprRelease).toBeGreaterThan(0);
    expect(THEME_VEIL.releaseAfterBallMs).toBeGreaterThan(dprRelease);
    expect(THEME_VEIL.releaseAfterBallMs).toBeGreaterThan(CEREMONY_RENDER_HOLD.releaseAfterDoneMs);
    expect(THEME_VEIL.maxHoldAfterArmMs).toBeGreaterThan(CEREMONY_RENDER_HOLD.maxMs);
  });

  it('the provider defers a live swap to the veil and HideHtmlOnRoute keeps the marks under it', () => {
    const provider = read(join(SRC, 'components', 'world', 'route', 'WorldStateProvider.tsx'));
    expect(provider).toMatch(/planPaletteSwap\(\{ swapping, worldLive: worldLiveRef\.current, veil \}\)/);
    expect(provider).toMatch(/requestThemeVeil\(\{ target: nextKey, commit: commitSwap \}\)/);
    const hider = read(join(SRC, 'components', 'world', 'evoliga', 'route', 'HideHtmlOnRoute.tsx'));
    expect(hider).toMatch(/if \(!veilHoldsNow\(\)\) removeMarks\(\);/);
    expect(hider).toMatch(/if \(tier !== 'route'\) abortThemeVeil\(\);/);
    const canvas = read(join(SRC, 'components', 'world', 'route', 'RouteWorldCanvas.tsx'));
    expect(canvas).toMatch(/<RouteThemeVeil \/>/);
  });
});

describe('CHROME D33 — the HUD menu chip and the NavBar hooks', () => {
  it('the chip is labelled and controls the site nav; station chips put it away', () => {
    const nav = read(join(SRC, 'components', 'world', 'WorldNav.tsx'));
    expect(nav).toMatch(/className="world-nav-hud-chip world-nav-hud-menu[^"]*"/);
    expect(nav).toMatch(/aria-label=\{menuLabel\}/);
    expect(nav).toMatch(/aria-controls=\{SITE_NAV_ID\}/);
    expect(nav).toMatch(/aria-expanded=\{navReveal\.open\}/);
    expect(nav).toMatch(/navReveal\.stationChosen\(\);/);
    const bar = read(join(SRC, 'components', 'shared', 'NavBar.tsx'));
    expect(bar).toMatch(/<nav\s+id="site-nav"/);
    expect(bar.match(/data-navbar-drawer=""/g)?.length).toBe(2);
  });

  it('the reveal zone and timings are the specified ones', () => {
    expect(NAV_REVEAL.edgePx).toBe(24);
    expect(NAV_REVEAL.dwellMs).toBeGreaterThanOrEqual(100);
    expect(NAV_REVEAL.dwellMs).toBeLessThanOrEqual(150);
    expect(NAV_REVEAL.closeDelayMs).toBe(400);
  });
});
