/**
 * The request shapes the D bindings allow (spec §18.4): the private ruleset draft writes. `checkCall` parses the RESOLVED
 * path params and body with these before anything is dispatched, so a value that no longer fits (an id that is not a uuid,
 * a preset the catalog does not know, a key the route would silently drop) is not sent. The routes validate again on
 * their own; this is the second lock.
 *
 * Each body is the route's OWN zod object (`@/lib/ruleset-studio/api-schemas`), strict, narrowed where the assistant never
 * sends a member: a create sends a name and never a whole document.
 */
import { z } from 'zod';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { rulesetCreateFromNameSchema, rulesetDraftSchema, rulesetForkSchema } from '@/lib/ruleset-studio/api-schemas';

/** `/api/ruleset-definitions/[id]/...`: a definition id (a uuid). */
export const definitionParams = z.strictObject({ id: z.uuid() });

/** `/api/ruleset-definitions/presets/[presetId]/fork`: a catalog preset id, checked against the catalog the way the route does (not a uuid). */
export const presetParams = z.strictObject({ presetId: z.string().refine(isRulesetPresetId, { message: 'Unknown rule preset' }) });

/** `POST /api/ruleset-definitions`, the name form (a blank start, or a copy of a catalog preset). */
export const rulesetCreateBody = rulesetCreateFromNameSchema;

/** `POST /api/ruleset-definitions/[id]/fork`: the route's body, whose only member is a slug. */
export const rulesetForkBody = rulesetForkSchema;

/** `POST /api/ruleset-definitions/presets/[presetId]/fork`: a slug and `tour_overlay` (the route checks the preset supports it). */
export const presetForkBody = rulesetForkSchema.extend({ tour_overlay: z.boolean().optional() });

/** `PUT /api/ruleset-definitions/[id]/draft`: the revision the patch was made against and the whole new document. */
export const rulesetDraftBody = rulesetDraftSchema;
