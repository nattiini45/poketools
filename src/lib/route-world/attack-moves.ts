/**
 * Signature-attack VFX vocabulary (fidelity W5 prep — pure, not mounted yet).
 *
 * An ambient figure's attack is a VFX EVENT keyed by its elemental type, never
 * by species: the type arrives from the baked world manifest (`primaryType`,
 * written at bake time from `@pkmn/dex`), so there is no hand-maintained
 * species → move table to drift out of date (repo Pokémon data rule). A
 * figure whose entry carries no type falls back to the Normal descriptor.
 *
 * Honesty rule (W2/W5): the GLBs ship no attack clips (clip vocabulary is
 * idle / idle2 / walk / run). The wind-up is a controller transform (a small
 * crouch + lean) plus the species' alternate idle where one exists — the
 * consumer must describe it as such, never as an attack animation.
 *
 * Every descriptor has a real wind-up (the W5 veto "an attack with no
 * wind-up"), a bounded travel and a settle back into behaviour; `radiusM`
 * bounds the effect volume so the keep-out check (data surfaces, camera
 * path) can reject it before it fires.
 */
import { POKEMON_TYPES, normalizeType, type PokemonType } from './habitat-types';

/**
 * The 18 elemental types, lower-case (the manifest's spelling is normalised).
 * D35 / D18: the vocabulary lives in `habitat-types.ts` (the ONE type table);
 * this is the same tuple object, re-exported under its attack name, so the
 * order and spelling cannot drift (runtime-neutral refactor, K5).
 */
export const ATTACK_TYPES = POKEMON_TYPES;
export type AttackType = PokemonType;

/** VFX families the (future) pooled attack actor draws. */
export const ATTACK_VFX_KINDS = ['beam', 'projectile', 'burst', 'spout', 'spark', 'leaf', 'gust'] as const;
export type AttackVfxKind = (typeof ATTACK_VFX_KINDS)[number];

export interface AttackVfxDescriptor {
  /** The resolved type (after normalisation / fallback). */
  type: AttackType;
  kind: AttackVfxKind;
  /** Core colour, sRGB hex. Kept below the bloom threshold by the actor, not here. */
  colour: string;
  /** Wind-up (crouch, lean, muzzle glow ramp), seconds. Always > 0. */
  windUpS: number;
  /** Release / travel of the effect, seconds. */
  travelS: number;
  /** Settle back into the figure's behaviour, seconds. */
  settleS: number;
  /** Radius of the effect volume around its path, metres (keep-out bound). */
  radiusM: number;
}

/**
 * The reduced-motion / `glow` presentation: a gentle emissive pulse on the
 * figure itself — no projectile, no travel, no screen motion (D12: only
 * reachable when route tier is forced for a reduced-motion visitor, or when
 * the ladder's `attackVfx` is `glow`).
 */
export interface AttackGlowPulse {
  type: AttackType;
  kind: 'glow-pulse';
  colour: string;
  /** Whole pulse (rise + fall), seconds. */
  durationS: number;
}

type Shape = Omit<AttackVfxDescriptor, 'type'>;

/**
 * Type → VFX family. The shapes are chosen so each type reads at a glance
 * from a station camera (a water spout, a leaf flurry, a spark crackle), and
 * no two neighbouring types in a typical world roster share both kind and
 * colour.
 */
const TYPE_SHAPES: Readonly<Record<AttackType, Shape>> = {
  normal: { kind: 'burst', colour: '#f2eee4', windUpS: 0.6, travelS: 0.35, settleS: 0.8, radiusM: 0.9 },
  fire: { kind: 'projectile', colour: '#ff7a2e', windUpS: 0.7, travelS: 0.55, settleS: 0.8, radiusM: 0.5 },
  water: { kind: 'spout', colour: '#5ab4f0', windUpS: 0.65, travelS: 0.7, settleS: 0.9, radiusM: 0.6 },
  electric: { kind: 'spark', colour: '#ffe04a', windUpS: 0.5, travelS: 0.3, settleS: 0.7, radiusM: 0.8 },
  grass: { kind: 'leaf', colour: '#7ccf5a', windUpS: 0.6, travelS: 0.8, settleS: 0.9, radiusM: 1.0 },
  ice: { kind: 'beam', colour: '#bfeaff', windUpS: 0.75, travelS: 0.45, settleS: 0.9, radiusM: 0.35 },
  fighting: { kind: 'burst', colour: '#e0643c', windUpS: 0.55, travelS: 0.25, settleS: 0.7, radiusM: 0.7 },
  poison: { kind: 'projectile', colour: '#b36ad8', windUpS: 0.65, travelS: 0.6, settleS: 0.8, radiusM: 0.45 },
  ground: { kind: 'burst', colour: '#d2a864', windUpS: 0.7, travelS: 0.4, settleS: 1.0, radiusM: 1.1 },
  flying: { kind: 'gust', colour: '#cfe6ff', windUpS: 0.6, travelS: 0.6, settleS: 0.8, radiusM: 1.0 },
  psychic: { kind: 'beam', colour: '#ff7ab8', windUpS: 0.8, travelS: 0.5, settleS: 0.9, radiusM: 0.35 },
  bug: { kind: 'projectile', colour: '#a8c83a', windUpS: 0.55, travelS: 0.5, settleS: 0.7, radiusM: 0.4 },
  rock: { kind: 'projectile', colour: '#b09a78', windUpS: 0.75, travelS: 0.55, settleS: 0.9, radiusM: 0.55 },
  ghost: { kind: 'projectile', colour: '#7a62c8', windUpS: 0.7, travelS: 0.7, settleS: 0.9, radiusM: 0.5 },
  dragon: { kind: 'beam', colour: '#6a6cf0', windUpS: 0.8, travelS: 0.55, settleS: 1.0, radiusM: 0.45 },
  dark: { kind: 'burst', colour: '#5a4a6a', windUpS: 0.6, travelS: 0.35, settleS: 0.8, radiusM: 0.8 },
  steel: { kind: 'beam', colour: '#c8d2dc', windUpS: 0.7, travelS: 0.4, settleS: 0.8, radiusM: 0.35 },
  fairy: { kind: 'spark', colour: '#ffb0d8', windUpS: 0.6, travelS: 0.45, settleS: 0.8, radiusM: 0.8 },
};

/**
 * The largest effect radius over every type (metres): the conservative,
 * roster-independent bound `attack-stage.ts` sweeps paths with.
 */
export const ATTACK_MAX_RADIUS_M: number = Math.max(...ATTACK_TYPES.map((type) => TYPE_SHAPES[type].radiusM));

/** Duration of the reduced-motion glow pulse, seconds. */
export const ATTACK_GLOW_PULSE_S = 1.2;

/**
 * Normalise a manifest `primaryType` (any case, possibly missing) to an
 * `AttackType`; unknown or absent types resolve to `normal`.
 */
export function normalizeAttackType(primaryType: string | null | undefined): AttackType {
  return normalizeType(primaryType) ?? 'normal';
}

/** The full VFX descriptor for a figure's manifest `primaryType`. */
export function attackForType(primaryType: string | null | undefined): AttackVfxDescriptor {
  const type = normalizeAttackType(primaryType);
  return { type, ...TYPE_SHAPES[type] };
}

/** The reduced-motion / `glow` variant of the same attack. */
export function glowPulseForType(primaryType: string | null | undefined): AttackGlowPulse {
  const type = normalizeAttackType(primaryType);
  return { type, kind: 'glow-pulse', colour: TYPE_SHAPES[type].colour, durationS: ATTACK_GLOW_PULSE_S };
}

/** Whole on-screen duration of a descriptor (wind-up + travel + settle), seconds. */
export function attackDurationS(descriptor: AttackVfxDescriptor | AttackGlowPulse): number {
  if (descriptor.kind === 'glow-pulse') return descriptor.durationS;
  return descriptor.windUpS + descriptor.travelS + descriptor.settleS;
}
