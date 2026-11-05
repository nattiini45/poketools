import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test for supabase/migrations/20261106090000_format_challenges.sql. It runs the query module against a LOCAL
// Supabase stack to prove the challenge functions: a challenge goes up the ladder within rank_range, one pair has one
// open challenge, max_open and the cooldown hold, the accept window expires an answer (stored, not rolled back), an
// accepted challenge creates one scheduled match in the phase's open round with the challenger as player 1, only the
// challenger (or an admin with a NULL player) withdraws, and format_challenges_expire counts what it expired. Opt-in
// only (`LOCAL_SUPABASE_FORMAT_CHALLENGES=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_CHALLENGES');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type ChallengesMod = typeof import('@/lib/supabase/queries/format-challenges');
type CreateInput = Parameters<ChallengesMod['createFormatChallenge']>[0];

let client: ClientMod['supabase'];
let ladder: ChallengesMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  season: randomUUID(),
  /** The phase that runs the ladder: a completed round 1 and a pending round 2 (its open round). */
  phase: randomUUID(),
  /** A phase of the same league without any round: no challenge can name a round in it. */
  emptyPhase: randomUUID(),
  roundDone: randomUUID(),
  roundOpen: randomUUID(),
  pChallenger: randomUUID(),
  pMid: randomUUID(),
  pDefender: randomUUID(),
  pTop: randomUUID(),
  /** A registered player who does not take part in the phase. */
  pOutsider: randomUUID(),
};
const PLAYERS = [ids.pChallenger, ids.pMid, ids.pDefender, ids.pTop, ids.pOutsider];
const PHASES = [ids.phase, ids.emptyPhase];

/** Places in the standings, 1 = first: the ladder lets a player challenge up to `rankRange` places above them. */
const RANK = new Map([
  [ids.pTop, 1],
  [ids.pDefender, 2],
  [ids.pMid, 3],
  [ids.pChallenger, 4],
]);

const create = (over: Partial<CreateInput> = {}) =>
  ladder.createFormatChallenge({
    seasonId: ids.season,
    phaseId: ids.phase,
    challengerId: ids.pChallenger,
    defenderId: ids.pTop,
    challengerRank: RANK.get(ids.pChallenger) as number,
    defenderRank: RANK.get(ids.pTop) as number,
    rankRange: 3,
    maxOpen: 4,
    cooldownRounds: 0,
    acceptWindowHours: 24,
    ...over,
  });

const stored = async () => ladder.listFormatChallenges(ids.season);
const rowOf = async (id: string) => (await stored()).find((row) => row.id === id);

const matchesOf = async () =>
  (
    await client
      .from('matches')
      .select('id, round_id, tournament_id, player_1_id, player_2_id, status')
      .eq('tournament_id', ids.phase)
  ).data ?? [];

/** The accept window of an open challenge run out, without waiting an hour. */
const lapse = async (id: string) => {
  const { error } = await client.from('format_challenges').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', id);
  if (error) throw new Error(`[lapse ${id}] ${JSON.stringify(error)}`);
};

const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
};

describe.skipIf(!optIn)('format challenges (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    ladder = await import('@/lib/supabase/queries/format-challenges');

    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Challenges ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert(
        PLAYERS.map((id, i) => ({ id, name: `Challenges ${RUN} ${i}`, is_guest: true })),
        { defaultToNull: false },
      ),
    );
    await run('seasons', client.from('seasons').insert({ id: ids.season, name: `Challenges ${RUN}`, format_type: 'custom' }));
    await run(
      'tournaments',
      client.from('tournaments').insert([
        { id: ids.phase, name: `Challenges ${RUN} Ladder`, season_id: ids.season, stage_order: 0, bracket_type: 'round_robin', ruleset_id: ids.ruleset, status: 'active' },
        { id: ids.emptyPhase, name: `Challenges ${RUN} Empty`, season_id: ids.season, stage_order: 1, bracket_type: 'round_robin', ruleset_id: ids.ruleset, status: 'active' },
      ]),
    );
    await run(
      'tournament_participants',
      client.from('tournament_participants').insert([
        { tournament_id: ids.phase, player_id: ids.pTop },
        { tournament_id: ids.phase, player_id: ids.pDefender },
        { tournament_id: ids.phase, player_id: ids.pMid },
        { tournament_id: ids.phase, player_id: ids.pChallenger },
        { tournament_id: ids.emptyPhase, player_id: ids.pTop },
        { tournament_id: ids.emptyPhase, player_id: ids.pChallenger },
      ]),
    );
    await run(
      'rounds',
      client.from('rounds').insert([
        { id: ids.roundDone, tournament_id: ids.phase, name: 'Round 1', round_number: 1, best_of: 1, status: 'completed' },
        { id: ids.roundOpen, tournament_id: ids.phase, name: 'Round 2', round_number: 2, best_of: 1, status: 'pending' },
      ]),
    );
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    await del('format_challenges', client.from('format_challenges').delete().eq('season_id', ids.season));
    await del('matches', client.from('matches').delete().in('tournament_id', PHASES));
    await del('rounds', client.from('rounds').delete().in('tournament_id', PHASES));
    await del('tournament_participants', client.from('tournament_participants').delete().in('tournament_id', PHASES));
    await del('tournaments', client.from('tournaments').delete().in('id', PHASES));
    await del('seasons', client.from('seasons').delete().eq('id', ids.season));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', PLAYERS));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60_000);

  beforeEach(async () => {
    await run('reset challenges', client.from('format_challenges').delete().eq('season_id', ids.season));
    await run('reset matches', client.from('matches').delete().in('tournament_id', PHASES));
    await run('reset phase', client.from('tournaments').update({ status: 'active' }).in('id', PHASES));
  }, 30_000);

  describe('format_challenge_create', () => {
    it('creates a challenge in the phase’s open round', async () => {
      const row = await create();

      expect(row).toMatchObject({
        season_id: ids.season,
        phase_id: ids.phase,
        challenger_id: ids.pChallenger,
        defender_id: ids.pTop,
        status: 'open',
        round: 2,
        responded_at: null,
        match_id: null,
      });
      expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(await stored()).toHaveLength(1);
    });

    it('refuses a challenge against yourself', async () => {
      await expect(create({ defenderId: ids.pChallenger, defenderRank: RANK.get(ids.pChallenger) })).rejects.toMatchObject({
        code: 'challenge_self',
      });
      expect(await stored()).toEqual([]);
    });

    it('refuses a defender who does not rank above the challenger, or who is too far above', async () => {
      // Down the ladder: the defender ranks below the challenger.
      await expect(
        create({ challengerId: ids.pTop, challengerRank: 1, defenderId: ids.pMid, defenderRank: RANK.get(ids.pMid) }),
      ).rejects.toMatchObject({ code: 'challenge_rank_range' });
      // Up the ladder but three places, with a range of one.
      await expect(create({ rankRange: 1 })).rejects.toMatchObject({ code: 'challenge_rank_range' });
      expect(await stored()).toEqual([]);
    });

    it('refuses a second open challenge between the same pair', async () => {
      await create();
      await expect(create()).rejects.toMatchObject({ code: 'challenge_already_open' });
      expect(await stored()).toHaveLength(1);
    });

    it('refuses past max_open, counted over the challenger’s open challenges', async () => {
      await create({ maxOpen: 1 });
      await expect(create({ maxOpen: 1, defenderId: ids.pDefender, defenderRank: RANK.get(ids.pDefender) })).rejects.toMatchObject({
        code: 'challenge_max_open',
      });
      expect(await stored()).toHaveLength(1);
    });

    it('counts an answered challenge in the cooldown but not a withdrawn one', async () => {
      const declined = await create();
      await ladder.respondToFormatChallenge({ challengeId: declined.id, playerId: ids.pTop, accept: false });
      await expect(create({ cooldownRounds: 1 })).rejects.toMatchObject({ code: 'challenge_cooldown' });
    });

    it('lets the same pair play again at once when the earlier challenge was withdrawn', async () => {
      const withdrawn = await create();
      await ladder.cancelFormatChallenge(withdrawn.id, ids.pChallenger);

      await expect(create({ cooldownRounds: 1 })).resolves.toMatchObject({ status: 'open' });
      expect(await stored()).toHaveLength(2);
    });

    it('refuses a phase of another league, a completed phase, a non-participant and a phase without a round', async () => {
      await expect(create({ seasonId: randomUUID() })).rejects.toMatchObject({ code: 'challenge_phase_not_found' });

      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));
      await expect(create()).rejects.toMatchObject({ code: 'challenge_phase_closed' });
      await run('phase active', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));

      await expect(create({ challengerId: ids.pOutsider, challengerRank: 5 })).rejects.toMatchObject({ code: 'challenge_not_participant' });
      await expect(create({ defenderId: ids.pOutsider, defenderRank: 1 })).rejects.toMatchObject({ code: 'challenge_not_participant' });

      await expect(create({ phaseId: ids.emptyPhase })).rejects.toMatchObject({ code: 'challenge_no_open_round' });
      expect(await stored()).toEqual([]);
    });
  });

  describe('format_challenge_respond', () => {
    it('accepts: one scheduled match in the open round, the challenger as player 1', async () => {
      const row = await create();

      const answered = await ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: true });

      expect(answered).toMatchObject({ id: row.id, status: 'accepted' });
      expect(answered.status).toBe('accepted');
      expect(answered.responded_at).not.toBeNull();
      const matches = await matchesOf();
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        round_id: ids.roundOpen,
        tournament_id: ids.phase,
        player_1_id: ids.pChallenger,
        player_2_id: ids.pTop,
        status: 'scheduled',
      });
      expect(answered.match_id).toBe(matches[0].id);
      // The match, not a round of its own: the challenge plays inside the open round.
      expect(matches[0].round_id).not.toBe(ids.roundDone);
    });

    it('declines without creating a match', async () => {
      const row = await create();

      const answered = await ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: false });

      expect(answered.status).toBe('declined');
      expect(answered.responded_at).not.toBeNull();
      expect(answered.match_id).toBeNull();
      expect(await matchesOf()).toEqual([]);
    });

    it('stores expired and raises challenge_expired for an answer after the accept window', async () => {
      const row = await create({ acceptWindowHours: 1 });
      await lapse(row.id);

      await expect(ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: true })).rejects.toMatchObject({
        code: 'challenge_expired',
        statusCode: 409,
      });
      // The status is kept: a RAISE would have rolled the expiry back.
      expect((await rowOf(row.id))?.status).toBe('expired');
      expect(await matchesOf()).toEqual([]);
    });

    it('asks only the defender, only while the challenge is open, and only in an open phase', async () => {
      const row = await create();
      await expect(
        ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pChallenger, accept: true }),
      ).rejects.toMatchObject({ code: 'challenge_not_defender' });
      await expect(ladder.respondToFormatChallenge({ challengeId: randomUUID(), playerId: ids.pTop, accept: true })).rejects.toMatchObject({
        code: 'challenge_not_found',
      });

      // A completed phase takes no accepted challenge (the match would land in a closed phase).
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));
      await expect(ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: true })).rejects.toMatchObject({
        code: 'challenge_phase_closed',
      });
      expect(await matchesOf()).toEqual([]);

      // Declining stays possible in a closed phase, and a second answer is refused.
      await run('phase active', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));
      await ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: false });
      await expect(ladder.respondToFormatChallenge({ challengeId: row.id, playerId: ids.pTop, accept: false })).rejects.toMatchObject({
        code: 'challenge_not_open',
      });
    });
  });

  describe('format_challenge_cancel', () => {
    it('lets the challenger withdraw, and an admin with a NULL player', async () => {
      const own = await create();
      const withdrawn = await ladder.cancelFormatChallenge(own.id, ids.pChallenger);
      expect(withdrawn.status).toBe('cancelled');
      expect(withdrawn.responded_at).not.toBeNull();

      const byAdmin = await create();
      expect((await ladder.cancelFormatChallenge(byAdmin.id, null)).status).toBe('cancelled');
    });

    it('refuses anyone else, an unknown challenge, and a challenge that is no longer open', async () => {
      const row = await create();
      await expect(ladder.cancelFormatChallenge(row.id, ids.pTop)).rejects.toMatchObject({ code: 'challenge_not_challenger' });
      await expect(ladder.cancelFormatChallenge(randomUUID(), ids.pChallenger)).rejects.toMatchObject({ code: 'challenge_not_found' });

      await ladder.cancelFormatChallenge(row.id, ids.pChallenger);
      await expect(ladder.cancelFormatChallenge(row.id, ids.pChallenger)).rejects.toMatchObject({ code: 'challenge_not_open' });
      expect((await rowOf(row.id))?.status).toBe('cancelled');
    });
  });

  describe('format_challenges_expire', () => {
    it('expires the lapsed open challenges of one league and returns how many', async () => {
      const lapsed = await create({ acceptWindowHours: 1, defenderId: ids.pTop });
      const other = await create({
        acceptWindowHours: 1,
        defenderId: ids.pDefender,
        defenderRank: RANK.get(ids.pDefender),
      });
      const stillOpen = await create({
        acceptWindowHours: 24,
        defenderId: ids.pMid,
        defenderRank: RANK.get(ids.pMid),
      });
      await lapse(lapsed.id);
      await lapse(other.id);

      await expect(ladder.expireFormatChallenges(ids.season)).resolves.toBe(2);

      const statuses = new Map((await stored()).map((row) => [row.id, row.status]));
      expect(statuses.get(lapsed.id)).toBe('expired');
      expect(statuses.get(other.id)).toBe('expired');
      expect(statuses.get(stillOpen.id)).toBe('open');
    });

    it('expires nothing when no window has run out', async () => {
      await create({ acceptWindowHours: 24 });
      await expect(ladder.expireFormatChallenges(ids.season)).resolves.toBe(0);
    });
  });
});
