/**
 * Lamp and lantern fog halos (LOOK r6, L6.5) — the pure half, shared by every
 * painted world (ROLLOUT §2.2 f). Moved verbatim from `plaza-emitters.ts`,
 * which re-exports every name. The seats are world data: a world passes its
 * own candidates through `clearLampHalos(seats, themeKeepOut(WORLD_DATA_SURFACES).sphereClear)`.
 *
 * Pure data + math — no client imports.
 */

/** A soft fog halo around a night practical (world centre, world radius, colour). */
export interface LampHalo {
  id: string;
  center: readonly [number, number, number];
  radius: number;
  color: string;
}

/**
 * Halo law (LOOK r6, L6.5; CLARITY: "radius + pad ≤ 1.0 m, or the keep-out
 * cull drops the gate-lantern halos"): a billboard of `radius` metres, culled
 * at build unless its sphere of `radius + pad` clears every keep-out wedge;
 * `gain.night` puts the visible glow (outside the lamp's own glass, r ≥ 0.3 of
 * the halo: ≤ 0.35 · e^(−0.45) · gain ≈ 0.5 linear) under the lamp core and
 * the night bloom; `gain.day` 0 (always mounted, one program, never animated).
 */
export const LAMP_HALO = { radius: 0.78, pad: 0.2, gain: { day: 0, night: 2.2 } } as const;

/** The halos that clear the keep-out law (`sphereClear` of the theme's keep-out). */
export function clearLampHalos(
  halos: readonly LampHalo[],
  sphereClear: (c: readonly [number, number, number], r: number) => boolean,
): LampHalo[] {
  return halos.filter((halo) => sphereClear(halo.center, halo.radius + LAMP_HALO.pad));
}

/** Halo strength per palette (a uniform write — never a program change). */
export function haloGain(night: boolean): number {
  return night ? LAMP_HALO.gain.night : LAMP_HALO.gain.day;
}
