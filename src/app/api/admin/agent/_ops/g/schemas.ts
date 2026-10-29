/**
 * The request shapes the Build bindings allow (spec §18.6). The executor parses the RESOLVED path params and body of every
 * stored step with these before it dispatches (`checkCall`), so a step that was edited after staging, or a reference that
 * resolved to something that is not an id, is not sent.
 *
 * Each body schema is the route's OWN zod object (`@/lib/validation/schemas`) made strict, so a key the route would
 * silently drop is refused here, and narrowed where the Plan never sends a field: the route takes `route_theme`, `insert_at`
 * and `stage_order`, a clone block that copies the source's league admins; a Build sends none of them. The route still
 * validates on its own; this is the second lock.
 */
import { z } from 'zod';
import { rulesetDraftSchema, rulesetPinsSchema, rulesetPublishSchema } from '@/lib/ruleset-studio/api-schemas';
import {
  generateRoundOptionsSchema,
  phaseCreateSchema,
  seasonCloneOptionsSchema,
  seasonCreateRequestSchema,
  seasonParticipantAddSchema,
  seasonParticipantBulkAddSchema,
  seasonParticipantRemoveSchema,
  seasonUpdateSchema,
  tournamentCreateSchema,
  tournamentUpdateSchema,
} from '@/lib/validation/schemas';

const id = z.uuid();

// ─── Path params ─────────────────────────────────────────────────────────────

/** `/api/seasons/[id]/...` and `/api/tournaments/[id]`: the one id. */
export const idParams = z.strictObject({ id });
/** `/api/seasons/[id]/phases/[phaseId]/...`. */
export const phaseParams = z.strictObject({ id, phaseId: id });
/** `/api/generate-round/[tid]`: the tournament id under the name that route gives it. */
export const tidParams = z.strictObject({ tid: id });

// ─── Bodies ──────────────────────────────────────────────────────────────────

/** `POST /api/seasons`. A clone block never copies the source's league admins. */
export const leagueCreateBody = seasonCreateRequestSchema
  .omit({ route_theme: true })
  .extend({ clone_from: seasonCloneOptionsSchema.extend({ copy_admins: z.literal(false).default(false) }).strict().optional() })
  .strict();

/** `POST /api/seasons/[id]/participants`, the bulk form (1 to 50 ids). */
export const rosterAddBody = seasonParticipantBulkAddSchema.strict();

/** `DELETE /api/seasons/[id]/participants`: one player. */
export const rosterRemoveBody = seasonParticipantRemoveSchema.strict();

/** `POST /api/tournaments/[id]/participants`: one player (seeds are a separate route the Build does not call). */
export const tournamentParticipantAddBody = seasonParticipantAddSchema.strict();

/** `DELETE /api/tournaments/[id]/participants`: one player. */
export const tournamentParticipantRemoveBody = seasonParticipantRemoveSchema.strict();

/** `POST /api/seasons/[id]/phases`. The position (`insert_at`, `stage_order`) is never the model's. */
export const phaseCreateBody = phaseCreateSchema.omit({ insert_at: true, stage_order: true }).strict();

/** `POST /api/tournaments`: a standalone tournament (the route refuses a `season_id`). */
export const tournamentCreateBody = tournamentCreateSchema.omit({ season_id: true, stage_order: true }).strict();

/** `POST .../sync-standings`: no options (the repair read-back never forces a re-sync). */
export const syncStandingsBody = z.strictObject({});

/** `PATCH /api/seasons/[id]`: archive, and nothing else. */
export const leagueArchiveBody = seasonUpdateSchema.pick({ archived: true }).extend({ archived: z.literal(true) }).strict();

/** `PATCH /api/tournaments/[id]`: archive, and nothing else. */
export const tournamentArchiveBody = tournamentUpdateSchema.pick({ archived: true }).extend({ archived: z.literal(true) }).strict();

// ─── Go-live bodies (spec §18.8): one exact call each, as `proposals/golive.ts` stores it ────────────────────────────────

/** `POST /api/ruleset-definitions/[id]/publish`: the route's own strict object (`draft_rev`, an optional changelog). */
export const publishRulesetBody = rulesetPublishSchema.strict();

/**
 * `POST /api/ruleset-definitions/[id]/pins`: the route's own strict object. Staging puts only the ids of started targets into
 * `confirm_started`, so an id that names no target of the call is refused here (the route would ignore it).
 */
export const movePinBody = rulesetPinsSchema.strict().refine(
  (body) => {
    const ids = new Set(body.targets.map((target) => target.id.toLowerCase()));
    return (body.confirm_started ?? []).every((started) => ids.has(started.toLowerCase()));
  },
  { path: ['confirm_started'], message: 'confirm_started names a target that is not in the call' },
);

/** `POST /api/generate-round/[tid]`: nothing, or `{ start_round: true }` (staging never sends `false`). */
export const startPhaseBody = generateRoundOptionsSchema.extend({ start_round: z.literal(true).optional() }).strict();

/** `POST /api/tournaments/[id]/generate-bracket`: staging stores `{}`; the route's `start_round` is not offered. */
export const generateBracketBody = z.strictObject({});

// ─── Undo bodies (spec §18.8) ────────────────────────────────────────────────────────────────────────────────────────

/** `PUT /api/ruleset-definitions/[id]/draft`: the route's own strict object, the previous document and the revision it is written at. */
export const restoreDraftBody = rulesetDraftSchema;
