import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test for format_substitute_seat (supabase/migrations/20261106090000_format_challenges.sql). It runs the query
// module against a LOCAL Supabase stack to prove the seat handover of a substitution: the links (both sides), items, picks
// (actor and target), attributes, track steps and open challenges of the player who left move to the substitute in one
// transaction, while the event log, adjustments, resolved checks and finished challenges stay; a phase-scope call moves
// nothing while the player keeps another phase that is not completed; a row of the substitute that would collide refuses the
// call and changes nothing; the revision moves, so a plan made for the old holder is refused; the move is logged once as a
// `seat_moved` event; a preview reports the same and rolls back. Opt-in only (`LOCAL_SUPABASE_FORMAT_SUBSTITUTE=1` or
// `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_SUBSTITUTE');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type SubstituteMod = typeof import('@/lib/supabase/queries/format-substitute');
type RuntimeMod = typeof import('@/lib/supabase/queries/format-runtime');

let client: ClientMod['supabase'];
let seat: SubstituteMod;
let runtime: RuntimeMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  season: randomUUID(),
  bareSeason: randomUUID(),
  phaseA: randomUUID(),
  phaseB: randomUUID(),
  /** The player who leaves. */
  out: randomUUID(),
  /** The substitute: a new player without rows. */
  incoming: randomUUID(),
  /** A player who already holds rows in the league (a collision partner). */
  busy: randomUUID(),
  peer: randomUUID(),
  peer2: randomUUID(),
};
const PLAYERS = Object.values({ out: ids.out, incoming: ids.incoming, busy: ids.busy, peer: ids.peer, peer2: ids.peer2 });
const PHASES = [ids.phaseA, ids.phaseB];
const SEASONS = [ids.season, ids.bareSeason];
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const ZERO = { relation_links: 0, resource_items: 0, action_submissions: 0, player_attrs: 0, track_progress: 0, challenges: 0 };

const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
};

const move = (over: Partial<Parameters<SubstituteMod['moveFormatSeat']>[0]> = {}) =>
  seat.moveFormatSeat({
    seasonId: ids.season,
    outPlayerId: ids.out,
    inPlayerId: ids.incoming,
    leagueScope: true,
    phaseIds: PHASES,
    dryRun: false,
    ...over,
  });

const revisionOf = async (): Promise<number> => {
  const { data, error } = await client.from('season_formats').select('revision').eq('season_id', ids.season).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.revision;
};

/** Everything the function can touch, as plain rows, to prove a refusal changed nothing. */
const snapshot = async () => {
  const [rt, challenges] = await Promise.all([runtime.getFormatRuntime(ids.season), client.from('format_challenges').select('*').eq('season_id', ids.season).order('id')]);
  const withoutTimes = <T extends Record<string, unknown>>(rows: T[]) => rows.map((row) => ({ ...row }));
  return JSON.stringify({
    links: withoutTimes(rt.relationLinks),
    items: withoutTimes(rt.resourceItems),
    submissions: withoutTimes(rt.actionSubmissions),
    attrs: withoutTimes(rt.playerAttrs),
    tracks: withoutTimes(rt.trackProgress),
    log: rt.eventLog.map((row) => row.event_key),
    challenges: challenges.data,
    revision: await revisionOf(),
  });
};

const link = (relation: string, from: string, to: string) => ({ season_id: ids.season, relation_key: relation, from_player_id: from, to_player_id: to });
const item = (player: string, resource = 'picks', itemId: string | null = 'garchomp', amount = 1) => ({
  season_id: ids.season, resource_key: resource, player_id: player, item_id: itemId, amount, exclusive: false, source: 'event', source_ref: 'match-1',
});
const submission = (action: string, actor: string, target: string | null) => ({
  season_id: ids.season, action_key: action, actor_player_id: actor, target_player_id: target, status: 'submitted', picks: [],
});
const challenge = (phase: string, challenger: string, defender: string, status = 'open') => ({
  season_id: ids.season, phase_id: phase, challenger_id: challenger, defender_id: defender, status, round: 1, expires_at: FUTURE,
});

type Row = Record<string, string | number | boolean | null>;

/** The rows of one league in a table the function moves, as plain column values. */
const rowsOf = async (table: 'format_relation_links' | 'format_resource_items' | 'format_action_submissions' | 'format_player_attrs' | 'format_track_progress'): Promise<Row[]> => {
  const { data, error } = await client.from(table).select('*').eq('season_id', ids.season);
  if (error) throw new Error(JSON.stringify(error));
  return (data ?? []) as unknown as Row[];
};

describe.skipIf(!optIn)('format_substitute_seat (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    seat = await import('@/lib/supabase/queries/format-substitute');
    runtime = await import('@/lib/supabase/queries/format-runtime');

    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Seat ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert(
        PLAYERS.map((id, i) => ({ id, name: `Seat ${RUN} ${i}`, is_guest: true })),
        { defaultToNull: false },
      ),
    );
    await run('seasons', client.from('seasons').insert([
      { id: ids.season, name: `Seat ${RUN}`, format_type: 'custom' },
      { id: ids.bareSeason, name: `Seat ${RUN} bare`, format_type: 'custom' },
    ]));
    await run(
      'season_formats',
      client.from('season_formats').insert({
        season_id: ids.season,
        version_no: 1,
        // The capacity of the `picks` resource is read from the attached spec when a holding is merged.
        spec: { resources: [{ key: 'picks', capacity: 2 }] },
        spec_hash: '0'.repeat(64),
        seed: `seat-${RUN}`,
        engine: 'kit',
      }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert([
        { id: ids.phaseA, name: `Seat ${RUN} A`, season_id: ids.season, stage_order: 0, bracket_type: 'round_robin', ruleset_id: ids.ruleset, status: 'active' },
        { id: ids.phaseB, name: `Seat ${RUN} B`, season_id: ids.season, stage_order: 1, bracket_type: 'round_robin', ruleset_id: ids.ruleset, status: 'active' },
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
    await del('tournament_participants', client.from('tournament_participants').delete().in('tournament_id', PHASES));
    await del('tournaments', client.from('tournaments').delete().in('id', PHASES));
    await del('seasons', client.from('seasons').delete().in('id', SEASONS));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', PLAYERS));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60_000);

  beforeEach(async () => {
    for (const table of [
      'format_challenges', 'format_relation_links', 'format_resource_items', 'format_action_submissions', 'format_event_log',
      'format_player_attrs', 'format_track_progress', 'format_checks', 'format_adjustments',
    ] as const) {
      await run(`reset ${table}`, client.from(table).delete().eq('season_id', ids.season));
    }
    await run('reset phases', client.from('tournaments').update({ status: 'active' }).in('id', PHASES));
    await run('reset enrollment', client.from('tournament_participants').delete().in('tournament_id', PHASES));
    await run(
      'enroll',
      client.from('tournament_participants').insert([
        { tournament_id: ids.phaseA, player_id: ids.out },
        { tournament_id: ids.phaseA, player_id: ids.peer },
        { tournament_id: ids.phaseB, player_id: ids.out },
        { tournament_id: ids.phaseB, player_id: ids.peer2 },
      ]),
    );
  }, 30_000);

  /** The seat of `out`: one row in every table the function moves, history rows beside them. */
  async function seedSeat() {
    await run('links', client.from('format_relation_links').insert([link('santa', ids.out, ids.peer), link('santa', ids.peer2, ids.out)]));
    await run('items', client.from('format_resource_items').insert([item(ids.out), item(ids.out, 'coins', null, 3)]));
    await run('submissions', client.from('format_action_submissions').insert([
      submission('gift', ids.out, ids.peer),
      submission('gift', ids.peer2, ids.out),
    ]));
    await run('attrs', client.from('format_player_attrs').insert({ season_id: ids.season, player_id: ids.out, attr_key: 'role', value: 'sweeper', source: 'event' }));
    await run('tracks', client.from('format_track_progress').insert({ season_id: ids.season, player_id: ids.out, track_key: 'milestones', step: 2 }));
    await run('challenges', client.from('format_challenges').insert([
      challenge(ids.phaseA, ids.out, ids.peer),
      challenge(ids.phaseB, ids.peer2, ids.out),
    ]));
    // History that stays with the player who left.
    await run('log', client.from('format_event_log').insert({
      season_id: ids.season, event_key: 'match_completed:m-1', event: 'match_completed', payload: {},
      ops: [{ op: 'grant_item', resource: 'picks', player_id: ids.out, item_id: 'garchomp', amount: 1 }],
    }));
    await run('adjustments', client.from('format_adjustments').insert({
      season_id: ids.season, kind: 'points', target: { stage: 'main', player_id: ids.out }, delta: { points: 3 }, reason: 'win bonus',
    }));
    await run('checks', client.from('format_checks').insert({
      season_id: ids.season, source: 'expr', rule_id: 'r1', dedupe_key: `expr:r1:${ids.out}`, subject: { of: 'player', id: ids.out }, status: 'confirmed',
    }));
    await run('finished challenge', client.from('format_challenges').insert(challenge(ids.phaseA, ids.out, ids.peer2, 'declined')));
  }

  it('moves every row of the seat to the substitute in one call, and leaves the history with the player who left', async () => {
    await seedSeat();
    const before = await revisionOf();

    const result = await move();

    expect(result).toEqual({
      attached: true,
      moved: true,
      kept_phase_ids: [],
      rows: { relation_links: 2, resource_items: 2, action_submissions: 2, player_attrs: 1, track_progress: 1, challenges: 2 },
      total: 10,
    });

    const links = await rowsOf('format_relation_links');
    expect(links.map((l) => `${l.from_player_id}>${l.to_player_id}`).sort()).toEqual([`${ids.incoming}>${ids.peer}`, `${ids.peer2}>${ids.incoming}`].sort());
    const items = await rowsOf('format_resource_items');
    expect(items.every((row) => row.player_id === ids.incoming)).toBe(true);
    expect(items.map((row) => `${row.resource_key}:${row.amount}:${row.source_ref}`).sort()).toEqual(['coins:3:match-1', 'picks:1:match-1']);
    const submissions = await rowsOf('format_action_submissions');
    expect(submissions.map((s) => `${s.actor_player_id}>${s.target_player_id}`).sort()).toEqual([`${ids.incoming}>${ids.peer}`, `${ids.peer2}>${ids.incoming}`].sort());
    expect((await rowsOf('format_player_attrs')).map((row) => row.player_id)).toEqual([ids.incoming]);
    expect((await rowsOf('format_track_progress')).map((row) => [row.player_id, row.step])).toEqual([[ids.incoming, 2]]);

    const challenges = await challengesOf();
    const open = challenges.filter((row) => row.status === 'open').map((row) => `${row.challenger_id}>${row.defender_id}`).sort();
    expect(open).toEqual([`${ids.incoming}>${ids.peer}`, `${ids.peer2}>${ids.incoming}`].sort());
    // A finished challenge is history.
    expect(challenges.find((row) => row.status === 'declined')).toMatchObject({ challenger_id: ids.out });

    const rt = await runtime.getFormatRuntime(ids.season);
    expect(rt.adjustments.map((row) => row.target)).toEqual([{ stage: 'main', player_id: ids.out }]);
    expect(rt.checks.map((row) => row.status)).toEqual(['confirmed']);
    expect(rt.eventLog.find((row) => row.event_key === 'match_completed:m-1')?.ops).toEqual([
      { op: 'grant_item', resource: 'picks', player_id: ids.out, item_id: 'garchomp', amount: 1 },
    ]);

    // The move is logged once, after the completion it follows, with the players and the rows.
    const moved = rt.eventLog.filter((row) => row.event === 'seat_moved');
    expect(moved).toHaveLength(1);
    expect(moved[0].event_key).toMatch(/^seat_moved:/);
    expect(moved[0].payload).toMatchObject({ from: ids.out, to: ids.incoming, rows: { relation_links: 2, challenges: 2 } });
    const completion = rt.eventLog.find((row) => row.event_key === 'match_completed:m-1');
    expect(new Date(moved[0].fired_at).getTime()).toBeGreaterThanOrEqual(new Date(completion?.fired_at ?? 0).getTime());

    // A plan made for the old holder is refused from now on.
    expect(await revisionOf()).toBeGreaterThan(before);
    await expect(
      runtime.fireFormatEvent({ seasonId: ids.season, eventKey: 'late', event: 'time', payload: {}, ops: [], firedBy: null, revision: before }),
    ).rejects.toMatchObject({ code: 'format_context_stale' });
  });

  async function challengesOf() {
    const { data, error } = await client.from('format_challenges').select('*').eq('season_id', ids.season);
    if (error) throw new Error(JSON.stringify(error));
    return data ?? [];
  }

  it('a second call moves nothing, logs no second event and does not collide with what the first call moved', async () => {
    await seedSeat();
    await move();
    const revision = await revisionOf();

    const again = await move();

    expect(again).toMatchObject({ attached: true, moved: true, total: 0, rows: ZERO });
    expect(await revisionOf()).toBe(revision);
    expect((await runtime.getFormatRuntime(ids.season)).eventLog.filter((row) => row.event === 'seat_moved')).toHaveLength(1);
  });

  it('a preview reports the same rows and rolls back: nothing moves, no event, the revision stays', async () => {
    await seedSeat();
    const before = await snapshot();

    const preview = await move({ dryRun: true });
    const applied = await (async () => {
      expect(await snapshot()).toBe(before);
      return move();
    })();

    expect(preview).toEqual(applied);
    expect(preview.total).toBe(10);
  });

  it('moves a player without any row as a seat with nothing to move: total 0, no event, no revision bump', async () => {
    const revision = await revisionOf();

    const result = await move();

    expect(result).toMatchObject({ attached: true, moved: true, total: 0, rows: ZERO });
    expect(await revisionOf()).toBe(revision);
    expect((await runtime.getFormatRuntime(ids.season)).eventLog).toEqual([]);
  });

  it('answers a league without an attached format as nothing to move', async () => {
    const result = await move({ seasonId: ids.bareSeason, phaseIds: [] });

    expect(result).toEqual({ attached: false, moved: false, kept_phase_ids: [], rows: ZERO, total: 0 });
  });

  describe('scope', () => {
    it('a phase-scope call moves nothing while the player keeps another phase that is not completed, and says which', async () => {
      await seedSeat();
      const before = await snapshot();

      const result = await move({ leagueScope: false, phaseIds: [ids.phaseA] });

      expect(result).toEqual({ attached: true, moved: false, kept_phase_ids: [ids.phaseB], rows: ZERO, total: 0 });
      expect(await snapshot()).toBe(before);
    });

    it('moves them once the other phase is completed (history does not keep a seat), or the player is no longer enrolled there', async () => {
      await seedSeat();
      await run('complete', client.from('tournaments').update({ status: 'completed' }).eq('id', ids.phaseB));

      const result = await move({ leagueScope: false, phaseIds: [ids.phaseA] });

      expect(result).toMatchObject({ moved: true, total: 10 - 1 });
      expect((await rowsOf('format_player_attrs')).map((row) => row.player_id)).toEqual([ids.incoming]);
    });

    it('moves the open challenges of the handed-over phases only', async () => {
      await seedSeat();
      await run('unenroll', client.from('tournament_participants').delete().eq('tournament_id', ids.phaseB).eq('player_id', ids.out));

      const result = await move({ leagueScope: false, phaseIds: [ids.phaseA] });

      expect(result.rows.challenges).toBe(1);
      const stays = (await challengesOf()).find((row) => row.phase_id === ids.phaseB && row.status === 'open');
      expect(stays).toMatchObject({ challenger_id: ids.peer2, defender_id: ids.out });
    });

    it('a league-scope call moves them whatever phase the player is enrolled in', async () => {
      await seedSeat();

      const result = await move({ leagueScope: true, phaseIds: [] });

      expect(result).toMatchObject({ moved: true, kept_phase_ids: [] });
      expect(result.rows.challenges).toBe(0);
      expect(result.rows.relation_links).toBe(2);
    });

    it('refuses a phase-scope call that names no phase', async () => {
      await expect(move({ leagueScope: false, phaseIds: [] })).rejects.toBeTruthy();
    });
  });

  describe('a row of the substitute that would collide refuses the call and changes nothing', () => {
    async function refused(code: string) {
      const before = await snapshot();
      await expect(move()).rejects.toMatchObject({ code, statusCode: 409 });
      await expect(move({ dryRun: true })).rejects.toMatchObject({ code });
      expect(await snapshot()).toBe(before);
    }

    it('links: a link between the two, or a link of the same relation on the same side', async () => {
      await seedSeat();
      await run('between', client.from('format_relation_links').insert(link('ring', ids.out, ids.incoming)));
      await refused('format_substitute_links_collide');

      await run('clean', client.from('format_relation_links').delete().eq('relation_key', 'ring'));
      await run('same side', client.from('format_relation_links').insert(link('santa', ids.incoming, ids.peer2)));
      await refused('format_substitute_links_collide');
    });

    it('items: the two holdings of a resource together exceed its capacity (a resource without capacity merges)', async () => {
      await seedSeat();
      // picks has capacity 2: out holds 1, the substitute 2.
      await run('held', client.from('format_resource_items').insert(item(ids.incoming, 'picks', 'other', 2)));
      await refused('format_substitute_items_collide');

      await run('fits', client.from('format_resource_items').delete().eq('player_id', ids.incoming));
      await run('fits', client.from('format_resource_items').insert(item(ids.incoming, 'picks', 'other', 1)));
      // coins has no capacity: any holdings add up.
      await run('coins', client.from('format_resource_items').insert(item(ids.incoming, 'coins', null, 50)));
      await expect(move({ dryRun: true })).resolves.toMatchObject({ moved: true });
    });

    it('picks: both picked for one action, or one targets the other', async () => {
      await seedSeat();
      await run('same action', client.from('format_action_submissions').insert(submission('gift', ids.incoming, ids.busy)));
      await refused('format_substitute_submissions_collide');

      await run('clean', client.from('format_action_submissions').delete().eq('actor_player_id', ids.incoming));
      await run('targets', client.from('format_action_submissions').insert(submission('wish', ids.incoming, ids.out)));
      await refused('format_substitute_submissions_collide');
    });

    it('attributes and track steps: both hold the key', async () => {
      await seedSeat();
      await run('attr', client.from('format_player_attrs').insert({ season_id: ids.season, player_id: ids.incoming, attr_key: 'role', value: 'lead', source: 'event' }));
      await refused('format_substitute_attrs_collide');

      await run('clean', client.from('format_player_attrs').delete().eq('player_id', ids.incoming));
      await run('track', client.from('format_track_progress').insert({ season_id: ids.season, player_id: ids.incoming, track_key: 'milestones', step: 1 }));
      await refused('format_substitute_tracks_collide');
    });

    it('open challenges: one between the two, or both with the same opponent in a handed-over phase', async () => {
      await seedSeat();
      await run('between', client.from('format_challenges').insert(challenge(ids.phaseA, ids.incoming, ids.out)));
      await refused('format_substitute_challenges_collide');

      await run('clean', client.from('format_challenges').delete().eq('challenger_id', ids.incoming));
      await run('same opponent', client.from('format_challenges').insert(challenge(ids.phaseA, ids.peer, ids.incoming)));
      await refused('format_substitute_challenges_collide');

      // An open challenge of the substitute in a phase this call does not hand over does not matter.
      await run('clean', client.from('format_challenges').delete().eq('defender_id', ids.incoming));
      await run('other phase', client.from('format_challenges').insert(challenge(ids.phaseB, ids.peer2, ids.incoming)));
      await expect(move({ dryRun: true, phaseIds: [ids.phaseA] })).resolves.toMatchObject({ moved: true });
    });
  });

  it('serialises with a writer that checks the revision: the move waits for it and moves its rows too', async () => {
    await seedSeat();
    const revision = await revisionOf();

    // A grant to the player who leaves and the move race: whichever commits first, the grant is either moved (it came first)
    // or refused as stale (the move came first and bumped the revision). It is never left behind with the old holder.
    const outcomes = await Promise.allSettled([
      runtime.fireFormatEvent({
        seasonId: ids.season,
        eventKey: 'race',
        event: 'time',
        payload: {},
        ops: [{ op: 'grant_item', resource: 'coins', player_id: ids.out, item_id: null, amount: 5, exclusive: false, source: 'event', source_ref: 'race' }],
        firedBy: null,
        revision,
      }),
      move(),
    ]);

    expect(outcomes[1].status).toBe('fulfilled');
    const leftBehind = (await rowsOf('format_resource_items')).filter((row) => row.player_id === ids.out);
    expect(leftBehind).toEqual([]);
    if (outcomes[0].status === 'rejected') {
      expect(outcomes[0].reason).toMatchObject({ code: 'format_context_stale' });
    }
  });
});
