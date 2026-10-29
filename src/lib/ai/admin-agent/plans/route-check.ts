/**
 * `validateStepBodies(steps)`: the pure core of `plan_validate` (plan 3.6.3). It parses every derived step body with the
 * REAL route schemas (`seasonCreateRequestSchema`, `phaseCreateSchema`, `tournamentCreateSchema`, the participants,
 * groups and draft bodies), replacing each `{ "$ref": ... }` with a placeholder uuid, and reports what the route would
 * answer with 400 `validation_failed`, plus keys the schema would silently strip (a Plan field the route does not know).
 *
 * No writes, no reads. Preflight (guards, typed refusals) is separate and lives next to the previews.
 */
import { z } from 'zod';
import { createQueueDraftSchema } from '@/lib/draft/schemas';
import type { JsonValue } from '@/lib/studio-core/json';
import {
  draftPoolCreateSchema,
  phaseCreateSchema,
  seasonCreateRequestSchema,
  seasonParticipantAddSchema,
  seasonParticipantBulkAddSchema,
  tournamentCreateSchema,
} from '@/lib/validation/schemas';
import { PLAN_LIMITS, toPlanIssues } from './schema';
import { isRefObject, REF_PATH_PATTERN } from './route-bodies';
import type { PlanOp } from './ops';
import type { PlanStep } from './steps';

/** Stands in for every `$ref` while a body is parsed. A valid v4 uuid, so uuid fields accept it. */
export const REF_PLACEHOLDER = '11111111-1111-4111-8111-111111111111';

/** `PUT /api/seasons/[id]/groups` in serpentine mode (the route's own strict schema is route-private). */
const groupsBodySchema = z
  .object({ mode: z.literal('serpentine'), group_count: z.int().min(PLAN_LIMITS.groupsMin).max(PLAN_LIMITS.groupsMax) })
  .strict();

/** The queue body of `POST /api/drafts`: the shared schema plus the optional group (`createGroupQueueDraftSchema`). */
const queueDraftBodySchema = createQueueDraftSchema.extend({ season_group_id: z.uuid().optional() });

function schemaFor(op: PlanOp, body: Record<string, JsonValue>): z.ZodType {
  switch (op) {
    case 'league_create':
      return seasonCreateRequestSchema;
    case 'roster_add':
      return seasonParticipantBulkAddSchema;
    case 'phase_create':
      return phaseCreateSchema;
    case 'groups_set':
      return groupsBodySchema;
    case 'draft_pool_create':
      return body.kind === undefined ? draftPoolCreateSchema : queueDraftBodySchema;
    case 'tournament_create':
      return tournamentCreateSchema;
    case 'tournament_participant_add':
      return seasonParticipantAddSchema;
  }
}

export interface StepBodyIssue {
  stepKey: string;
  /** Pointer inside the body. */
  path: string;
  /** What is wrong: a zod issue code or one of this module's own (`invalid_type`, `ref_path_not_allowed`, `key_stripped`). Not an API error code. */
  reason: string;
}

/** Replace every `$ref` object with the placeholder; reports a `$ref` path the executor would not resolve. */
function resolvePlaceholders(value: JsonValue, onBadRef: (path: string) => void): JsonValue {
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, onBadRef));
  if (typeof value === 'object' && value !== null) {
    if (isRefObject(value)) {
      if (!REF_PATH_PATTERN.test(value.$ref)) onBadRef(value.$ref);
      return REF_PLACEHOLDER;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePlaceholders(item, onBadRef)]));
  }
  return value;
}

export function validateStepBodies(steps: readonly PlanStep[]): StepBodyIssue[] {
  const issues: StepBodyIssue[] = [];
  for (const step of steps) {
    const body = step.args.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      issues.push({ stepKey: step.key, path: '', reason: 'invalid_type' });
      continue;
    }
    const resolved = resolvePlaceholders(body, () => issues.push({ stepKey: step.key, path: '', reason: 'ref_path_not_allowed' })) as Record<string, JsonValue>;
    const parsed = schemaFor(step.op, resolved).safeParse(resolved);
    if (!parsed.success) {
      for (const issue of toPlanIssues(parsed.error)) issues.push({ stepKey: step.key, path: issue.path, reason: issue.code });
      continue;
    }
    // Non-strict route schemas drop unknown keys silently: a Plan key that disappears here would be lost at the route.
    const kept = new Set(Object.keys(parsed.data as object));
    for (const key of Object.keys(resolved)) {
      if (!kept.has(key)) issues.push({ stepKey: step.key, path: `/${key}`, reason: 'key_stripped' });
    }
  }
  return issues;
}
