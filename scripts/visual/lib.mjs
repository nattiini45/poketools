/**
 * Pure helpers of the visual-capture harness (docs/visual-harness.md): target expansion, URL templating,
 * the request policy and the pixel comparison. No browser and no file system here, so
 * scripts/__tests__/visual-harness.test.mjs covers them directly.
 */

/** Hosts a capture may load images from. Each response is cached on disk by the runner, so a second run is offline. */
export const EXTERNAL_IMAGE_HOSTS = ['play.pokemonshowdown.com', 'img.pokemondb.net', 'raw.githubusercontent.com', 'cdn.discordapp.com'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * What the runner does with one browser request.
 * - 'allow': the app server or the local stack (loopback), or a data:/blob: URL.
 * - 'cache': an image from an allow-listed external host, served from the disk cache.
 * - 'block': anything else; the capture records it and the run fails. Every Supabase host that is not
 *   loopback is blocked, so a capture can never reach the hosted project or its Storage buckets.
 * @param {string} url
 * @param {string} resourceType Playwright's request.resourceType()
 * @returns {'allow' | 'cache' | 'block'}
 */
export function requestPolicy(url, resourceType) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'block';
  }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return 'allow';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'block';
  if (LOOPBACK.has(parsed.hostname)) return 'allow';
  if (resourceType === 'image' && EXTERNAL_IMAGE_HOSTS.includes(parsed.hostname)) return 'cache';
  return 'block';
}

/** Replaces each {name} in a template from vars; an unknown name throws, so a typo never captures the wrong URL. */
export function fillTemplate(template, vars) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    if (!(name in vars)) throw new Error('visual: no value for {' + name + '} in "' + template + '"');
    return encodeURIComponent(String(vars[name]));
  });
}

/** Every combination of a target's matrix, in a stable order (keys sorted, values in listed order). */
export function expandMatrix(matrix = {}) {
  const keys = Object.keys(matrix).sort();
  let rows = [{}];
  for (const key of keys) {
    const values = matrix[key];
    if (!Array.isArray(values) || values.length === 0) throw new Error('visual: matrix "' + key + '" needs at least one value');
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value })));
  }
  return rows;
}

/** A file-system-safe slug of a capture's variables, stable across runs. */
export function slugOf(parts) {
  return parts
    .map((part) => String(part).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('__');
}

/**
 * Expands a manifest (frozen.json or routes.json) into one job per page load.
 * @param {{ viewports: Record<string, {width: number, height: number}>, themes: string[], defaults?: object, targets: object[] }} manifest
 * @param {{ ids?: Record<string, string>, now?: string, only?: string[] }} context
 */
export function expandTargets(manifest, { ids = {}, now = '', only = [] } = {}) {
  const jobs = [];
  for (const target of manifest.targets) {
    if (only.length && !only.some((pattern) => target.id === pattern || target.id.startsWith(pattern + '/'))) continue;
    // A target whose seed ids are missing (no seed run) is skipped, never captured with a half-filled URL.
    if ((target.needs ?? []).some((id) => !(id in ids))) continue;
    const viewports = target.viewports ?? Object.keys(manifest.viewports);
    const themes = target.themes ?? manifest.themes;
    for (const vars of expandMatrix(target.matrix)) {
      for (const viewport of viewports) {
        const size = manifest.viewports[viewport];
        if (!size) throw new Error('visual: target ' + target.id + ' names unknown viewport ' + viewport);
        for (const theme of themes) {
          const all = { ...ids, ...vars, now, theme, viewport };
          jobs.push({
            target: target.id,
            key: slugOf([target.id, ...Object.keys(vars).sort().map((k) => vars[k]), viewport, theme]),
            url: fillTemplate(target.url, all),
            viewport: size,
            viewportName: viewport,
            theme,
            vars,
            roots: target.roots ?? [],
            fullPage: target.fullPage === true,
            mask: target.mask ?? [],
            minRoots: target.minRoots ?? 1,
            tolerance: target.tolerance ?? { maxChangedPct: 0, threshold: 0 },
            signIn: target.signIn ?? null,
            locale: vars.lang ?? target.locale ?? 'en',
            waitFor: target.waitFor ?? null,
            click: target.click ?? null,
            settleMs: target.settleMs ?? manifest.defaults?.settleMs ?? 400,
            advanceMs: target.advanceMs == null ? null : Number(fillTemplate(String(target.advanceMs), all)),
          });
        }
      }
    }
  }
  return jobs;
}

/**
 * Compares two decoded RGBA images. A pixel differs when any channel differs by more than threshold
 * (0 means any difference at all). Returns the count, the share in percent and the bounding box.
 * @param {{ data: Uint8Array | Buffer, width: number, height: number, channels: number }} a
 * @param {{ data: Uint8Array | Buffer, width: number, height: number, channels: number }} b
 */
export function comparePixels(a, b, { threshold = 0 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sameSize: false, changed: null, changedPct: 100, box: null, size: [a.width, a.height, b.width, b.height] };
  }
  const ca = a.channels;
  const cb = b.channels;
  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = y * a.width + x;
      const pa = i * ca;
      const pb = i * cb;
      let delta = 0;
      for (let c = 0; c < 4; c += 1) {
        const va = c < ca ? a.data[pa + c] : 255;
        const vb = c < cb ? b.data[pb + c] : 255;
        const d = Math.abs(va - vb);
        if (d > delta) delta = d;
      }
      if (delta > threshold) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const total = a.width * a.height;
  return {
    sameSize: true,
    changed,
    changedPct: total ? (100 * changed) / total : 0,
    box: changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

/**
 * The verdict for one capture pair. Frozen captures pass only within their tolerance (zero by default);
 * a capture that exists on one side only, or whose root count changed, always fails.
 */
export function verdictOf({ base, head, comparison, tolerance = { maxChangedPct: 0, threshold: 0 } }) {
  if (!base) return { status: 'added', pass: false };
  if (!head) return { status: 'removed', pass: false };
  if (!comparison.sameSize) return { status: 'resized', pass: false };
  if (comparison.changed === 0) return { status: 'same', pass: true };
  const pass = comparison.changedPct <= (tolerance.maxChangedPct ?? 0);
  return { status: pass ? 'within-tolerance' : 'changed', pass };
}
