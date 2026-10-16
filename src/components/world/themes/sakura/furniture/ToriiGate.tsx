'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useSakuraPalette } from '../use-sakura-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintPlaque, plaqueCopy, PLAQUE_TEX_H, PLAQUE_TEX_W } from '../content/paint';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import { SAKURA_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { SakuraRouteData } from '../types';
import { TORII } from './layout';
import { useStandbyDim } from '@/components/world/route/useStandbyDim';
import { SAKURA_DATA_SURFACES } from './data-faces';

/**
 * The #rules hero: a great vermilion torii at the park's south entrance,
 * facing the station camera (north). Procedural: two tapered pillars, the
 * nuki tie beam, an upswept kasagi top beam with its black shimaki, and a
 * hanging gakuzuka plaque painted with the ruleset of record — the
 * contract's stage-fallback-aware `rulesetName` plus headline rules shaped
 * by `plaqueCopy`.
 *
 * C-102: the sandō's mid-ground practicals are now the C-107 GLB
 * `sakura-stone-lantern-tall` pair on the same sites (PropMounts, over
 * TORII.approachLantern) — the procedural pair this component used to mount
 * there is retired with them.
 */

/** Pillar centres, gate-local metres. */
const HALF_SPAN = TORII.span / 2;

/**
 * The gakuzuka tablet, in gate-local metres. One source for both the mesh and
 * the focus proxy, so the camera can never frame a box the paint moved out of.
 */
const TABLET = {
  w: 2.6,
  h: 2.95,
  d: 0.1,
  y: TORII.height * 0.62 - 1.65,
  z: 0.3,
} as const;

/**
 * Hand-authored world AABB of the tablet alone (the plaza Board / clouds
 * SkyGate discipline): auto-measure would swallow the 7.2 m span, both
 * pillars and the kasagi, and the focus camera would stand far too deep to
 * read the rules rows at the 117 px painter floor.
 */
const TABLET_BOUNDS: SubjectBounds = {
  min: [TORII.x - TABLET.w / 2 - 0.1, TABLET.y - TABLET.h / 2 - 0.1, TORII.z + TABLET.z - TABLET.d / 2 - 0.15],
  max: [TORII.x + TABLET.w / 2 + 0.1, TABLET.y + TABLET.h / 2 + 0.1, TORII.z + TABLET.z + TABLET.d / 2 + 0.1],
};

/** The tablet's painted face looks north, down the sandō, at the rules station. */
const TABLET_FACING: Vec3Tuple = [0, 0, 1];

/** The only rules value the overlay map answers (ThemeOverlays RULE_VALUES). */
const GATE_RULES_PANEL: SubjectPanel = { param: 'rules', value: 'gate' };

/** The tablet's data-face id (data-faces.ts) — the standby dim's key. */
const RULES_FACE_IDS = ['rules:tablet'] as const;
/**
 * Wave-2 r3 (LUMA, W1 "sakura-light rules face P99 202.6 vs 202.9"): the
 * tablet's day emission 0.35 → 0.42 so the paper out-reads the light sky by
 * a margin, not a rounding error. Night keeps 0.9.
 */
const TABLET_EMISSIVE_DAY = 0.42;
const TABLET_EMISSIVE_NIGHT = 0.9;

export default function ToriiGate() {
  const palette = useSakuraPalette();
  const night = palette.exposure < 0.75;
  const { formatRules, rulesetName, league, stages } = useRouteData<SakuraRouteData>();
  // The format decides the rows (EPB draft numbers, else format and best-of);
  // primitives as deps so the plaque repaints only when they change.
  const { format, bestOf } = rulesCopyContext({ league, stages });
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);

  const copy = useMemo(
    () => plaqueCopy(formatRules, rulesetName, { format, bestOf }, locale),
    [formatRules, rulesetName, format, bestOf, locale],
  );
  const paint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      // Light tablet ground like the festival banners (dark plum ink on warm
      // paper): the near-black ground first tried here read as a void at the
      // 21 m rules pose (C-093 r1 capture fix).
      paintPlaque(ctx, w, h, copy, { ground: '#f6eadf', ink: '#3a2333', accent: palette.toriiRed }, tools, locale),
    [copy, palette.toriiRed, locale],
  );
  // C-105 r1: the gakuzuka face is a board page — shared paint path (rules
  // station tablet face; C-102 r3 widened 1.4 → 1.9 m with the canvas; C-106
  // r3 widened to 2.6 m with the canvas — see the mesh note).
  const plaque = usePaintedBoardTexture(paint, PLAQUE_TEX_W, PLAQUE_TEX_H, SAKURA_STATIONS[4], TABLET.w);

  const red = palette.toriiRed;
  // Wave-2 r3 (LUMA): the tablet stands by away from the rules station.
  const standby = useStandbyDim({ surfaces: SAKURA_DATA_SURFACES, subjectId: 'rules:gate', faceIds: RULES_FACE_IDS });

  return (
    <FocusSubject
      id="rules:gate"
      kind="rules"
      label={t('subjects.sakura.rules')}
      facing={TABLET_FACING}
      panel={GATE_RULES_PANEL}
      bounds={TABLET_BOUNDS}
    >
      <group position={[TORII.x, 0, TORII.z]}>
        {/* Pillars: tapered cylinders, sunk and slightly splayed. */}
        {([-1, 1] as const).map((side) => (
          <group key={side} position={[side * HALF_SPAN, 0, 0]} rotation={[0, 0, side * -0.012]}>
            <mesh position={[0, TORII.height * 0.42, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.34, 0.44, TORII.height * 0.84, 12]} />
              <meshStandardMaterial color={red} roughness={0.62} metalness={0.05} />
            </mesh>
            {/* Stone base collar. */}
            <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.5, 0.56, 0.44, 12]} />
              <meshStandardMaterial color={palette.lanternStone} roughness={0.9} metalness={0.02} />
            </mesh>
          </group>
        ))}
        {/* Nuki tie beam through both pillars. */}
        <mesh position={[0, TORII.height * 0.62, 0]} castShadow>
          <boxGeometry args={[TORII.span + 1.1, 0.42, 0.5]} />
          <meshStandardMaterial color={red} roughness={0.62} metalness={0.05} />
        </mesh>
        {/* Gakuzuka (hanging plaque) between the beams — one tablet box, the
            painted rules face toward the north station camera. The box itself
            carries the paint (no separate face plane): cream fallback while (or
            if) the paint uploads, so the gate never shows a black void.
            C-102 r3: 1.4 → 1.9 m wide, height 1.95 and placement kept — the
            floor-width law's lever. At 1.4 m the measured "STANDARD"
            ruleset line (670 px at the 117 px rules floor) ran 142 px past the
            painter width and into the plaque border ("STANDARO…"). The wider
            tablet carries a proportionally wider canvas (640 → 872 declared),
            which keeps the derived floor at 117 (floorPaint ∝ declaredW/worldW)
            and gives the line 760 px of painter width — "STANDARD" and the
            title's "THE PARK" now wrap whole. Nothing sub-floor ships — the
            clamp still enforces the derived floor by construction.
            C-106 r3: 1.9×1.95 → 2.6×2.95 m (canvas 872×896 → 1193×1355, both
            axes proportional, floor still 117) — the compact rules summary
            needs vertical area BELOW the title block, which the old face did
            not have (the r2 chief's title-only finding). Top edge anchored at
            the old top (TORII.height·0.62 − 0.175); the bottom now clears the
            sandō path at 0.84 m. */}
        <mesh position={[0, TABLET.y, TABLET.z]} castShadow receiveShadow>
          <boxGeometry args={[TABLET.w, TABLET.h, TABLET.d]} />
          <meshStandardMaterial
            map={plaque}
            emissiveMap={plaque}
            emissive="#ffffff"
            emissiveIntensity={night ? TABLET_EMISSIVE_NIGHT : TABLET_EMISSIVE_DAY}
            color={plaque ? '#ffffff' : '#f6eadf'}
            roughness={0.5}
            metalness={0.08}
            toneMapped={false}
            fog={false}
            {...standby.materialProps}
          />
        </mesh>
        {/* Kasagi top beam: the main member, slightly wider, with the black
            shimaki above and a subtle upward sweep at the ends. */}
        <mesh position={[0, TORII.height - 0.35, 0]} castShadow>
          <boxGeometry args={[TORII.span + 2.0, 0.44, 0.62]} />
          <meshStandardMaterial color={red} roughness={0.6} metalness={0.05} />
        </mesh>
        <mesh position={[0, TORII.height - 0.02, 0]} castShadow>
          <boxGeometry args={[TORII.span + 2.35, 0.26, 0.72]} />
          <meshStandardMaterial color="#2e2620" roughness={0.72} metalness={0.03} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh
            key={side}
            position={[side * (TORII.span / 2 + 0.85), TORII.height - 0.16, 0]}
            rotation={[0, 0, side * 0.1]}
            castShadow
          >
            <boxGeometry args={[1.1, 0.3, 0.66]} />
            <meshStandardMaterial color="#2e2620" roughness={0.72} metalness={0.03} />
          </mesh>
        ))}
        {/* Warm up-light so the vermilion reads after sunset. */}
        <pointLight
          position={[0, 1.2, 2.2]}
          color={palette.lanternGlow}
          intensity={night ? 16 : 1.6}
          distance={13}
          decay={2}
          castShadow={false}
        />
      </group>
    </FocusSubject>
  );
}
