import { config } from 'dotenv';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// LIVE-DATABASE test: it reads real rows. Automation must never spend the
// Supabase quota (AGENTS.md hard rule), so it runs only on an explicit opt-in,
// against a local stack:
//   AGENT_TOOLS_LIVE_DB=1 npx vitest run src/lib/ai/agent/tools/__tests__/supabase.test.ts
const liveDbOptIn = process.env.AGENT_TOOLS_LIVE_DB === '1' && process.env.CI !== 'true';

if (liveDbOptIn) {
  // Load the env over vitest.config's placeholders so the Supabase client
  // constructs against the configured DB. Must run before the query modules
  // (which build the client at import time) are dynamically loaded.
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

type ToolsMod = typeof import('../supabase');
type TournMod = typeof import('@/lib/supabase/queries/tournaments');

let tools: ToolsMod;
let tournaments: TournMod;
// A real player id discovered from the linked DB (null if there is no data).
let playerId: string | null = null;

beforeAll(async () => {
  if (noRealDb) return;
  try {
    tournaments = await import('@/lib/supabase/queries/tournaments');
    tools = await import('../supabase');

    // Cheap discovery: find any tournament with participants and grab one player.
    const lists = [
      await tournaments.listTournaments(),
      await tournaments.listAllTournaments(),
    ];
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

describe.skipIf(noRealDb)('getMatchHistory', () => {
  it('returns an array of well-shaped completed matches (may be empty)', async () => {
    expect(playerId).not.toBeNull();
    const history = await tools.getMatchHistory({ playerId: playerId!, limit: 5 });
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeLessThanOrEqual(5);
    for (const h of history) {
      expect(typeof h.match_id).toBe('string');
      expect(typeof h.opponent_name).toBe('string');
      expect(typeof h.score).toBe('string');
      expect(Array.isArray(h.replay_urls)).toBe(true);
      expect(['win', 'loss', null]).toContain(h.result);
    }
  }, 30000);
});

describe.skipIf(noRealDb)('getUpcomingMatches', () => {
  it('returns an array (may be empty)', async () => {
    expect(playerId).not.toBeNull();
    const upcoming = await tools.getUpcomingMatches({ playerId: playerId! });
    expect(Array.isArray(upcoming)).toBe(true);
    for (const m of upcoming) {
      expect(typeof m.match_id).toBe('string');
      expect(typeof m.opponent_name).toBe('string');
      expect(['scheduled', 'in_progress']).toContain(m.status);
    }
  }, 30000);
});
