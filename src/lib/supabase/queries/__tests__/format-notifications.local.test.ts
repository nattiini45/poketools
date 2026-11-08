import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test for supabase/migrations/20261108090000_format_notifications.sql, against a LOCAL Supabase stack: who is told of
// each challenge outcome, that a retry or a repeated sweep tells nobody twice, that a rule's notice is written only with
// the event that had not fired, that a recipient who no longer exists cannot roll the event back, and that a league restored from
// the recycle bin comes back with its notifications and notifies nobody again.
// Opt-in only (`LOCAL_SUPABASE_FORMAT_NOTIFICATIONS=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_FORMAT_NOTIFICATIONS');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type ChallengesMod = typeof import('@/lib/supabase/queries/format-challenges');
type RuntimeMod = typeof import('@/lib/supabase/queries/format-runtime');
type NotificationsMod = typeof import('@/lib/supabase/queries/format-notifications');

let client: ClientMod['supabase'];
let ladder: ChallengesMod;
let runtime: RuntimeMod;
let inbox: NotificationsMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  season: randomUUID(),
  phase: randomUUID(),
  round: randomUUID(),
  challenger: randomUUID(),
  defender: randomUUID(),
};
const PLAYERS = [ids.challenger, ids.defender];

const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[${label}] ${JSON.stringify(error)}`);
};

const create = () =>
  ladder.createFormatChallenge({
    seasonId: ids.season,
    phaseId: ids.phase,
    challengerId: ids.challenger,
    defenderId: ids.defender,
    challengerRank: 2,
    defenderRank: 1,
    rankRange: 1,
    maxOpen: 4,
    cooldownRounds: 0,
    acceptWindowHours: 24,
  });

const lapse = (id: string) =>
  run('lapse', client.from('format_challenges').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', id));

const rows = async () => {
  const { data, error } = await client
    .from('format_notifications')
    .select('player_id, kind, dedupe_key, payload')
    .eq('season_id', ids.season)
    .order('created_at')
    .order('player_id');
  if (error) throw new Error(JSON.stringify(error));
  return data;
};

const toldFor = async (challengeId: string) => {
  const all = await rows();
  return all.filter((row) => row.dedupe_key.startsWith(`challenge:${challengeId}:`)).map((row) => `${row.player_id === ids.defender ? 'defender' : 'challenger'}:${row.kind}`).sort();
};

const clearChallenges = async () => {
  await run('clear notifications', client.from('format_notifications').delete().eq('season_id', ids.season));
  await run('clear challenges', client.from('format_challenges').delete().eq('season_id', ids.season));
  await run('clear events', client.from('format_event_log').delete().eq('season_id', ids.season));
};

const seed = async () => {
  await run('players', client.from('players').insert(PLAYERS.map((id, i) => ({ id, name: `Notify ${RUN} ${i}`, is_guest: true })), { defaultToNull: false }));
  await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Notify ${RUN} Ruleset` }));
  await run('seasons', client.from('seasons').insert({ id: ids.season, name: `Notify ${RUN}`, format_type: 'custom' }));
  await run('season_formats', client.from('season_formats').insert({ season_id: ids.season, version_no: 1, spec: {}, spec_hash: '0'.repeat(64), seed: `notify-${RUN}`, engine: 'kit' }));
  await run('tournaments', client.from('tournaments').insert({ id: ids.phase, name: `Notify ${RUN} Ladder`, season_id: ids.season, stage_order: 0, bracket_type: 'round_robin', ruleset_id: ids.ruleset, status: 'active' }));
  await run('participants', client.from('tournament_participants').insert(PLAYERS.map((player_id) => ({ tournament_id: ids.phase, player_id }))));
  await run('rounds', client.from('rounds').insert({ id: ids.round, tournament_id: ids.phase, name: 'Round 1', round_number: 1, best_of: 1, status: 'pending' }));
};

const revisionNow = async (): Promise<number> => {
  const { data, error } = await client.from('season_formats').select('revision').eq('season_id', ids.season).single();
  if (error) throw new Error(JSON.stringify(error));
  return data.revision;
};

describe.skipIf(!optIn)('format notifications (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    ladder = await import('@/lib/supabase/queries/format-challenges');
    runtime = await import('@/lib/supabase/queries/format-runtime');
    inbox = await import('@/lib/supabase/queries/format-notifications');
    await seed();
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.from('league_trash_restore_rebuilds').delete().eq('season_id', ids.season);
    await client.from('format_notifications').delete().eq('season_id', ids.season);
    await client.from('format_challenges').delete().eq('season_id', ids.season);
    await client.from('format_event_log').delete().eq('season_id', ids.season);
    await client.from('matches').delete().eq('tournament_id', ids.phase);
    await client.from('rounds').delete().eq('tournament_id', ids.phase);
    await client.from('tournament_participants').delete().eq('tournament_id', ids.phase);
    await client.from('tournaments').delete().eq('id', ids.phase);
    await client.from('season_formats').delete().eq('season_id', ids.season);
    await client.from('seasons').delete().eq('id', ids.season);
    await client.from('players').delete().in('id', PLAYERS);
    await deleteLocalRuleset(client, ids.ruleset);
  }, 60_000);

  beforeEach(async () => {
    await run('matches', client.from('matches').delete().eq('tournament_id', ids.phase));
    await clearChallenges();
  });

  it('tells the defender of a new challenge, and not the challenger', async () => {
    const row = await create();
    expect(await toldFor(row.id)).toEqual(['defender:challenge_created']);
    const stored = (await rows())[0];
    expect(stored.payload).toEqual({ role: 'defender', counterparty_id: ids.challenger });
  });

  it('tells the challenger of an answer', async () => {
    const accepted = await create();
    await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: accepted.id, playerId: ids.defender, accept: true });
    expect(await toldFor(accepted.id)).toEqual(['challenger:challenge_accepted', 'defender:challenge_created']);

    await run('matches', client.from('matches').delete().eq('tournament_id', ids.phase));
    await clearChallenges();
    const declined = await create();
    await ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: declined.id, playerId: ids.defender, accept: false });
    expect(await toldFor(declined.id)).toEqual(['challenger:challenge_declined', 'defender:challenge_created']);
  });

  it('tells only the defender when the challenger withdraws, and both when an admin cancels', async () => {
    const withdrawn = await create();
    await ladder.cancelFormatChallenge(ids.season, withdrawn.id, ids.challenger);
    expect(await toldFor(withdrawn.id)).toEqual(['defender:challenge_cancelled', 'defender:challenge_created']);

    await clearChallenges();
    const cancelled = await create();
    await ladder.cancelFormatChallenge(ids.season, cancelled.id, null);
    expect(await toldFor(cancelled.id)).toEqual(['challenger:challenge_cancelled', 'defender:challenge_cancelled', 'defender:challenge_created']);
  });

  it('tells both of an expiry once, however often the sweep runs', async () => {
    const row = await create();
    await lapse(row.id);
    expect(await ladder.expireFormatChallenges(ids.season)).toBe(1);
    expect(await ladder.expireFormatChallenges(ids.season)).toBe(0);
    expect(await toldFor(row.id)).toEqual(['challenger:challenge_expired', 'defender:challenge_created', 'defender:challenge_expired']);
  });

  it('tells both when an answer comes too late', async () => {
    const row = await create();
    await lapse(row.id);
    await expect(ladder.respondToFormatChallenge({ seasonId: ids.season, challengeId: row.id, playerId: ids.defender, accept: true })).rejects.toMatchObject({ code: 'challenge_expired' });
    expect(await toldFor(row.id)).toEqual(['challenger:challenge_expired', 'defender:challenge_created', 'defender:challenge_expired']);
  });

  it('writes a rule\'s notice once, with the event, and skips a recipient who does not exist', async () => {
    const revision = await revisionNow();
    const message = { base: 'en' as const, en: { v: 'Pool open', s: 'human' as const } };
    const fire = () =>
      runtime.fireFormatEvent({
        seasonId: ids.season,
        eventKey: 'time:main:open',
        event: 'time',
        payload: {},
        ops: [],
        firedBy: null,
        revision,
        notifications: [{ message, players: [ids.defender, randomUUID()], rule: 'open_note', effect: 0 }],
      });
    expect(await fire()).toBe(true);
    expect(await fire()).toBe(false);
    const stored = await rows();
    expect(stored).toEqual([
      { player_id: ids.defender, kind: 'rule_notice', dedupe_key: `rule:${revision}:time:main:open:open_note:0`, payload: { message } },
    ]);
  });

  it('reads, counts, marks and purges the inbox of one player only', async () => {
    const row = await create();
    expect(await inbox.countUnreadFormatNotifications(ids.defender)).toBe(1);
    expect(await inbox.countUnreadFormatNotifications(ids.challenger)).toBe(0);

    const page = await inbox.listFormatNotifications(ids.defender, 30, 0);
    expect(page.rows.map((r) => r.kind)).toEqual(['challenge_created']);
    // Somebody else naming the row changes nothing.
    await inbox.markFormatNotificationsRead(ids.challenger, [page.rows[0].id]);
    expect(await inbox.countUnreadFormatNotifications(ids.defender)).toBe(1);

    await inbox.markFormatNotificationsRead(ids.defender, 'all');
    expect(await inbox.countUnreadFormatNotifications(ids.defender)).toBe(0);

    expect(await inbox.purgeFormatNotifications(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1);
    expect(await toldFor(row.id)).toEqual([]);
  });

  it('names the current members of a league', async () => {
    const members = await inbox.readCurrentLeagueMembers([ids.season], PLAYERS);
    expect(members.get(ids.season)).toEqual(new Set(PLAYERS));
  });

  it('brings a league\'s notifications back from the recycle bin and notifies nobody again', async () => {
    const row = await create();
    const before = await rows();

    const { data: deleted, error: deleteError } = await client.rpc('league_trash_delete', { p_season_id: ids.season, p_actor: ids.challenger, p_retention_days: 90 });
    expect(deleteError?.message ?? null).toBeNull();
    expect(await rows()).toEqual([]);

    const trashId = (deleted as { trash_id: string }).trash_id;
    // The aggregate rebuild of a delete is another module's work; this league has no games to rebuild.
    await run('rebuild done', client.from('league_trash').update({ rebuild_pending: false }).eq('id', trashId));
    const { error: restoreError } = await client.rpc('league_trash_restore', { p_trash_id: trashId });
    expect(restoreError?.message ?? null).toBeNull();

    expect(await rows()).toEqual(before);
    expect(await toldFor(row.id)).toEqual(['defender:challenge_created']);
  }, 60_000);
});
