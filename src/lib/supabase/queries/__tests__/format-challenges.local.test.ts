import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test for supabase/migrations/20261106090000_format_challenges.sql. It runs the query module against a LOCAL
// Supabase stack to prove the challenge functions: a challenge goes up the ladder within rank_range, one pair has one
// open challenge, max_open and the cooldown hold, the accept window expires an answer (stored, not rolled back), an
// accepted challenge creates one scheduled match in the phase's open round with the challenger as player 1, only the
// challenger (or an admin with a NULL player) withdraws, and format_challenges_expire counts what it expired. The
// completion functions (round_complete, phase_complete_at_stage_end) and an accept are serialised on the round and the
// phase rows: in either order, and under a real race, no match is left unfinished in a round or phase that completed
// without force. The round generators' write (round_write: a round and its matches in one transaction, the phase row read
// FOR SHARE) is serialised with the stage end the same way, and a write into an existing empty round (a retry) locks that
// round: of two concurrent retries one writes, a completed round takes none. Create and accept read the league's engine
// under a lock: only 'kit' runs the ladder (an engine switch next to an accept leaves a match only when the accept won).
// Opt-in only (`LOCAL_SUPABASE_FORMAT_CHALLENGES=1` or
// `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_CHALLENGES');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type ChallengesMod = typeof import('@/lib/supabase/queries/format-challenges');
type RoundsMod = typeof import('@/lib/supabase/queries/rounds');
type TournamentsMod = typeof import('@/lib/supabase/queries/tournaments');
type CreateInput = Parameters<ChallengesMod['createFormatChallenge']>[0];

let client: ClientMod['supabase'];
let ladder: ChallengesMod;
let roundsQ: RoundsMod;
let tournamentsQ: TournamentsMod;

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

/** Takes a player out of the ladder phase's enrollment for the duration of `fn` and puts them back, whatever happens. */
const withoutEnrollment = async (playerId: string, fn: () => Promise<void>) => {
  await run('unenroll', client.from('tournament_participants').delete().eq('tournament_id', ids.phase).eq('player_id', playerId));
  try {
    await fn();
  } finally {
    await run('re-enroll', client.from('tournament_participants').insert({ tournament_id: ids.phase, player_id: playerId }));
  }
};

const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
};

/** What an admin's PUT format/engine does to the league: a plain UPDATE of season_formats.engine. */
const setEngine = (engine: 'legacy' | 'shadow' | 'kit') =>
  run(`engine ${engine}`, client.from('season_formats').update({ engine }).eq('season_id', ids.season));

describe.skipIf(!optIn)('format challenges (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    ladder = await import('@/lib/supabase/queries/format-challenges');
    roundsQ = await import('@/lib/supabase/queries/rounds');
    tournamentsQ = await import('@/lib/supabase/queries/tournaments');

    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Challenges ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert(
        PLAYERS.map((id, i) => ({ id, name: `Challenges ${RUN} ${i}`, is_guest: true })),
        { defaultToNull: false },
      ),
    );
    await run('seasons', client.from('seasons').insert({ id: ids.season, name: `Challenges ${RUN}`, format_type: 'custom' }));
    // The ladder runs on the kit engine only: the league carries an attached format on that engine (the spec is not read).
    await run(
      'season_formats',
      client.from('season_formats').insert({
        season_id: ids.season,
        version_no: 1,
        spec: {},
        spec_hash: '0'.repeat(64),
        seed: `challenges-${RUN}`,
        engine: 'kit',
      }),
    );
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
    await run('reset round', client.from('rounds').update({ status: 'pending' }).eq('id', ids.roundOpen));
    await setEngine('kit');
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
      await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: declined.id, playerId: ids.pTop, accept: false });
      await expect(create({ cooldownRounds: 1 })).rejects.toMatchObject({ code: 'challenge_cooldown' });
    });

    it('lets the same pair play again at once when the earlier challenge was withdrawn', async () => {
      const withdrawn = await create();
      await ladder.cancelFormatChallenge(ids.season, withdrawn.id, ids.pChallenger);

      await expect(create({ cooldownRounds: 1 })).resolves.toMatchObject({ status: 'open' });
      expect(await stored()).toHaveLength(2);
    });

    it('stores a withdrawal after the accept window as expired, which the cooldown still counts', async () => {
      const lapsed = await create({ acceptWindowHours: 1 });
      await lapse(lapsed.id);

      // Nothing marked the challenge expired yet; withdrawing it must not turn it into a free `cancelled` one.
      await expect(ladder.cancelFormatChallenge(ids.season, lapsed.id, ids.pChallenger)).rejects.toMatchObject({
        code: 'challenge_expired',
        statusCode: 409,
      });
      // The status is kept (a RAISE would have rolled it back): expired, answered by no one, not withdrawn.
      expect(await rowOf(lapsed.id)).toMatchObject({ status: 'expired', responded_at: null });
      await expect(create({ cooldownRounds: 1 })).rejects.toMatchObject({ code: 'challenge_cooldown' });
      expect(await stored()).toHaveLength(1);

      // The admin path (player NULL) is the same, and a second withdrawal finds it expired, not open.
      await expect(ladder.cancelFormatChallenge(ids.season, lapsed.id, null)).rejects.toMatchObject({ code: 'challenge_not_open' });
    });

    it('cancels an open challenge of a player who left the phase, so it neither counts against max_open nor lingers', async () => {
      const stale = await create({ maxOpen: 1 });
      await withoutEnrollment(ids.pTop, async () => {
        // maxOpen 1 would refuse a second challenge while the first, against the removed player, still counted.
        const fresh = await create({ maxOpen: 1, defenderId: ids.pDefender, defenderRank: RANK.get(ids.pDefender) as number });
        expect(fresh.status).toBe('open');
        expect(await rowOf(stale.id)).toMatchObject({ status: 'cancelled', match_id: null });
        expect((await rowOf(stale.id))?.responded_at).not.toBeNull();
      });
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

      const answered = await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true });

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

    it('cancels instead of accepting when the defender or the challenger left the phase since', async () => {
      for (const leaver of [ids.pTop, ids.pChallenger]) {
        const row = await create();
        await withoutEnrollment(leaver, async () => {
          await expect(
            ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true }),
          ).rejects.toMatchObject({ code: 'challenge_player_not_enrolled', statusCode: 409 });
        });
        // The status is kept (a RAISE would have rolled it back): cancelled, no match, answered at a moment.
        expect(await rowOf(row.id)).toMatchObject({ status: 'cancelled', match_id: null });
        expect((await rowOf(row.id))?.responded_at).not.toBeNull();
        expect(await matchesOf()).toEqual([]);
        // A second answer finds it no longer open.
        await expect(
          ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true }),
        ).rejects.toMatchObject({ code: 'challenge_not_open' });
        await run('reset challenges', client.from('format_challenges').delete().eq('season_id', ids.season));
      }
    });

    it('lets the defender decline after the challenger left the phase, and accepts once both are enrolled again', async () => {
      const declined = await create();
      await withoutEnrollment(ids.pChallenger, async () => {
        await expect(
          ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: declined.id, playerId: ids.pTop, accept: false }),
        ).resolves.toMatchObject({ status: 'declined' });
      });
      const row = await create();
      await expect(
        ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true }),
      ).resolves.toMatchObject({ status: 'accepted' });
      expect(await matchesOf()).toHaveLength(1);
    });

    it('refuses an accept while the league does not run the kit engine: no match, the challenge stays open, and it works again on kit', async () => {
      const row = await create();

      for (const engine of ['legacy', 'shadow'] as const) {
        await setEngine(engine);
        await expect(
          ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true }),
        ).rejects.toMatchObject({ code: 'challenge_ladder_inactive', statusCode: 409 });
        expect(await matchesOf()).toEqual([]);
        expect((await rowOf(row.id))?.status).toBe('open');
      }

      await setEngine('kit');
      const answered = await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true });
      expect(answered.status).toBe('accepted');
      expect(await matchesOf()).toHaveLength(1);
    });

    it('lets the defender decline and the challenger withdraw while the engine is not kit (they only close a challenge)', async () => {
      const declined = await create();
      const withdrawn = await create({ defenderId: ids.pDefender, defenderRank: RANK.get(ids.pDefender) as number });
      await setEngine('shadow');

      await expect(
        ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: declined.id, playerId: ids.pTop, accept: false }),
      ).resolves.toMatchObject({ status: 'declined' });
      await expect(ladder.cancelFormatChallenge(ids.season, withdrawn.id, ids.pChallenger)).resolves.toMatchObject({ status: 'cancelled' });
      expect(await matchesOf()).toEqual([]);
    });

    it('makes a challenge only on kit, and refuses both make and accept in a league whose format is gone', async () => {
      const row = await create();

      await setEngine('legacy');
      await expect(create({ defenderId: ids.pDefender, defenderRank: RANK.get(ids.pDefender) as number })).rejects.toMatchObject({
        code: 'challenge_ladder_inactive',
        statusCode: 409,
      });
      // Nothing was made by the refused call; the open challenge is the one from before the switch.
      expect((await stored()).map((challenge) => challenge.id)).toEqual([row.id]);

      await setEngine('kit');
      await expect(create({ defenderId: ids.pDefender, defenderRank: RANK.get(ids.pDefender) as number })).resolves.toMatchObject({ status: 'open' });

      const saved = (await client.from('season_formats').select('*').eq('season_id', ids.season).single()).data as Record<string, unknown>;
      await run('format detached', client.from('season_formats').delete().eq('season_id', ids.season));
      try {
        await expect(
          ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true }),
        ).rejects.toMatchObject({ code: 'challenge_ladder_inactive' });
        await expect(create({ challengerId: ids.pMid, challengerRank: 3, defenderId: ids.pTop })).rejects.toMatchObject({ code: 'challenge_ladder_inactive' });
      } finally {
        await run('format re-attached', client.from('season_formats').insert(saved as never));
      }
      expect(await matchesOf()).toEqual([]);
    });

    it('declines without creating a match', async () => {
      const row = await create();

      const answered = await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: false });

      expect(answered.status).toBe('declined');
      expect(answered.responded_at).not.toBeNull();
      expect(answered.match_id).toBeNull();
      expect(await matchesOf()).toEqual([]);
    });

    it('stores expired and raises challenge_expired for an answer after the accept window', async () => {
      const row = await create({ acceptWindowHours: 1 });
      await lapse(row.id);

      await expect(ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true })).rejects.toMatchObject({
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
        ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pChallenger, accept: true }),
      ).rejects.toMatchObject({ code: 'challenge_not_defender' });
      await expect(ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: randomUUID(), playerId: ids.pTop, accept: true })).rejects.toMatchObject({
        code: 'challenge_not_found',
      });

      // A completed phase takes no accepted challenge (the match would land in a closed phase).
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));
      await expect(ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: true })).rejects.toMatchObject({
        code: 'challenge_phase_closed',
      });
      expect(await matchesOf()).toEqual([]);

      // Declining stays possible in a closed phase, and a second answer is refused.
      await run('phase active', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));
      await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: false });
      await expect(ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.pTop, accept: false })).rejects.toMatchObject({
        code: 'challenge_not_open',
      });
    });
  });

  describe('format_challenge_respond across leagues', () => {
    it('does not reach a challenge of another league, even for its defender', async () => {
      const row = await create();
      await expect(
        ladder.respondToFormatChallenge({ seasonId: randomUUID(), challengeId: row.id, playerId: ids.pTop, accept: true }),
      ).rejects.toMatchObject({ code: 'challenge_not_found' });
      expect((await rowOf(row.id))?.status).toBe('open');
      expect(await matchesOf()).toEqual([]);
    });
  });

  describe('format_challenge_cancel', () => {
    it('lets the challenger withdraw, and an admin with a NULL player', async () => {
      const own = await create();
      const withdrawn = await ladder.cancelFormatChallenge(ids.season, own.id, ids.pChallenger);
      expect(withdrawn.status).toBe('cancelled');
      expect(withdrawn.responded_at).not.toBeNull();

      const byAdmin = await create();
      expect((await ladder.cancelFormatChallenge(ids.season, byAdmin.id, null)).status).toBe('cancelled');
    });

    it('refuses anyone else, an unknown challenge, and a challenge that is no longer open', async () => {
      const row = await create();
      await expect(ladder.cancelFormatChallenge(ids.season, row.id, ids.pTop)).rejects.toMatchObject({ code: 'challenge_not_challenger' });
      await expect(ladder.cancelFormatChallenge(ids.season, randomUUID(), ids.pChallenger)).rejects.toMatchObject({ code: 'challenge_not_found' });

      await ladder.cancelFormatChallenge(ids.season, row.id, ids.pChallenger);
      await expect(ladder.cancelFormatChallenge(ids.season, row.id, ids.pChallenger)).rejects.toMatchObject({ code: 'challenge_not_open' });
      expect((await rowOf(row.id))?.status).toBe('cancelled');
    });

    it('does not reach a challenge of another league, for the challenger or for an admin', async () => {
      const row = await create();
      const elsewhere = randomUUID();
      await expect(ladder.cancelFormatChallenge(elsewhere, row.id, ids.pChallenger)).rejects.toMatchObject({ code: 'challenge_not_found' });
      await expect(ladder.cancelFormatChallenge(elsewhere, row.id, null)).rejects.toMatchObject({ code: 'challenge_not_found' });
      expect((await rowOf(row.id))?.status).toBe('open');
    });
  });

  describe('completing the round or the phase next to an accept', () => {
    const accept = (challengeId: string) =>
      ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId, playerId: ids.pTop, accept: true });
    const statusOf = async (table: 'rounds' | 'tournaments', id: string) =>
      ((await client.from(table).select('status').eq('id', id).single()).data as { status: string }).status;
    const unfinishedMatches = async () =>
      (await matchesOf()).filter((match) => match.status !== 'completed').map((match) => match.id);
    const resetRace = async () => {
      await run('reset matches', client.from('matches').delete().in('tournament_id', PHASES));
      await run('reset challenges', client.from('format_challenges').delete().eq('season_id', ids.season));
      await run('reset phase', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));
      await run('reset round', client.from('rounds').update({ status: 'pending' }).eq('id', ids.roundOpen));
    };

    it('refuses an accept once the round completed: no match is made in a completed round', async () => {
      const row = await create();

      await expect(roundsQ.completeRound(ids.roundOpen, { force: false })).resolves.toMatchObject({ outcome: 'completed', unfinished: 0 });

      await expect(accept(row.id)).rejects.toMatchObject({ code: 'challenge_no_open_round', statusCode: 409 });
      expect(await matchesOf()).toEqual([]);
      expect((await rowOf(row.id))?.status).toBe('open');
    });

    // The accept looks for the open round again when the one it picked completed meanwhile (the highest round that is not
    // completed). Round 3 is added on top of round 2 for these cases, so a round is left to fall back to.
    describe('with a second open round', () => {
      const roundHigh = randomUUID();
      const dropHighRound = async () => {
        await run('high round matches', client.from('matches').delete().eq('round_id', roundHigh));
        await run('high round', client.from('rounds').delete().eq('id', roundHigh));
      };

      beforeEach(async () => {
        await dropHighRound();
        await run(
          'high round',
          client.from('rounds').insert({ id: roundHigh, tournament_id: ids.phase, name: 'Round 3', round_number: 3, best_of: 1, status: 'pending' }),
        );
      });
      afterAll(async () => {
        await dropHighRound();
      });

      it('creates and accepts into the highest open round while it is open', async () => {
        const row = await create();
        expect(row.round).toBe(3);

        const answered = await accept(row.id);

        expect((await matchesOf()).find((match) => match.id === answered.match_id)?.round_id).toBe(roundHigh);
      });

      it('falls back to the next open round when the one it would pick completed: the match lands there, never in the completed round', async () => {
        const row = await create();
        await expect(roundsQ.completeRound(roundHigh, { force: false })).resolves.toMatchObject({ outcome: 'completed', unfinished: 0 });

        const answered = await accept(row.id);

        expect(answered.status).toBe('accepted');
        const matches = await matchesOf();
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({ id: answered.match_id, round_id: ids.roundOpen, status: 'scheduled' });
        expect(matches.filter((match) => match.round_id === roundHigh)).toEqual([]);
        expect(await statusOf('rounds', ids.roundOpen)).toBe('pending');
      });

      it('skips every completed round above the open one and still refuses once none is left', async () => {
        const row = await create();
        await roundsQ.completeRound(roundHigh, { force: false });
        await roundsQ.completeRound(ids.roundOpen, { force: false });

        await expect(accept(row.id)).rejects.toMatchObject({ code: 'challenge_no_open_round', statusCode: 409 });
        expect(await matchesOf()).toEqual([]);
      });

      it('lands the match in exactly one open round, and a completed round holds none, however the accept and the completion interleave', async () => {
        for (let i = 0; i < 12; i++) {
          await resetRace();
          await run('high round matches', client.from('matches').delete().eq('round_id', roundHigh));
          await run('high round', client.from('rounds').update({ status: 'pending' }).eq('id', roundHigh));
          const row = await create();

          const [accepted, completed] = await Promise.allSettled([accept(row.id), roundsQ.completeRound(roundHigh, { force: false })]);

          // Round 2 stays open, so the accept always finds a round: it never raises challenge_no_open_round.
          expect(accepted.status).toBe('fulfilled');
          const matches = await matchesOf();
          expect(matches).toHaveLength(1);
          const highCompleted = (await statusOf('rounds', roundHigh)) === 'completed';
          if (matches[0].round_id === roundHigh) {
            // The match went in first: the completion counted it and was refused.
            expect(highCompleted).toBe(false);
            expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('unfinished');
          } else {
            // The completion went first: the match fell back to round 2.
            expect(matches[0].round_id).toBe(ids.roundOpen);
            expect(highCompleted).toBe(true);
            expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('completed');
          }
        }
      }, 60_000);
    });

    it('counts a match accepted before the completion: refused without force, reported with force', async () => {
      const row = await create();
      await accept(row.id);

      await expect(roundsQ.completeRound(ids.roundOpen, { force: false })).resolves.toEqual({ outcome: 'unfinished', unfinished: 1 });
      expect(await statusOf('rounds', ids.roundOpen)).toBe('pending');

      await expect(roundsQ.completeRound(ids.roundOpen, { force: true })).resolves.toMatchObject({
        outcome: 'completed',
        unfinished: 1,
        round: { id: ids.roundOpen, status: 'completed' },
      });
      expect(await statusOf('rounds', ids.roundOpen)).toBe('completed');
    });

    it('answers a repeat, a completed round and an unknown round with unchanged', async () => {
      await roundsQ.completeRound(ids.roundOpen, { force: false });

      await expect(roundsQ.completeRound(ids.roundOpen, { force: false })).resolves.toEqual({ outcome: 'unchanged' });
      await expect(roundsQ.completeRound(ids.roundDone, { force: true })).resolves.toEqual({ outcome: 'unchanged' });
      await expect(roundsQ.completeRound(randomUUID(), { force: false })).resolves.toEqual({ outcome: 'unchanged' });
    });

    it('keeps the phase active at its stage end while a match exists that the read did not see, then completes', async () => {
      const row = await create();
      const answered = await accept(row.id);
      const matchId = answered.match_id as string;

      // The caller read the phase's matches before the accept: it knows of none.
      await expect(tournamentsQ.completeTournamentIfActive(ids.phase, [])).resolves.toEqual({ outcome: 'unsettled', unknownUnfinished: 1 });
      expect(await statusOf('tournaments', ids.phase)).toBe('active');

      // A caller that saw the match (a forced-complete round may leave one behind) completes it, exactly once.
      await expect(tournamentsQ.completeTournamentIfActive(ids.phase, [matchId])).resolves.toMatchObject({
        outcome: 'completed',
        tournament: { id: ids.phase, status: 'completed' },
      });
      await expect(tournamentsQ.completeTournamentIfActive(ids.phase, [matchId])).resolves.toEqual({ outcome: 'not_active' });
    });

    it('completes a phase with no unfinished match, ignores an unknown phase, and refuses an accept after an admin completion', async () => {
      await expect(tournamentsQ.completeTournamentIfActive(ids.phase, [])).resolves.toMatchObject({ outcome: 'completed' });
      // Reopened by an admin, challenged, then completed by an admin (a plain status write): the accept finds it closed.
      await run('phase active', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));
      const row = await create();
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));
      await expect(accept(row.id)).rejects.toMatchObject({ code: 'challenge_phase_closed' });
      expect(await matchesOf()).toEqual([]);

      await expect(tournamentsQ.completeTournamentIfActive(randomUUID(), [])).resolves.toEqual({ outcome: 'not_active' });
    });

    // A real race over HTTP: whichever of the two wins, the pair of results must agree. The accept either made its match
    // before the completion (counted, so a completion without force is refused) or found the round completed.
    it('never leaves an unfinished match in a round that completed without force, however the accept and the completion interleave', async () => {
      for (let i = 0; i < 12; i++) {
        await resetRace();
        const row = await create();

        const [accepted, completed] = await Promise.allSettled([accept(row.id), roundsQ.completeRound(ids.roundOpen, { force: false })]);

        const roundCompleted = (await statusOf('rounds', ids.roundOpen)) === 'completed';
        const unfinished = await unfinishedMatches();
        // The forbidden state.
        expect(roundCompleted && unfinished.length > 0).toBe(false);
        if (accepted.status === 'fulfilled') {
          expect(unfinished).toHaveLength(1);
          expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('unfinished');
        } else {
          expect(accepted.reason).toMatchObject({ code: 'challenge_no_open_round' });
          expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('completed');
        }
      }
    }, 60_000);

    it('never leaves an unseen unfinished match in a phase that ended, however the accept and the stage end interleave', async () => {
      for (let i = 0; i < 12; i++) {
        await resetRace();
        const row = await create();

        // The stage end read the phase's matches before the accept: it knows of none.
        const [accepted, ended] = await Promise.allSettled([accept(row.id), tournamentsQ.completeTournamentIfActive(ids.phase, [])]);

        const phaseCompleted = (await statusOf('tournaments', ids.phase)) === 'completed';
        const unfinished = await unfinishedMatches();
        expect(phaseCompleted && unfinished.length > 0).toBe(false);
        if (accepted.status === 'fulfilled') {
          expect(unfinished).toHaveLength(1);
          expect(ended.status === 'fulfilled' && ended.value.outcome).toBe('unsettled');
        } else {
          expect(accepted.reason).toMatchObject({ code: 'challenge_phase_closed' });
          expect(ended.status === 'fulfilled' && ended.value.outcome).toBe('completed');
        }
      }
    }, 60_000);

    // The engine switch is a plain UPDATE of the league's season_formats row; the accept holds that row FOR SHARE until its
    // match exists, so either the accept commits first (its match stands, the switch follows) or the switch commits first
    // (the accept is refused and made no match). Never a match the accept made after the switch.
    // This can only check the outcome: it cannot show that the accept took its engine lock before the challenge row, so that
    // lock order is pinned by the static test in format-runtime-migrations.test.ts ("reads the league engine FOR SHARE ...").
    it('serialises an engine switch with an accept: a refusal leaves no match and the challenge open, in either order', async () => {
      for (let i = 0; i < 12; i++) {
        await resetRace();
        await setEngine('kit');
        const row = await create();

        const [accepted] = await Promise.allSettled([accept(row.id), setEngine(i % 2 === 0 ? 'shadow' : 'legacy')]);

        const { data } = await client.from('season_formats').select('engine').eq('season_id', ids.season).single();
        expect((data as { engine: string }).engine).not.toBe('kit');
        if (accepted.status === 'rejected') {
          expect(accepted.reason).toMatchObject({ code: 'challenge_ladder_inactive' });
          expect(await matchesOf()).toEqual([]);
          expect((await rowOf(row.id))?.status).toBe('open');
        } else {
          expect(await matchesOf()).toHaveLength(1);
          expect((await rowOf(row.id))?.status).toBe('accepted');
        }
      }
    }, 60_000);

    it('serialises an admin completion (a plain status write) with an accept: a refusal leaves no match, in either order', async () => {
      for (let i = 0; i < 12; i++) {
        await resetRace();
        const row = await create();

        const [accepted] = await Promise.allSettled([
          accept(row.id),
          Promise.resolve(client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase)).then(({ error }) => {
            if (error) throw new Error(JSON.stringify(error));
          }),
        ]);

        // Accept first: its match stands and the admin's completion follows (the admin chose to complete). Completion first:
        // the accept is refused and made no match.
        expect(await statusOf('tournaments', ids.phase)).toBe('completed');
        if (accepted.status === 'rejected') {
          expect(accepted.reason).toMatchObject({ code: 'challenge_phase_closed' });
          expect(await matchesOf()).toEqual([]);
        } else {
          expect(await matchesOf()).toHaveLength(1);
        }
      }
    }, 60_000);
  });

  // The round generators write a round and its matches through round_write: one transaction with the phase row read FOR SHARE,
  // so a stage end (phase_complete_at_stage_end, FOR UPDATE on the same row) and a round write are serialised. In either order
  // the forbidden state (a completed phase that holds a round or an unfinished match the stage end did not see) cannot appear.
  describe('writing a round next to the stage end (round_write)', () => {
    const pairs = [
      { player_1_id: ids.pTop, player_2_id: ids.pDefender },
      { player_1_id: ids.pMid, player_2_id: ids.pChallenger },
    ];
    const write = (over: Partial<Parameters<RoundsMod['createRoundWithMatches']>[0]> = {}) =>
      roundsQ.createRoundWithMatches({ tournament_id: ids.phase, name: 'Round 10', round_number: 10, best_of: 1, matches: pairs, ...over });
    const written = async () => ((await client.from('rounds').select('id').eq('tournament_id', ids.phase).gte('round_number', 10)).data ?? []).length;
    const statusOf = async () =>
      ((await client.from('tournaments').select('status').eq('id', ids.phase).single()).data as { status: string }).status;
    const reset = async () => {
      await run('reset matches', client.from('matches').delete().in('tournament_id', PHASES));
      await run('reset written rounds', client.from('rounds').delete().eq('tournament_id', ids.phase).gte('round_number', 10));
      await run('reset phase', client.from('tournaments').update({ status: 'active' }).eq('id', ids.phase));
    };

    beforeEach(reset);
    afterAll(reset);

    it('writes the round and its matches together: scheduled matches of this phase and round, the byes on the round', async () => {
      const round = await write({ bye_player_ids: [ids.pOutsider] });

      expect(round).toMatchObject({ tournament_id: ids.phase, name: 'Round 10', round_number: 10, best_of: 1, bye_player_ids: [ids.pOutsider], pairings_generated: true });
      const matches = (await matchesOf()).filter((match) => match.round_id === round.id);
      expect(matches.map((match) => [match.player_1_id, match.player_2_id, match.status, match.tournament_id])).toEqual([
        [ids.pTop, ids.pDefender, 'scheduled', ids.phase],
        [ids.pMid, ids.pChallenger, 'scheduled', ids.phase],
      ]);
    });

    it('writes a round of byes only (no match) and a round without a bye list', async () => {
      const round = await write({ matches: [] });

      expect(round).toMatchObject({ round_number: 10, bye_player_ids: [] });
      expect((await matchesOf()).filter((match) => match.round_id === round.id)).toEqual([]);
    });

    it('refuses a completed phase with rounds_phase_completed and leaves nothing behind: no round, no match', async () => {
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));

      await expect(write()).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });

      expect(await written()).toBe(0);
      expect(await matchesOf()).toEqual([]);
    });

    it('refuses the matches of a reused round in a completed phase the same way', async () => {
      const empty = await write({ matches: [] });
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));

      await expect(roundsQ.addMatchesToRound(empty, pairs)).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });
      expect(await matchesOf()).toEqual([]);
    });

    const byesOf = async (roundId: string) =>
      ((await client.from('rounds').select('bye_player_ids').eq('id', roundId).single()).data as { bye_player_ids: string[] }).bye_player_ids;

    it('replaces the byes of a reused round in the same write as its matches, and keeps them when none are given', async () => {
      const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });

      await roundsQ.addMatchesToRound(empty, pairs);
      expect(await byesOf(empty.id)).toEqual([ids.pOutsider]);

      const other = await write({ round_number: 11, name: 'Round 11', matches: [], bye_player_ids: [ids.pOutsider] });
      await roundsQ.addMatchesToRound(other, pairs, [ids.pTop]);
      expect(await byesOf(other.id)).toEqual([ids.pTop]);
      expect((await matchesOf()).filter((match) => match.round_id === other.id)).toHaveLength(2);
    });

    it('leaves the stored byes of a reused round as they were when the write is refused (the phase completed first)', async () => {
      const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));

      await expect(roundsQ.addMatchesToRound(empty, pairs, [ids.pTop])).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });
      // A bye-only retry (no matches) is refused the same way and does not change the byes either.
      await expect(roundsQ.addMatchesToRound(empty, [], [ids.pMid])).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });

      expect(await byesOf(empty.id)).toEqual([ids.pOutsider]);
      expect(await matchesOf()).toEqual([]);
    });

    it('stores the byes of a retried round that has no matches at all (a round of byes only)', async () => {
      const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });

      await roundsQ.addMatchesToRound(empty, [], [ids.pTop]);

      expect(await byesOf(empty.id)).toEqual([ids.pTop]);
      expect(await matchesOf()).toEqual([]);
    });

    it('fills a round an interrupted call left empty, and only a round of the phase itself', async () => {
      const empty = await write({ matches: [] });

      await roundsQ.addMatchesToRound(empty, pairs);
      expect((await matchesOf()).filter((match) => match.round_id === empty.id)).toHaveLength(2);

      // A round of another phase of the league is not this phase's own: the function refuses it, nothing is written.
      const foreign = { id: ids.roundOpen, name: 'Round 2', tournament_id: ids.emptyPhase };
      await expect(roundsQ.addMatchesToRound(foreign, pairs)).rejects.toMatchObject({ code: 'round_not_found', statusCode: 404 });
      expect((await client.from('matches').select('id').eq('tournament_id', ids.emptyPhase)).data).toEqual([]);
    });

    describe('resuming an empty round (a retry of generate-round / generate-all-rounds)', () => {
      const matchesOfRound = async (roundId: string) => (await matchesOf()).filter((match) => match.round_id === roundId);
      const statusOfRound = async (roundId: string) =>
        ((await client.from('rounds').select('status').eq('id', roundId).single()).data as { status: string }).status;

      it('refuses a round that has matches by now, and changes neither its matches nor its byes', async () => {
        const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });
        await roundsQ.addMatchesToRound(empty, pairs);

        // A second retry read the round as empty before the first one wrote; it must not add a second set.
        await expect(roundsQ.addMatchesToRound(empty, pairs, [ids.pTop])).rejects.toMatchObject({
          code: 'rounds_round_already_written',
          statusCode: 409,
          params: { round: 'Round 10' },
        });
        await expect(roundsQ.addMatchesToRound(empty, [], [ids.pMid])).rejects.toMatchObject({ code: 'rounds_round_already_written' });

        expect(await matchesOfRound(empty.id)).toHaveLength(2);
        expect(await byesOf(empty.id)).toEqual([ids.pOutsider]);
      });

      it('refuses a completed round with rounds_round_completed: no match, the byes as they were', async () => {
        const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });
        await run('round completed', client.from('rounds').update({ status: 'completed' }).eq('id', empty.id));

        await expect(roundsQ.addMatchesToRound(empty, pairs, [ids.pTop])).rejects.toMatchObject({
          code: 'rounds_round_completed',
          statusCode: 409,
          params: { round: 'Round 10' },
        });
        await expect(roundsQ.addMatchesToRound(empty, [], [ids.pMid])).rejects.toMatchObject({ code: 'rounds_round_completed' });

        expect(await matchesOfRound(empty.id)).toEqual([]);
        expect(await byesOf(empty.id)).toEqual([ids.pOutsider]);
      });

      it('lets a retry that wrote nothing (a round of byes only) run again', async () => {
        const empty = await write({ matches: [] });

        await roundsQ.addMatchesToRound(empty, [], [ids.pTop]);
        await roundsQ.addMatchesToRound(empty, [], [ids.pMid]);

        expect(await byesOf(empty.id)).toEqual([ids.pMid]);
        expect(await matchesOfRound(empty.id)).toEqual([]);
      });

      // A real race: two retries read the same empty round and both write. The phase lock is shared (FOR SHARE), so only
      // the lock on the round row separates them: exactly one inserts its fixtures, the other writes nothing.
      it('lets exactly one of two concurrent retries write, however they interleave', async () => {
        for (let i = 0; i < 12; i++) {
          await reset();
          const empty = await write({ matches: [], bye_player_ids: [ids.pOutsider] });

          const results = await Promise.allSettled([
            roundsQ.addMatchesToRound(empty, pairs, [ids.pTop]),
            roundsQ.addMatchesToRound(empty, pairs, [ids.pMid]),
          ]);

          const won = results.filter((result) => result.status === 'fulfilled');
          const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
          expect(won, `iteration ${i}`).toHaveLength(1);
          expect(lost).toHaveLength(1);
          expect(lost[0].reason).toMatchObject({ code: 'rounds_round_already_written', statusCode: 409 });
          // One set of fixtures, and the byes of the winner (the loser's replacement rolled back with its refusal).
          expect(await matchesOfRound(empty.id)).toHaveLength(2);
          const winnerByes = results[0].status === 'fulfilled' ? [ids.pTop] : [ids.pMid];
          expect(await byesOf(empty.id)).toEqual(winnerByes);
        }
      }, 60_000);

      // A real race: the round completes while a retry writes into it. The completion (round_complete, FOR UPDATE on the
      // round) and the write (FOR UPDATE on the same row) are serialised: a write that commits first leaves unfinished
      // matches, which a completion without force refuses; a completion that commits first refuses the write.
      it('never leaves matches in a round that completed without force, however the retry and the completion interleave', async () => {
        for (let i = 0; i < 12; i++) {
          await reset();
          const empty = await write({ matches: [] });

          const [wrote, completed] = await Promise.allSettled([roundsQ.addMatchesToRound(empty, pairs), roundsQ.completeRound(empty.id, { force: false })]);

          const matches = await matchesOfRound(empty.id);
          const roundCompleted = (await statusOfRound(empty.id)) === 'completed';
          // The forbidden state.
          expect(roundCompleted && matches.length > 0, `iteration ${i}`).toBe(false);
          if (wrote.status === 'fulfilled') {
            expect(matches).toHaveLength(2);
            expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('unfinished');
          } else {
            expect(wrote.reason).toMatchObject({ code: 'rounds_round_completed' });
            expect(matches).toEqual([]);
            expect(completed.status === 'fulfilled' && completed.value.outcome).toBe('completed');
          }
        }
      }, 60_000);
    });

    it('answers tournament_not_found for a phase that is gone', async () => {
      await expect(write({ tournament_id: randomUUID() })).rejects.toMatchObject({ code: 'tournament_not_found', statusCode: 404 });
    });

    it('rolls the round back when a match is refused: no empty round is left behind', async () => {
      // A player that does not exist violates the foreign key of the match, after the round row was inserted.
      await expect(write({ matches: [{ player_1_id: ids.pTop, player_2_id: randomUUID() }] })).rejects.toBeTruthy();

      expect(await written()).toBe(0);
      expect(await matchesOf()).toEqual([]);
    });

    it('answers the round number taken by an earlier write as rounds_round_already_written, and writes no match', async () => {
      await write();

      await expect(write()).rejects.toMatchObject({ code: 'rounds_round_already_written', statusCode: 409 });
      expect(await written()).toBe(1);
      expect(await matchesOf()).toHaveLength(2);
    });

    it('does not guard the other writes into a completed tournament: a restore, the dev seed or a bracket materialisation insert as before', async () => {
      await run('phase completed', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase));
      const roundId = randomUUID();

      await run('plain round insert', client.from('rounds').insert({ id: roundId, tournament_id: ids.phase, name: 'Round 11', round_number: 11, best_of: 1, status: 'completed' }));
      await run('plain match insert', client.from('matches').insert({ round_id: roundId, tournament_id: ids.phase, player_1_id: ids.pTop, player_2_id: ids.pDefender }));

      expect(await matchesOf()).toHaveLength(1);
      await run('cleanup', client.from('matches').delete().eq('round_id', roundId));
      await run('cleanup round', client.from('rounds').delete().eq('id', roundId));
    });

    // A real race: the stage end read the phase's matches before the write, so it knows of none. Whichever commits first, the
    // pair of results must agree: the write either stands (the stage end finds its matches: unsettled, the phase stays
    // active) or is refused (the stage end completed the phase first, and nothing was written).
    it('never leaves a round or an unseen unfinished match in a phase that ended, however the write and the stage end interleave', async () => {
      for (let i = 0; i < 12; i++) {
        await reset();

        const [wrote, ended] = await Promise.allSettled([write(), tournamentsQ.completeTournamentIfActive(ids.phase, [])]);

        const phaseCompleted = (await statusOf()) === 'completed';
        const unfinished = (await matchesOf()).filter((match) => match.status !== 'completed');
        // The forbidden state.
        expect(phaseCompleted && (unfinished.length > 0 || (await written()) > 0)).toBe(false);
        if (wrote.status === 'fulfilled') {
          expect(unfinished).toHaveLength(2);
          expect(ended.status === 'fulfilled' && ended.value.outcome).toBe('unsettled');
        } else {
          expect(wrote.reason).toMatchObject({ code: 'rounds_phase_completed' });
          expect(await written()).toBe(0);
          expect(ended.status === 'fulfilled' && ended.value.outcome).toBe('completed');
        }
      }
    }, 60_000);

    // The limit of the guarantee above: a write without a match leaves no unfinished match for the stage end to find, so a
    // stage end that comes after it completes the phase around the round it wrote (documented in the migration header and
    // docs/format-kit.md). The write is never half done, and a refusal still leaves nothing.
    it('a round of byes only does not make the stage end unsettled: the phase completes around it, and a refused write leaves nothing', async () => {
      await write({ matches: [], bye_player_ids: [ids.pOutsider] });

      const ended = await tournamentsQ.completeTournamentIfActive(ids.phase, []);

      expect(ended.outcome).toBe('completed');
      expect(await statusOf()).toBe('completed');
      expect(await written()).toBe(1);

      for (let i = 0; i < 12; i++) {
        await reset();

        const [wrote, raced] = await Promise.allSettled([write({ matches: [] }), tournamentsQ.completeTournamentIfActive(ids.phase, [])]);

        // Never unsettled (no match exists), always completed; the write either stands whole or leaves nothing.
        expect(raced.status === 'fulfilled' && raced.value.outcome).toBe('completed');
        if (wrote.status === 'fulfilled') {
          expect(await written()).toBe(1);
        } else {
          expect(wrote.reason).toMatchObject({ code: 'rounds_phase_completed' });
          expect(await written()).toBe(0);
        }
      }
    }, 60_000);

    it('serialises an admin completion (a plain status write) with a round write: a refusal leaves nothing, in either order', async () => {
      for (let i = 0; i < 12; i++) {
        await reset();

        const [wrote] = await Promise.allSettled([
          write(),
          Promise.resolve(client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phase)).then(({ error }) => {
            if (error) throw new Error(JSON.stringify(error));
          }),
        ]);

        // Write first: the round stands and the admin's completion follows (the admin chose to complete). Completion first:
        // the write is refused and left no round and no match.
        expect(await statusOf()).toBe('completed');
        if (wrote.status === 'rejected') {
          expect(wrote.reason).toMatchObject({ code: 'rounds_phase_completed' });
          expect(await written()).toBe(0);
          expect(await matchesOf()).toEqual([]);
        } else {
          expect(await written()).toBe(1);
          expect(await matchesOf()).toHaveLength(2);
        }
      }
    }, 60_000);
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
