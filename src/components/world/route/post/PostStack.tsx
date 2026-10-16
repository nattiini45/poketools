'use client';

import { useContext, useEffect, useLayoutEffect, useMemo, useState, type Ref } from 'react';
import { applyProps, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, EffectComposerContext, groupPasses } from '@react-three/postprocessing';
import {
  BlendFunction,
  BloomEffect,
  EffectPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Pass,
} from 'postprocessing';
import * as THREE from 'three';
import { useQuality } from '../QualityGovernor';
import { useWorldState } from '../WorldStateProvider';
import { passMaterials, registerWarmPostPass } from '../useStationWarmup';
import { ExactN8AOPostPass } from './n8ao-exact';
import { setPostComposer } from './post-store';

/**
 * Bloom threshold in scene-linear luminance. Practicals, signage cores and the
 * sun disc sit well above it (HDR emissive ≥ 2); sunlit stone peaks near 1.2
 * and coloured screen content is authored ≤ 1.6, so daylight and board copy
 * stay crisp while lamps glow.
 */
const BLOOM_THRESHOLD = 1.7;

/**
 * C-044: day-only bloom knee. With the authored 1.7 threshold the 0.3
 * smoothing opens a soft knee down to ~1.4 scene-linear, and the golden-hour
 * frame carries real energy across that band (warm sky around the contre-jour
 * sun, board content authored to 1.6). Its mipmap bloom spread that energy as
 * a frame-wide albedo-insensitive veil — a measured ~13–20 lum of the
 * ~111-lum additive floor on the #rules shop glass, and the same veil washed
 * bright surfaces ~15 lum. By day
 * the knee sits at 2.0/0.25 so only true HDR sources (sun core, emissive
 * signage ≥ 2) feed the blur: dark façade surfaces keep their albedo, the
 * day bloom reads as restrained as the look-sheet demands, and the sky's
 * cloud gradient stops being flattened by the veil. Night keeps the authored
 * knee verbatim — the dark theme and its lamp glow stay byte-class unchanged.
 */
const DAY_BLOOM_THRESHOLD = 2.0;
const DAY_BLOOM_SMOOTHING = 0.25;
const NIGHT_BLOOM_SMOOTHING = 0.3;

/**
 * C-032: bloom mipmap levels. Seven levels at 2520×1575 cost two extra
 * down/upsample passes for energy the threshold already excludes below the
 * fifth level; five holds the authored lamp glow.
 */
const BLOOM_LEVELS = 5;
const BLOOM_INTENSITY = 0.42;
const BLOOM_RADIUS = 0.7;

const VIGNETTE_OFFSET = 0.26;
/** The authored vignette every world has shipped with. */
const VIGNETTE_DARKNESS = 0.46;

/**
 * The renderer exposure every route world shipped with. AgX (post on) and
 * ACES (post off) both read `gl.toneMappingExposure`; LOOK r2 found the
 * canvas no longer set it (1.0 instead of 1.05), which moved every pixel of
 * every world by −1…−2 LSB — the blast-radius leak. Restored here, a uniform.
 */
export const ROUTE_TONE_MAPPING_EXPOSURE = 1.05;

/**
 * The post-off operator (rungs 2–4): the renderer's ACES, exactly the path
 * every world shipped with. Design decision: the lean full-screen AgX
 * pass graded the data faces (`toneMapped: false` materials, which ACES
 * never touches) — Poké Ball red, ledger chips and board ink lost chroma and
 * white point — and a full-screen pass cannot exclude them, so the post-off
 * rungs return to the renderer operator.
 */
export const POST_OFF_TONE_MAPPING = THREE.ACESFilmicToneMapping;

/**
 * The vignette darkness for a route theme (a uniform, never a program key).
 * ROLLOUT §2.2 (k): a theme's paint block carries its own
 * (`paint.vignette`; the plaza pilot lifts it to 0.30, LOOK-PLAN §2 G4 — its
 * colour story lives in the lights); every theme without one keeps the
 * authored 0.46, so a world that has not opted in stays pixel-identical.
 */
export function vignetteDarknessFor(theme: { paint?: { vignette?: number } } | null | undefined): number {
  return theme?.paint?.vignette ?? VIGNETTE_DARKNESS;
}

/** The bloom knee for a palette (day / night), uniforms on one material. */
export function bloomKneeFor(day: boolean): { threshold: number; smoothing: number } {
  return day
    ? { threshold: DAY_BLOOM_THRESHOLD, smoothing: DAY_BLOOM_SMOOTHING }
    : { threshold: BLOOM_THRESHOLD, smoothing: NIGHT_BLOOM_SMOOTHING };
}

/**
 * The output path a rung draws (LOOK r2): `composer` (N8AO when the rung
 * carries `ao`, then one merged Bloom + SMAA + Vignette + AgX pass that
 * renders straight to the screen, exactly the pipeline rung 0 shipped with)
 * when the rung carries post, otherwise the renderer's own ACES with no
 * composer at all (the shipped post-off path).
 */
export function outputPathFor(step: { post: boolean; ao: boolean }): {
  composer: boolean;
  ao: boolean;
  toneMapping: THREE.ToneMapping;
} {
  return step.post
    ? { composer: true, ao: step.ao, toneMapping: THREE.NoToneMapping }
    : { composer: false, ao: false, toneMapping: POST_OFF_TONE_MAPPING };
}

interface PostPasses {
  rich: EffectPass;
  bloom: BloomEffect;
  vignette: VignetteEffect;
}

/** The palette / theme look: uniforms on the existing materials, never a program key. */
function applyLook(passes: PostPasses, day: boolean, vignette: number): void {
  const knee = bloomKneeFor(day);
  passes.bloom.luminanceMaterial.threshold = knee.threshold;
  passes.bloom.luminanceMaterial.smoothing = knee.smoothing;
  passes.vignette.darkness = vignette;
}

/** The shipped renderer exposure (`gl.toneMappingExposure = 1.05`). */
function applyExposure(gl: THREE.WebGLRenderer): void {
  gl.toneMappingExposure = ROUTE_TONE_MAPPING_EXPOSURE;
}

/** Post off: the renderer's own operator (the composer parks it at none while mounted). */
function applyPostOffOperator(gl: THREE.WebGLRenderer, composer: boolean, toneMapping: THREE.ToneMapping): void {
  if (!composer) gl.toneMapping = toneMapping;
}

/** A render target type the drawing path can actually render into (half float, else 8-bit). */
function frameBufferTypeFor(gl: THREE.WebGLRenderer): THREE.TextureDataType {
  try {
    const renderable =
      gl.extensions.has('EXT_color_buffer_half_float') || gl.extensions.has('EXT_color_buffer_float');
    return renderable ? THREE.HalfFloatType : THREE.UnsignedByteType;
  } catch {
    return THREE.UnsignedByteType;
  }
}

/** Publishes the live composer for the capture harness (see RouteWorldCanvas). */
function ComposerBridge() {
  const { composer } = useContext(EffectComposerContext);
  useEffect(() => {
    setPostComposer(composer);
    return () => setPostComposer(null);
  }, [composer]);
  return null;
}

/**
 * Whether the composer's buffers lag the renderer's drawing buffer.
 *
 * LOOK r3 (CLARITY veto: 390 @ dpr 2 faces 6x softer at rung 0): the r3f
 * composer resizes only when the renderer's CSS size changes. When the
 * pixel ratio settles AFTER the composer mounted (the D23 staged mount puts
 * it in the first commit, before the canvas's dpr lands), the CSS size is
 * unchanged, so the composer kept rendering at dpr 1 and the merged pass
 * up-sampled that to the 1.75 drawing buffer — every data face smeared.
 */
export function composerLagsDrawingBuffer(
  input: { width: number; height: number },
  drawingBuffer: { width: number; height: number },
): boolean {
  return input.width !== drawingBuffer.width || input.height !== drawingBuffer.height;
}

const drawingBufferSize = new THREE.Vector2();
const cssSize = new THREE.Vector2();

/**
 * Keeps the composer at the drawing-buffer resolution (CSS size x pixel
 * ratio). Runs before the composer's own render (priority 0 < its 1) and
 * resizes only on a mismatch, so a settled frame does no work.
 */
function ComposerResolutionSync() {
  const { composer } = useContext(EffectComposerContext);
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    if (!composer) return;
    gl.getDrawingBufferSize(drawingBufferSize);
    if (!composerLagsDrawingBuffer(composer.inputBuffer, drawingBufferSize)) return;
    const size = gl.getSize(cssSize);
    composer.setSize(size.width, size.height, false);
  });
  return null;
}

/** Side of the warm input target (LOOK-PLAN §2 G3.6: "a 64² target"). */
const WARM_TARGET_SIZE = 64;

/**
 * Registers the composer's passes with the load warm (useStationWarmup
 * `registerWarmPostPass`). The rich pass is the composer's LAST pass, so it
 * renders to the screen (the shipped pipeline, no trailing copy); its warm
 * draw therefore targets the screen too — the exact program variant the
 * first real frame uses — under a zero-size scissor, so it links the
 * program without writing a single pixel. N8AO is registered for its
 * materials only: its internal targets are sized to the composer, so the
 * warm's first real frame draws it.
 */
function WarmRegistrar({ rich, ao }: { rich: EffectPass; ao: Pass | null }) {
  const { composer } = useContext(EffectComposerContext);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    let input: THREE.WebGLRenderTarget | null = null;
    let output: THREE.WebGLRenderTarget | null = null;
    const warmRich = () => {
      // Only a pass the composer actually holds (initialised with its renderer).
      if (!composer.passes.includes(rich)) return;
      if (input === null || output === null) {
        const texture = composer.inputBuffer.texture;
        const make = () => {
          const target = new THREE.WebGLRenderTarget(WARM_TARGET_SIZE, WARM_TARGET_SIZE, {
            type: texture.type,
            depthBuffer: false,
          });
          target.texture.colorSpace = texture.colorSpace;
          return target;
        };
        input ??= make();
        output ??= make();
      }
      const scissor = gl.getScissor(new THREE.Vector4());
      const scissorTest = gl.getScissorTest();
      const was = rich.enabled;
      const wasScreen = rich.renderToScreen;
      rich.enabled = true;
      gl.setScissorTest(true);
      gl.setScissor(0, 0, 0, 0);
      try {
        // `output` is ignored by a render-to-screen pass; the bloom's own
        // mip targets still render (and link) from the 64² input.
        rich.render(gl, input, output, 0, false);
        // ENGINE r3 (quiet governor leg: one EffectMaterial link at the
        // 0 -> 1 step): the pass is the composer's terminal pass on one rung
        // and not on another (N8AO in front of it at rung 0), and its program
        // keys the output colour space of where it draws. Both variants are
        // linked here; a distinct output target keeps the non-screen draw
        // from sampling the buffer it writes (a feedback loop).
        rich.renderToScreen = !wasScreen;
        rich.render(gl, input, output, 0, false);
      } finally {
        rich.renderToScreen = wasScreen;
        rich.enabled = was;
        gl.setScissor(scissor);
        gl.setScissorTest(scissorTest);
      }
    };
    const releases = [
      registerWarmPostPass({ key: 'rich', materials: () => passMaterials(rich, [scene]), warm: warmRich }),
    ];
    // N8AO keeps the world's scene: excluded, its materials are the scene compile's.
    if (ao !== null) releases.push(registerWarmPostPass({ key: 'ao', materials: () => passMaterials(ao, [scene]) }));
    return () => {
      for (const release of releases) release();
      input?.dispose();
      output?.dispose();
    };
  }, [composer, gl, scene, rich, ao]);
  return null;
}

/** The N8AO settings the route ships (the `<N8AO>` props every rung with `ao` used). */
interface RouteN8AOProps {
  aoRadius: number;
  intensity: number;
  distanceFalloff: number;
  quality: 'performance' | 'low' | 'medium' | 'high' | 'ultra';
  halfRes: boolean;
  depthAwareUpsampling: boolean;
  color: string;
  ref?: Ref<Pass | null>;
}

/**
 * D42 N3: `@react-three/postprocessing`'s `<N8AO>` (3.1.1), line for line,
 * with the route's exact transparency pass (`ExactN8AOPostPass`) in place of
 * the stock `N8AOPostPass` (the wrapper hard-codes its class). Same defaults
 * (`aoSamples` 16, `denoiseSamples` 4, `denoiseRadius` 12, `renderMode` 0),
 * same configuration writes in the same order, and the pass joins
 * `groupPasses`, so the composer builds the same pass list.
 */
function RouteN8AO({ aoRadius, intensity, distanceFalloff, quality, halfRes, depthAwareUpsampling, color, ref }: RouteN8AOProps) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const effect = useMemo(() => {
    const instance = new ExactN8AOPostPass(scene, camera);
    groupPasses.add(instance);
    return instance;
  }, [camera, scene]);
  useEffect(() => () => effect.dispose(), [effect]);
  useLayoutEffect(() => {
    effect.setEnabled(true);
    invalidate();
  }, [effect, invalidate]);
  useLayoutEffect(() => {
    applyProps(effect.configuration as unknown as Parameters<typeof applyProps>[0], {
      color,
      aoRadius,
      distanceFalloff,
      intensity,
      aoSamples: 16,
      denoiseSamples: 4,
      denoiseRadius: 12,
      screenSpaceRadius: undefined,
      renderMode: 0,
      halfRes,
      depthAwareUpsampling,
    });
    invalidate();
  }, [color, aoRadius, distanceFalloff, intensity, halfRes, depthAwareUpsampling, effect, invalidate]);
  useLayoutEffect(() => {
    effect.setQualityMode(quality.charAt(0).toUpperCase() + quality.slice(1));
    invalidate();
  }, [effect, quality, invalidate]);
  return <primitive ref={ref} object={effect} />;
}

/**
 * The composer, mounted only while the rung carries post (the shipped
 * pipeline): N8AO when `ao`, then ONE merged Bloom (mipmap, ADD) + SMAA +
 * Vignette + AgX pass that renders straight to the screen.
 */
function Composer({ passes, ao }: { passes: PostPasses; ao: boolean }) {
  const gl = useThree((state) => state.gl);
  const [frameBufferType] = useState(() => frameBufferTypeFor(gl));
  const [aoPass, setAoPass] = useState<Pass | null>(null);
  return (
    <EffectComposer multisampling={0} frameBufferType={frameBufferType} enableNormalPass={false}>
      <ComposerBridge />
      <ComposerResolutionSync />
      <WarmRegistrar rich={passes.rich} ao={ao ? aoPass : null} />
      {ao ? (
        <RouteN8AO
          ref={setAoPass}
          aoRadius={1.6}
          intensity={2.2}
          distanceFalloff={0.9}
          quality="medium"
          halfRes
          depthAwareUpsampling
          color="#1a1410"
        />
      ) : null}
      <primitive object={passes.rich} />
    </EffectComposer>
  );
}

/**
 * The route's post-processing stack (ADR-0001, spec §8.4): N8AO → Bloom →
 * SMAA → Vignette → AgX while the rung carries post; the renderer's ACES
 * with no composer otherwise — byte-for-byte the output path every world
 * shipped with (LOOK r2: the D23 always-mounted rewrite shifted every
 * world's pixels and graded the data faces at rung 2).
 *
 * Tone mapping: three skips the renderer's operator while drawing into the
 * composer's HDR buffer and the composer parks `gl.toneMapping` at none
 * while mounted, so AgX is the only operator with post on; with post off
 * this stack sets the renderer's ACES (the canvas creates it at none). The
 * exposure is the shipped 1.05 in both paths.
 */
export default function PostStack() {
  const quality = useQuality();
  const { palette, theme } = useWorldState();
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const day = palette.exposure >= 0.75;
  const vignetteDarkness = vignetteDarknessFor(theme);
  const path = outputPathFor(quality);

  const passes = useMemo<PostPasses>(() => {
    const knee = bloomKneeFor(true);
    const bloom = new BloomEffect({
      // The JSX <Bloom> this replaces defaulted to ADD (not the effect's own
      // SCREEN): kept, so rung 0 renders exactly as it shipped.
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: knee.threshold,
      luminanceSmoothing: knee.smoothing,
      intensity: BLOOM_INTENSITY,
      radius: BLOOM_RADIUS,
      levels: BLOOM_LEVELS,
    });
    const smaa = new SMAAEffect();
    const vignette = new VignetteEffect({ offset: VIGNETTE_OFFSET, darkness: VIGNETTE_DARKNESS });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const rich = new EffectPass(camera, bloom, smaa, vignette, tone);
    return { rich, bloom, vignette };
  }, [camera]);

  useEffect(
    () => () => {
      passes.rich.dispose();
    },
    [passes],
  );

  // Uniforms only: the day/night knee and the theme's vignette.
  useLayoutEffect(() => applyLook(passes, day, vignetteDarkness), [passes, day, vignetteDarkness]);

  // The shipped exposure (both operators read it).
  useLayoutEffect(() => applyExposure(gl), [gl]);

  // Post off: the renderer's ACES. A layout effect, so on a governor step it
  // lands before the unmounting composer's passive cleanup (whose guard then
  // leaves a value it did not force alone).
  useLayoutEffect(() => applyPostOffOperator(gl, path.composer, path.toneMapping), [gl, path.composer, path.toneMapping]);

  return path.composer ? <Composer passes={passes} ao={path.ao} /> : null;
}
