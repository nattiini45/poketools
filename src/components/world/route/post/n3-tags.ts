/**
 * D42 N3 / X15: the two camera layer bits N3's exact N8AO transparency pass
 * (`n8ao-exact.ts`, ENGINE-P) tags objects with, as layer MASKS (a value a
 * `Layers.mask` can be ANDed with or set to directly).
 *
 * Layer use before D42: every object and camera on layer 0 (three's default);
 * the warm's `buffers` slices draw through layer 31 (`WARM_BUFFER_LAYER`,
 * `useStationWarmup.ts`); the compile guard parks a held renderable at mask 0.
 * Layers 29 and 30 are unused anywhere in the app, so N3 takes them.
 *
 * The compile guard's release is tag-aware (X15): a held object's tags,
 * written while it was held, survive the release, and its original layers
 * come back (`useStationWarmup.ts` `releaseHeldMask`).
 */

/** The layer index of the "transparent, depth write off" tag. */
export const N3_TAG_DW_OFF_LAYER = 29;
/** The layer index of the "transparent, depth write on" tag. */
export const N3_TAG_DW_ON_LAYER = 30;

/** Mask of the "transparent, depth write off" tag (layer 29). */
export const N3_TAG_DW_OFF = 1 << N3_TAG_DW_OFF_LAYER;
/** Mask of the "transparent, depth write on" tag (layer 30). */
export const N3_TAG_DW_ON = 1 << N3_TAG_DW_ON_LAYER;
/** Both tag bits. */
export const N3_TAG_BITS = N3_TAG_DW_OFF | N3_TAG_DW_ON;
