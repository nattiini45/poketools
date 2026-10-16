/**
 * LOOK-PLAN §2 SEAT H: the post-reveal quiet probe's pure helpers and its
 * in-page recorder. capture-route.mjs runs the harness at import time, so the
 * self-contained `quiet-probe:pure` block is lifted out of the script and
 * imported on its own (the block must reference nothing outside itself).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '..', 'capture-route.mjs');
const OPEN = '// >>> quiet-probe:pure';
const CLOSE = '// <<< quiet-probe:pure';

let q;

beforeAll(async () => {
  const source = await readFile(SCRIPT, 'utf8');
  const start = source.indexOf(OPEN);
  const end = source.indexOf(CLOSE);
  expect(start).toBeGreaterThan(-1);
  expect(source.indexOf(OPEN, start + 1)).toBe(-1);
  expect(end).toBeGreaterThan(start);
  const dir = await mkdtemp(join(tmpdir(), 'quiet-probe-'));
  const file = join(dir, 'quiet-pure.mjs');
  await writeFile(file, source.slice(start, end + CLOSE.length), 'utf8');
  q = await import(pathToFileURL(file).href);
});

const OBS = { resource: true, longtask: true, gl: true };
const snap = (t, { programs = 80, textures = 40, links = 0, glDebugPrograms = programs } = {}) => ({ t, links, info: { programs, textures }, glDebugPrograms });
const emptyRaw = () => ({ resources: [], requests: [], longTasks: [], links: [], textures: [], reuploads: [], rbAllocs: [], induced: [] });

function judge({ start = snap(1000), end = snap(5000), raw = emptyRaw(), observers = OBS, mode = 'strict' } = {}) {
  const counts = q.quietLegCounts({ start, end, raw, observers, mode });
  return { counts, verdict: q.quietLegVerdict(counts, { mode }) };
}

describe('quiet probe: world-asset classification', () => {
  it('matches the local mirror, the world-assets bucket and /textures/world only', () => {
    expect(q.isWorldAssetUrl('http://localhost:3111/models/world/models/regular/2.glb')).toBe(true);
    expect(q.isWorldAssetUrl('/models/world/env/tex/cobble/diff.webp?quietInject=1')).toBe(true);
    expect(q.isWorldAssetUrl('https://x.supabase.co/storage/v1/object/public/world-assets/props/lamp.glb')).toBe(true);
    expect(q.isWorldAssetUrl('/textures/world/tree-card-a.png')).toBe(true);
    expect(q.isWorldAssetUrl('https://x.supabase.co/storage/v1/object/public/avatars/a.png')).toBe(false);
    expect(q.isWorldAssetUrl('/_next/static/chunks/src_1yih1w6._.js')).toBe(false);
    expect(q.isWorldAssetUrl('https://img.pokemondb.net/sprites/home/normal/x.png')).toBe(false);
    expect(q.isWorldAssetUrl(null)).toBe(false);
  });
});

describe('quiet probe: strict leg verdict (legs idle / a / b)', () => {
  it('passes a leg with nothing after reveal (a live canvas re-upload is reported, never judged)', () => {
    const raw = emptyRaw();
    raw.textures = [{ createdAt: 200, firstDataAt: 210, deletedAt: null }];
    raw.reuploads = [1500, 2500, 3500];
    raw.resources = [{ name: 'https://img.pokemondb.net/sprites/home/normal/x.png', t: 2000 }];
    const { counts, verdict } = judge({ raw });
    expect(verdict.verdict).toBe('pass');
    expect(counts).toMatchObject({ worldFetches: 0, programs: 0, textures: 0, longTasks: 0 });
    expect(counts.detail.reuploads).toBe(3);
    expect(counts.detail.otherFetchUrls).toEqual(['https://img.pokemondb.net/sprites/home/normal/x.png']);
  });

  it('fails a windowed GLB fetch after reveal (either channel)', () => {
    const raw = emptyRaw();
    raw.requests = [{ url: 'http://localhost:3111/models/world/models/regular/254.glb', t: 2400 }];
    const { counts, verdict } = judge({ raw });
    expect(counts.worldFetches).toBe(1);
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reasons[0]).toMatch(/world-asset fetch/);
  });

  it('ignores fetches outside the leg window', () => {
    const raw = emptyRaw();
    raw.resources = [{ name: '/models/world/props/led-board-cabinet.glb', t: 900 }];
    expect(judge({ raw }).verdict.verdict).toBe('pass');
  });

  it('fails a program link even when renderer.info.programs nets out (the rung-2 re-key class)', () => {
    const raw = emptyRaw();
    raw.links = [3000, 3001];
    const { counts, verdict } = judge({ raw });
    expect(counts.programs).toBe(2);
    expect(verdict.verdict).toBe('fail');
  });

  it('fails a renderer.info.programs rise when the GL channel is unavailable', () => {
    const { counts, verdict } = judge({ end: snap(5000, { programs: 83 }), observers: { ...OBS, gl: false } });
    expect(counts.programs).toBe(3);
    expect(counts.detail.links).toBeNull();
    expect(verdict.verdict).toBe('fail');
  });

  it('fails a first texture upload (asset) and a memory.textures rise', () => {
    const raw = emptyRaw();
    raw.textures = [{ createdAt: 2000, firstDataAt: 2001, deletedAt: null }];
    const { counts, verdict } = judge({ raw, end: snap(5000, { textures: 41 }) });
    expect(counts.detail.assetUploads).toBe(1);
    expect(counts.textures).toBe(1);
    expect(verdict.verdict).toBe('fail');
  });

  it('fails a long task >= 50 ms but not a 49 ms one', () => {
    const raw = emptyRaw();
    raw.longTasks = [{ t: 2000, d: 49 }];
    expect(judge({ raw }).verdict.verdict).toBe('pass');
    raw.longTasks.push({ t: 2100, d: 80 });
    const { counts, verdict } = judge({ raw });
    expect(counts.longTasks).toBe(1);
    expect(verdict.verdict).toBe('fail');
  });

  it('is unmeasured (never a pass) when a channel is missing', () => {
    const start = { t: 1000, links: 0, info: null, glDebugPrograms: null };
    const end = { t: 5000, links: 0, info: null, glDebugPrograms: null };
    const raw = emptyRaw();
    raw.requests = null;
    const { verdict } = judge({ start, end, raw, observers: { resource: false, longtask: false, gl: false } });
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.unmeasured).toEqual(['worldFetches', 'programs', 'textures', 'longTasks']);
    expect(q.quietProbeVerdict([{ name: 'sweep', verdict }]).pass).toBe(false);
  });
});

describe('quiet probe: governor leg (c)', () => {
  it('passes when the texture change is exactly the RT reallocations', () => {
    const raw = emptyRaw();
    // Shadow map disposed at the step to rung 4, post RTs resized (delete + create).
    raw.textures = [
      { createdAt: 100, firstDataAt: null, deletedAt: 2000 },
      { createdAt: 100, firstDataAt: null, deletedAt: 2100 },
      { createdAt: 2101, firstDataAt: null, deletedAt: null },
    ];
    raw.rbAllocs = [2101];
    const { counts, verdict } = judge({ raw, end: snap(5000, { textures: 39 }), mode: 'governor' });
    expect(counts.detail).toMatchObject({ rtCreated: 1, rtDeleted: 2, rtNet: -1, memTexturesDelta: -1, rbAllocs: 1 });
    expect(verdict.verdict).toBe('pass');
  });

  it('fails an unexplained texture change, a program link or an asset upload', () => {
    expect(judge({ end: snap(5000, { textures: 42 }), mode: 'governor' }).verdict.verdict).toBe('fail');
    const linked = emptyRaw();
    linked.links = [2500];
    expect(judge({ raw: linked, mode: 'governor' }).verdict.verdict).toBe('fail');
    const uploaded = emptyRaw();
    uploaded.textures = [{ createdAt: 2500, firstDataAt: 2501, deletedAt: null }];
    expect(judge({ raw: uploaded, end: snap(5000, { textures: 41 }), mode: 'governor' }).verdict.verdict).toBe('fail');
  });

  it('keeps long tasks inside a harness stress window out of the judged count', () => {
    const raw = emptyRaw();
    raw.longTasks = [{ t: 2000, d: 70 }];
    raw.induced = [[1900, 2600]];
    const { counts, verdict } = judge({ raw, mode: 'governor' });
    expect(counts.longTasks).toBe(0);
    expect(counts.detail.inducedLongTasks).toBe(1);
    expect(verdict.verdict).toBe('pass');
  });
});

describe('quiet probe: --quiet-inject self-test detection', () => {
  const failLeg = (detail, programs = 0) => ({ name: 'sweep', counts: { programs, detail }, verdict: { verdict: 'fail' } });

  it('detects an injected fetch only when the injected URL failed the leg', () => {
    const inject = { fired: true, marker: 'quietInject=123' };
    expect(q.quietInjectDetected('fetch', failLeg({ worldFetchUrls: ['http://h/models/world/manifest.json?quietInject=123'] }), inject)).toEqual({ detected: true });
    // A dirty tree fails the leg on its own GLBs: that is not a detection.
    expect(q.quietInjectDetected('fetch', failLeg({ worldFetchUrls: ['http://h/models/world/models/regular/2.glb'] }), inject).detected).toBe(false);
    expect(q.quietInjectDetected('fetch', { ...failLeg({ worldFetchUrls: [] }), verdict: { verdict: 'pass' } }, inject).detected).toBe(false);
  });

  it('detects an injected program only when a link showed while it rendered', () => {
    expect(q.quietInjectDetected('program', failLeg({}, 1), { fired: true, linksBefore: 5, linksAfter: 6 })).toEqual({ detected: true });
    expect(q.quietInjectDetected('program', failLeg({}, 1), { fired: true, linksBefore: 5, linksAfter: 5 }).detected).toBe(false);
    expect(q.quietInjectDetected('program', failLeg({}, 1), { fired: false, reason: '__routeWorldScene absent' }).detected).toBe(false);
  });

  it('an injected fetch and an injected program both fail the strict verdict', () => {
    const fetchRaw = emptyRaw();
    fetchRaw.resources = [{ name: 'http://localhost:3111/models/world/manifest.json?quietInject=9', t: 1200 }];
    expect(judge({ raw: fetchRaw }).verdict.verdict).toBe('fail');
    const programRaw = emptyRaw();
    programRaw.links = [1200];
    expect(judge({ raw: programRaw }).verdict.verdict).toBe('fail');
  });
});

describe('quiet probe: run verdict, theme leg, prod server, rung readout', () => {
  it('the run passes only when every judged leg passes', () => {
    const pass = { verdict: 'pass', reasons: [] };
    expect(q.quietProbeVerdict([{ name: 'idle', verdict: pass }, { name: 'sweep', verdict: pass }]).pass).toBe(true);
    const out = q.quietProbeVerdict([{ name: 'idle', verdict: pass }, { name: 'jump', verdict: { verdict: 'fail', reasons: ['x'] } }, { name: 'theme', judged: false, verdict: { verdict: 'fail' } }]);
    expect(out.pass).toBe(false);
    expect(out.failing).toEqual(['jump: fail (x)']);
    expect(q.quietProbeVerdict([]).pass).toBe(false);
  });

  it('theme: exactly one new generation with a complete ceremony', () => {
    const ok = { themeBefore: 'light', themeAfter: 'dark', generationBefore: 1, generationAfter: 2, generationHeld: 2, ballPhasesAfter: ['loading', 'opening', 'releasing', 'done'], presented: true };
    expect(q.quietThemeVerdict(ok).verdict).toBe('pass');
    expect(q.quietThemeVerdict({ ...ok, generationAfter: 3, generationHeld: 3 }).verdict).toBe('fail');
    expect(q.quietThemeVerdict({ ...ok, generationHeld: 3 }).verdict).toBe('fail');
    expect(q.quietThemeVerdict({ ...ok, ballPhasesAfter: [] }).reasons[0]).toMatch(/no ball ceremony/);
    expect(q.quietThemeVerdict({ ...ok, ballPhasesAfter: ['loading', 'opening'] }).verdict).toBe('fail');
    expect(q.quietThemeVerdict({ ...ok, themeAfter: 'light' }).verdict).toBe('fail');
    expect(q.quietThemeVerdict({ ...ok, generationBefore: null, generationAfter: null, generationHeld: null }).verdict).toBe('unmeasured');
  });

  it('classifies the listener chain: dev wins, start, else unknown', () => {
    const devBin = '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\app\\node_modules\\next\\dist\\bin\\next dev --port 3111';
    const worker = '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\app\\node_modules\\next\\dist\\server\\lib\\start-server.js';
    expect(q.prodServerKind([worker, devBin])).toBe('dev');
    expect(q.prodServerKind(['node node_modules/.bin/next start -p 3200'])).toBe('start');
    expect(q.prodServerKind(['npx next start -p 3200'])).toBe('start');
    expect(q.prodServerKind(['C:\\WINDOWS\\system32\\cmd.exe /d /s /c "npm run dev"'])).toBe('dev');
    expect(q.prodServerKind(['npm start'])).toBe('start');
    expect(q.prodServerKind([worker, null])).toBe('unknown');
    expect(q.prodServerKind([])).toBe('unknown');
    // A path segment named "dev" is not the dev verb.
    expect(q.prodServerKind(['node D:\\dev\\app\\node_modules\\next\\dist\\bin\\next start'])).toBe('start');
  });

  it('reads the rung from the debug readout', () => {
    expect(q.parseDebugRung('tier      route\nrung      2 · fps 58.0 · 17.1 ms\ndraws 10')).toBe(2);
    expect(q.parseDebugRung('tier route')).toBeNull();
    expect(q.parseDebugRung(null)).toBeNull();
  });
});

describe('quiet probe: in-page recorder (installQuietProbe)', () => {
  const saved = {};
  const keys = ['window', 'document', 'PerformanceObserver', 'MutationObserver'];
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  });

  it('counts links, first uploads vs re-uploads, RT allocations, resources, long tasks and the live snapshot', () => {
    for (const k of keys) saved[k] = globalThis[k];
    const poCallbacks = {};
    globalThis.PerformanceObserver = class {
      static supportedEntryTypes = ['resource', 'longtask'];
      constructor(cb) {
        this.cb = cb;
      }
      observe({ type }) {
        poCallbacks[type] = this.cb;
      }
    };
    const mutationCallbacks = [];
    globalThis.MutationObserver = class {
      constructor(cb) {
        mutationCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    };
    const classes = new Set();
    globalThis.document = { documentElement: { classList: { contains: (c) => classes.has(c) } } };
    let texId = 0;
    class FakeGL {
      linkProgram() {}
      createTexture() {
        texId += 1;
        return { id: texId };
      }
      deleteTexture() {}
      activeTexture() {}
      bindTexture() {}
      texImage2D() {}
      texImage3D() {}
      texSubImage2D() {}
      texSubImage3D() {}
      compressedTexImage2D() {}
      compressedTexImage3D() {}
      compressedTexSubImage2D() {}
      compressedTexSubImage3D() {}
      renderbufferStorage() {}
      renderbufferStorageMultisample() {}
    }
    const fakeWindow = { WebGL2RenderingContext: FakeGL, __routeWorldGlDebug: () => ({ programs: 7 }), __c089Windows: { plaza: { resident: false, entered: false } } };
    globalThis.window = fakeWindow;

    q.installQuietProbe({ maxLog: 1000 });
    const probe = fakeWindow.__quietProbe;
    expect(probe).toBeTruthy();
    expect(probe.status().observers).toEqual({ resource: true, longtask: true, gl: true });

    // three's devtools hook hands over the renderer.
    const renderer = { isWebGLRenderer: true, info: { programs: [1, 2, 3], memory: { textures: 4, geometries: 9 } } };
    fakeWindow.__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', { detail: renderer }));
    fakeWindow.__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', { detail: { isScene: true } }));
    expect(probe.status().rendererSeen).toBe(true);

    const t0 = performance.now();
    const gl = new FakeGL();
    const TEX2D = 0x0de1;
    const asset = gl.createTexture();
    gl.activeTexture(0x84c0);
    gl.bindTexture(TEX2D, asset);
    gl.texSubImage2D(TEX2D, 0, 0, 0, 4, 4, 0x1908, 0x1401, new Uint8Array(64));
    gl.texSubImage2D(TEX2D, 0, 0, 0, 4, 4, 0x1908, 0x1401, new Uint8Array(64)); // re-upload
    const rt = gl.createTexture();
    gl.activeTexture(0x84c1);
    gl.bindTexture(TEX2D, rt);
    gl.texImage2D(TEX2D, 0, 0x8058, 4, 4, 0, 0x1908, 0x1401, null); // storage-only
    const cube = gl.createTexture();
    gl.bindTexture(0x8513, cube);
    gl.texImage2D(0x8515, 0, 0x1908, 0x1908, 0x1401, { width: 1 }); // face upload, 6-arg form
    gl.renderbufferStorage(0x8d41, 0x81a5, 4, 4);
    gl.linkProgram({});
    gl.deleteTexture(rt);
    poCallbacks.resource({ getEntries: () => [{ name: '/models/world/props/lamp.glb', startTime: performance.now(), initiatorType: 'fetch' }] });
    poCallbacks.longtask({ getEntries: () => [{ startTime: performance.now(), duration: 64 }] });

    classes.add('world-route-live');
    for (const cb of mutationCallbacks) cb([]);
    const status = probe.status();
    expect(status.liveAt).not.toBeNull();
    expect(status.liveSnapshot.info).toEqual({ programs: 3, textures: 4, geometries: 9 });
    expect(status.liveSnapshot.glDebugPrograms).toBe(7);
    expect(status.liveSnapshot.windows).toEqual({ plaza: { resident: false, entered: false } });

    const t1 = performance.now() + 1;
    const win = probe.window(t0, t1);
    expect(win.links).toHaveLength(1);
    expect(win.reuploads).toHaveLength(1);
    expect(win.rbAllocs).toHaveLength(1);
    expect(win.resources.map((r) => r.name)).toEqual(['/models/world/props/lamp.glb']);
    expect(win.longTasks).toHaveLength(1);
    const withData = win.textures.filter((r) => r.firstDataAt !== null);
    const storageOnly = win.textures.filter((r) => r.firstDataAt === null);
    expect(withData).toHaveLength(2); // the asset and the cube face
    expect(storageOnly).toHaveLength(1);
    expect(storageOnly[0].deletedAt).not.toBeNull();

    const counts = q.quietLegCounts({ start: { t: t0, info: { programs: 3, textures: 4 } }, end: { t: t1, info: { programs: 3, textures: 4 } }, raw: { ...win, requests: [] }, observers: status.observers });
    expect(counts).toMatchObject({ worldFetches: 1, programs: 1, textures: 2, longTasks: 1 });
    expect(counts.detail).toMatchObject({ rtCreated: 1, rtDeleted: 1, reuploads: 1 });

    // Installing twice is a no-op, and a wrapped GL call still returns the page's value.
    q.installQuietProbe({});
    expect(fakeWindow.__quietProbe).toBe(probe);
    expect(gl.createTexture()).toEqual({ id: texId });
  });

  it('LOOK r4: evicts the OLDEST re-uploads / resources when full (post-reveal legs stay complete) and counts newest-dropped links per kind', () => {
    for (const k of keys) saved[k] = globalThis[k];
    const poCallbacks = {};
    globalThis.PerformanceObserver = class {
      static supportedEntryTypes = ['resource', 'longtask'];
      constructor(cb) {
        this.cb = cb;
      }
      observe({ type }) {
        poCallbacks[type] = this.cb;
      }
    };
    globalThis.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    globalThis.document = { documentElement: { classList: { contains: () => false } } };
    class FakeGL {
      linkProgram() {}
      createTexture() {
        return {};
      }
      deleteTexture() {}
      activeTexture() {}
      bindTexture() {}
      texImage2D() {}
      texSubImage2D() {}
    }
    const fakeWindow = { WebGL2RenderingContext: FakeGL };
    globalThis.window = fakeWindow;
    q.installQuietProbe({ maxLog: 10, hardCap: 20 });
    const probe = fakeWindow.__quietProbe;
    const gl = new FakeGL();
    const tex = gl.createTexture();
    gl.activeTexture(0x84c0);
    gl.bindTexture(0x0de1, tex);
    for (let i = 0; i < 30; i += 1) gl.texSubImage2D(0x0de1, 0, 0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4));
    for (let i = 0; i < 25; i += 1) gl.linkProgram({});
    const lastUploadAt = performance.now();
    const st = probe.status();
    expect(st.evicted.reuploads.count).toBeGreaterThan(0);
    expect(typeof st.evicted.reuploads.before).toBe('number');
    expect(st.droppedByKind).toEqual({ links: 5 });
    expect(st.dropped).toBe(5);
    // The newest re-upload is still in the log (a window at the end sees it).
    expect(probe.window(lastUploadAt - 1e6, lastUploadAt + 1).reuploads.length).toBeGreaterThan(0);
    expect(probe.window(0, lastUploadAt + 1).links).toHaveLength(20);
  });
});

describe('quiet probe: post-reveal JS chunks (R40 / R38, D23)', () => {
  it('classifies Next chunks, script-typed entries and .js paths, never world assets or images', () => {
    expect(q.isScriptChunk('http://localhost:3111/_next/static/chunks/src_components_world_route_surfaces_1a2b._.js')).toBe(true);
    expect(q.isScriptChunk('/_next/static/chunks/app/page.js?v=1')).toBe(true);
    expect(q.isScriptChunk('http://localhost:3111/some/loader', 'script')).toBe(true);
    expect(q.isScriptChunk('/static/x.mjs')).toBe(true);
    expect(q.isScriptChunk('/models/world/models/regular/2.glb')).toBe(false);
    expect(q.isScriptChunk('https://img.pokemondb.net/sprites/home/normal/x.png')).toBe(false);
    expect(q.isScriptChunk('/api/data', 'fetch')).toBe(false);
    expect(q.isScriptChunk(null)).toBe(false);
  });

  it('counts a chunk fetched inside the leg on either channel and fails the strict leg like a fetch', () => {
    const raw = emptyRaw();
    raw.resources = [
      { name: 'http://localhost:3111/_next/static/chunks/surfaces_abc._.js', t: 2000, initiator: 'script' },
      { name: 'http://localhost:3111/_next/static/chunks/early._.js', t: 500, initiator: 'script' },
    ];
    raw.requests = [{ url: 'http://localhost:3111/_next/static/chunks/surfaces_abc._.js', t: 2001, type: 'script' }];
    const { counts, verdict } = judge({ raw });
    expect(counts.jsChunks).toBe(1);
    expect(counts.detail.jsChunkUrls).toEqual(['http://localhost:3111/_next/static/chunks/surfaces_abc._.js']);
    expect(counts.worldFetches).toBe(0);
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reasons[0]).toMatch(/1 JS chunk \/ script fetch\(es\) after reveal \(D23, R38: \/_next\/static\/chunks\/surfaces_abc\._\.js\)/);
  });

  it('fails a governor leg too, and a script-typed request without a chunk path', () => {
    const raw = emptyRaw();
    raw.requests = [{ url: 'http://localhost:3111/late-loader', t: 3000, type: 'script' }];
    const { counts, verdict } = judge({ raw, mode: 'governor' });
    expect(counts.jsChunks).toBe(1);
    expect(verdict.verdict).toBe('fail');
  });

  it('passes a leg whose chunks all landed before it, and is null when no fetch channel was measured', () => {
    const raw = emptyRaw();
    raw.resources = [{ name: '/_next/static/chunks/a._.js', t: 100, initiator: 'script' }];
    expect(judge({ raw }).counts.jsChunks).toBe(0);
    expect(judge({ raw }).verdict.verdict).toBe('pass');
    const none = { ...emptyRaw(), requests: null };
    expect(judge({ raw: none, observers: { resource: false, longtask: true, gl: true } }).counts.jsChunks).toBeNull();
  });
});
