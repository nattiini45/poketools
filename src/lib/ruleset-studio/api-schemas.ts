/**
 * Request envelopes of the ruleset library routes (zod, all strict). The `document` member is opaque here: the route has
 * already run `assertDocument` on it (`assertEnvelopeDocument`), and the ruleset kit validates its content at check and
 * publish time, never at save time (a draft may be half built).
 */
import { z } from 'zod';
import { getRulesetPreset, isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { ltextSchema, slugSchema, uuidSchema } from '@/lib/studio-core/text-schema';
import {
  MAX_REVISION,
  definitionNameSchema,
  documentSchema,
  draftRevSchema,
  studioListQuerySchema,
  visibilitySchema,
} from '@/lib/studio-core/api-schemas';

export { validationFailedResponse } from '@/lib/studio-core/api-schemas';

/** `GET /api/ruleset-definitions` query string (values arrive as text). */
export const rulesetListQuerySchema = studioListQuerySchema;
export type RulesetListQuery = z.infer<typeof rulesetListQuerySchema>;

/** Whether "add Smogon tour bans" exists for a preset: only the draft presets with documented tour extras have it. */
function hasTourOverlay(presetId: string | undefined): boolean {
  return getRulesetPreset(presetId)?.tourOverlay === true;
}

const TOUR_OVERLAY_UNAVAILABLE = { path: ['tour_overlay'], message: 'This preset has no Smogon tour extras' };

/**
 * `POST /api/ruleset-definitions`: a whole document, or just a name to start from a blank skeleton, optionally pre-filled
 * from a catalog preset (`preset`, a format id such as `gen9ou` or `gen9natdexdraft`). `tour_overlay` adds the preset's
 * documented Smogon tour clauses and bans as ordinary editable entries; it needs a preset that has them.
 */
export const rulesetCreateSchema = z.union([
  z.strictObject({ document: documentSchema, slug: slugSchema.optional() }),
  z
    .strictObject({
      name: definitionNameSchema,
      base_locale: z.enum(['en', 'de']),
      preset: z.string().refine(isRulesetPresetId, { message: 'Unknown rule preset' }).optional(),
      tour_overlay: z.boolean().optional(),
      slug: slugSchema.optional(),
    })
    .refine((body) => body.tour_overlay !== true || hasTourOverlay(body.preset), TOUR_OVERLAY_UNAVAILABLE),
]);
export type RulesetCreateBody = z.infer<typeof rulesetCreateSchema>;

/** `PUT /api/ruleset-definitions/[id]/draft` */
export const rulesetDraftSchema = z.strictObject({
  draft_rev: draftRevSchema,
  document: documentSchema,
});
export type RulesetDraftBody = z.infer<typeof rulesetDraftSchema>;

/** `POST /api/ruleset-definitions/[id]/publish` */
export const rulesetPublishSchema = z.strictObject({
  draft_rev: draftRevSchema,
  changelog: ltextSchema.optional(),
});
export type RulesetPublishBody = z.infer<typeof rulesetPublishSchema>;

/** `PATCH /api/ruleset-definitions/[id]` */
export const rulesetVisibilitySchema = z.strictObject({
  visibility: visibilitySchema,
});
export type RulesetVisibilityBody = z.infer<typeof rulesetVisibilitySchema>;

/** `POST /api/ruleset-definitions/[id]/fork` */
export const rulesetForkSchema = z.strictObject({
  slug: slugSchema.optional(),
});
export type RulesetForkBody = z.infer<typeof rulesetForkSchema>;

/**
 * `POST /api/ruleset-definitions/presets/[presetId]/fork`: the fork body plus `tour_overlay` (see the create body), which
 * the preset named in the address must support. A schema per preset, because the address is part of the check.
 */
export function presetForkSchema(presetId: string) {
  return rulesetForkSchema
    .extend({ tour_overlay: z.boolean().optional() })
    .refine((body) => body.tour_overlay !== true || hasTourOverlay(presetId), TOUR_OVERLAY_UNAVAILABLE);
}
export type PresetForkBody = z.infer<ReturnType<typeof presetForkSchema>>;

/** One league or phase whose ruleset moves. */
export const pinTargetSchema = z.strictObject({
  kind: z.enum(['season', 'tournament']),
  id: uuidSchema,
});
export type PinTarget = z.infer<typeof pinTargetSchema>;

/** A league or phase appears once: two moves of the same target would race each other's compare-and-set. */
const pinTargetsSchema = z
  .array(pinTargetSchema)
  .min(1)
  .max(50)
  .refine((targets) => new Set(targets.map((t) => `${t.kind}:${t.id}`)).size === targets.length, { message: 'A league or phase may be listed only once' });

/**
 * `POST /api/ruleset-definitions/[id]/pins`: move the pin of up to 50 leagues and phases to one version of this ruleset.
 * A target that has already started needs its id in `confirm_started` (the confirmation that names it); a finished one is
 * refused.
 */
export const rulesetPinsSchema = z.strictObject({
  to_version_no: z.number().int().min(1).max(MAX_REVISION),
  targets: pinTargetsSchema,
  confirm_started: z.array(uuidSchema).max(50).optional(),
});
export type RulesetPinsBody = z.infer<typeof rulesetPinsSchema>;

/**
 * `POST /api/ruleset-definitions/[id]/pins/impact`: the same targets as a move, without the confirmation (nothing is written).
 * Asks how many already-submitted teams of the targets would become invalid under version `to_version_no`.
 */
export const rulesetPinImpactSchema = rulesetPinsSchema.omit({ confirm_started: true });
export type RulesetPinImpactBody = z.infer<typeof rulesetPinImpactSchema>;
