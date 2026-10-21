/**
 * The bounded-water shader pair (see `BoundedWater.tsx` for what it does and
 * its disclosed optical limits). Plain strings, no three.js import, so the
 * sources can be assembled and inspected outside a renderer. `chunk` is
 * `emitGlsl(spec)` from `@/lib/route-world/water` — the body constants and
 * the field functions shared with the CPU sampler.
 */

/** Practical-light slots (night glitter streaks). */
export const MAX_PRACTICALS = 2;

export const WATER_VERTEX = (chunk: string) => /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${chunk}
uniform float uTime;
varying vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float h; vec2 g; float crest; float foam; float sd;
  waterField(world.xz, uTime, h, g, crest, foam, sd);
  world.y += h;
  vWorldPos = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const WATER_FRAGMENT = (chunk: string) => /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${chunk}
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uAbsorb;
uniform vec3 uFoam;
uniform vec3 uShore;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform vec3 uSmear;
uniform vec2 uSmearDir;
uniform float uSmearGain;
uniform vec4 uPracticals[${MAX_PRACTICALS}];
uniform vec3 uPracticalColor;
uniform float uPetals;
uniform vec3 uPetalColor;
uniform float uCapillary;
uniform float uMacro;
uniform float uDebug;
varying vec3 vWorldPos;

float wHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 p = vWorldPos.xz;
  float h; vec2 g; float crest; float rippleFoam; float sd;
  waterField(p, uTime, h, g, crest, rippleFoam, sd);
  float depth = waterDepth(sd);
  float fade = smoothstep(0.0, WATER_SHORE_BAND_M, sd);
  // The analytic field slope (bands + ripples + ambient), before the
  // fragment-only detail layers — the normals debug view splits it.
  vec2 gField = g;

  // Capillary layer: GPU-only slope detail in world metres (isotropic on
  // any ellipse), softened inside the shore band.
  if (uCapillary > 0.5) {
    vec2 q = p / WATER_CAPILLARY_SCALE;
    float n1 = wNoise(q + vec2(uTime * 0.35, uTime * 0.22));
    float n2 = wNoise(q * 2.13 - vec2(uTime * 0.41, uTime * 0.3));
    g += (vec2(n1, n2) - 0.5) * 2.0 * WATER_CAPILLARY_STRENGTH * (0.35 + 0.65 * fade);
  }

  // Macro layer (waterDetail >= 1, W3 r2): one slow, large-cell noise
  // octave on the slope, so the analytic sky reflection breaks into broad
  // light/dark patches even with the capillary layer and post both off.
  // Fragment-only like the capillary layer (not part of sampleWater).
  if (uMacro > 0.5) {
    vec2 mq = p / 2.4;
    float m1 = wNoise(mq + vec2(uTime * 0.05, uTime * 0.031));
    float m2 = wNoise(mq * 1.37 + vec2(-uTime * 0.037, uTime * 0.046) + 17.3);
    g += (vec2(m1, m2) - 0.5) * 0.14 * fade;
  }

  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  // View-grazing ramp from the FLAT surface (v.y = sine of the view's
  // depression angle), so it runs near → far across every station framing
  // regardless of the wave normal: ~0 where the camera looks steeply down
  // (the near water), 1 at the grazing far water.
  float graze = 1.0 - smoothstep(0.15, 0.55, v.y);
  // Stylised Fresnel: a physical Schlick (F0 = 0.02) would leave a park pond
  // near-black from the station cameras' 20–35° view. r2: a lower floor
  // plus the grazing ramp, so the near half reads as body (absorb) and the
  // far half picks up a clearly lighter, sky-tinted band — the base read
  // that carries the water with post and every detail layer off.
  float fresnel = clamp(0.06 + 0.6 * pow(1.0 - ndv, 3.0) + 0.22 * graze, 0.0, 0.78);

  // Body colour by optical path length through the analytic bowl
  // (HEURISTIC refraction: no refracted scene sample).
  float path = depth / max(ndv, 0.25);
  float tAbs = 1.0 - exp(-path * (2.2 / max(WATER_DEPTH_M, 0.05)));
  vec3 body = tAbs < 0.5
    ? mix(uShallow, uAbsorb, tAbs * 2.0)
    : mix(uAbsorb, uDeep, tAbs * 2.0 - 1.0);
  // Near water darkens toward the absorb body (up to 16 %): with the
  // grazing Fresnel above, the value runs dark-near → light-far.
  body *= mix(0.84, 1.0, graze);

  // Bounded caustic band just inside the shore (heuristic, sun-driven,
  // faded at night): two drifting noise fields' difference ridges.
  float band = smoothstep(0.15, 0.6, sd) * (1.0 - smoothstep(0.9, 2.4, sd));
  vec2 cq = p * 2.6;
  float c1 = wNoise(cq + vec2(uTime * 0.23, -uTime * 0.17));
  float c2 = wNoise(cq * 1.9 - vec2(uTime * 0.19, uTime * 0.27));
  float caustic = pow(clamp(1.0 - abs(c1 - c2) * 3.0, 0.0, 1.0), 8.0);
  body += uSunColor * caustic * band * 0.06 * (1.0 - 0.85 * uNight);

  // Sky reflection (analytic — not SSR, not a planar mirror).
  vec3 r = reflect(-v, n);
  float skyT = clamp(r.y * 1.4 + 0.1, 0.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, skyT);
  if (uSmearGain > 0.0) {
    float toward = clamp(dot(normalize(r.xz + vec2(1e-5)), uSmearDir), 0.0, 1.0);
    float smear = pow(toward, 6.0) * clamp(0.5 - r.y, 0.0, 0.5) * 2.0;
    sky = mix(sky, uSmear, smear * uSmearGain);
  }
  vec3 col = mix(body, sky, fresnel);

  // Sun glint + broad sheen, capped under the bloom threshold.
  vec3 L = normalize(uSunDir);
  vec3 hv = normalize(L + v);
  float nh = max(dot(n, hv), 0.0);
  // r2: the broad sheen rises to 0.15 by day (0.08 at night) so a soft
  // highlight reads without bloom; the sum stays under the 0.8 cap below.
  float glint = pow(nh, 220.0) * 1.6 + pow(nh, 40.0) * mix(0.15, 0.08, uNight);
  glint *= mix(1.0, 0.25, uNight) * smoothstep(-0.05, 0.1, L.y);
  col += min(uSunColor * glint, vec3(0.8));

  // Night: practical-light glitter streaks. The wavy normal stretches each
  // highlight toward the viewer; the capillary layer breaks it into glitter.
  if (uNight > 0.5) {
    for (int i = 0; i < ${MAX_PRACTICALS}; i++) {
      vec4 pr = uPracticals[i];
      if (pr.w <= 0.0) continue;
      vec3 toLight = pr.xyz - vWorldPos;
      float dist = length(toLight);
      vec3 hp = normalize(toLight / max(dist, 1e-3) + v);
      float s = pow(max(dot(n, hp), 0.0), 60.0);
      col += min(uPracticalColor * s * pr.w / (1.0 + 0.06 * dist * dist), vec3(1.0));
    }
  }

  // Wet rim: the outer part of the shore band leans toward WET sand/gravel —
  // the shore tint darkened and desaturated (W3 r3: the raw, pale shore tint
  // read as a milky veil where the 390 camera looks steeply down on the rim),
  // so water, lip and shore dressing read as one wet band, not a haze.
  vec3 wetShore = mix(uShore, vec3(dot(uShore, vec3(0.2126, 0.7152, 0.0722))), 0.3) * 0.64;
  col = mix(col, wetShore, (1.0 - smoothstep(0.0, WATER_SHORE_BAND_M * 0.4, sd)) * 0.55);
  // The first ~0.9 m of shelf reads as clear water over WET sand (a darker
  // wet-shore/absorb blend), not as the pale shallow tint — which, seen
  // steeply from above, read as a milky veil between water and sand.
  col = mix(col, mix(wetShore, uAbsorb, 0.5), (1.0 - smoothstep(0.1, 0.9, sd)) * 0.35 * (1.0 - 0.6 * graze));

  // Foam: crest-linked + ripple ring fronts + a thin lapping lip.
  float lipNoise = wNoise(p * 3.1 + vec2(uTime * 0.2, 0.0));
  // r2: a lip with a ~1.5 px screen-space floor, so it survives the station
  // distances (it was sub-pixel, ≈ 0 in the foam view). r3: narrower in
  // metres, and softer where the view is steep (graze ≈ 0) — up close the
  // metric lip is many pixels wide and read as a pale veil.
  float lipWidth = 0.1 + 0.08 * lipNoise + 0.03 * sin(uTime * 1.3 + lipNoise * 6.0);
  lipWidth = max(lipWidth, 1.5 * fwidth(sd));
  float lip = (1.0 - smoothstep(0.0, lipWidth, sd)) * mix(0.55, 1.0, graze);
  // r2: crest is normalised by the body's summed steepness (the calm tarn's
  // raw crest never reached the old 0.35 threshold), then broken into sparse
  // flecks by a drifting noise mask — foam where band crests align.
  float crestN = crest / max(WAVE0_STEEP + WAVE1_STEEP + WAVE2_STEEP, 1e-3);
  float fleck = smoothstep(0.5, 0.78, wNoise(p * 5.0 + vec2(uTime * 0.21, -uTime * 0.17)));
  float crestFoam = smoothstep(0.28, 0.62, crestN) * fleck * 0.5;
  float foam = clamp(crestFoam + rippleFoam + lip * 0.8, 0.0, 0.85);
  col = mix(col, uFoam, foam);

  // Sakura: drifting floating petals, collecting toward the shore. The
  // ellipse and its AA derivative are evaluated outside any branch.
  {
    float cellM = 0.42;
    vec2 drift = p + vec2(uTime * 0.045, uTime * 0.018);
    vec2 cell = floor(drift / cellM);
    vec2 f = fract(drift / cellM);
    vec2 c = vec2(wHash(cell + 3.1), wHash(cell + 7.7)) * 0.6 + 0.2;
    float ang = wHash(cell + 11.3) * 6.2831853 + uTime * 0.1;
    vec2 d = (f - c) * cellM;
    vec2 rd = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y);
    float e = length(rd / vec2(0.055, 0.032));
    float aa = fwidth(e);
    float density = mix(0.3, 0.1, smoothstep(0.3, 2.6, sd));
    float present = step(wHash(cell), density) * uPetals;
    float petal = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, e)) * present;
    col = mix(col, uPetalColor, petal * 0.9 * fade);
  }

  // Diagnostic views (?routeDebug=1&waterDebug=…).
  if (uDebug > 0.5) {
    if (uDebug < 1.5) {
      // Height, split: GREEN = the base wave bands (normalised by their
      // amplitude sum), RED = the ripple + ambient displacement (the field
      // minus the bands, ×1/0.02 m) — so a ring shows as a red ring. The
      // split is exact above rest; inside compressed troughs it is approximate.
      float hb = 0.0; vec2 gb = vec2(0.0); float cb = 0.0;
      waterBand(p, uTime, WAVE0_DIR, WAVE0_K, WAVE0_OMEGA, WAVE0_AMP, WAVE0_EXP, WAVE0_STEEP, hb, gb, cb);
      waterBand(p, uTime, WAVE1_DIR, WAVE1_K, WAVE1_OMEGA, WAVE1_AMP, WAVE1_EXP, WAVE1_STEEP, hb, gb, cb);
      waterBand(p, uTime, WAVE2_DIR, WAVE2_K, WAVE2_OMEGA, WAVE2_AMP, WAVE2_EXP, WAVE2_STEEP, hb, gb, cb);
      hb *= fade;
      float hr = h - hb;
      col = vec3(clamp(0.5 + hr / 0.02, 0.0, 1.0) * step(0.0005, abs(hr)),
                 clamp(0.5 + 0.5 * hb / WATER_AMP_SUM, 0.0, 1.0) * 0.6,
                 0.12);
    } else if (uDebug < 2.5) {
      col = vec3(0.08) + vec3(1.0, 0.25, 0.8) * min(rippleFoam * 2.0, 1.0);
      for (int i = 0; i < WATER_RIPPLE_CAPACITY; i++) {
        if (i >= uRippleCount) break;
        if (length(p - uRipples[i].xy) < 0.12) col = vec3(1.0, 1.0, 0.2);
      }
      for (int s = 0; s < WATER_AMBIENT_MAX_STREAMS; s++) {
        float sf = float(s);
        if (sf >= uAmbientStreams || sf >= WATER_AMBIENT_TOTAL) break;
        vec4 e = waterAmbientEvent(sf, uTime);
        if (length(p - e.xy) < 0.12) col = vec3(0.2, 1.0, 1.0);
      }
    } else if (uDebug < 3.5) {
      col = vec3(foam);
    } else if (uDebug > 5.5) {
      // normals-full (the r2 encoding): the world-space normal incl. macro +
      // capillary layers, tangential slope ×4 (R = x, B = z, G = up).
      col = clamp(vec3(0.5 + 2.0 * n.x, n.y * 0.5 + 0.5, 0.5 + 2.0 * n.z), 0.0, 1.0);
    } else if (uDebug > 4.5) {
      // Normals, split (W3 r3) like the height view: R/B = the RIPPLE slope
      // only (the analytic field slope minus the base bands, before the
      // macro/capillary layers) ×25 around 0.5 — a ring shows as a red/blue
      // dipole ring on neutral grey; G = the detail layers' slope (macro +
      // capillary) ×4, so their texture never masks the ring channels.
      float hb = 0.0; vec2 gb = vec2(0.0); float cb = 0.0;
      waterBand(p, uTime, WAVE0_DIR, WAVE0_K, WAVE0_OMEGA, WAVE0_AMP, WAVE0_EXP, WAVE0_STEEP, hb, gb, cb);
      waterBand(p, uTime, WAVE1_DIR, WAVE1_K, WAVE1_OMEGA, WAVE1_AMP, WAVE1_EXP, WAVE1_STEEP, hb, gb, cb);
      waterBand(p, uTime, WAVE2_DIR, WAVE2_K, WAVE2_OMEGA, WAVE2_AMP, WAVE2_EXP, WAVE2_STEEP, hb, gb, cb);
      // Exact under the trough compression: h = -T(1 - e) ⇒ e = 1 + h/T, and
      // the field slope was scaled by e, so the bands' share is gb·fade·e.
      float troughE = h < 0.0 ? 1.0 + h / WATER_MAX_TROUGH : 1.0;
      vec2 gr = gField - gb * fade * troughE;
      col = clamp(vec3(0.5 + gr.x * 25.0, 0.25 + length(g - gField) * 4.0, 0.5 + gr.y * 25.0), 0.0, 1.0);
    } else {
      col = mix(vec3(0.95, 0.85, 0.35), vec3(0.03, 0.15, 0.55), depth / max(WATER_DEPTH_M, 0.05));
      if (sd < WATER_SHORE_BAND_M) col = mix(col, vec3(1.0, 0.3, 0.1), 0.5);
    }
    // Diagnostic colours are exact: written BEFORE (and instead of) the tone
    // mapping, colour-space and fog chunks below.
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
