/**
 * Agent memory CRUD (PRD §6) over the three v1 tables — `user_agent_profile`,
 * `agent_conversations`, `agent_suggestions` — using the service-role Supabase
 * client. Authorization is enforced upstream in API routes (`requirePlayer()`);
 * these helpers take `playerId` as a parameter and never read a session.
 *
 * Style follows the existing query modules in `src/lib/supabase/queries/*`.
 */
import { supabase } from '@/lib/supabase/client';
import type { Tables, Json } from '@/types/database';
import type { AgentMessage } from './types';

export type AgentProfileRow = Tables<'user_agent_profile'>;
export type AgentConversationRow = Tables<'agent_conversations'>;
export type AgentSuggestionRow = Tables<'agent_suggestions'>;

/**
 * What a conversation write returns. The orchestrator only needs the id, and
 * echoing the whole row back meant re-downloading the full `messages` JSONB
 * blob (every turn so far) on each append.
 */
export type AgentConversationWriteResult = Pick<AgentConversationRow, 'id' | 'last_message_at'>;

/** Columns returned by conversation writes (see {@link AgentConversationWriteResult}). */
const CONVERSATION_WRITE_COLUMNS = 'id, last_message_at';

/** Active-window for loading a recent conversation (PRD §6 / §9: 30 days). */
const ACTIVE_WINDOW_DAYS = 30;
/** Cap messages loaded back into context (PRD §6). */
const MAX_LOADED_MESSAGES = 20;

// ─── Eval-harness dry-run opt-out (Task 4a / PRD §8.4) ───────────────
//
// A `userId` / `playerId` (and, downstream, a `conversationId`) carrying this
// prefix marks an EVAL DRY RUN: `runAgent` executes end-to-end but every memory
// call here short-circuits to an in-memory row instead of touching the DB. This
// lets the §8.4 eval harness exercise the agent with a FAKE, non-existent player
// id without violating the `players` FK, writing rows, or polluting real
// conversation history. Keying the opt-out off the id (rather than threading a
// separate `dry_run` flag through `AgentRequest`) is the cleanest fit, because
// identity already flows through `userId` everywhere in this module — and the
// `eval-` prefix is not a valid UUID, so it can never collide with a real
// `players.id`.

/** Identity prefix that marks an eval dry run (skips all persistence). */
export const DRY_RUN_USER_PREFIX = 'eval-';
/** Synthetic conversation id returned for dry runs; recognised by {@link isDryRunUser}. */
export const DRY_RUN_CONVERSATION_ID = 'eval-dry-run-conversation';

/** True when an id marks an eval dry run (see {@link DRY_RUN_USER_PREFIX}). */
export function isDryRunUser(id: string): boolean {
  return id.startsWith(DRY_RUN_USER_PREFIX);
}

/**
 * Default in-memory profile for a dry run. The eval harness encodes the model
 * under test in the id as `eval-<modelId>`, which we surface as the sole
 * `model_priority` entry so the router prefers that model first while the real
 * §2 escalation chain still falls through to other tiers (so the harness can
 * measure escalation rate). `eval-harness` (no model suffix) leaves priority
 * empty → plain registry order.
 */
function ephemeralProfile(playerId: string): AgentProfileRow {
  const now = new Date().toISOString();
  const suffix = playerId.slice(DRY_RUN_USER_PREFIX.length);
  const modelPriority = suffix && suffix !== 'harness' ? [suffix] : [];
  return {
    player_id: playerId,
    default_persona: 'linden_teambuilding',
    favorite_pokemon: null,
    model_priority: modelPriority as unknown as Json,
    opt_in_data_collection: false,
    play_style_tags: null,
    preferred_formats: null,
    created_at: now,
    updated_at: now,
  };
}

/** In-memory conversation write result for a dry run (never persisted). */
function ephemeralConversation(
  id: string = DRY_RUN_CONVERSATION_ID,
): AgentConversationWriteResult {
  return { id, last_message_at: new Date().toISOString() };
}

/** In-memory suggestion row for a dry run (never persisted). */
function ephemeralSuggestion(input: RecordSuggestionInput): AgentSuggestionRow {
  const now = new Date().toISOString();
  return {
    id: 'eval-dry-run-suggestion',
    player_id: input.playerId,
    conversation_id: input.conversationId,
    context_format: input.contextFormat,
    match_id: input.matchId ?? null,
    proposed_team: input.proposedTeam ?? null,
    reasoning: input.reasoning ?? null,
    suggested_at: now,
    topic_tags: input.topicTags ?? [],
    user_accepted_at: null,
    user_rejected_at: null,
  };
}

// ─── Profile ─────────────────────────────────────────────────────────

/**
 * Fetch the player's agent profile, creating a default row on first use. The
 * table defaults (`default_persona`, `model_priority`, …) come from the
 * migration, so the insert only needs the player id.
 */
export async function getOrCreateProfile(playerId: string): Promise<AgentProfileRow> {
  if (isDryRunUser(playerId)) return ephemeralProfile(playerId);
  const { data, error } = await supabase
    .from('user_agent_profile')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabase
    .from('user_agent_profile')
    .insert({ player_id: playerId })
    .select('*')
    .single();
  if (insertError) throw insertError;
  return created;
}

/** Fields a player may self-edit on their agent profile (PRD §7 config route). */
export interface AgentProfileConfigUpdate {
  model_priority?: string[];
  default_persona?: string;
}

/**
 * Update the player's agent config (model priority order and/or default
 * persona). Validation of the values (known model ids, persona enum) is the
 * caller's responsibility — this writes whatever it is handed.
 */
export async function updateProfileConfig(
  playerId: string,
  update: AgentProfileConfigUpdate,
): Promise<AgentProfileRow> {
  const patch: { model_priority?: Json; default_persona?: string } = {};
  if (update.model_priority !== undefined) {
    patch.model_priority = update.model_priority as unknown as Json;
  }
  if (update.default_persona !== undefined) {
    patch.default_persona = update.default_persona;
  }
  const { data, error } = await supabase
    .from('user_agent_profile')
    .update(patch)
    .eq('player_id', playerId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ─── Conversations ───────────────────────────────────────────────────

/** Parse the JSONB `messages` column into typed messages (best-effort). */
function parseMessages(raw: Json): AgentMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentMessage[] = [];
  for (const m of raw as unknown[]) {
    if (
      typeof m === 'object' &&
      m !== null &&
      typeof (m as { role?: unknown }).role === 'string' &&
      typeof (m as { content?: unknown }).content === 'string'
    ) {
      out.push(m as AgentMessage);
    }
  }
  return out;
}

export interface RecentConversation {
  id: string;
  persona: string;
  messages: AgentMessage[];
  last_message_at: string;
}

/**
 * Load the player's most recent non-archived conversation for a persona within
 * the 30-day active window, capping returned messages to the last
 * {@link MAX_LOADED_MESSAGES}. Returns null when there is none.
 */
export async function getRecentConversation(
  playerId: string,
  persona: string,
): Promise<RecentConversation | null> {
  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('id, persona, messages, last_message_at')
    .eq('player_id', playerId)
    .eq('persona', persona)
    .eq('is_archived', false)
    .gte('last_message_at', since)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const messages = parseMessages(data.messages);
  return {
    id: data.id,
    persona: data.persona,
    messages: messages.slice(-MAX_LOADED_MESSAGES),
    last_message_at: data.last_message_at,
  };
}

/**
 * True when `conversationId` exists, is not archived, and belongs to this
 * player under this persona. Used by the orchestrator to decide whether a
 * client-supplied `conversation_id` may be appended to (defends against a
 * client replaying another player's — or another persona's — conversation id).
 * Dry-run ids are always treated as owned (the eval harness never persists).
 */
export async function conversationBelongsTo(
  conversationId: string,
  playerId: string,
  persona: string,
): Promise<boolean> {
  if (isDryRunUser(playerId) || isDryRunUser(conversationId)) return true;
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('player_id, persona, is_archived')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return data.player_id === playerId && data.persona === persona && !data.is_archived;
}

/** Create a new conversation row and return its id and timestamp. */
export async function createConversation(
  playerId: string,
  persona: string,
  messages: AgentMessage[],
): Promise<AgentConversationWriteResult> {
  if (isDryRunUser(playerId)) return ephemeralConversation();
  const { data, error } = await supabase
    .from('agent_conversations')
    .insert({
      player_id: playerId,
      persona,
      messages: messages as unknown as Json,
    })
    .select(CONVERSATION_WRITE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Append messages to an existing conversation and bump `last_message_at`.
 * Reads the current array, concatenates, and writes back (the column is a
 * single JSONB blob per PRD §6). Returns only the id and new timestamp, so
 * the merged blob is not sent back over the wire.
 */
export async function appendMessages(
  conversationId: string,
  messages: AgentMessage[],
): Promise<AgentConversationWriteResult> {
  // Dry runs never created a real row, so there is nothing to read/merge into.
  if (isDryRunUser(conversationId)) {
    return ephemeralConversation(conversationId);
  }
  const { data: existing, error: readError } = await supabase
    .from('agent_conversations')
    .select('messages')
    .eq('id', conversationId)
    .single();
  if (readError) throw readError;

  const merged = [...parseMessages(existing.messages), ...messages];
  const { data, error } = await supabase
    .from('agent_conversations')
    .update({
      messages: merged as unknown as Json,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .select(CONVERSATION_WRITE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

// ─── Suggestions ─────────────────────────────────────────────────────

export interface RecordSuggestionInput {
  playerId: string;
  conversationId: string;
  contextFormat: string;
  matchId?: string | null;
  proposedTeam?: Json | null;
  reasoning?: string | null;
  topicTags?: string[];
}

/** Insert a single consolidated suggestion blob (PRD §6) and return the row. */
export async function recordSuggestion(
  input: RecordSuggestionInput,
): Promise<AgentSuggestionRow> {
  if (isDryRunUser(input.playerId)) return ephemeralSuggestion(input);
  const { data, error } = await supabase
    .from('agent_suggestions')
    .insert({
      player_id: input.playerId,
      conversation_id: input.conversationId,
      context_format: input.contextFormat,
      match_id: input.matchId ?? null,
      proposed_team: input.proposedTeam ?? null,
      reasoning: input.reasoning ?? null,
      topic_tags: input.topicTags ?? [],
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
