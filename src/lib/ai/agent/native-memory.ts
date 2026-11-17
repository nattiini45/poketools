import 'server-only';
import { z } from 'zod';
import { authorizeNativePlayerMatch, nativePlayerContextSchema } from './native-context';
import { conversationBelongsTo } from './memory';
import { insertNativeAgentSuggestion } from '@/lib/supabase/queries/agent-suggestions';
import type { Json } from '@/types/database';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';

const nativeSuggestionSchema = z.strictObject({
  context: nativePlayerContextSchema,
  conversationId: z.uuid(),
  persona: z.enum(['linden_match_prep', 'linden_teambuilding']),
  proposedTeam: z.json().nullable(),
  reasoning: z.string().max(20000).nullable(),
  topicTags: z.array(z.string().max(100)).max(20),
});

export async function recordNativePlayerSuggestion(input: unknown) {
  const parsed = nativeSuggestionSchema.safeParse(input);
  if (!parsed.success) throw new Error('Native suggestion requires fresh generation and explicit match reference');
  const { context, conversationId, persona, proposedTeam, reasoning, topicTags } = parsed.data;
  const { player, match, phase } = await authorizeNativePlayerMatch(context);
  if (!await conversationBelongsTo(conversationId, player.playerId, persona)) throw new Error('Native suggestion conversation unavailable');
  const ruleset = await getRulesetById(phase.ruleset_id);
  if (!ruleset || ruleset.id !== phase.ruleset_id) throw new Error('Native pinned ruleset unavailable');
  return insertNativeAgentSuggestion({ playerId: player.playerId, conversationId, phaseMatchId: match.id,
    contextFormat: ruleset.base_format, proposedTeam: proposedTeam as Json, reasoning, topicTags });
}
