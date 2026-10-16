import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import { N3_TAG_BITS, N3_TAG_DW_OFF, N3_TAG_DW_ON } from '../n3-tags';
import { onN3RetagRequested, requestN3Retag } from '../n3-retag';
import { passMaterials, releaseHeldMask } from '../../useStationWarmup';
import {
  ExactN8AOPostPass,
  parseAoTransparencyMode,
  routeDebugParam,
  type AoTransparencyMode,
  type ExactAoTriggers,
} from '../n8ao-exact';

/**
 * D42 N3 (option B, exact): the route's N8AO pass draws exactly what the
 * stock n8ao 2.0.1 transparency renders draw, with no per-frame Map,
 * traversal or allocation, the empty DW-on render and its depth copy
 * skipped, and `autoDetectTransparency = false` written before
 * `transparencyAware` (X10).
 */

// ── A fake renderer that projects the scene the way three r185 does ─────────

type Draw = { kind: 'scene'; target: unknown; meshes: string[]; lights: string[] } | { kind: 'copy' | 'clear'; target: unknown };

class FakeRenderer {
  autoClearDepth = true;
  readonly clearColor = new THREE.Color(0x335577);
  clearAlpha = 1;
  target: unknown = null;
  readonly log: Draw[] = [];
  readonly getClearColorArgs: THREE.Color[] = [];
  readonly setClearColorArgs: THREE.Color[] = [];

  constructor(private readonly world: THREE.Scene) {}

  getClearColor(target: THREE.Color): THREE.Color {
    this.getClearColorArgs.push(target);
    return target.copy(this.clearColor);
  }
  getClearAlpha(): number {
    return this.clearAlpha;
  }
  setClearColor(color: THREE.Color, alpha: number): void {
    this.setClearColorArgs.push(color);
    this.clearColor.copy(color);
    this.clearAlpha = alpha;
  }
  setRenderTarget(target: unknown): void {
    this.target = target;
  }
  clear(): void {
    this.log.push({ kind: 'clear', target: this.target });
  }
  /** three's `projectObject`: `visible` gates the subtree, layers gate the node only. */
  render(scene: THREE.Object3D, camera: THREE.Camera): void {
    if (scene !== this.world) {
      this.log.push({ kind: 'copy', target: this.target });
      return;
    }
    const meshes: string[] = [];
    const lights: string[] = [];
    const project = (object: THREE.Object3D): void => {
      if (object.visible === false) return;
      if (object.layers.test(camera.layers)) {
        if ((object as THREE.Light).isLight) lights.push(object.name);
        else if ((object as THREE.Mesh).isMesh || (object as THREE.Sprite).isSprite) meshes.push(object.name);
      }
      for (const child of object.children) project(child);
    };
    project(scene);
    this.log.push({ kind: 'scene', target: this.target, meshes: meshes.sort(), lights: lights.sort() });
  }
  take(): Draw[] {
    return this.log.splice(0, this.log.length);
  }
}

function mesh(name: string, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BufferGeometry(), material);
  object.name = name;
  return object;
}

const opaque = () => new THREE.MeshStandardMaterial();
const blend = () => new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
const blendDw = () => new THREE.MeshStandardMaterial({ transparent: true, depthWrite: true });

function light(name: string): THREE.PointLight {
  const object = new THREE.PointLight();
  object.name = name;
  return object;
}

/** Every case the stock predicates and three's projection distinguish. */
function buildScene(withDepthWriteTransparent: boolean): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; named: Record<string, THREE.Object3D> } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const named: Record<string, THREE.Object3D> = {};
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, object: T): T => {
    parent.add(object);
    named[object.name] = object;
    return object;
  };
  const lamp = add(scene, mesh('opaque-lamp', opaque()));
  add(lamp, mesh('blend-under-opaque', blend())); // stock hides the whole subtree
  add(lamp, light('light-under-opaque'));
  const glass = add(scene, mesh('blend-glass', blend()));
  add(glass, light('light-under-blend'));
  add(glass, mesh('blend-child-of-blend', blend()));
  if (withDepthWriteTransparent) {
    add(scene, mesh('blend-dw', blendDw()));
    // Stock quirk: an array material has no `transparent`, so the DW-on
    // render writes `visible = undefined`, which three draws.
    add(scene, mesh('array-material', [blend(), blend()]));
  }
  const solid = add(scene, mesh('blend-treated-opaque', blend()));
  solid.userData.treatAsOpaque = true;
  const noAo = add(scene, mesh('opaque-cannot-receive-ao', opaque()));
  noAo.userData.cannotReceiveAO = true;
  const group = new THREE.Group();
  group.name = 'group';
  add(scene, group);
  add(group, mesh('blend-in-group', blend()));
  const hidden = add(scene, mesh('blend-invisible', blend()));
  hidden.visible = false;
  const otherLayer = add(scene, mesh('blend-other-layer', blend()));
  otherLayer.layers.set(5);
  add(scene, light('key-light'));
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  sprite.name = 'sprite';
  add(scene, sprite);
  return { scene, camera, named };
}

function triggers(): ExactAoTriggers & { reveal: () => void; figures: () => void; setGeneration: (g: number) => void } {
  let reveal: (() => void) | null = null;
  let figures: (() => void) | null = null;
  let generation = 1;
  let readyFor: number | null = null;
  return {
    // Like residency-store's: fires once per generation, at once if already ready.
    onRevealReady: (cb) => {
      reveal = cb;
      if (readyFor === generation) cb();
      return () => (reveal = null);
    },
    onFigureSetChanged: (cb) => {
      figures = cb;
      return () => (figures = null);
    },
    generation: () => generation,
    reveal: () => {
      readyFor = generation;
      reveal?.();
    },
    figures: () => figures?.(),
    setGeneration: (g) => (generation = g),
  };
}

function exactPass(scene: THREE.Scene, camera: THREE.Camera, mode: AoTransparencyMode = 'exact') {
  const t = triggers();
  const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode, triggers: t, debug: false });
  return { pass, t };
}

/** The stock pass's draws, labelled by which of its targets they went to. */
function stockFrame(scene: THREE.Scene, camera: THREE.Camera) {
  const stock = new N8AOPostPass(scene, camera, 64, 64);
  stock.autoDetectTransparency = false;
  stock.configuration.transparencyAware = true;
  const renderer = new FakeRenderer(scene);
  stock.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
  const log = renderer.take();
  return { stock, log };
}

function scenes(log: Draw[], target: unknown) {
  return log.filter((d): d is Extract<Draw, { kind: 'scene' }> => d.kind === 'scene' && d.target === target);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('n8ao 2.0.1 (pinned): the stock surface the exact pass replaces', () => {
  const dist = readFileSync(path.join(process.cwd(), 'node_modules/n8ao/dist/N8AO.js'), 'utf8');

  it('is version 2.0.1', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/n8ao/package.json'), 'utf8'));
    expect(pkg.version).toBe('2.0.1');
  });

  it('renders transparency with the predicates the tags replicate (and its per-frame Map)', () => {
    expect(dist).toContain('const oldVisibility = new Map();');
    expect(dist).toContain(
      'obj.visible = oldVisibility.get(obj) && (obj.material.transparent && !obj.material.depthWrite && !obj.userData.treatAsOpaque || !!obj.userData.cannotReceiveAO);',
    );
    expect(dist).toContain(
      'obj.visible = oldVisibility.get(obj) && obj.material.transparent && obj.material.depthWrite && !obj.userData.treatAsOpaque;',
    );
  });

  it('detects transparency every frame and clears auto-detect only on a CHANGE of transparencyAware', () => {
    expect(dist).toContain('this.detectTransparency();\n        if (inputBuffer.texture.type');
    expect(dist).toContain('if (propName === "transparencyAware" && oldProp !== value) {\n                    this.autoDetectTransparency = false;');
  });

  it('X10: writing transparencyAware alone (no change) leaves auto-detect on, and the next frame flips it', () => {
    const { scene, camera } = buildScene(false);
    const stock = new N8AOPostPass(new THREE.Scene(), camera, 64, 64);
    stock.scene = scene; // constructed on an empty scene: nothing detected yet
    expect(stock.configuration.transparencyAware).toBe(false);
    stock.configuration.transparencyAware = false; // the value alone
    expect(stock.autoDetectTransparency).toBe(true);
    stock.detectTransparency();
    expect(stock.configuration.transparencyAware).toBe(true); // flipped back (late allocation)

    const ordered = new N8AOPostPass(new THREE.Scene(), camera, 64, 64);
    ordered.scene = scene;
    ordered.autoDetectTransparency = false; // FIRST
    ordered.configuration.transparencyAware = false;
    ordered.detectTransparency();
    expect(ordered.configuration.transparencyAware).toBe(false);
  });
});

describe('ExactN8AOPostPass: the setter order (X10)', () => {
  it('writes autoDetectTransparency = false before transparencyAware', () => {
    const { scene, camera } = buildScene(false);
    const { pass } = exactPass(scene, camera);
    const writes: string[] = [];
    let auto = pass.autoDetectTransparency;
    Object.defineProperty(pass, 'autoDetectTransparency', {
      get: () => auto,
      set: (value: boolean) => {
        writes.push(`autoDetectTransparency=${value}`);
        auto = value;
      },
      configurable: true,
    });
    const config = pass.configuration;
    pass.configuration = new Proxy(config, {
      set(target, key, value) {
        writes.push(`${String(key)}=${value}`);
        return Reflect.set(target, key, value);
      },
    });
    pass.setTransparencyAware(true);
    expect(writes).toEqual(['autoDetectTransparency=false', 'transparencyAware=true']);
  });

  it('allocates the transparency targets at construction and never auto-detects', () => {
    const { scene, camera } = buildScene(false);
    const traverse = vi.spyOn(THREE.Object3D.prototype, 'traverse');
    const { pass } = exactPass(scene, camera);
    expect(traverse).not.toHaveBeenCalled();
    expect(pass.autoDetectTransparency).toBe(false);
    expect(pass.configuration.transparencyAware).toBe(true);
    expect(pass.transparencyRenderTargetDWFalse).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(pass.transparencyRenderTargetDWTrue).toBeInstanceOf(THREE.WebGLRenderTarget);
    pass.detectTransparency();
    expect(traverse).not.toHaveBeenCalled();
  });

  it('the dev switch: off turns awareness off, stock keeps the library pass', () => {
    const { scene, camera } = buildScene(false);
    expect(exactPass(scene, camera, 'off').pass.configuration.transparencyAware).toBe(false);
    const stock = exactPass(scene, camera, 'stock').pass;
    const library = new N8AOPostPass(scene, camera, 64, 64);
    // Detected at construction, as the library pass does (the proxy then clears auto-detect).
    expect(stock.configuration.transparencyAware).toBe(true);
    expect(stock.configuration.transparencyAware).toBe(library.configuration.transparencyAware);
    expect(stock.autoDetectTransparency).toBe(library.autoDetectTransparency);
  });

  it('?routeAoTransparency is read under routeDebug only and never in production', () => {
    expect(parseAoTransparencyMode('?routeDebug=1&routeAoTransparency=stock', false)).toBe('stock');
    expect(parseAoTransparencyMode('?routeDebug=1&routeAoTransparency=off', false)).toBe('off');
    expect(parseAoTransparencyMode('?routeDebug=1&routeAoTransparency=bogus', false)).toBe('exact');
    expect(parseAoTransparencyMode('?routeAoTransparency=stock', false)).toBe('exact');
    expect(parseAoTransparencyMode('?routeDebug=1&routeAoTransparency=stock', true)).toBe('exact');
  });
});

describe('ExactN8AOPostPass: the same draw list as the stock pass', () => {
  it('the tag bits are two distinct single layer bits (n3-tags)', () => {
    expect(N3_TAG_DW_OFF & N3_TAG_DW_ON).toBe(0);
    expect(N3_TAG_BITS).toBe(N3_TAG_DW_OFF | N3_TAG_DW_ON);
    for (const bit of [N3_TAG_DW_OFF, N3_TAG_DW_ON]) {
      expect(bit).toBeGreaterThan(1); // never layer 0, the camera's own
      expect(bit & (bit - 1)).toBe(0);
    }
  });

  for (const withDw of [true, false]) {
    it(`draws the same meshes and lights per target${withDw ? ' (a depth-writing transparent and a multi-material mesh)' : ' (DW-on empty: skipped)'}`, () => {
      const { scene, camera } = buildScene(withDw);
      const { stock, log: stockLog } = stockFrame(scene, camera);
      const { pass, t } = exactPass(scene, camera);
      t.reveal();
      const renderer = new FakeRenderer(scene);
      pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
      const log = renderer.take();

      const stockOff = scenes(stockLog, stock.transparencyRenderTargetDWFalse);
      const exactOff = scenes(log, pass.transparencyRenderTargetDWFalse);
      expect(exactOff).toHaveLength(1);
      expect(exactOff[0].meshes).toEqual(stockOff[0].meshes);
      expect(exactOff[0].lights).toEqual(stockOff[0].lights);
      expect(stockOff[0].meshes).toEqual(
        ['blend-child-of-blend', 'blend-glass', 'blend-in-group', 'opaque-cannot-receive-ao', 'sprite'].sort(),
      );
      expect(stockOff[0].lights).toEqual(['key-light', 'light-under-blend']);

      const stockOn = scenes(stockLog, stock.transparencyRenderTargetDWTrue);
      const exactOn = scenes(log, pass.transparencyRenderTargetDWTrue);
      expect(stockOn).toHaveLength(1);
      if (withDw) {
        expect(stockOn[0].meshes).toEqual(['array-material', 'blend-dw']);
        expect(exactOn).toHaveLength(1);
        expect(exactOn[0].meshes).toEqual(stockOn[0].meshes);
        expect(exactOn[0].lights).toEqual(stockOn[0].lights);
        expect(log.filter((d) => d.kind === 'copy')).toHaveLength(2);
      } else {
        // Stock draws an empty DW-on render behind a depth copy; the exact pass
        // skips both and clears the target once instead.
        expect(stockOn[0].meshes).toEqual([]);
        expect(exactOn).toHaveLength(0);
        expect(log.filter((d) => d.kind === 'copy')).toHaveLength(1);
        expect(log.filter((d) => d.kind === 'clear' && d.target === pass.transparencyRenderTargetDWTrue)).toHaveLength(1);
        renderer.take();
        pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
        const next = renderer.take();
        expect(next.filter((d) => d.kind === 'clear' && d.target === pass.transparencyRenderTargetDWTrue)).toHaveLength(0);
        expect(pass.exactStats?.skippedDwOn).toBe(2);
      }
    });
  }

  it('a transparency-free scene: both empty renders and their copies skipped, each target cleared once (P6)', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(mesh('opaque-a', opaque()), mesh('opaque-b', opaque()), light('key-light'));
    const group = new THREE.Group();
    group.add(mesh('opaque-in-group', opaque()));
    scene.add(group);
    // Stock draws nothing into either target (alpha stays 0; only .a of DW-off is read).
    const { stock, log: stockLog } = stockFrame(scene, camera);
    expect(scenes(stockLog, stock.transparencyRenderTargetDWFalse)[0].meshes).toEqual([]);
    expect(scenes(stockLog, stock.transparencyRenderTargetDWTrue)[0].meshes).toEqual([]);

    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    const frame = () => {
      pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
      return renderer.take();
    };
    const clears = (log: Draw[], target: unknown) => log.filter((d) => d.kind === 'clear' && d.target === target).length;
    const first = frame();
    expect(first.filter((d) => d.kind === 'scene' || d.kind === 'copy')).toHaveLength(0);
    expect(clears(first, pass.transparencyRenderTargetDWFalse)).toBe(1);
    expect(clears(first, pass.transparencyRenderTargetDWTrue)).toBe(1);
    expect(frame()).toHaveLength(0); // steady state: nothing at all
    expect(pass.exactStats?.skippedDwOff).toBe(2);
    expect(pass.exactStats?.skippedDwOn).toBe(2);

    pass.setSize(32, 32); // a resize leaves the targets undefined: clear once more
    const resized = frame();
    expect(clears(resized, pass.transparencyRenderTargetDWFalse)).toBe(1);
    expect(clears(resized, pass.transparencyRenderTargetDWTrue)).toBe(1);
    expect(frame()).toHaveLength(0);

    t.setGeneration(2); // a stock frame (the veil swap) fills both targets
    expect(frame().filter((d) => d.kind === 'scene')).toHaveLength(2);
    t.reveal();
    const back = frame();
    expect(clears(back, pass.transparencyRenderTargetDWFalse)).toBe(1);
    expect(clears(back, pass.transparencyRenderTargetDWTrue)).toBe(1);
    expect(back.filter((d) => d.kind === 'scene' || d.kind === 'copy')).toHaveLength(0);

    // A transparent mount (a figure-set change) brings the DW-off render back.
    scene.add(mesh('late-glass', blend()));
    t.figures();
    const drawn = frame();
    expect(scenes(drawn, pass.transparencyRenderTargetDWFalse)[0].meshes).toEqual(['late-glass']);
    expect(drawn.filter((d) => d.kind === 'copy')).toHaveLength(1);
  });

  it('never writes a camera mask, even for a camera parented in the scene', () => {
    const { scene, camera } = buildScene(false);
    const rig = new THREE.PerspectiveCamera();
    scene.add(rig);
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    expect(rig.layers.mask).toBe(1);
    expect(pass.listDrift()).toBe(0);
  });

  it('restores the camera mask, clear colour, background and autoClearDepth', () => {
    const { scene, camera } = buildScene(true);
    scene.background = new THREE.Color(0x101010);
    const background = scene.background;
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    const mask = camera.layers.mask;
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(camera.layers.mask).toBe(mask);
    expect(renderer.clearColor.getHex()).toBe(0x335577);
    expect(renderer.clearAlpha).toBe(1);
    expect(scene.background).toBe(background);
    expect(renderer.autoClearDepth).toBe(true);
  });

  it('renders the stock way until the reveal arms for the current generation (and after a new one begins)', () => {
    const { scene, camera } = buildScene(false);
    const { pass, t } = exactPass(scene, camera);
    const renderer = new FakeRenderer(scene);
    const stockRender = vi.spyOn(N8AOPostPass.prototype, 'renderTransparency');
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(stockRender).toHaveBeenCalledTimes(1); // the stock body (the load)
    t.reveal();
    stockRender.mockClear();
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(stockRender).not.toHaveBeenCalled(); // the exact path
    expect(pass.exactStats?.fresh).toBe(true);
    t.setGeneration(2); // a D32 veil swap: stock again until its own reveal
    stockRender.mockClear();
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(stockRender).toHaveBeenCalledTimes(1);
    expect(pass.exactStats?.fresh).toBe(false);
    t.reveal();
    stockRender.mockClear();
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(stockRender).not.toHaveBeenCalled();
  });

  it('a held object is never tagged; it takes its tags the frame it is released', () => {
    const { scene, camera, named } = buildScene(false);
    const glass = named['blend-glass'];
    glass.layers.mask = 0; // the warm's compile hold
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(glass.layers.mask).toBe(0);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).not.toContain('blend-glass');
    expect(pass.exactStats?.pending).toBe(1);
    glass.layers.mask = 1; // released
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(glass.layers.mask & N3_TAG_DW_OFF).toBe(N3_TAG_DW_OFF);
    expect(glass.layers.mask & 1).toBe(1);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).toContain('blend-glass');
    expect(pass.exactStats?.pending).toBe(0);
    expect(pass.listDrift()).toBe(0);
  });

  it('a tag applied before a hold is parked with the mask and comes back on release', () => {
    const { scene, camera, named } = buildScene(false);
    const glass = named['blend-glass'];
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    renderer.take();
    const saved = glass.layers.mask;
    expect(saved & N3_TAG_DW_OFF).toBe(N3_TAG_DW_OFF);
    glass.layers.mask = 0; // the compile hold parks the mask
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).not.toContain('blend-glass');
    glass.layers.mask = releaseHeldMask(saved, glass.layers.mask) ?? -1; // X15's release
    expect(glass.layers.mask).toBe(saved);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).toContain('blend-glass');
  });

  it('a retag while held corrects the stale tags the release brings back', () => {
    const { scene, camera, named } = buildScene(false);
    const glass = named['blend-glass'] as THREE.Mesh;
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    const saved = glass.layers.mask; // tagged DW-off
    glass.layers.mask = 0; // held
    glass.material = opaque(); // its look changed while held (no longer transparent)
    t.figures(); // a retag while it is held
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.pending).toBeGreaterThan(0);
    glass.layers.mask = releaseHeldMask(saved, glass.layers.mask) ?? -1; // stale tags come back
    renderer.take();
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(glass.layers.mask & N3_TAG_BITS).toBe(0);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).not.toContain('blend-glass');
    expect(pass.listDrift()).toBe(0);
  });

  it('X15 (ENGINE-L): tag a held object, release it — layer 0 restored and the tag kept', () => {
    const saved = 1; // layer 0
    const heldAndTagged = 0 | N3_TAG_DW_OFF; // a tag written while the mask was parked
    const restored = releaseHeldMask(saved, heldAndTagged);
    expect(restored).toBe(1 | N3_TAG_DW_OFF);
    expect((restored ?? 0) & 1).toBe(1);
    // Any other write while held is a deliberate one: kept.
    expect(releaseHeldMask(saved, 1 << 3)).toBeNull();
  });

  it('retags on a figure-set change; the drift check sees the gap until then', () => {
    const { scene, camera } = buildScene(false);
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.listDrift()).toBe(0);
    const figure = new THREE.Group();
    figure.name = 'figure';
    figure.add(mesh('figure-blend', blend()));
    scene.add(figure);
    expect(pass.listDrift()).toBe(2); // the group and its BLEND part
    const retags = pass.exactStats?.retags ?? 0;
    t.figures();
    renderer.take();
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.retags).toBe(retags + 1);
    expect(pass.listDrift()).toBe(0);
    expect(scenes(renderer.take(), pass.transparencyRenderTargetDWFalse)[0].meshes).toContain('figure-blend');
  });
});

describe('ExactN8AOPostPass: steady state', () => {
  it('no traversal, no Map and the same scratch colours every frame', () => {
    const { scene, camera } = buildScene(true);
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer); // the one tagging traversal
    const retags = pass.exactStats?.retags;

    const traverse = vi.spyOn(THREE.Object3D.prototype, 'traverse');
    const traverseVisible = vi.spyOn(THREE.Object3D.prototype, 'traverseVisible');
    let maps = 0;
    const RealMap = Map;
    vi.stubGlobal(
      'Map',
      class CountingMap<K, V> extends RealMap<K, V> {
        constructor(entries?: readonly (readonly [K, V])[] | null) {
          super(entries);
          maps += 1;
        }
      },
    );
    renderer.getClearColorArgs.length = 0;
    renderer.setClearColorArgs.length = 0;
    for (let frame = 0; frame < 5; frame += 1) pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(traverse).not.toHaveBeenCalled();
    expect(traverseVisible).not.toHaveBeenCalled();
    expect(maps).toBe(0);
    expect(pass.exactStats?.retags).toBe(retags);
    expect(new Set(renderer.getClearColorArgs).size).toBe(1);
    // One scratch black for the passes, one scratch for the restore.
    expect(new Set(renderer.setClearColorArgs).size).toBe(2);
  });

  it('the stock pass, for contrast, builds a Map and traverses four times a frame', () => {
    const { scene, camera } = buildScene(true);
    const stock = new N8AOPostPass(scene, camera, 64, 64);
    const traverse = vi.spyOn(THREE.Object3D.prototype, 'traverse');
    let maps = 0;
    const RealMap = Map;
    vi.stubGlobal(
      'Map',
      class CountingMap<K, V> extends RealMap<K, V> {
        constructor(entries?: readonly (readonly [K, V])[] | null) {
          super(entries);
          maps += 1;
        }
      },
    );
    stock.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    vi.unstubAllGlobals();
    // `traverse` recurses through every child: count the whole-scene walks.
    expect(traverse.mock.contexts.filter((context) => context === scene)).toHaveLength(4);
    expect(maps).toBe(1);
  });

  it("the warm's passMaterials sees the stock pass's materials, never the scene's (pending objects included)", () => {
    const { scene, camera, named } = buildScene(true);
    named['blend-glass'].layers.mask = 0; // held: joins the pending list
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.pending).toBe(1);
    const stock = new N8AOPostPass(scene, camera, 64, 64);
    const ours = passMaterials(pass, [scene]);
    const theirs = passMaterials(stock, [scene]);
    expect(ours.map((m) => m.type).sort()).toEqual(theirs.map((m) => m.type).sort());
    expect(ours).not.toContain((named['blend-glass'] as THREE.Mesh).material);
  });

  it('the drift check needs routeN8aoDrift=1 on top of routeDebug=1 (timing runs never carry it)', () => {
    expect(routeDebugParam('?routeDebug=1', false, 'routeDebug')).toBe(true);
    expect(routeDebugParam('?routeDebug=1', false, 'routeN8aoDrift')).toBe(false);
    expect(routeDebugParam('?routeDebug=1&routeN8aoDrift=1', false, 'routeN8aoDrift')).toBe(true);
    expect(routeDebugParam('?routeN8aoDrift=1', false, 'routeN8aoDrift')).toBe(false);
    expect(routeDebugParam('?routeDebug=1&routeN8aoDrift=1', true, 'routeN8aoDrift')).toBe(false);
    expect(routeDebugParam('?routeDebug=1', true, 'routeDebug')).toBe(false);

    const host: { location: { search: string }; __routeN8ao?: unknown } = { location: { search: '?routeDebug=1' } };
    vi.stubGlobal('window', host);
    const { scene, camera } = buildScene(false);
    const t = triggers();
    t.reveal();
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t });
    expect(host.__routeN8ao).toBe(pass.exactStats); // the readout is still published
    const traverse = vi.spyOn(THREE.Object3D.prototype, 'traverse');
    const listDrift = vi.spyOn(pass, 'listDrift');
    const renderer = new FakeRenderer(scene);
    for (let frame = 0; frame < 3; frame += 1) pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(listDrift).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();
    expect(pass.exactStats?.driftChecks).toBe(0);
  });

  it('dev readout: n8aoListDrift is checked at most once per second and published on window.__routeN8ao', () => {
    const host: { location: { search: string }; __routeN8ao?: unknown } = { location: { search: '?routeDebug=1&routeN8aoDrift=1' } };
    vi.stubGlobal('window', host);
    const { scene, camera } = buildScene(false);
    const t = triggers();
    t.reveal();
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t });
    expect(host.__routeN8ao).toBe(pass.exactStats);
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    scene.add(mesh('late-blend', blend())); // mounted after the tagging: drift
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.driftChecks).toBe(1);
    expect(pass.exactStats?.n8aoListDrift).toBe(0);
    expect(pass.listDrift()).toBe(1);
  });

  it('dev readout is off in production', () => {
    vi.stubGlobal('window', { location: { search: '?routeDebug=1' } });
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const { scene, camera } = buildScene(false);
      new ExactN8AOPostPass(scene, camera, 64, 64, { triggers: triggers() });
      expect((window as unknown as { __routeN8ao?: unknown }).__routeN8ao).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('dispose unsubscribes both triggers', () => {
    const { scene, camera } = buildScene(false);
    const off: string[] = [];
    const t: ExactAoTriggers = {
      onRevealReady: () => () => off.push('reveal'),
      onFigureSetChanged: () => () => off.push('figures'),
      generation: () => 1,
    };
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t, debug: false });
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer); // subscribes lazily
    pass.dispose();
    expect(off.sort()).toEqual(['figures', 'reveal']);
  });

  it('a disposed instance that keeps rendering (Fast Refresh, StrictMode replay) subscribes again and re-arms', () => {
    const { scene, camera } = buildScene(false);
    const { pass, t } = exactPass(scene, camera);
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.fresh).toBe(true);
    pass.dispose(); // the effect cleanup; the memo keeps the instance
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    // Re-subscribed: the reveal (already ready) fires at once and re-arms.
    expect(pass.exactStats?.fresh).toBe(true);
    const retags = pass.exactStats?.retags ?? 0;
    t.figures(); // the new subscription is live
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.retags).toBe(retags + 1);
  });

  it('subscribes nothing until it first renders (a discarded render-phase instance holds nothing)', () => {
    const { scene, camera } = buildScene(false);
    let subscriptions = 0;
    const t: ExactAoTriggers = {
      onRevealReady: () => {
        subscriptions += 1;
        return () => {};
      },
      onFigureSetChanged: () => {
        subscriptions += 1;
        return () => {};
      },
      generation: () => 1,
    };
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t, debug: false });
    expect(subscriptions).toBe(0);
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    expect(subscriptions).toBe(2);
  });
});

describe('ExactN8AOPostPass: a late non-figure transparent mount (requestN3Retag)', () => {
  /** The no-model ace card: bezel + glass (opaque) and the transparent sprite plane. */
  function aceCard(scene: THREE.Scene): THREE.Group {
    const card = new THREE.Group();
    card.name = 'ace-card';
    card.add(mesh('ace-bezel', opaque()), mesh('ace-glass', opaque()));
    scene.add(card);
    return card;
  }

  function lateScene() {
    const { scene, camera } = buildScene(false);
    const card = aceCard(scene);
    const t = { ...triggers(), onRetagRequested: onN3RetagRequested };
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t, debug: false });
    t.reveal();
    const renderer = new FakeRenderer(scene);
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer); // the reveal's tagging
    renderer.take();
    return { scene, camera, card, pass, renderer };
  }

  it('the sprite that arrives after the reveal is drawn like stock once the mount requests a retag', () => {
    const { scene, camera, card, pass, renderer } = lateScene();
    card.add(mesh('ace-sprite', blend())); // /api/proxy-image answered after the reveal
    scene.add(mesh('late-dw', blendDw())); // and a depth-writing late transparent

    // Without the request the tags are stale: the reviewer's P2 gap.
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    const stale = renderer.take();
    expect(scenes(stale, pass.transparencyRenderTargetDWFalse)[0].meshes).not.toContain('ace-sprite');
    expect(pass.listDrift()).toBeGreaterThan(0);

    requestN3Retag();
    const retags = pass.exactStats?.retags ?? 0;
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    const log = renderer.take();
    expect(pass.exactStats?.retags).toBe(retags + 1);
    expect(pass.listDrift()).toBe(0);

    const { stock, log: stockLog } = stockFrame(scene, camera);
    const exactOff = scenes(log, pass.transparencyRenderTargetDWFalse);
    const stockOff = scenes(stockLog, stock.transparencyRenderTargetDWFalse);
    expect(exactOff[0].meshes).toContain('ace-sprite');
    expect(exactOff[0].meshes).toEqual(stockOff[0].meshes);
    expect(exactOff[0].lights).toEqual(stockOff[0].lights);
    const exactOn = scenes(log, pass.transparencyRenderTargetDWTrue);
    const stockOn = scenes(stockLog, stock.transparencyRenderTargetDWTrue);
    expect(exactOn).toHaveLength(1);
    expect(exactOn[0].meshes).toEqual(['late-dw']);
    expect(exactOn[0].meshes).toEqual(stockOn[0].meshes);

    // One traversal per request, never per frame.
    pass.renderTransparency(renderer as unknown as THREE.WebGLRenderer);
    expect(pass.exactStats?.retags).toBe(retags + 1);
  });

  it('the default triggers carry the retag request; dispose unsubscribes it', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/world/route/post/n8ao-exact.ts'), 'utf8');
    expect(source).toMatch(/const DEFAULT_TRIGGERS: ExactAoTriggers = \{[^}]*onRetagRequested: onN3RetagRequested,/);
    const { scene, camera } = buildScene(false);
    let live = 0;
    const t: ExactAoTriggers = {
      ...triggers(),
      onRetagRequested: (cb) => {
        live += 1;
        const off = onN3RetagRequested(cb);
        return () => {
          live -= 1;
          off();
        };
      },
    };
    const pass = new ExactN8AOPostPass(scene, camera, 64, 64, { mode: 'exact', triggers: t, debug: false });
    pass.renderTransparency(new FakeRenderer(scene) as unknown as THREE.WebGLRenderer);
    expect(live).toBe(1);
    pass.dispose();
    expect(live).toBe(0);
  });

  it('requestN3Retag is a module-level listener set (no listener: a no-op)', () => {
    expect(() => requestN3Retag()).not.toThrow();
    const calls: string[] = [];
    const offA = onN3RetagRequested(() => calls.push('a'));
    const offB = onN3RetagRequested(() => calls.push('b'));
    requestN3Retag();
    offA();
    requestN3Retag();
    offB();
    requestN3Retag();
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('the no-model ace cards request a retag once their sprite plane commits', () => {
    const files = [
      'src/components/world/evoliga/route/plaza/StatueRow.tsx',
      'src/components/world/themes/sakura/furniture/AcesLine.tsx',
      'src/components/world/themes/mountain/furniture/CairnCircle.tsx',
    ];
    for (const file of files) {
      const code = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(code, file).toMatch(/import \{ useN3RetagOnMount \} from '@\/components\/world\/route\/post\/n3-retag';/);
      expect(code, file).toMatch(/useN3RetagOnMount\(texture\);/);
      expect(code, file).toMatch(/\{texture \? \(\s*<mesh[^]*?transparent depthWrite=\{false\}/);
    }
    const retag = readFileSync(path.join(process.cwd(), 'src/components/world/route/post/n3-retag.ts'), 'utf8');
    // A layout effect: the late child is in the scene graph when it runs.
    expect(retag).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(mounted\) requestN3Retag\(\);\s*\}, \[mounted\]\);/);
  });
});
