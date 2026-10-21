'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { paintBoardPage } from '@/lib/route-world/board-paint-path';
import { boardTextureFloor } from '@/lib/route-world/legibility';
import { PROBE_STATIONS } from './probe-theme';

/**
 * The C-100 r2 enforcement probe board — the PRODUCTION consumer that wires
 * the legibility floors into a shipped board. Both clauses route through the
 * shared `paintBoardPage` call:
 *
 *  - board-texture floor: the declared constants here are plaza-class
 *    1024×592 — a SUB-FLOOR request. The shared call clamps the allocation
 *    to the theme's ≥2× floor, so the shipped canvas is 2048×1184 (measured,
 *    not declared — see the `__probeBoardPaint` proof global).
 *  - font floor: every text line's px passes through `tools.fontPx`, the
 *    station pose-derived clamp from the same shared call — the 22px body
 *    line ships at the pulse station's floor (78 shipped px = 39 painter px
 *    at 2×).
 *
 * A strict sub-floor request (`onSubFloor: 'reject'`) is self-tested on
 * mount and the caught NAMED error is recorded in the same proof global, so
 * the live page carries both enforcement proofs (clamp + reject) beside the
 * rendered board.
 */

/** Declared constants — deliberately the sub-floor plaza class. */
export const PROBE_BOARD_TEX = { width: 1024, height: 592 } as const;
/** Real-world face width in metres (1024:592 aspect → 2.3125 m tall). */
export const PROBE_BOARD_FACE_W_M = 4;

/** The pose source of record: the pulse station the boards face. */
const PROBE_BOARD_STATION = PROBE_STATIONS[0];
/** The floor the shared call clamps to, precomputed for the proof global. */
const PROBE_BOARD_FLOOR = boardTextureFloor(PROBE_BOARD_TEX);

interface ProbeBoardPaintProof {
  declared: string;
  floor: string;
  shipped: { width: number; height: number };
  clamped: boolean;
  fontFloorTexPx: number;
  fontFloorPaintPx: number;
  fontFloorApplied: { requestedPx: number; paintedPx: number };
  subFloorRejection: string | null;
}

type ProbeHost = Window & { __probeBoardPaint?: ProbeBoardPaintProof };

export interface ProbeBoardCopy {
  title: string;
  kicker: string;
  line: string;
  ticker: string;
}

const PANEL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Unlit LED panel — the painted canvas straight through, tone mapping off. */
const PANEL_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uMap, vUv);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The probe page painter — authored in DECLARED space (1024×592); the shared
 * call scales it onto the floored canvas. Text px go through `tools.fontPx`
 * so the pose floor is applied in the shared call, not by this painter.
 */
function paintProbeBoardPage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: ProbeBoardCopy,
  onFontClamp: (requestedPx: number, paintedPx: number) => void,
  tools: { fontPx: (n: number) => number },
): void {
  const ink = '#f4fbff';
  const accent = '#39c7ff';
  const font = (weight: number, px: number) => `${weight} ${px}px system-ui, 'Segoe UI', sans-serif`;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#04101c');
  bg.addColorStop(1, '#0a2036');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = accent;
  ctx.font = font(600, tools.fontPx(26));
  ctx.textAlign = 'left';
  ctx.fillText(copy.kicker, 56, 66);
  ctx.fillStyle = ink;
  ctx.font = font(800, tools.fontPx(92));
  ctx.fillText(copy.title, 52, 160);

  // The enforcement demo line: requested BELOW the floor on purpose — the
  // clamp in the shared call decides what ships.
  const bodyPx = tools.fontPx(22);
  onFontClamp(22, bodyPx);
  ctx.fillStyle = 'rgba(244,251,255,0.85)';
  ctx.font = font(700, bodyPx);
  ctx.fillText(copy.line, 56, 250);

  ctx.fillStyle = accent;
  ctx.font = font(800, tools.fontPx(64));
  ctx.fillText('≥2×', 56, 380);

  ctx.fillStyle = 'rgba(2, 8, 16, 0.72)';
  ctx.fillRect(0, h - 56, w, 56);
  ctx.fillStyle = 'rgba(57,199,255,0.8)';
  ctx.font = font(600, tools.fontPx(22));
  ctx.fillText(copy.ticker, 56, h - 21);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(14, 14, w - 28, h - 28);
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export interface ProbeBoardProps {
  position: readonly [number, number, number];
  yaw?: number;
  copy: ProbeBoardCopy;
}

/**
 * One probe LED board: cabinet box + unlit panel, painted and uploaded
 * through the shared enforcement path (Board.tsx's PNG-data-URL route).
 */
export default function ProbeBoard({ position, yaw = 0, copy }: ProbeBoardProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const faceH = (PROBE_BOARD_FACE_W_M * PROBE_BOARD_TEX.height) / PROBE_BOARD_TEX.width;

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Texture | null = null;

    // Font-clamp capture from inside the painter (the shared call applies it).
    let clampedLine: { requestedPx: number; paintedPx: number } | null = null;
    const result = paintBoardPage({
      current: PROBE_BOARD_TEX,
      request: PROBE_BOARD_TEX,
      station: PROBE_BOARD_STATION,
      boardWorldWidthM: PROBE_BOARD_FACE_W_M,
      paint: (ctx, w, h, tools) =>
        paintProbeBoardPage(ctx, w, h, copy, (requestedPx, paintedPx) => {
          clampedLine = { requestedPx, paintedPx };
        }, tools),
    });

    // Strict-variant self-test: the same sub-floor request under 'reject'
    // must throw the NAMED legibility error — recorded for the live proof.
    let rejection: string | null = null;
    try {
      paintBoardPage({
        current: PROBE_BOARD_TEX,
        request: PROBE_BOARD_TEX,
        onSubFloor: 'reject',
        station: PROBE_BOARD_STATION,
        boardWorldWidthM: PROBE_BOARD_FACE_W_M,
        paint: () => {},
      });
    } catch (err) {
      rejection = err instanceof Error ? err.message : String(err);
    }

    const host = window as ProbeHost;
    host.__probeBoardPaint = {
      declared: `${PROBE_BOARD_TEX.width}x${PROBE_BOARD_TEX.height}`,
      floor: `${PROBE_BOARD_FLOOR.width}x${PROBE_BOARD_FLOOR.height}`,
      shipped: { width: result.canvas.width, height: result.canvas.height },
      clamped: result.allocation.clamped,
      fontFloorTexPx: result.fontFloorTexPx,
      fontFloorPaintPx: result.fontFloorPaintPx,
      fontFloorApplied: clampedLine ?? { requestedPx: 0, paintedPx: 0 },
      subFloorRejection: rejection,
    };

    loadTexture(result.canvas.toDataURL('image/png')).then(
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        loaded = tex;
        setTexture(tex);
      },
      (err: unknown) => console.error('[route-world] probe board upload failed', err),
    );

    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [copy]);

  const uniforms = useMemo(() => ({ uMap: { value: texture } }), [texture]);

  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0, 0.13]} castShadow>
        <boxGeometry args={[PROBE_BOARD_FACE_W_M + 0.3, faceH + 0.3, 0.24]} />
        <meshStandardMaterial color="#0b0c10" roughness={0.4} metalness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.26]} renderOrder={2}>
        <planeGeometry args={[PROBE_BOARD_FACE_W_M, faceH]} />
        {texture ? (
          <shaderMaterial
            vertexShader={PANEL_VERTEX}
            fragmentShader={PANEL_FRAGMENT}
            uniforms={uniforms}
            side={THREE.FrontSide}
            toneMapped={false}
          />
        ) : (
          <meshBasicMaterial color="#05070c" />
        )}
      </mesh>
    </group>
  );
}
