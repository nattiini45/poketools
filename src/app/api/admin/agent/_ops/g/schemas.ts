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
import {
  phaseCreateSchema,
  seasonCloneOptionsSchema,
  seasonCreateRequestSchema,
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
