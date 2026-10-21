/**
 * Manifest v3 helpers (fidelity pass, W2/W5 — proposal S8): per-figure clip
 * metadata and the species' primary type, baked OFFLINE so the client never
 * pulls @pkmn/dex into its bundle and never guesses durations at runtime.
 *
 *  - `clipMeta: { [clip]: { duration } }` — loop length in seconds, read from
 *    the glTF animation samplers (the max input-accessor time over every
 *    channel sampler of the clip). Consumed by clip-phase.ts (phase → time),
 *    walk-gait.ts (stride matching) and the idle-fidget schedule.
 *  - `primaryType` — `Dex.species.get(species).types[0]`, with the base
 *    species (text before the first dash) as the fallback. Consumed by the W5
 *    attack-move map. Types come from the data package, never a hand table
 *    (repo rule: never hardcode Pokémon names/types/stats).
 *
 *  - `types` (D35 core round, Q1) — BOTH types, `Dex.species.get(species).types`,
 *    same lookup as `primaryType`. Additive metadata: `primaryType` stays, and
 *    `types[0] === primaryType` always. Consumed by habitat-types.ts (casting).
 *  - `roles` (D35 core round, Q2) — species-identity roles a type cannot
 *    express, from the bake-side role table (`ROLE_SPECIES`: the Poké Center
 *    nurse, `lib.mjs NURSE_SPECIES`). Written only when non-empty. Consumed by
 *    casting.ts `roleEntries`, so the app never names the nurse species.
 *
 * Pure helpers — `bake-manifest.mjs` wires them into the full bake and the
 * offline `--enrich` pass over the local mirror. Both paths build the v3
 * fields through `v3FieldsFromRoot`, so they emit the same set (R33).
 */

import { NURSE_SPECIES } from './lib.mjs';

export const MANIFEST_VERSION_V3 = 3;

/** Bake-side role table: role → species names (the ONLY place roles name species). */
export const ROLE_SPECIES = Object.freeze({ nurse: NURSE_SPECIES });

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Loop duration (seconds) of one glTF-Transform `Animation`: the latest
 * keyframe time across its samplers. 0 when the clip has no keyframes.
 */
export function animationDuration(animation) {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (!input) continue;
    const count = input.getCount();
    for (let i = 0; i < count; i += 1) {
      const t = input.getScalar(i);
      if (Number.isFinite(t) && t > duration) duration = t;
    }
  }
  return duration;
}

/** `{ [clipName]: { duration } }` for a glTF-Transform document root. */
export function clipMetaFromRoot(root) {
  const meta = {};
  for (const animation of root.listAnimations()) {
    const name = animation.getName();
    if (!name) continue;
    meta[name] = { duration: round(animationDuration(animation)) };
  }
  return meta;
}

/**
 * Primary type for a manifest species string via a `Dex`-shaped object
 * (`Dex.species.get(name) → { exists, types }`). Null when unresolvable.
 */
export function primaryTypeFor(species, dex) {
  const candidates = [species];
  const dash = species.indexOf('-');
  if (dash > 0) candidates.push(species.slice(0, dash));
  for (const name of candidates) {
    const entry = dex.species.get(name);
    if (entry && entry.exists && Array.isArray(entry.types) && entry.types.length > 0) return entry.types[0];
  }
  return null;
}

/**
 * Every type of a manifest species (primary first) via a `Dex`-shaped object,
 * with the same base-species fallback as `primaryTypeFor`. `[]` when unresolvable.
 */
export function typesFor(species, dex) {
  const candidates = [species];
  const dash = species.indexOf('-');
  if (dash > 0) candidates.push(species.slice(0, dash));
  for (const name of candidates) {
    const entry = dex.species.get(name);
    if (entry && entry.exists && Array.isArray(entry.types) && entry.types.length > 0) return [...entry.types];
  }
  return [];
}

function normalizeName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Roles of a manifest species from a role table (`{ role: speciesName[] }`),
 * matched on the normalised species name (the entry's own name, not its base
 * species: a regional forme is not the nurse). Sorted, `[]` when none.
 */
export function rolesFor(species, roleSpecies = ROLE_SPECIES) {
  const key = normalizeName(species);
  const roles = [];
  for (const [role, names] of Object.entries(roleSpecies)) {
    if (names.some((name) => normalizeName(name) === key)) roles.push(role);
  }
  return roles.sort();
}

/**
 * The v3 fields for one figure. `readRoot(file)` resolves a figure's GLB to a
 * glTF-Transform root (or null when the binary is absent locally — the entry
 * then keeps whatever clipMeta it already had, or none).
 */
export async function v3Fields(figure, { readRoot, dex, roleSpecies = ROLE_SPECIES }) {
  const root = await readRoot(figure.file);
  return v3FieldsFromRoot(root, figure.species, { dex, roleSpecies, fallbackClipMeta: figure.clipMeta });
}

/**
 * The v3 fields of one figure from an already-read glTF-Transform root (or
 * null). The ONE builder both bake paths share (R33): the full bake
 * (`bake-manifest.mjs` main) and the offline `--enrich` pass (`v3Fields`),
 * so neither can drop `types` / `roles`. Key order: clipMeta, primaryType,
 * types, roles. `fallbackClipMeta` is kept when there is no root.
 */
export function v3FieldsFromRoot(root, species, { dex, roleSpecies = ROLE_SPECIES, fallbackClipMeta } = {}) {
  const out = {};
  if (root) out.clipMeta = clipMetaFromRoot(root);
  else if (fallbackClipMeta) out.clipMeta = fallbackClipMeta;
  const type = primaryTypeFor(species, dex);
  if (type) out.primaryType = type;
  const types = typesFor(species, dex);
  if (types.length > 0) out.types = types;
  const roles = rolesFor(species, roleSpecies);
  if (roles.length > 0) out.roles = roles;
  return out;
}

/**
 * Enrich an existing (v1/v2) manifest to v3 in place of its figures, keeping
 * every other section (props, environment, the v2 `pool` coverage) intact.
 * Returns `{ manifest, stats }`.
 */
export async function enrichManifest(manifest, { readRoot, dex, now = new Date(), roleSpecies = ROLE_SPECIES }) {
  const figures = [];
  let withMeta = 0;
  let withType = 0;
  let withTypes = 0;
  let withRoles = 0;
  let missingGlb = 0;
  for (const figure of manifest.figures) {
    const fields = await v3Fields(figure, { readRoot, dex, roleSpecies });
    if (!fields.clipMeta) missingGlb += 1;
    if (fields.clipMeta) withMeta += 1;
    if (fields.primaryType) withType += 1;
    if (fields.types) withTypes += 1;
    if (fields.roles) withRoles += 1;
    // Clip-name order stays whatever the bake recorded; clipMeta is additive.
    figures.push({ ...figure, ...fields });
  }
  return {
    manifest: { ...manifest, version: MANIFEST_VERSION_V3, generatedAt: now.toISOString(), figures },
    stats: { figures: figures.length, withMeta, withType, withTypes, withRoles, missingGlb },
  };
}
