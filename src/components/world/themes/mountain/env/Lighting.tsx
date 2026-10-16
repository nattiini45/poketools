'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useMountainPalette } from '../use-mountain-palette';
import type { MountainWorldPalette } from '../theme-palette';
import { mountainTheme } from '../theme';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import { stationCrossfade, type StationCrossfade } from '@/lib/route-world/camera-path';

/**
 * The valley's light: one crisp directional key from the south-south-east
 * (the mountain theme's `lights.keyDirection`), a hemisphere fill borrowing
 * the sky and meadow colors, and the HDRI environment (`WorldEnvironment`)
 * for PBR response. By day the key drops to a low raking seat and warms
 * toward lantern-gold (DAY_KEY_POSITION / DAY_KEY_INTENSITY / KEY_WARM_TONE
 * — r3 tuning, r4 spread, r5 per-station table): the r4 pass lifted the day
 * seat toward the disc and raised intensity/warm so lit/shade faces
 * differentiate at the flat stations; the r5 table re-sited roster/teams
 * onto their own front diagonals; the C-103 r2 round tunes roster further
 * and adds schedule + rules (the three light cells the C-103 r1 visual review
 * measured washing), pulse keeping its r4-calibrated raking model. The day
 * seat keeps the sky body's azimuth at the shared stations, so shadows
 * agree with the disc in direction. At night the verified SSE rig is
 * untouched — position, color and intensity all keep the verified literals
 * (the dark rules moon-rim framing depends on it). The key sinks toward the
 * pass the way a mountain afternoon does; the route takes time, not five
 * rooms at one hour.
 */
const KEY_INTENSITY = 3.2;
const FILL_INTENSITY = 0.38;

/**
 * Day-only key seat: the SSE azimuth of `keyDirection` ([7, ·, 20]) scaled
 * 1.4 like `keyPosition`, elevation ≈ 10.0° (r4: y 2.6 → 5.2 — the r3 6.9°
 * raking seat read flat at roster/teams/schedule; the lift puts the seat
 * within ≈ 4° of the disc while keeping afternoon-long shadows and the
 * crag's raking model). Night keeps `lights.keyPosition` verbatim (the
 * verified moon-rim rig).
 */
const DAY_KEY_POSITION: Vec3Tuple = [7 * 1.4, 5.2, 20 * 1.4];

/**
 * Day-only key intensity (r4 spread): the shared 3.2 left the flat
 * stations' grazing faces ~2:1 over the hemisphere fill, which AgX
 * tone-maps to milk. Calibration captures (c094r4-spot/spot2/spot5/brute
 * raws): 4.5 never separated the flat stations, 8.5 separated them but
 * washed the pulse board's face — 6.2 is the midpoint that keeps the
 * summit's read intact. Night keeps KEY_INTENSITY verbatim.
 */
const DAY_KEY_INTENSITY = 6.2;

/** Day warmth: the key lerps this far toward lantern-gold (the valley's own warm literal). */
const KEY_WARM_TONE = '#ffd9a0';
/** R4 spread: 0.35 → 0.62 — the warm read must survive AgX at the flat stations. */
const KEY_WARM_LERP = 0.62;

/**
 * Per-station day-key overrides (r5, sanctioned by the r4 visual review co-finding
 * after two global-rig attempts left roster/teams non-directional; C-103 r2
 * extends the table to the three light cells the r1 visual review measured washing —
 * roster/schedule/rules — while pulse keeps its r4-calibrated raking model
 * and teams its credited r5 seat): a station-indexed DAY-BRANCH-ONLY
 * override of the key seat, intensity and warm lerp.
 *
 *  - roster (C-103 r2 tune): [14, 4.6, 13] → [14, 6, 13] — elevation
 *    13.5° → 17.4° so the meadow's horizontal faces take ≈ 0.30 of the key
 *    (was 0.23) and the east-facing frieze front keeps ≈ 0.69; intensity
 *    6.2 → 7.6, warm 0.78 → 0.8.
 *  - schedule (C-103 r2 new): [10, 8.7, 20] — south-east key at 21.3° that
 *    still fronts the yawed sign cloths (cos ≈ 0.60 on their south-west
 *    normals) while the higher seat lights the sign-meadow ground (≈ 0.36)
 *    and throws the north-east tree line's shadows INTO the frame;
 *    intensity 7.2, warm 0.78.
 *  - rules (C-103 r2 new): [8, 10, 26] — 20.2° southern seat: the gate's
 *    north faces were NEVER key-lit (any southern seat back-lights them at
 *    cos ≈ −0.9), so the pass warms and brightens the forecourt ground
 *    (≈ 0.35 of a stronger 8.8 key) and throws the gate/pillar/tree shadows
 *    north toward the camera — lit/shade separation around the hero without
 *    moving the hero's own (fill+HDRI) luminance. Warm 0.78.
 *
 * Stations without an entry (pulse/teams) run their credited rigs
 * unchanged. Night never consults this table: the verified moon-rim rig
 * (`lights.keyPosition` / KEY_INTENSITY / palette keyColor) stays verbatim.
 *
 * Disclosure: at the overridden stations the day key's azimuth leaves the
 * visible disc's axis where a station frames the disc out (roster/schedule
 * do; rules frames the disc IN — its on-screen shadows already fell north
 * under the shared seat and keep that direction, only their contrast
 * deepens, so no shadow newly contradicts the visible sun).
 */
const DAY_STATION_KEYS: Record<string, { position: Vec3Tuple; intensity: number; warmLerp: number }> = {
  roster: { position: [14, 6, 13], intensity: 7.6, warmLerp: 0.8 },
  teams: { position: [-14, 4.6, 13], intensity: 6.2, warmLerp: 0.78 },
  schedule: { position: [10, 8.7, 20], intensity: 7.2, warmLerp: 0.78 },
  rules: { position: [8, 10, 26], intensity: 8.8, warmLerp: 0.78 },
};

const HALO_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uNight;
  varying vec2 vUv;

  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;

    if (uNight < 0.5) {
      // High-altitude sun through thin air: a wide soft corona, no hot core.
      float core = exp(-r * r * 10.0);
      float halo = exp(-r * r * 3.0);
      float a = (core * 0.55 + halo * 0.42) * uGain;
      gl_FragColor = vec4(uColor * (0.35 + a * 0.6), clamp(a, 0.0, 1.0));
      return;
    }

    // Moon rim: a crisp disc edge with a cool veil — weights kept below 1 so
    // the disc never flattens into a circular 255 plateau. The rim is the
    // signature: core stays a step inside 1.0 and a tight annulus carries it.
    float core = exp(-r * r * 760.0);
    float inner = exp(-r * r * 60.0);
    float annulus = smoothstep(0.30, 0.42, r) * (1.0 - smoothstep(0.42, 0.55, r));
    float halo = exp(-r * r * 7.0);
    float a = (inner * 1.25 + annulus * 0.85 + halo * 0.10) * uGain;
    vec3 col = mix(uColor, vec3(1.0), inner);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

function SkyBody({
  night,
  palette,
  position,
}: {
  night: boolean;
  palette: MountainWorldPalette;
  position: Vec3Tuple;
}) {
  const color = night ? palette.moonColor : palette.sunColor;
  const haloSize = night ? 1.5 : 0.86;
  const haloRef = useRef<THREE.Mesh>(null);

  const haloMat = useMemo(() => {
    const body = night ? palette.moonColor : palette.sunColor;
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(body) },
        uGain: { value: night ? 1.12 : 0.86 },
        uNight: { value: night ? 1 : 0 },
      },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      side: THREE.DoubleSide,
    });
  }, [night, palette]);

  useEffect(
    () => () => {
      haloMat.dispose();
    },
    [haloMat],
  );

  useFrame(({ camera }) => {
    haloRef.current?.lookAt(camera.position);
  });

  return (
    <group position={position}>
      {/* The visible disc day and night — at night the halo's rim annulus
          reads around it (the starfield sky carries the moon-rim look). */}
      <mesh renderOrder={3}>
        <sphereGeometry args={[night ? 0.16 : 0.11, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
      <mesh ref={haloRef} renderOrder={2} material={haloMat}>
        <planeGeometry args={[haloSize, haloSize]} />
      </mesh>
      <pointLight color={color} intensity={night ? 3.4 : 2.0} distance={18} decay={2} />
    </group>
  );
}

export default function Lighting() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = useMountainPalette();
  const quality = useQuality();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.HemisphereLight>(null);
  const night = palette.exposure < 0.75;
  const day = !night;
  // Belt and braces: the mountain root always provides the theme; this
  // definition is the fallback of record if this ever mounts without one.
  const lights = (theme ?? mountainTheme).lights;
  // Day key warms toward lantern-gold and runs the spread intensity; night
  // keeps the verified cool moon key token and 3.2 verbatim (no palette
  // change — a rig-side mix only, day-branch only).
  const keyColor = useMemo(
    () =>
      new THREE.Color(palette.keyLight).lerp(
        new THREE.Color(KEY_WARM_TONE),
        night ? 0 : KEY_WARM_LERP,
      ),
    [palette.keyLight, night],
  );
  const keyIntensity = day ? DAY_KEY_INTENSITY : KEY_INTENSITY;
  // Per-station day-key warm colors, precomputed off the same palette key
  // (the palette.keyLight branch itself is untouched — these are rig-side
  // day mixes only). Empty until first render needs them.
  const stationKeyColors = useMemo(() => {
    const warm = new THREE.Color(KEY_WARM_TONE);
    const map = new Map<string, THREE.Color>();
    for (const [id, override] of Object.entries(DAY_STATION_KEYS)) {
      map.set(
        id,
        new THREE.Color(palette.keyLight).lerp(warm, day ? override.warmLerp : 0),
      );
    }
    return map;
  }, [palette.keyLight, day]);
  /** Station ids in route order (fallback of record: mountain). */
  const stationIds = useMemo(
    () => (theme ?? mountainTheme).stations.map((station) => station.id),
    [theme],
  );
  // Per-frame scratch for the station-key crossfade — the frame loop must
  // not allocate.
  const keyBlend = useMemo(
    () => ({
      fade: { lower: 0, upper: 0, weight: 0 } as StationCrossfade,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      color: new THREE.Color(),
    }),
    [],
  );

  useFrame(() => {
    const progress = conductor.progress.current;
    const world = sampleWorldState(progress.smooth);
    if (keyRef.current) {
      // Per-station day-key: resolved per frame off the conductor ref (the
      // context value is stable across station changes, so a React
      // re-render cannot be relied on here). Day branch only — the night
      // position/intensity/color literals are never touched.
      let intensity = keyIntensity;
      let color = keyColor;
      if (day) {
        // W6: CROSSFADE between the two stations' keys on `smooth` — the
        // camera's own channel — instead of snapping at round(exact), which
        // jumped the seat (and every shadow) before the view had even
        // turned and flickered on noise around x.5. Within 0.2 station of
        // each integer the station's own key stands unblended, so every
        // frozen-pose capture sees exactly the tuned seat, as before.
        const fade = stationCrossfade(progress.smooth, stationIds.length, keyBlend.fade);
        const lowerId = stationIds[fade.lower] ?? '';
        const upperId = stationIds[fade.upper] ?? '';
        const lower = DAY_STATION_KEYS[lowerId];
        const upper = DAY_STATION_KEYS[upperId];
        // Position is re-asserted EVERY frame in the day branch: the
        // declarative prop only applies on re-render, and the context value
        // is stable across station changes — without this the last
        // override's seat would stick on the shared stations.
        keyBlend.from.set(...(lower?.position ?? DAY_KEY_POSITION));
        keyBlend.to.set(...(upper?.position ?? DAY_KEY_POSITION));
        keyRef.current.position.lerpVectors(keyBlend.from, keyBlend.to, fade.weight);
        const lowerIntensity = lower?.intensity ?? keyIntensity;
        const upperIntensity = upper?.intensity ?? keyIntensity;
        intensity = lowerIntensity + (upperIntensity - lowerIntensity) * fade.weight;
        const lowerColor = lower ? (stationKeyColors.get(lowerId) ?? keyColor) : keyColor;
        const upperColor = upper ? (stationKeyColors.get(upperId) ?? keyColor) : keyColor;
        color = keyBlend.color.copy(lowerColor).lerp(upperColor, fade.weight);
      }
      if (color) keyRef.current.color.copy(color);
      keyRef.current.intensity = intensity * world.key * palette.exposure;
    }
    if (fillRef.current) {
      fillRef.current.intensity = (FILL_INTENSITY + 0.12 * world.key) * palette.exposure;
    }
  });

  const shadows = quality.shadowedLights > 0 && quality.shadowMapSize > 0;

  return (
    <>
      <SkyBody night={night} palette={palette} position={lights.skyBodyPosition} />
      <hemisphereLight
        ref={fillRef}
        args={[palette.skyLight, palette.bounce, FILL_INTENSITY]}
        position={[0, 30, 0]}
      />
      <directionalLight
        ref={keyRef}
        position={day ? DAY_KEY_POSITION : [...lights.keyPosition]}
        intensity={keyIntensity}
        color={keyColor}
        castShadow={shadows}
        shadow-mapSize-width={quality.shadowMapSize || 512}
        shadow-mapSize-height={quality.shadowMapSize || 512}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        // One stabilized frustum over the valley floor plus the knoll —
        // following the camera would shimmer or cost a cascade.
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
      >
        <object3D attach="target" position={[0, 0, 0]} />
      </directionalLight>
    </>
  );
}
