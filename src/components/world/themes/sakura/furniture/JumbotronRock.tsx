'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { useSakuraPalette } from '../use-sakura-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintBoardPage, BOARD_TEX_H, BOARD_TEX_W } from '../content/paint';
import { SAKURA_STATIONS } from '../theme';
import type { SakuraRouteData } from '../types';
import { ROCK } from './layout';
import { useStandbyDim } from '@/components/world/route/useStandbyDim';
import { SAKURA_DATA_SURFACES } from './data-faces';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #pulse hero: a lakeside jumbotron rock — a weathered boulder on the
 * north-west shore carrying an embedded LED screen with the standings, the
 * live match and the kickoff ticker. Content arrives through
 * `buildBoardContent(data, locale)` in the viewer's language; the boulder is procedural (a faceted
 * icosahedron, flat-shaded), and the screen sits on its south-east face
 * aimed at the station camera.
 */

/** Screen face size (16:9), metres — ≈ 46 % of the 1440 frame at the pose. */
export const ROCK_SCREEN_W = 7.0;
export const ROCK_SCREEN_H = ROCK_SCREEN_W * (9 / 16);

/** Screen plane / bezel-back depth along the rock group's local +Z (the
 * bezel box spans 1.17..1.53 at z 1.35; the painted plane rides at 1.545). */
const SCREEN_Z0 = 1.12;
const SCREEN_Z1 = 1.6;

/**
 * Hand-authored world AABB of the bezel + screen, swung by `ROCK.faceYaw`
 * into world axes (the plaza Board's discipline). Auto-measure would frame
 * the whole 10 m boulder and its moss crown instead of the lit face, and the
 * focus camera would stand far too deep.
 */
const SCREEN_BOUNDS: SubjectBounds = (() => {
  const sin = Math.sin(ROCK.faceYaw);
  const cos = Math.cos(ROCK.faceYaw);
  const halfW = (ROCK_SCREEN_W + 0.5) / 2 + 0.1;
  const halfH = (ROCK_SCREEN_H + 0.5) / 2 + 0.1;
  const zc = (SCREEN_Z0 + SCREEN_Z1) / 2;
  const hd = (SCREEN_Z1 - SCREEN_Z0) / 2;
  const cx = ROCK.x + zc * sin;
  const cz = ROCK.z + zc * cos;
  const ex = halfW * Math.abs(cos) + hd * Math.abs(sin);
  const ez = halfW * Math.abs(sin) + hd * Math.abs(cos);
  return {
    min: [cx - ex, 2.7 - halfH, cz - ez],
    max: [cx + ex, 2.7 + halfH, cz + ez],
  };
})();

/** The screen's world normal: the group's local +Z swung by `faceYaw`. */
const SCREEN_FACING: Vec3Tuple = [Math.sin(ROCK.faceYaw), 0, Math.cos(ROCK.faceYaw)];

const PULSE_PANEL: SubjectPanel = { param: 'board', value: 'pulse' };

/** The screen's data-face id (data-faces.ts) — the standby dim's key. */
const PULSE_FACE_IDS = ['pulse:board'] as const;

export default function JumbotronRock() {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const palette = useSakuraPalette();
  const data = useRouteData<SakuraRouteData>();
  const night = palette.exposure < 0.75;
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);

  const colors = useMemo(
    () => ({ field: palette.boardField, accent: palette.boardAccent, ink: '#eafcff' }),
    [palette],
  );
  // C-105 r1: the rock's screen is a board page — allocated and font-floored
  // through the shared paint path (pulse station, 7.0 m face).
  const paint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintBoardPage(ctx, w, h, content, colors, tools, locale),
    [content, colors, locale],
  );
  const screen = usePaintedBoardTexture(paint, BOARD_TEX_W, BOARD_TEX_H, SAKURA_STATIONS[0], ROCK_SCREEN_W);
  // Fidelity wave 2 (2F): standby dim — uniforms exist before the screen's first compile.
  const standby = useStandbyDim({ surfaces: SAKURA_DATA_SURFACES, subjectId: 'board:pulse', faceIds: PULSE_FACE_IDS });

  return (
    <FocusSubject
      id="board:pulse"
      kind="board"
      label={t('subjects.sakura.pulse')}
      facing={SCREEN_FACING}
      panel={PULSE_PANEL}
      bounds={SCREEN_BOUNDS}
    >
      <group position={[ROCK.x, 0, ROCK.z]} rotation={[0, ROCK.faceYaw, 0]}>
        {/* Boulder: faceted, sunk into the shore. Sunk 1.6 m along the group's
            local −Z so its south bulge (radius 2.6 × z-scale) stays behind the
            bezel back (1.17) and the screen plane (1.545) at every station pose
            — at the authored z=0 the bulge reached 2.99 and swallowed the
            screen (C-093 r1 capture fix). */}
        <mesh position={[0, 1.35, -1.6]} scale={[1.55, 1.5, 1.0]} castShadow receiveShadow>
          <icosahedronGeometry args={[2.6, 1]} />
          <meshStandardMaterial color={palette.lanternStone} roughness={0.95} metalness={0.02} flatShading />
        </mesh>
        {/* Moss crown. */}
        <mesh position={[0, 3.4, -0.6]} scale={[1.05, 0.5, 0.8]} castShadow>
          <icosahedronGeometry args={[1.6, 1]} />
          <meshStandardMaterial color={palette.lawnColor} roughness={0.96} metalness={0} flatShading />
        </mesh>
        {/* Screen bezel, embedded proud of the boulder's face. */}
        <mesh position={[0, 2.7, 1.35]} castShadow>
          <boxGeometry args={[ROCK_SCREEN_W + 0.5, ROCK_SCREEN_H + 0.5, 0.36]} />
          <meshStandardMaterial color="#3a352f" roughness={0.55} metalness={0.35} />
        </mesh>
        {screen ? (
          <mesh position={[0, 2.7, 1.545]} renderOrder={2}>
            <planeGeometry args={[ROCK_SCREEN_W, ROCK_SCREEN_H]} />
            {/* Fidelity W1 r3 (the light-theme milky wash over the slate):
                the self-lit screen lever the clouds flagship proved — base
                color black so the day key never lifts the slate field, dead
                specular (roughness 1, envMapIntensity 0) so no HDRI sheen
                veils it, no scene fog; the paint reads by its own emission
                (day intensity raised to keep the ink's level). */}
            <meshStandardMaterial
              map={screen}
              color="#000000"
              emissiveMap={screen}
              emissive="#ffffff"
              emissiveIntensity={night ? 1.35 : 1.05}
              roughness={1}
              metalness={0}
              ref={bindEnv}
              envMapIntensity={0}
              toneMapped={false}
              fog={false}
              {...standby.materialProps}
            />
          </mesh>
        ) : null}
        {/* A soft sky of the board's own color over the shore at night.
            Review r2 (W1): seated just BEHIND the screen plane (1.545 → 1.3,
            inside the bezel) so N·L ≤ 0 on the screen — at 2.6 m it painted a
            pink hotspot disc on the standings rows. It still washes the shore. */}
        <pointLight
          position={[0, 2.7, 1.3]}
          color={palette.boardAccent}
          intensity={night ? 6 : 1.1}
          distance={10}
          decay={2}
          castShadow={false}
        />
      </group>
    </FocusSubject>
  );
}
