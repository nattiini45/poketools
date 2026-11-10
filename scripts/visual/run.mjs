#!/usr/bin/env node
/**
 * Visual-capture harness: capture runner (docs/visual-harness.md).
 *
 *   node scripts/visual/run.mjs --label <name> [--set frozen|surfaces|all] [--only <target id>[,...]]
 *        [--app-dir <checkout>] [--port <n>] [--base-url <url>] [--concurrency <n>] [--out <dir>] [--no-seed]
 *
 * Boots its own next dev server in --app-dir (default: this checkout) on a pinned port with the local-stack
 * preload (.claude/local-db.cjs: the local Supabase stack, the local world and sprite mirrors) and the public
 * example pack, then captures every job of scripts/visual/frozen.json (zero-diff baselines of the frozen surfaces,
 * clipped to their roots) and/or scripts/visual/routes.json (surface captures for review). Files land in
 * <out>/<label>/<set>/<key>.png with a manifest.json; compare two labels with scripts/visual/diff.mjs.
 *
 * Quota rules (AGENTS.md): every request that is not loopback is intercepted. Images from the allow-listed
 * Pokémon sprite hosts are served from a disk cache (<out>/cache) after their first fetch; anything else is aborted
 * and fails the run, so a capture never reaches the hosted Supabase project or a Storage bucket.
 *
 * Exits 0 when every job captured its roots without a blocked request, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expandTargets, requestPolicy } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

export const DEFAULT_PORT = 3123;
const DEV_OVERLAY_HIDE_CSS = 'nextjs-portal { display: none !important; }';
/** Software raster on one thread: GPU and tiled raster anti-alias rounded corners differently run to run. */
const DETERMINISTIC_CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-gpu-rasterization',
  '--disable-partial-raster',
  '--disable-skia-runtime-opts',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--num-raster-threads=1',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
];

/** Requests the quiet-network wait ignores: dev-server channels and long polls never settle. */
const QUIET_IGNORE = [/\/_next\/webpack-hmr/, /\/__nextjs/, /\/_next\/static\/.*\.hot-update\./, /\/api\/notifications/, /\/api\/push\//];

function option(argv, name, fallback) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** The seed ids that URL templates may name ({leagueSakura}, ...), or {} without a seed file. */
async function seedIds(appDir) {
  const path = join(appDir, 'scripts', 'visual', 'seed-ids.json');
  if (!existsSync(path)) return {};
  const raw = await readJson(path);
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string'));
}

function waitForServer(baseUrl, child, timeoutMs) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const tick = async () => {
      if (child && child.exitCode !== null) return reject(new Error('visual: dev server exited with ' + child.exitCode));
      try {
        const res = await fetch(baseUrl + '/robots.txt');
        if (res.status < 500) return resolvePromise();
      } catch {
        // not up yet
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('visual: dev server did not answer within ' + timeoutMs + ' ms'));
      setTimeout(tick, 1000);
    };
    tick();
  });
}

/** Starts next dev in appDir behind the local-stack preload; resolves once it answers. */
export async function bootDevServer({ appDir, port, logPath }) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    FORMAT_PACK: 'example',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'e2e-secret-for-the-local-stack-only',
    LOCAL_DB_DEV_PORT: String(port),
    RATE_LIMIT_STORE: 'memory',
    NEXT_PUBLIC_WORLD_ASSETS_URL: '/models/world',
    NEXT_PUBLIC_SPRITES_URL: '/sprites',
    NEXT_TELEMETRY_DISABLED: '1',
    DISCORD_CLIENT_ID: '',
    DISCORD_CLIENT_SECRET: '',
    ANTHROPIC_API_KEY: '',
    REPLICATE_API_TOKEN: '',
    BRAINTRUST_API_KEY: '',
  };
  const { openSync } = await import('node:fs');
  await mkdir(dirname(logPath), { recursive: true });
  const log = openSync(logPath, 'w');
  const child = spawn(process.execPath, ['--require', './.claude/local-db.cjs', 'node_modules/next/dist/bin/next', 'dev', '--port', String(port)], {
    cwd: appDir,
    env,
    stdio: ['ignore', log, log],
  });
  const baseUrl = 'http://localhost:' + port;
  await waitForServer(baseUrl, child, 180_000);
  return { baseUrl, stop: () => child.kill('SIGTERM') };
}

/** The cached body and its metadata, or null when the image was never cached (read without a separate existence check). */
async function readCached(file) {
  try {
    return { meta: JSON.parse(await readFile(file + '.json', 'utf8')), body: await readFile(file) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** The app answered 429: the capture would show a page without its data, so the job is run again later. */
class RateLimitedError extends Error {
  constructor(url, retryAfterSeconds) {
    super('visual: rate limited by the app: ' + url);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Serves an allow-listed external image from the disk cache, fetching it once. */
async function serveCached(route, cacheDir) {
  const url = route.request().url();
  const file = join(cacheDir, createHash('sha256').update(url).digest('hex'));
  const cached = await readCached(file);
  if (cached) return route.fulfill({ status: cached.meta.status, headers: { 'content-type': cached.meta.contentType }, body: cached.body });
  const response = await route.fetch();
  const body = await response.body();
  const meta = { url, status: response.status(), contentType: response.headers()['content-type'] ?? 'application/octet-stream' };
  if (meta.status === 200 || meta.status === 404) {
    await writeFile(file, body);
    await writeFile(file + '.json', JSON.stringify(meta));
  }
  return route.fulfill({ status: meta.status, headers: { 'content-type': meta.contentType }, body });
}

/** Waits until no tracked request has been in flight for quietMs (bounded). */
async function waitQuiet(inflight, { quietMs = 600, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  let quietSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (inflight.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function settlePage(page, { fakeClock = false } = {}) {
  await page.addStyleTag({ content: DEV_OVERLAY_HIDE_CSS });
  // Image loads are real events, so this resolves under a fake clock too; the bound runs in Node.
  const loaded = page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) if (img.loading === 'lazy') img.loading = 'eager';
    const settle = () => Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((done) => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    })));
    await settle();
    // A sprite the busy dev server failed once is requested again, so a capture never shows a hole by chance.
    for (let retry = 0; retry < 2; retry += 1) {
      const broken = [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && img.currentSrc);
      if (broken.length === 0) break;
      for (const img of broken) {
        const src = img.src;
        img.src = '';
        img.src = src;
      }
      await settle();
    }
    await Promise.all([...document.images].filter((img) => img.complete && img.naturalWidth > 0).map((img) => img.decode().catch(() => undefined)));
  });
  await Promise.race([loaded, new Promise((done) => setTimeout(done, 15_000))]);
  if (fakeClock) await page.clock.runFor(50);
  else await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** One sign-in per role and run, shared by the jobs that need it (concurrent jobs await the same promise). */
const signIns = new Map();
function signInState(browser, baseUrl, role, roles, dir) {
  const key = dir + '|' + role;
  if (!signIns.has(key)) signIns.set(key, signInOnce(browser, baseUrl, role, roles, dir));
  return signIns.get(key);
}

async function signInOnce(browser, baseUrl, role, roles, dir) {
  const file = join(dir, 'auth-' + role + '.json');
  if (existsSync(file)) return file;
  const creds = roles[role];
  if (!creds) throw new Error('visual: unknown role ' + role);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(baseUrl + '/auth/signin', { waitUntil: 'networkidle', timeout: 180_000 });
      await page.getByLabel('Email').fill(creds.email);
      await page.getByLabel('Password').fill(creds.password);
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials'), { timeout: 60_000 }).catch(() => null),
        page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
      const session = await page.request.get(baseUrl + '/api/auth/session').then((r) => r.json()).catch(() => null);
      if (session && session.user) {
        await context.storageState({ path: file });
        return file;
      }
    }
    throw new Error('visual: could not sign in as ' + role);
  } finally {
    await context.close();
  }
}

async function captureJob(browser, job, { baseUrl, outDir, cacheDir, authDir, roles }) {
  const violations = [];
  const inflight = new Set();
  const storageState = job.signIn ? await signInState(browser, baseUrl, job.signIn, roles, authDir) : undefined;
  const context = await browser.newContext({
    viewport: job.viewport,
    deviceScaleFactor: 1,
    colorScheme: job.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    locale: job.locale === 'de' ? 'de-DE' : 'en-US',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
    storageState,
  });
  try {
    await context.addCookies([{ name: 'plc_locale', value: job.locale, url: baseUrl }]);
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem('theme', theme);
      } catch {
        // storage unavailable: colorScheme still applies
      }
    }, job.theme);
    // advanceMs: fake timers from the pinned instant, run forward by that much once the page has its data.
    if (job.advanceMs != null) {
      await context.clock.install({ time: new Date(job.clock) });
      await context.clock.pauseAt(new Date(Date.parse(job.clock) + 1));
    }
    else if (job.clock) await context.clock.setFixedTime(new Date(job.clock));
    await context.route('**/*', async (route) => {
      const request = route.request();
      const policy = requestPolicy(request.url(), request.resourceType());
      if (policy === 'allow') return route.continue();
      if (policy === 'cache') {
        try {
          return await serveCached(route, cacheDir);
        } catch (err) {
          violations.push({ url: request.url(), reason: 'cache-fetch-failed: ' + (err instanceof Error ? err.message : String(err)) });
          return route.abort();
        }
      }
      violations.push({ url: request.url(), reason: 'blocked' });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('request', (r) => {
      if (!QUIET_IGNORE.some((re) => re.test(r.url()))) inflight.add(r);
    });
    const done = (r) => inflight.delete(r);
    let rateLimited = null;
    page.on('response', (r) => {
      if (r.status() === 429 && !rateLimited) rateLimited = new RateLimitedError(r.url(), Number(r.headers()['retry-after']) || 30);
    });
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    const response = await page.goto(baseUrl + job.url, { waitUntil: 'load', timeout: 240_000 });
    if (!response || response.status() >= 400) throw new Error('HTTP ' + (response ? response.status() : 'no response'));
    if (job.waitFor) await page.locator(job.waitFor).first().waitFor({ state: 'visible', timeout: 60_000 });
    await waitQuiet(inflight);
    const fakeClock = job.advanceMs != null;
    if (fakeClock) {
      // The paused clock holds the page's timers: step it until the overlay has rendered its data, so the
      // rotation timer starts at a known instant, then run forward by exactly advanceMs.
      const ready = page.locator(job.waitFor ?? 'div[lang] > :not(style)').first();
      for (let step = 0; step < 400 && !rateLimited && !(await ready.isVisible()); step += 1) {
        await page.clock.runFor(50);
        await waitQuiet(inflight, { quietMs: 300, timeoutMs: 10_000 });
      }
      if (rateLimited) throw rateLimited;
      if (!(await ready.isVisible())) throw new Error('visual: the page never rendered ' + (job.waitFor ?? 'its overlay content') + ' under the paused clock');
      await page.clock.runFor(job.advanceMs);
      await waitQuiet(inflight, { quietMs: 300, timeoutMs: 10_000 });
    }
    await settlePage(page, { fakeClock });
    await waitQuiet(inflight, { quietMs: 300, timeoutMs: 10_000 });
    await page.waitForTimeout(job.settleMs);
    if (job.click) {
      await page.locator(job.click).first().click();
      await waitQuiet(inflight, { quietMs: 300, timeoutMs: 10_000 });
      await settlePage(page, { fakeClock });
      await page.waitForTimeout(job.settleMs);
    }
    const shots = [];
    const mask = job.mask.map((sel) => page.locator(sel));
    if (job.fullPage) {
      shots.push(await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', mask }));
    } else {
      // Site chrome that floats over a clipped root (the sticky nav bar) is not part of the surface: hide every
      // fixed or sticky element that neither sits inside a root nor contains one, keeping its layout box.
      // Chrome around a root is not part of it either, and its height would move the root on the page or change how
      // far the page scrolls (which moves a sticky part of the root): drop every element that precedes or follows the
      // root or one of its ancestors (unless it holds another root), and the vertical padding, margin and border of
      // those ancestors and the root's own vertical margin (a sibling's spacing rule, which Tailwind 3 and 4 place on
      // different sides), so each root starts near the top of a page that ends with it, whatever the chrome is.
      // The page ground is chrome too: ancestors paint no background, and the page shows the plaza ground, so a root
      // with transparent edges (rounded corners, an outlined card) reads the same backdrop on every run.
      await page.evaluate((selectors) => {
        const roots = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
        for (const root of roots) {
          for (let el = root; el && el !== document.body; el = el.parentElement) {
            for (const sib of el.parentElement ? el.parentElement.children : []) {
              if (sib === el || ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(sib.tagName) || roots.some((r) => sib.contains(r) || r.contains(sib))) continue;
              sib.style.setProperty('display', 'none', 'important');
            }
            if (el === root) for (const prop of ['margin-top', 'margin-bottom']) el.style.setProperty(prop, '0', 'important');
            if (el !== root && !roots.some((r) => el === r || r.contains(el))) {
              for (const prop of ['padding-top', 'margin-top', 'border-top-width', 'padding-bottom', 'margin-bottom', 'border-bottom-width']) el.style.setProperty(prop, '0', 'important');
              el.style.setProperty('background', 'none', 'important');
            }
          }
          if (!roots.some((r) => r.contains(document.body))) document.body.style.setProperty('background', 'none', 'important');
        }
        document.documentElement.style.setProperty('background', 'var(--palette-plaza-ground)', 'important');
        for (const el of document.querySelectorAll('body *')) {
          const position = getComputedStyle(el).position;
          if (position !== 'fixed' && position !== 'sticky') continue;
          if (roots.some((root) => root.contains(el) || el.contains(root))) continue;
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }, job.roots);
      await page.waitForTimeout(300);
      // Lazy images below the fold would otherwise be captured unloaded.
      await page.evaluate(async (selectors) => {
        const images = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).flatMap((root) => [...root.querySelectorAll('img')]);
        for (const img of images) img.loading = 'eager';
        await Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }))));
      }, job.roots);
      for (const selector of job.roots) {
        const matches = page.locator(selector);
        const count = await matches.count();
        for (let i = 0; i < count; i += 1) {
          const el = matches.nth(i);
          const box = await el.boundingBox();
          if (!box || box.width < 1 || box.height < 1) continue;
          // Pin the root to the same raster phase on every run: whole pixels across, and down to the next multiple of
          // 64 px. Chrome above a root may change its height, and gradients, rotated boxes and text rasterise by
          // their offset on the page, so an unchanged surface would otherwise re-rasterise.
          await el.evaluate((node) => {
            const style = getComputedStyle(node);
            if (style.position !== 'static' && style.position !== 'relative') return;
            const offset = (value) => (value === 'auto' ? 0 : parseFloat(value));
            const rect = node.getBoundingClientRect();
            const x = rect.left + window.scrollX;
            const y = rect.top + window.scrollY;
            const [left, top] = style.position === 'relative' ? [offset(style.left), offset(style.top)] : [0, 0];
            node.style.setProperty('position', 'relative');
            node.style.setProperty('left', left + Math.round(x) - x + 'px');
            node.style.setProperty('top', top + Math.ceil(y / 64) * 64 - y + 'px');
          });
          shots.push(await el.screenshot({ animations: 'disabled', caret: 'hide', mask, timeout: 60_000 }));
        }
      }
    }
    if (rateLimited) throw rateLimited;
    if (shots.length < job.minRoots) throw new Error('found ' + shots.length + ' frozen roots, expected at least ' + job.minRoots + ' (' + job.roots.join(' | ') + ')');
    const files = [];
    for (let i = 0; i < shots.length; i += 1) {
      const name = job.key + '__' + i + '.png';
      await writeFile(join(outDir, name), shots[i]);
      files.push({ file: name, sha256: createHash('sha256').update(shots[i]).digest('hex') });
    }
    return { files, violations };
  } finally {
    await context.close();
  }
}

/** The social match card (next/og, no browser): scripts/visual/social-images.tsx under tsx, in the app dir. */
async function renderSocialImages({ appDir, setDir, cacheDir }) {
  const tmp = join(setDir, '.social');
  const tsxCli = join(appDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [tsxCli, '--tsconfig', 'scripts/visual/tsconfig.json', 'scripts/visual/social-images.tsx', tmp, cacheDir], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => done({ code, output }));
  });
  if (result.code !== 0) {
    return { ok: false, entries: [{ key: 'social-image', target: 'social-image', url: null, files: [], error: result.output.trim().split('\n').slice(-3).join(' ') }] };
  }
  const { readdir, rename } = await import('node:fs/promises');
  const entries = [];
  for (const name of (await readdir(tmp)).filter((f) => f.endsWith('.png')).sort()) {
    const key = 'social-image__' + name.replace(/\.png$/, '');
    const file = key + '__0.png';
    await rename(join(tmp, name), join(setDir, file));
    const body = await readFile(join(setDir, file));
    entries.push({ key, target: 'social-image', url: null, viewport: null, theme: null, tolerance: { maxChangedPct: 0, threshold: 0 }, files: [{ file, sha256: createHash('sha256').update(body).digest('hex') }], violations: [] });
  }
  await rm(tmp, { recursive: true, force: true });
  return { ok: entries.length > 0, entries };
}

async function runPool(items, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function capture({ label, sets, only = [], appDir = REPO, port = DEFAULT_PORT, baseUrl = null, concurrency = 4, out = join(REPO, '.visual'), withSeed = true }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('visual: --concurrency must be a whole number of at least 1');
  const manifests = Object.fromEntries(await Promise.all(sets.map(async (set) => [set, await readJson(join(HERE, set === 'frozen' ? 'frozen.json' : 'routes.json'))])));
  const known = Object.values(manifests).flatMap((m) => m.targets.map((t) => t.id));
  const unknown = only.filter((pattern) => pattern !== 'social-image' && !known.some((id) => id === pattern || id.startsWith(pattern + '/')));
  if (unknown.length) throw new Error('visual: --only names no target: ' + unknown.join(', '));
  const runDir = join(out, label);
  const cacheDir = join(out, 'cache');
  const authDir = join(runDir, '.auth');
  await rm(runDir, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(authDir, { recursive: true });
  const ids = withSeed ? await seedIds(appDir) : {};
  let server = null;
  if (!baseUrl) {
    server = await bootDevServer({ appDir, port, logPath: join(runDir, 'dev-server.log') });
    baseUrl = server.baseUrl;
  }
  const browser = await chromium.launch({ args: DETERMINISTIC_CHROMIUM_ARGS });
  const summary = { label, baseUrl, appDir, startedAt: new Date().toISOString(), sets: {} };
  let failed = false;
  try {
    for (const set of sets) {
      const manifest = manifests[set];
      const setDir = join(runDir, set);
      await mkdir(setDir, { recursive: true });
      const jobs = expandTargets(manifest, { ids, now: manifest.now ?? '', only });
      const skippedTargets = manifest.targets.filter((t) => (t.needs ?? []).some((id) => !(id in ids))).map((t) => t.id);
      const skipped = skippedTargets.length;
      if (jobs.length === 0 && !(set === 'frozen' && only.includes('social-image'))) throw new Error('visual: ' + set + ': no capture selected (missing seed ids or --only)');
      if (skipped) console.warn('visual: ' + set + ': ' + skipped + ' targets skipped, their seed ids are missing (npm run visual:seed): ' + skippedTargets.join(', '));
      for (const job of jobs) job.clock = manifest.targets.find((t) => t.id === job.target)?.clock ? manifest.now : null;
      const entries = [];
      // Warm the dev compiler once per distinct route, so the first capture of a route does not race the compile.
      const warmed = new Set();
      for (const job of jobs) {
        const path = job.url.split('?')[0];
        if (warmed.has(path)) continue;
        warmed.add(path);
        try {
          await fetch(baseUrl + job.url, { signal: AbortSignal.timeout(240_000) });
        } catch {
          // the capture itself reports the failure
        }
      }
      let doneCount = 0;
      await runPool(jobs, concurrency, async (job) => {
        const started = Date.now();
        try {
          let result;
          for (let attempt = 1; ; attempt += 1) {
            try {
              result = await captureJob(browser, job, { baseUrl, outDir: setDir, cacheDir, authDir, roles: manifest.roles ?? {} });
              break;
            } catch (err) {
              if (!(err instanceof RateLimitedError) || attempt === 4) throw err;
              await new Promise((wake) => setTimeout(wake, (Math.min(err.retryAfterSeconds, 60) + 1) * 1000));
            }
          }
          const { files, violations } = result;
          entries.push({ key: job.key, target: job.target, url: job.url, viewport: job.viewportName, theme: job.theme, tolerance: job.tolerance, files, violations, ms: Date.now() - started });
          if (violations.length) failed = true;
        } catch (err) {
          failed = true;
          entries.push({ key: job.key, target: job.target, url: job.url, viewport: job.viewportName, theme: job.theme, tolerance: job.tolerance, files: [], error: err instanceof Error ? err.message.split('\n')[0] : String(err), ms: Date.now() - started });
        }
        doneCount += 1;
        if (doneCount % 25 === 0 || doneCount === jobs.length) console.log('visual: ' + set + ' ' + doneCount + '/' + jobs.length);
      });
      if (set === 'frozen' && (only.length === 0 || only.includes('social-image'))) {
        const social = await renderSocialImages({ appDir, setDir, cacheDir });
        entries.push(...social.entries);
        if (!social.ok) failed = true;
      }
      entries.sort((a, b) => a.key.localeCompare(b.key));
      await writeFile(join(setDir, 'manifest.json'), JSON.stringify({ set, jobs: entries.length, skipped, entries }, null, 2));
      const errors = entries.filter((e) => e.error);
      const blocked = entries.flatMap((e) => e.violations ?? []);
      summary.sets[set] = { jobs: entries.length, skipped, errors: errors.length, blockedRequests: blocked.length };
      for (const e of errors) console.error('visual: FAIL ' + e.key + ': ' + e.error);
      for (const v of blocked.slice(0, 20)) console.error('visual: BLOCKED ' + v.reason + ' ' + v.url);
    }
  } finally {
    await browser.close();
    server?.stop();
  }
  summary.finishedAt = new Date().toISOString();
  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('visual: ' + JSON.stringify(summary.sets));
  return { ok: !failed, runDir, summary };
}

async function main() {
  const argv = process.argv.slice(2);
  const label = option(argv, 'label');
  if (!label || !/^[a-zA-Z0-9._-]+$/.test(label)) {
    console.error('visual: --label <name> is required (letters, digits, . _ -)');
    process.exit(2);
  }
  const set = option(argv, 'set', 'frozen');
  const sets = set === 'all' ? ['frozen', 'surfaces'] : [set];
  if (!sets.every((s) => s === 'frozen' || s === 'surfaces')) {
    console.error('visual: --set must be frozen, surfaces or all');
    process.exit(2);
  }
  const result = await capture({
    label,
    sets,
    only: (option(argv, 'only', '') || '').split(',').filter(Boolean),
    appDir: resolve(option(argv, 'app-dir', REPO)),
    port: Number(option(argv, 'port', DEFAULT_PORT)),
    baseUrl: option(argv, 'base-url', null),
    concurrency: Number(option(argv, 'concurrency', 4)),
    out: resolve(option(argv, 'out', join(REPO, '.visual'))),
    withSeed: !argv.includes('--no-seed'),
  });
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
