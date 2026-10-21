import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALL_TIMING } from '@/lib/route-world/ball-loader-state';

/**
 * W7 handoff contract — the canvas is inert (opacity 0, no pointer events)
 * until the handoff, and the handoff is TWO-PHASE (review r3, blank-frame
 * veto): `html[data-route-handoff]` raises the canvas over the still-painted
 * sections, and `html.world-route-live` (which hides the sections) is only
 * written once the canvas has composited at opacity 1. The invariant is split
 * across CSS, the canvas wrapper and the hider, so it is pinned statically
 * here (the ordering itself — "never live while opacity < 1 or animating" —
 * is a property test of `stepHandoffComposite` in ball-loader-state.test):
 *
 * 1. `HideHtmlOnRoute` writes the handoff attribute from the provider's
 *    `routeSceneLive`, and adds `world-route-live` ONLY from the composite
 *    gate's `live` branch.
 * 2. Every stylesheet rule that sets the canvas's opacity is scoped to
 *    `html:not(.world-route-live):not([data-route-handoff])`, every rule that
 *    removes its pointer events to `html:not(.world-route-live)` — so neither
 *    mark can leave the canvas hidden.
 * 3. Every rule that hides section paint is scoped to `html.world-route-live`
 *    (phase 2), never to the handoff attribute (phase 1).
 * 4. The release fade runs only during the ball's reveal, starts at opacity
 *    0 on the beam's delay (flight lead and time scale included), is
 *    opacity-only (compositor), and ends before the ceremony does.
 * 6. Wave 2 (compositor-driven ceremony): every keyframe of the ceremony
 *    and of the canvas release animates only `transform` / `opacity`, and
 *    every reveal beat is scaled by the plan (`--k` / `--ball-k`) and offset
 *    by the flight lead, so one pre-scheduled timeline covers every mode.
 * 5. The canvas wrapper carries no inline/utility opacity of its own, and
 *    every surface that mounts `RouteWorldCanvas` also mounts
 *    `HideHtmlOnRoute`.
 *
 * Honest limit: this is a source-level contract (regex over CSS/TSX), not a
 * rendered check. The headed loader trace with `--handoff-composite`
 * (EVIDENCE.md, W7) is the runtime proof.
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..', '..');

// ENGINE-A4: the src/ walk and its reads are cached once per file. Walked and
// re-read per test, they took 5-78 s under a loaded full suite (timeouts);
// the tests below also carry an explicit FILE_WALK_TIMEOUT_MS.
const FILE_WALK_TIMEOUT_MS = 30_000;
const texts = new Map<string, string>();
function read(path: string): string {
  let text = texts.get(path);
  if (text === undefined) {
    text = readFileSync(path, 'utf8');
    texts.set(path, text);
  }
  return text;
}

const walked = new Map<string, string[]>();
function allFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      allFiles(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function walk(dir: string, match: (path: string) => boolean): string[] {
  let files = walked.get(dir);
  if (files === undefined) {
    files = allFiles(dir);
    walked.set(dir, files);
  }
  return files.filter(match);
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Remove every `@media (prefers-reduced-motion: reduce) { … }` block (brace-matched). */
function stripReducedMotion(css: string): string {
  let out = css;
  for (;;) {
    const at = out.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
    if (at < 0) return out;
    let depth = 0;
    let end = out.indexOf('{', at);
    for (; end < out.length; end += 1) {
      if (out[end] === '{') depth += 1;
      else if (out[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out = out.slice(0, at) + out.slice(end + 1);
  }
}

/** Every `@keyframes name { … }` block → the set of properties its frames declare. */
function keyframeProperties(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 0;
    let end = (match.index ?? 0) + match[0].length - 1;
    const start = end;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = css.slice(start + 1, end);
    const props = new Set<string>();
    for (const decl of body.matchAll(/([a-z-]+)\s*:/g)) props.add(decl[1]);
    found.set(match[1], props);
  }
  return found;
}

interface CssRule {
  file: string;
  selector: string;
  body: string;
}

function rulesOf(file: string): CssRule[] {
  const css = stripCssComments(read(file));
  const rules: CssRule[] = [];
  // Innermost blocks only: a rule nested in @media is captured with the
  // selector text that follows the media block's opening brace.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ file, selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

const posix = (path: string) => relative(SRC, path).split(sep).join('/');

describe('W7 handoff contract — two-phase: no frame shows neither page nor world', () => {
  const hiderPath = () => join(SRC, 'components', 'world', 'evoliga', 'route', 'HideHtmlOnRoute.tsx');

  it('HideHtmlOnRoute writes the handoff from routeSceneLive and world-route-live only through the composite gate', () => {
    const hider = read(hiderPath());
    expect(hider).toMatch(/ROUTE_HANDOFF_ATTR\s*=\s*'data-route-handoff'/);
    expect(hider).toMatch(/ROUTE_LIVE_CLASS\s*=\s*'world-route-live'/);
    expect(hider).toMatch(/if\s*\(!routeSceneLive\)/);
    expect(hider).toMatch(/root\.setAttribute\(\s*ROUTE_HANDOFF_ATTR/);
    // The ONLY add of the live class sits in the gate's `live` branch.
    const adds = hider.match(/classList\.(add|toggle)\([^)]*\)/g) ?? [];
    expect(adds).toEqual(['classList.add(ROUTE_LIVE_CLASS)']);
    expect(hider).toMatch(
      /stepHandoffComposite\([\s\S]*?if\s*\(step\.live\)\s*\{\s*root\.classList\.add\(ROUTE_LIVE_CLASS\)/,
    );
    // No raw class write anywhere else in the source tree.
    const writers = walk(SRC, (path) => /\.tsx?$/.test(path)).filter((path) =>
      /classList\.(add|toggle)\(\s*'world-route-live'/.test(read(path)),
    );
    expect(writers.map(posix)).toEqual([]);
  }, FILE_WALK_TIMEOUT_MS);

  it('every rule hiding [data-route-canvas] is scoped to the pre-handoff state', () => {
    const sheets = walk(SRC, (path) => path.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(0);
    const canvasRules = sheets.flatMap(rulesOf).filter((rule) => rule.selector.includes('data-route-canvas'));
    expect(canvasRules.length).toBeGreaterThanOrEqual(2);

    const opacity = canvasRules.filter((rule) =>
      /\bopacity\s*:|\bvisibility\s*:\s*hidden|\bdisplay\s*:\s*none/.test(rule.body),
    );
    expect(opacity.length).toBeGreaterThan(0);
    for (const rule of opacity) {
      for (const selector of rule.selector.split(',')) {
        expect(
          selector.includes('html:not(.world-route-live):not([data-route-handoff])'),
          `${posix(rule.file)}: "${selector.trim()}" hides the canvas after the handoff began`,
        ).toBe(true);
      }
    }
    const pointer = canvasRules.filter((rule) => /\bpointer-events\s*:\s*none/.test(rule.body));
    for (const rule of pointer) {
      for (const selector of rule.selector.split(',')) {
        expect(selector.includes('html:not(.world-route-live)'), selector).toBe(true);
      }
    }
  }, FILE_WALK_TIMEOUT_MS);

  it('section paint is hidden only in phase 2 (html.world-route-live), never on the handoff attribute', () => {
    const rules = rulesOf(join(SRC, 'app', 'globals.css')).filter(
      (rule) =>
        /\[data-world-route\]\s+section/.test(rule.selector) &&
        /\bvisibility\s*:\s*hidden|\bdisplay\s*:\s*none|\bopacity\s*:\s*0/.test(rule.body),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const selector of rule.selector.split(',')) {
        expect(selector).toContain('html.world-route-live');
        expect(selector).not.toContain('data-route-handoff');
      }
    }
  }, FILE_WALK_TIMEOUT_MS);

  it('the release fade runs only during the ball reveal, on the beam delay, opacity-only, and ends before the ceremony', () => {
    const globals = read(join(SRC, 'app', 'globals.css'));
    const rules = rulesOf(join(SRC, 'app', 'globals.css')).filter(
      (rule) => rule.selector.includes('data-route-canvas') && /\banimation\s*:(?!\s*none)/.test(rule.body),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.selector).toContain('html[data-route-handoff]');
      expect(rule.selector).toMatch(/\[data-ball-loader\]\[data-revealing\]:not\(\[data-reduced\]\)/);
      const body = rule.body.replace(/\s+/g, ' ');
      const timing = body.match(
        // Wave-2 r2: the fade is a release beat — its duration runs at the
        // release scale (`--ball-kb`), its delay at the lead-in scale.
        /route-canvas-release calc\((\d+)ms \* var\(--ball-kb, 1\)\) [^;]*? calc\(\(var\(--ball-lead, 0ms\) \+ (\d+)ms\) \* var\(--ball-k, 1\)\) both/,
      );
      expect(timing, 'release animation shorthand (scaled, lead-offset)').not.toBeNull();
      expect(Number(timing?.[2])).toBe(BALL_TIMING.handoffMs);
      // The fade ends before the ball is done (the rule drops away then).
      expect(Number(timing?.[1]) + Number(timing?.[2])).toBeLessThanOrEqual(BALL_TIMING.openMs);
    }
    const css = stripCssComments(globals);
    const from = css.match(/@keyframes\s+route-canvas-release\s*\{\s*from\s*\{([^}]*)\}/);
    expect(from?.[1]).toMatch(/opacity\s*:\s*0\s*;/);
    expect([...(keyframeProperties(css).get('route-canvas-release') ?? [])]).toEqual(['opacity']);
    // The r3–r5 clip-path iris (main-thread paint) is gone for good.
    expect(css).not.toMatch(/route-canvas-iris|clip-path\s*:\s*circle/);
  });

  it('the site NavBar leaves with the page from handoff phase 1, on the canvas opacity transition (review r4)', () => {
    const rules = rulesOf(join(SRC, 'app', 'globals.css'));
    const canvasBase = rules.find((rule) => rule.selector === '[data-route-canvas]' && /transition\s*:/.test(rule.body));
    const canvasTransition = canvasBase?.body.match(/transition\s*:\s*([^;]+);/)?.[1].trim();
    expect(canvasTransition, 'canvas base transition').toBeDefined();
    const nav = rules.filter(
      (rule) => rule.selector === 'html[data-route-handoff] body > nav' && /\bopacity\s*:\s*0\b/.test(rule.body),
    );
    expect(nav).toHaveLength(1);
    const body = nav[0]?.body ?? '';
    expect(body).toMatch(/pointer-events\s*:\s*none/);
    // Opacity only: the NavBar keeps its flow slot (conductor offsets stay put).
    expect(body).not.toMatch(/\bdisplay\s*:|\bheight\s*:|\bposition\s*:/);
    expect(body.match(/transition\s*:\s*([^;]+);/)?.[1].trim()).toBe(canvasTransition);
  });

  it('the ball CSS beats match BALL_TIMING (hinge start, beam delay), offset by the flight lead and scaled', () => {
    const css = stripCssComments(read(join(SRC, 'components', 'world', 'route', 'BallLoader.module.css'))).replace(
      /\s+/g,
      ' ',
    );
    const hinge = css.match(
      /\.root\[data-revealing\] \.lid \{[^}]*animation: lidOpen calc\(\d+ms \* var\(--k\)\) [^;]*? calc\(\(var\(--lead\) \+ (\d+)ms\) \* var\(--k\)\) both/,
    );
    expect(hinge).not.toBeNull();
    expect(Number(hinge?.[1])).toBe(BALL_TIMING.hingeStartMs);
    for (const part of ['glow', 'sweep', 'core', 'ring', 'ray', 'spark']) {
      const beat = css.match(
        new RegExp(
          `\\.root\\[data-revealing\\] \\.${part} \\{[^}]*animation: [^;]*? (?:calc\\()?calc\\(\\(var\\(--lead\\) \\+ (\\d+)ms`,
        ),
      );
      expect(beat, part).not.toBeNull();
      expect(Number(beat?.[1]), part).toBe(BALL_TIMING.handoffMs);
    }
    // The flight lead is 0 unless the page sets it (wide screens open in the dock).
    expect(css).toMatch(/--lead: var\(--ball-lead, 0ms\);/);
    expect(css).toMatch(/--k: var\(--ball-k, 1\);/);
  });

  it('the reveal point is screen centre at EVERY width (wave-2 r3: no dock-corner burst at ≥ 641 px)', () => {
    const css = stripCssComments(read(join(SRC, 'components', 'world', 'route', 'BallLoader.module.css')));
    const base = css.match(/\.root\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(base).toMatch(/--reveal-x:\s*0px/);
    expect(base).toMatch(/--reveal-y:\s*0px/);
    const narrow = css.match(/@media\s*\(max-width:\s*640px\)\s*\{\s*\.root\s*\{([^}]*)\}/)?.[1] ?? '';
    // No width scoping of the reveal point or the flight.
    expect(narrow).not.toMatch(/--reveal-[xy]/);
    for (const block of css.matchAll(/@media\s*\(max-width:[^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
      expect(block[1]).not.toMatch(/ballFly|\.flight|--reveal-/);
    }
    const tsx = read(join(SRC, 'components', 'world', 'route', 'BallLoader.tsx'));
    expect(tsx).not.toMatch(/FLIGHT_QUERY/);
    expect(tsx).toMatch(/const FLIGHT = true;/);
    // The docked visual stays the r3 32 px gutter ball (72 px × 0.4444).
    expect(narrow).toMatch(/--dock-size:\s*32px/);
    const size = Number(narrow.match(/--ball-size:\s*(\d+)px/)?.[1]);
    const scale = Number(narrow.match(/--dock-scale:\s*([\d.]+)/)?.[1]);
    expect(Math.abs(size * scale - 32)).toBeLessThan(0.1);
    // The beam bursts from the reveal point, never the raw dock.
    expect(css).toMatch(/\.beam\s*\{[^}]*left:\s*calc\(50% \+ var\(--reveal-x\)\)/);
  });

  it('Lite floor (wave-2 r3): the route canvas and the page handoff exist only on the route tier', () => {
    const canvas = read(join(SRC, 'components', 'world', 'route', 'RouteWorldCanvas.tsx'));
    const entry = canvas.match(/export default function RouteWorldCanvas\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(entry).toMatch(/routeCanvasMounts\(tier\)\s*\?\s*<RouteWorldCanvasLive>/);
    expect(canvas).toMatch(/export function routeCanvasMounts\(tier: 'route' \| 'lite'\): boolean \{\s*return tier === 'route';/);
    const hide = read(join(SRC, 'components', 'world', 'evoliga', 'route', 'HideHtmlOnRoute.tsx'));
    expect(hide).toMatch(/routeHandoffAllowed\(\{ tier, routeSceneLive: sceneLive \}\)/);
  });

  it('compositor-only: every ceremony keyframe animates transform / opacity and nothing else', () => {
    const ballCss = stripCssComments(read(join(SRC, 'components', 'world', 'route', 'BallLoader.module.css')));
    const frames = keyframeProperties(ballCss);
    expect(frames.size).toBeGreaterThanOrEqual(10);
    for (const [name, props] of frames) {
      for (const prop of props) expect(['transform', 'opacity'], `@keyframes ${name} animates ${prop}`).toContain(prop);
    }
  });

  it('one timeline: every reveal beat (outside the crossfade) is scaled by --k; the reduced paths are not', () => {
    const css = stripReducedMotion(
      stripCssComments(read(join(SRC, 'components', 'world', 'route', 'BallLoader.module.css'))),
    );
    const beats = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selector: match[1].trim(), body: match[2] }))
      .filter(
        (rule) =>
          rule.selector.includes('[data-revealing]') &&
          !rule.selector.includes('[data-reduced]') &&
          /\banimation\s*:(?!\s*none)/.test(rule.body),
      );
    expect(beats.length).toBeGreaterThanOrEqual(10);
    for (const rule of beats) {
      const animation = rule.body.match(/\banimation\s*:([^;]*);/)?.[1] ?? '';
      for (const layer of animation.split(/,(?![^(]*\))/)) {
        // The layer's duration (and delay, where it has one) is `… * var(--k))`.
        expect(layer, rule.selector).toMatch(/\* var\(--k\)\)/);
      }
    }
  });

  it('the canvas wrapper carries no opacity of its own', () => {
    const canvas = read(join(SRC, 'components', 'world', 'route', 'RouteWorldCanvas.tsx'));
    const wrapper = canvas.match(/<div[^>]*data-route-canvas[^>]*>/);
    expect(wrapper, 'RouteWorldCanvas lost its data-route-canvas wrapper').not.toBeNull();
    const tag = wrapper?.[0] ?? '';
    expect(tag).not.toMatch(/opacity|invisible|hidden(?!=)|style=/);
  });

  it('every surface that mounts RouteWorldCanvas mounts HideHtmlOnRoute in its world root', () => {
    const importers = walk(SRC, (path) => /\.tsx?$/.test(path)).filter((path) =>
      /import\s+RouteWorldCanvas\s+from\s+'@\/components\/world\/route\/RouteWorldCanvas'/.test(read(path)),
    );
    expect(importers.length).toBeGreaterThan(0);

    for (const scene of importers) {
      // The world root sits beside the scene (themes, route-preview) or one
      // directory up (evoliga/route/RouteScene → evoliga/EvoligaWorld).
      const here = join(scene, '..');
      const candidates = [here, join(here, '..')].flatMap((dir) =>
        readdirSync(dir)
          .filter((entry) => entry.endsWith('.tsx'))
          .map((entry) => join(dir, entry)),
      );
      const mountsHider = candidates.some((path) => /<HideHtmlOnRoute\s*\/>/.test(read(path)));
      expect(mountsHider, `${posix(scene)} mounts the canvas but no nearby world root mounts <HideHtmlOnRoute />`).toBe(
        true,
      );
    }
  }, FILE_WALK_TIMEOUT_MS);
});
