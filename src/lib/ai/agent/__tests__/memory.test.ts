import { config } from 'dotenv';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// LIVE-DATABASE test: it writes and deletes real rows. Automation must never
// spend the Supabase quota (AGENTS.md hard rule), so it runs only on an
// explicit opt-in, against a local stack:
//   AGENT_MEMORY_LIVE_DB=1 npx vitest run src/lib/ai/agent/__tests__/memory.test.ts
// Mocked coverage of the same module lives in memory-writes.test.ts.
const liveDbOptIn = process.env.AGENT_MEMORY_LIVE_DB === '1' && process.env.CI !== 'true';

if (liveDbOptIn) {
  // Load the env over vitest.config's placeholders so the Supabase client
  // constructs against the configured DB, before the query modules (which
  // build the client at import time) are dynamically imported.
  config({ override: true });
}

// Skip unless opted in / when env is missing / when the DB is unreachable.
// File-level beforeAll still runs when describe.skipIf is true, so it must not throw.
let noRealDb =
  !liveDbOptIn ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.NEXT_PUBLIC_SUPABASE_URL;

function isUnreachableSupabase(err: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 4 && current != null; i++) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === 'object' && current !== null && 'message' in current) {
      const message = (current as { message: unknown }).message;
      if (typeof message === 'string') parts.push(message);
    }
    break;
  }
  const text = parts.join(' ').toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('failed to fetch') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('network')
  );
}

type MemoryMod = typeof import('../memory');
type TournMod = typeof import('@/lib/supabase/queries/tournaments');
type ClientMod = typeof import('@/lib/supabase/client');

let memory: MemoryMod;
let tournaments: TournMod;
let supabase: ClientMod['supabase'] | undefined;

let playerId: string | null = null;
let profilePreexisted = false;
let createdConversationId: string | null = null;
let createdSuggestionId: string | null = null;

beforeAll(async () => {
  if (noRealDb) return;
  try {
    tournaments = await import('@/lib/supabase/queries/tournaments');
    memory = await import('../memory');
    supabase = (await import('@/lib/supabase/client')).supabase;

    // Discover a real player id (same approach as the supabase tool test).
    const lists = [await tournaments.listTournaments(), await tournaments.listAllTournaments()];
    for (const list of lists) {
      for (const t of list) {
        if (t.participant_count <= 0) continue;
        const parts = await tournaments.getParticipants(t.id);
        if (parts.length > 0) {
          playerId = parts[0].id;
          break;
        }
      }
      if (playerId) break;
    }

    // Record whether this player already had a profile so cleanup only removes
    // rows this test created.
    if (playerId) {
      const { data } = await supabase
        .from('user_agent_profile')
        .select('player_id')
        .eq('player_id', playerId)
        .maybeSingle();
      profilePreexisted = !!data;
    }
  } catch (err) {
    if (isUnreachableSupabase(err)) {
      noRealDb = true;
      return;
    }
    throw err;
  }
}, 30000);

beforeEach((ctx) => {
  if (noRealDb) ctx.skip();
});

afterAll(async () => {
  if (noRealDb || !supabase) return;
  // Suggestions cascade on conversation delete, but remove explicitly to be tidy.
  if (createdSuggestionId) {
    await supabase.from('agent_suggestions').delete().eq('id', createdSuggestionId);
  }
  if (createdConversationId) {
    await supabase.from('agent_conversations').delete().eq('id', createdConversationId);
  }
  if (playerId && !profilePreexisted) {
    await supabase.from('user_agent_profile').delete().eq('player_id', playerId);
  }
}, 30000);

describe.skipIf(noRealDb)('agent memory CRUD (real DB)', () => {
  it('getOrCreateProfile returns a row with sensible defaults', async () => {
    expect(playerId).not.toBeNull();
    const profile = await memory.getOrCreateProfile(playerId!);
    expect(profile.player_id).toBe(playerId);
    expect(typeof profile.default_persona).toBe('string');
    expect(profile.model_priority).toBeDefined();

    // Idempotent: a second call returns the same row, no duplicate.
    const again = await memory.getOrCreateProfile(playerId!);
    expect(again.player_id).toBe(playerId);
  }, 30000);

  it('creates a conversation, appends messages, and loads it back capped', async () => {
    expect(playerId).not.toBeNull();
    const conv = await memory.createConversation(playerId!, 'linden_teambuilding', [
      { role: 'user', content: 'Build me a team.' },
    ]);
    createdConversationId = conv.id;
    expect(conv.id).toBeTruthy();

    const updated = await memory.appendMessages(conv.id, [
      { role: 'assistant', content: 'Sure — what format?' },
    ]);
    // Writes return only the id and timestamp, never the messages blob.
    expect(updated).toEqual({ id: conv.id, last_message_at: expect.any(String) });

    const recent = await memory.getRecentConversation(playerId!, 'linden_teambuilding');
    expect(recent).not.toBeNull();
    expect(recent!.id).toBe(conv.id);
    expect(recent!.messages.length).toBe(2);
    expect(recent!.messages.length).toBeLessThanOrEqual(20);
    expect(recent!.messages[0].role).toBe('user');
  }, 30000);

  it('records a suggestion linked to the conversation', async () => {
    expect(createdConversationId).not.toBeNull();
    const suggestion = await memory.recordSuggestion({
      playerId: playerId!,
      conversationId: createdConversationId!,
      contextFormat: 'gen9ou',
      reasoning: 'Balanced core with hazard control.',
      proposedTeam: [{ species: 'Garchomp', moves: ['Earthquake'] }],
      topicTags: ['teambuilding'],
    });
    createdSuggestionId = suggestion.id;
    expect(suggestion.id).toBeTruthy();
    expect(suggestion.conversation_id).toBe(createdConversationId);
    expect(suggestion.context_format).toBe('gen9ou');
  }, 30000);

  it('conversationBelongsTo gates append-on-existing by player + persona', async () => {
    expect(createdConversationId).not.toBeNull();
    // Owner + matching persona → may append.
    expect(await memory.conversationBelongsTo(createdConversationId!, playerId!, 'linden_teambuilding')).toBe(true);
    // Wrong persona → not owned (cannot cross personas).
    expect(await memory.conversationBelongsTo(createdConversationId!, playerId!, 'kale')).toBe(false);
    // Wrong player → not owned.
    expect(await memory.conversationBelongsTo(createdConversationId!, 'not-the-owner', 'linden_teambuilding')).toBe(false);
  }, 30000);
});
