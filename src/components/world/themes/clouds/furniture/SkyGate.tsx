'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useCloudsPalette } from '../use-clouds-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintGatePlaque, gatePlaqueCopy, PLAQUE_TEX_H, PLAQUE_TEX_W } from '../content/paint';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import { CLOUDS_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { CloudsRouteData } from '../types';
import { HALO_GATE, ISLES } from './layout';
import { emissiveUnderInk, useStandbyDim } from '@/components/world/route/useStandbyDim';
import { CLOUDS_DATA_SURFACES } from './data-faces';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #rules hero: the HALO GATE — a standing stone ring on the south isle,
 * the landmark the whole south approach reads through, with the league's
 * rules plaque hung at its centre from two ring hangers. Content arrives
 * through the contract's rules fields (`gatePlaqueCopy`), the same shaping
 * the DOM #rules section mounts, so the DOM and the gate can never disagree
 * about the ruleset of record. The ring is one procedural torus on a pier.
 */

/**
 * Hand-authored world AABB of the hung plaque plane (axis-aligned: faceYaw
 * is exactly π, so the 5:2 face spans X/Y at `HALO_GATE.face`). The depth
 * span covers the bezel box behind (face.z + 0.06, 0.1 deep) and the hanger
 * rods; auto-measure would swallow the whole 8 m stone ring and pier.
 */
const GATE_BOUNDS: SubjectBounds = {
  min: [
    HALO_GATE.face.x - HALO_GATE.faceW / 2 - 0.15,
    HALO_GATE.face.y - HALO_GATE.faceH / 2 - 0.15,
    HALO_GATE.face.z - 0.2,
  ],
  max: [
    HALO_GATE.face.x + HALO_GATE.faceW / 2 + 0.15,
    HALO_GATE.face.y + HALO_GATE.faceH / 2 + 0.15,
    HALO_GATE.face.z + 0.16,
  ],
};

/** The plaque's world normal: its faceYaw (π) swings the plane's +Z to −Z. */
const GATE_FACING: Vec3Tuple = [Math.sin(HALO_GATE.faceYaw), 0, Math.cos(HALO_GATE.faceYaw)];

/** The only rules value the overlay map answers (ThemeOverlays RULE_VALUES). */
const GATE_RULES_PANEL: SubjectPanel = { param: 'rules', value: 'gate' };

/** The plaque's data-face id (data-faces.ts) — the standby dim's key. */
const RULES_FACE_IDS = ['rules:tablet'] as const;

/** The plaque's body ink — the reference every clouds glow line is budgeted under. */
export const PLAQUE_INK = '#eef6ff';
/**
 * The plaque's emission (fidelity W1 r5, ≤ 1.0: under the bloom threshold).
 * The dimmest board in the world, so it is the reference for the "≤ 0.6 ×
 * board ink" budget of the non-data glow lines (this ring's inlay, the
 * light bridges): anything under it is under every clouds board.
 */
export const PLAQUE_EMISSION = { night: 0.92, day: 1.0 } as const;
/** Share of the board ink a non-data glow line may emit (WAVE-PLAN 2F). */
export const GLOW_UNDER_INK = 0.6;

/**
 * The ring's gold inlay, budgeted (fidelity wave 2, 2F; audit issue 16 —
 * "the white ribbon and rings are the brightest pixels in the frame", CD).
 * Authored 2.6 at night (≈ 1.35 linear luminance, over the plaque's paper
 * white and blooming around the rules text); now ≤ 0.6 × the plaque ink.
 * The inlay's albedo is toned too (metalness 0.3 → 0.1, rougher), so the
 * day key no longer strikes a specular line brighter than the plaque.
 */
export function inlayEmissive(accent: string, night: boolean): number {
  const authored = night ? 2.6 : 0.5;
  const ink = night ? PLAQUE_EMISSION.night : PLAQUE_EMISSION.day;
  return Math.min(authored, emissiveUnderInk(accent, PLAQUE_INK, ink, GLOW_UNDER_INK));
}

export default function SkyGate() {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;
  const { formatRules, rulesetName, league, stages } = useRouteData<CloudsRouteData>();
  // The format decides the rows (EPB draft numbers, else format and best-of);
  // primitives as deps so the plaque repaints only when they change.
  const { format, bestOf } = rulesCopyContext({ league, stages });
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);

  const copy = useMemo(
    () => gatePlaqueCopy(formatRules, rulesetName, { format, bestOf }, locale),
    [formatRules, rulesetName, format, bestOf, locale],
  );
  const colors = useMemo(
    () => ({ ground: palette.boardField, accent: palette.boardAccent, ink: PLAQUE_INK }),
    [palette],
  );
  const paint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintGatePlaque(ctx, w, h, copy, colors, tools, locale),
    [copy, colors, locale],
  );
  // C-105 r1: the gate plaque is a board page — shared paint path (rules
  // station, 5.6 m board face).
  const plaque = usePaintedBoardTexture(paint, PLAQUE_TEX_W, PLAQUE_TEX_H, CLOUDS_STATIONS[4], HALO_GATE.faceW);
  // Fidelity wave 2 (2F): standby dim — uniforms exist before the plaque's first compile.
  const standby = useStandbyDim({ surfaces: CLOUDS_DATA_SURFACES, subjectId: 'rules:gate', faceIds: RULES_FACE_IDS });

  const { ring, face } = HALO_GATE;
  const isleTop = ISLES.rules.top;
  const hangerTop = ring.y - HALO_GATE.ringRadius + 0.3;
  const plaqueTop = face.y + HALO_GATE.faceH / 2;
  const hangerLength = Math.max(0.1, plaqueTop - hangerTop);

  return (
    <FocusSubject
      id="rules:gate"
      kind="rules"
      label={t('subjects.clouds.rules')}
      facing={GATE_FACING}
      panel={GATE_RULES_PANEL}
      bounds={GATE_BOUNDS}
    >
      <group>
        {/* Pier under the ring's foot. */}
        <mesh position={[HALO_GATE.pier.x, isleTop + HALO_GATE.pier.h / 2, HALO_GATE.pier.z]} castShadow receiveShadow>
          <boxGeometry args={[HALO_GATE.pier.w, HALO_GATE.pier.h, HALO_GATE.pier.d]} />
          <meshStandardMaterial color={palette.stoneColor} roughness={0.92} metalness={0.02} />
        </mesh>

        {/* The ring — standing in the vertical plane facing north. */}
        <mesh position={[ring.x, ring.y, ring.z]} castShadow>
          <torusGeometry args={[HALO_GATE.ringRadius, HALO_GATE.ringTube, 10, 44]} />
          <meshStandardMaterial color={palette.rockColor} roughness={0.88} metalness={0.03} flatShading />
        </mesh>
        {/* A sun-gold inlay band circling the ring's crown — the landmark's glow line. */}
        <mesh position={[ring.x, ring.y, ring.z]} rotation={[0, 0, 0]}>
          <torusGeometry args={[HALO_GATE.ringRadius + 0.02, 0.1, 6, 44]} />
          <meshStandardMaterial
            color={palette.boardAccent}
            emissive={palette.boardAccent}
            emissiveIntensity={inlayEmissive(palette.boardAccent, night)}
            roughness={0.62}
            metalness={0.1}
          />
        </mesh>

        {/* Hangers from the ring's inner crown down to the plaque — hung just
            BEHIND the face plane so the rods read above the plaque's top edge
            without crossing its text (C-104: the rods used to render in the
            face's own plane, crossing the tracked masthead). */}
        {([-0.9, 0.9] as const).map((dx) => (
          <mesh key={dx} position={[face.x + dx, hangerTop + hangerLength / 2, face.z + 0.035]}>
            <cylinderGeometry args={[0.03, 0.03, hangerLength, 6]} />
            <meshStandardMaterial color={palette.sailTrim} roughness={0.5} metalness={0.3} />
          </mesh>
        ))}

        {/* The rules plaque, hung at the authored #rules target, facing north. */}
        {plaque ? (
          <mesh position={[face.x, face.y, face.z]} rotation={[0, HALO_GATE.faceYaw, 0]} renderOrder={2}>
            <planeGeometry args={[HALO_GATE.faceW, HALO_GATE.faceH]} />
            {/* Fidelity W1 r5: the self-lit data-face lever (SummitCairn /
                FestivalBanners). At roughness 0.32 the pool light 1.6 m in
                front of the face centre painted a warm hotspot behind the
                "Lines per trainer" value, and the 1.9 night emission (tone
                mapping off) crossed BLOOM_THRESHOLD 1.7 into glyph halos.
                Base colour black, envMapIntensity 0, roughness 1 and an
                emission ≤ 1.0 leave the plaque at its painted values. */}
            <meshStandardMaterial
              map={plaque}
              color="#000000"
              emissiveMap={plaque}
              emissive="#ffffff"
              emissiveIntensity={night ? PLAQUE_EMISSION.night : PLAQUE_EMISSION.day}
              roughness={1}
              metalness={0}
              ref={bindEnv}
              envMapIntensity={0}
              toneMapped={false}
              // Fidelity wave 2 (2F): data faces take no scene fog (the one
              // self-lit face that still did).
              fog={false}
              {...standby.materialProps}
            />
          </mesh>
        ) : null}
        {/* Bezel behind the plaque (south side — hidden from the camera). */}
        <mesh position={[face.x, face.y, face.z + 0.06]}>
          <boxGeometry args={[HALO_GATE.faceW + 0.4, HALO_GATE.faceH + 0.4, 0.1]} />
          <meshStandardMaterial color={palette.timberColor} roughness={0.74} metalness={0.06} />
        </mesh>

        {/* A soft pool of the plaque's own light on the isle at night.
            Fidelity W1 r5: moved off the face rect — it sat 1.6 m in front
            of the plaque CENTRE (a warm blob behind the rules values); now
            it hangs just above the isle floor, below the plaque's bottom
            edge, so it still pools on the deck and pier. */}
        <pointLight
          position={[face.x, isleTop + 0.5, face.z - 2.2]}
          color={palette.boardAccent}
          intensity={night ? 6 : 1.0}
          distance={10}
          decay={2}
          castShadow={false}
        />
      </group>
    </FocusSubject>
  );
}
