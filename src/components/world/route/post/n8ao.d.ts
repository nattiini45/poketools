/**
 * Ambient types for `n8ao` 2.0.1 (the package ships none). Only the surface
 * the route's exact transparency pass (`n8ao-exact.ts`, D42 N3) touches is
 * typed; the version is pinned by `n8ao-exact.test.ts`.
 */
declare module 'n8ao' {
  import type { Camera, Color, Scene, ShaderMaterial, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
  import { Pass } from 'postprocessing';

  /** n8ao's full-screen triangle helper (`depthCopyPass`, `copyQuad`, …). */
  export interface N8AOFullScreenTriangle {
    material: ShaderMaterial;
    render(renderer: WebGLRenderer): void;
    dispose(): void;
  }

  /** The proxied configuration (writes re-configure the pass). */
  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number;
    biasMultiplier: number;
    color: Color;
    gammaCorrection: boolean;
    depthBufferType: number;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    neuralDenoise: boolean;
  }

  /** The depth-buffer kinds the pass keys its shaders on. */
  export const DepthType: { readonly Default: 1; readonly Log: 2; readonly Reverse: 3 };

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
    configuration: N8AOConfiguration;
    autoDetectTransparency: boolean;
    depthTexture: Texture | undefined;
    transparencyRenderTargetDWFalse: WebGLRenderTarget | null | undefined;
    transparencyRenderTargetDWTrue: WebGLRenderTarget | null | undefined;
    depthCopyPass: N8AOFullScreenTriangle | null | undefined;
    detectTransparency(): void;
    configureTransparencyTarget(): void;
    renderTransparency(renderer: WebGLRenderer): void;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' | string): void;
    firstFrame(): void;
  }
}
