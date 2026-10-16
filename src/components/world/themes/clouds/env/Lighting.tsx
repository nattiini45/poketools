'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useCloudsPalette } from '../use-clouds-palette';
import type { CloudsWorldPalette } from '../theme-palette';
import { cloudsTheme } from '../theme';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import { stationCrossfade, type StationCrossfade } from '@/lib/route-world/camera-path';

/**
 * The isles' light: one crisp directional key from the east-south-east (the
 * clouds theme's `lights.keyDirection`), a hemisphere fill borrowing the sky
 * and meadow colors, and the HDRI environment (`WorldEnvironment`) for PBR
 * response. The mood is a deliberate per-world color story (criterion 10b):
 * DAY is high thin-air sunlight — a high, near-vertical key seat (the sun of
 * an altitude) with a warm gold lerp so the isle tops and cloud crests read
 * sun-struck; NIGHT is luminous dusk — the key drops to a cool moon seat and
 * the practicals (lanterns, bridges, billboards) carry the scene. The
 * west-facing roster sail and east-facing aces row take per-station day-key
 * overrides (the mountain DAY_STATION_KEYS pattern): the shared ESE seat
 * grazes both fronts, so each override re-sites the key onto the station's
 * own front-right diagonal. Night never consults the table — the dusk rig's
 * literals are the verified look.
 */
const KEY_INTENSITY = 3.0;
const FILL_INTENSITY = 0.42;

/** Day-only key seat: the ESE azimuth of `keyDirection` scaled 1.4 like
 * `keyPosition`, high thin-air elevation. Night keeps
 * `lights.keyPosition` verbatim. */
const DAY_KEY_POSITION: Vec3Tuple = [18 * 1.4, 16 * 1.15, 8 * 1.4];

/** Day-only key intensity: the high sun of an altitude, bright but not
 * washed (the cloud sea already reads near-white — calibrate by bracketing
 * high-then-midpoint per the convex day-key law). */
const DAY_KEY_INTENSITY = 6.4;

/** Day warmth: the key lerps this far toward sun-gold. */
const KEY_WARM_TONE = '#ffe2b0';
const KEY_WARM_LERP = 0.5;

/**
 * Per-station day-key overrides (day branch only): roster's sail faces east
 * and teams' float row faces west, so the shared ESE seat grazed both
 * fronts; each override re-sites the key onto the station's own front-right
 * diagonal (≈ 14° elevation — long shadows falling away from the camera),
 * warms the lerp and keeps the spread intensity. Stations without an entry
 * (pulse/schedule/rules) run the shared day rig unchanged. Night never
 * consults this table.
 */
const DAY_STATION_KEYS: Record<string, { position: Vec3Tuple; intensity: number; warmLerp: number }> = {
  roster: { position: [14, 5.0, 13], intensity: 6.4, warmLerp: 0.7 },
  teams: { position: [-14, 5.0, 13], intensity: 6.4, warmLerp: 0.7 },
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
      float core = exp(-r * r * 11.0);
      float halo = exp(-r * r * 3.4);
      float a = (core * 0.5 + halo * 0.4) * uGain;
      gl_FragColor = vec4(uColor * (0.35 + a * 0.6), clamp(a, 0.0, 1.0));
      return;
    }

    // Dusk moon: a crisp disc edge with a cool veil — weights kept below 1
    // so the disc never flattens into a circular 255 plateau.
    float core = exp(-r * r * 720.0);
    float inner = exp(-r * r * 58.0);
    float annulus = smoothstep(0.32, 0.44, r) * (1.0 - smoothstep(0.44, 0.57, r));
    float halo = exp(-r * r * 7.5);
    float a = (inner * 1.2 + annulus * 0.8 + halo * 0.1) * uGain;
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
  palette: CloudsWorldPalette;
  position: Vec3Tuple;
}) {
  const color = night ? palette.moonColor : palette.sunColor;
  const haloSize = night ? 1.5 : 0.9;
  const haloRef = useRef<THREE.Mesh>(null);

  const haloMat = useMemo(() => {
    const body = night ? palette.moonColor : palette.sunColor;
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(body) },
        uGain: { value: night ? 1.1 : 0.84 },
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
          reads around it (the starfield sky carries the dusk mood). */}
      <mesh renderOrder={3}>
        <sphereGeometry args={[night ? 0.16 : 0.11, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
      <mesh ref={haloRef} renderOrder={2} material={haloMat}>
        <planeGeometry args={[haloSize, haloSize]} />
      </mesh>
      <pointLight color={color} intensity={night ? 3.2 : 2.0} distance={18} decay={2} />
    </group>
  );
}

export default function Lighting() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = useCloudsPalette();
  const quality = useQuality();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.HemisphereLight>(null);
  const night = palette.exposure < 0.75;
  const day = !night;
  // Belt and braces: the clouds root always provides the theme; this
  // definition is the fallback of record if this ever mounts without one.
  const lights = (theme ?? cloudsTheme).lights;
  // Day key warms toward sun-gold and runs the high-seat intensity; night
  // keeps the cool moon key token and 3.0 verbatim (a rig-side mix only,
  // day-branch only).
  const keyColor = useMemo(
    () =>
      new THREE.Color(palette.keyLight).lerp(
        new THREE.Color(KEY_WARM_TONE),
        night ? 0 : KEY_WARM_LERP,
      ),
    [palette.keyLight, night],
  );
  const keyIntensity = day ? DAY_KEY_INTENSITY : KEY_INTENSITY;
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
  /** Station ids in route order (fallback of record: clouds). */
  const stationIds = useMemo(
    () => (theme ?? cloudsTheme).stations.map((station) => station.id),
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
        // One stabilized frustum over the whole chain — following the camera
        // would shimmer or cost a cascade.
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
      >
        <object3D attach="target" position={[0, 0, 0]} />
      </directionalLight>
    </>
  );
}
