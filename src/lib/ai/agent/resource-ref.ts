import { z } from 'zod';

const uuid = z.uuid().transform((id) => id.toLowerCase());

const tournamentCompetitionRefSchema = z.strictObject({ kind: z.literal('tournament'), tournamentId: uuid });
export const phaseCompetitionRefSchema = z.strictObject({ kind: z.literal('phase'), seasonId: uuid, phaseId: uuid });
export const competitionRefSchema = z.discriminatedUnion('kind', [tournamentCompetitionRefSchema, phaseCompetitionRefSchema]);
export type CompetitionRef = z.output<typeof competitionRefSchema>;

export const matchResourceRefSchema = z.strictObject({ resource: z.literal('match'), owner: competitionRefSchema, id: uuid });
export const agentResourceRefSchema = z.discriminatedUnion('resource', [
  z.strictObject({ resource: z.literal('competition'), owner: competitionRefSchema }),
  z.strictObject({ resource: z.literal('round'), owner: competitionRefSchema, id: uuid }),
  matchResourceRefSchema,
  z.strictObject({ resource: z.literal('game'), owner: competitionRefSchema, id: uuid }),
]);
export type AgentResourceRef = z.output<typeof agentResourceRefSchema>;

export const agentResourceRefsSchema = z.array(agentResourceRefSchema).max(200);

export type ReferenceValidation =
  | { ok: true; refs: AgentResourceRef[] }
  | { ok: false; reason: 'invalid_refs' | 'ownership_unavailable' | 'ownership_mismatch' };

export interface AgentOwnershipReader {
  resolve(refs: readonly AgentResourceRef[]): Promise<readonly (AgentResourceRef | null)[]>;
}

export function resourceRefKey(ref: AgentResourceRef): string {
  const owner = ref.owner.kind === 'phase'
    ? `phase:${ref.owner.seasonId}:${ref.owner.phaseId}`
    : `tournament:${ref.owner.tournamentId}`;
  return ref.resource === 'competition' ? owner : `${owner}:${ref.resource}:${ref.id}`;
}

export async function validateAgentResourceRefs(input: unknown, reader: AgentOwnershipReader): Promise<ReferenceValidation> {
  const parsed = agentResourceRefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_refs' };
  if (parsed.data.length === 0) return { ok: true, refs: [] };
  const resolved = await reader.resolve(parsed.data);
  if (resolved.length !== parsed.data.length || resolved.some((ref) => ref === null)) {
    return { ok: false, reason: 'ownership_unavailable' };
  }
  for (let i = 0; i < parsed.data.length; i++) {
    const actual = agentResourceRefSchema.safeParse(resolved[i]);
    if (!actual.success || resourceRefKey(actual.data) !== resourceRefKey(parsed.data[i])) {
      return { ok: false, reason: 'ownership_mismatch' };
    }
  }
  return { ok: true, refs: parsed.data };
}
