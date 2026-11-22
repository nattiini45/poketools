import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_TEAMS');

function session() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_poketools', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']);
  let output = '';
  let errors = '';
  let ended = false;
  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
  const done = new Promise<{ code: number | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
  return {
    send: (text: string) => { if (!ended && !child.stdin.destroyed) child.stdin.write(`${text}\n`); },
    finish: () => { if (!ended) { ended = true; child.stdin.end(); } return done; },
    waitFor: async (text: string) => {
      const until = Date.now() + 10_000;
      while (!output.includes(text)) {
        if (Date.now() >= until || child.exitCode !== null) throw new Error(`psql did not reach ${text}: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function sql(text: string) {
  const connection = session();
  connection.send(text);
  return connection.finish();
}

async function ok(text: string) {
  const result = await sql(text);
  expect(result.errors).toBe('');
  expect(result.code).toBe(0);
  return result.output.trim();
}

describe.skipIf(!optedIn)('phase teams on the disposable CI database', () => {
  const seasonId = randomUUID();
  const phaseId = randomUUID();
  const rulesetId = randomUUID();
  const roundId = randomUUID();
  const matchId = randomUUID();
  const players = [randomUUID(), randomUUID()];
  let admin: SupabaseClient<Database>;

  const insert = (store: 'teams' | 'phase_teams', id: string, token: string | null, extra = '') =>
    `INSERT INTO public.${store} (id,player_id,share_token,share_enabled_at${store === 'phase_teams' ? ',phase_id' : ''}${extra ? ',match_id' : ''})
     VALUES ('${id}','${players[0]}',${token ? `'${token}'` : 'NULL'},${token ? 'now()' : 'NULL'}${store === 'phase_teams' ? `,'${phaseId}'` : ''}${extra ? `,'${extra}'` : ''});`;
  const release = () => `SELECT public.phase_teams_release_matches(ARRAY['${matchId}']::uuid[]);`;
  const roster = (operation: string, team: string | null, match: string | null, actor: string, pokemon = '[]') =>
    `SELECT id FROM public.phase_team_roster_write('${operation}','${phaseId}','${players[0]}',
     ${team ? `'${team}'` : 'NULL'},${match ? `'${match}'` : 'NULL'},'${pokemon}'::jsonb,'manual',NULL,'${actor}');`;

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await admin.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: 'Native team fixture' })).error).toBeNull();
    expect((await admin.from('players').insert(players.map((id) => ({ id, name: `Fixture ${id}`, is_guest: true })))).error).toBeNull();
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Team fixture', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('league_phases').insert({ id: phaseId, season_id: seasonId, name: 'Team phase', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('phase_rounds').insert({ id: roundId, phase_id: phaseId, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    expect((await admin.from('phase_matches').insert({ id: matchId, phase_id: phaseId, round_id: roundId, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await ok(`DELETE FROM public.teams WHERE player_id IN ('${players[0]}','${players[1]}');
      DELETE FROM public.phase_teams WHERE phase_id = '${phaseId}';
      DELETE FROM public.phase_matches WHERE phase_id = '${phaseId}';
      DELETE FROM public.phase_rounds WHERE phase_id = '${phaseId}';
      DELETE FROM public.league_phases WHERE id = '${phaseId}';
      DELETE FROM public.seasons WHERE id = '${seasonId}';
      DELETE FROM public.players WHERE id IN ('${players[0]}','${players[1]}');`);
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  }, 60_000);

  for (const first of ['teams', 'phase_teams'] as const) {
    const second = first === 'teams' ? 'phase_teams' : 'teams';
    it(`serializes ${first} first against ${second}, for insert/update and commit/rollback`, async () => {
      for (const write of ['insert', 'update']) for (const commit of [true, false]) {
        const token = randomUUID();
        const firstId = randomUUID();
        const secondId = randomUUID();
        const writer = session();
        const contender = session();
        const name = `share-${secondId}`;
        try {
          if (write === 'update') await ok(`${insert(first, firstId, null)} ${insert(second, secondId, null)}`);
          const firstWrite = write === 'insert' ? insert(first, firstId, token) : `UPDATE public.${first} SET share_token = '${token}' WHERE id = '${firstId}';`;
          const secondWrite = write === 'insert' ? insert(second, secondId, token) : `UPDATE public.${second} SET share_token = '${token}' WHERE id = '${secondId}';`;
          writer.send(`BEGIN; SET LOCAL ROLE service_role; ${firstWrite} SELECT 'held';`);
          await writer.waitFor('held');
          contender.send(`SET application_name = '${name}'; SET ROLE service_role; ${secondWrite} SELECT 'inserted';`);
          const until = Date.now() + 10_000;
          let blocked = false;
          while (Date.now() < until) {
            const result = await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${name}' AND wait_event = 'advisory';`);
            if (result.output.trim() === '1') { blocked = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          expect(blocked).toBe(true);
          writer.send(commit ? 'COMMIT;' : 'ROLLBACK;');
          expect((await writer.finish()).code).toBe(0);
          const result = await contender.finish();
          if (commit) {
            expect(result.code).not.toBe(0);
            expect(result.errors).toContain('teams_global_share_token_key');
            await ok(`DELETE FROM public.${first} WHERE id = '${firstId}'; ${secondWrite}`);
          } else {
            expect(result.code).toBe(0);
            expect(result.output).toContain('inserted');
          }
        } finally {
          writer.send('ROLLBACK;');
          await writer.finish();
          await contender.finish();
          await ok(`DELETE FROM public.teams WHERE id IN ('${firstId}','${secondId}');
            DELETE FROM public.phase_teams WHERE id IN ('${firstId}','${secondId}');`);
        }
      }
    }, 60_000);

    it(`rejects ${first} same-ID duplicates at commit but allows an actual transfer`, async () => {
      const id = randomUUID();
      const token = randomUUID();
      await ok(insert(first, id, token));
      try {
        const duplicate = await sql(`BEGIN; ${insert(second, id, token)} COMMIT;`);
        expect(duplicate.code).not.toBe(0);
        expect(duplicate.errors).toContain('teams_global_share_token_key');
        await ok(`BEGIN; ${insert(second, id, token)} DELETE FROM public.${first} WHERE id = '${id}'; COMMIT;`);
        expect(await ok(`SELECT share_token FROM public.${second} WHERE id = '${id}';`)).toBe(token);
      } finally {
        await ok(`DELETE FROM public.teams WHERE id = '${id}'; DELETE FROM public.phase_teams WHERE id = '${id}';`);
      }
    });
  }

  it('retains the first released planned row and transfers later duplicates atomically with metadata and both fork stores', async () => {
    const planned = randomUUID();
    const released = randomUUID();
    const libraryFork = randomUUID();
    const phaseFork = randomUUID();
    const source = randomUUID();
    const token = randomUUID();
    try {
      await ok(`${insert('phase_teams', planned, null, matchId)} ${release()}`);
      expect(await ok(`SELECT phase_id || ':' || (match_id IS NULL) FROM public.phase_teams WHERE id = '${planned}';`)).toBe(`${phaseId}:true`);
      await ok(`${insert('teams', source, null)} ${insert('phase_teams', released, token, matchId)}
        UPDATE public.phase_teams SET season_id = '${seasonId}', library_published_at = '2026-11-17', library_title = 'Fixture title',
          library_description = 'Fixture description', library_tags = ARRAY['fixture'], forked_from_team_id = '${source}' WHERE id = '${released}';
        ${insert('teams', libraryFork, null)}
        UPDATE public.teams SET forked_from_phase_team_id = '${released}' WHERE id = '${libraryFork}';
        INSERT INTO public.phase_teams (id,phase_id,player_id,forked_from_phase_team_id)
          VALUES ('${phaseFork}','${phaseId}','${players[1]}','${released}');
        SET ROLE service_role; ${release()}`);
      expect(await ok(`SELECT count(*) FROM public.phase_teams WHERE id = '${released}';`)).toBe('0');
      expect(await ok(`SELECT (share_token = '${token}') AND (share_enabled_at IS NOT NULL)
        AND library_title = 'Fixture title' AND library_description = 'Fixture description' AND library_tags = ARRAY['fixture']
        AND library_published_at = '2026-11-17' AND forked_from_team_id = '${source}'
        AND tournament_id IS NULL AND match_id IS NULL AND phase_match_id IS NULL AND season_id = '${seasonId}'
        FROM public.teams WHERE id = '${released}';`)).toBe('t');
      for (const [table, id] of [['teams', libraryFork], ['phase_teams', phaseFork]]) {
        expect(await ok(`SELECT forked_from_team_id = '${released}' AND forked_from_phase_team_id IS NULL FROM public.${table} WHERE id = '${id}';`)).toBe('t');
      }
      expect(await ok(release())).toBe('0');
    } finally {
      await ok(`DELETE FROM public.teams WHERE id IN ('${released}','${libraryFork}','${source}');
        DELETE FROM public.phase_teams WHERE id IN ('${planned}','${released}','${phaseFork}');`);
    }
  });

  it('rolls back the pointer clear and every transfer when an identity collision aborts release', async () => {
    const planned = randomUUID();
    const collision = randomUUID();
    const firstRelease = randomUUID();
    const firstMatch = randomUUID();
    try {
      // phase_matches_round_pair_unique seats a pairing once per round: `firstMatch` goes into a second round.
      const firstRound = randomUUID();
      await ok(`INSERT INTO public.phase_rounds (id,phase_id,name,round_number,best_of) VALUES ('${firstRound}','${phaseId}','Round 2',2,3);
        ${insert('phase_teams', planned, null)} ${insert('phase_teams', collision, randomUUID(), matchId)} ${insert('teams', collision, null)}
        INSERT INTO public.phase_matches (id,phase_id,round_id,player_1_id,player_2_id)
          VALUES ('${firstMatch}','${phaseId}','${firstRound}','${players[0]}','${players[1]}');
        INSERT INTO public.phase_teams (id,phase_id,player_id,match_id)
          VALUES ('${firstRelease}','${phaseId}','${players[1]}','${firstMatch}');`);
      const result = await sql(`SET ROLE service_role; SELECT public.phase_teams_release_matches(ARRAY['${firstMatch}','${matchId}']::uuid[]);`);
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain('teams_pkey');
      expect(await ok(`SELECT match_id FROM public.phase_teams WHERE id = '${collision}';`)).toBe(matchId);
      expect(await ok(`SELECT match_id FROM public.phase_teams WHERE id = '${firstRelease}';`)).toBe(firstMatch);
    } finally {
      await ok(`DELETE FROM public.teams WHERE id = '${collision}'; DELETE FROM public.phase_teams WHERE id IN ('${collision}','${planned}','${firstRelease}');
        DELETE FROM public.phase_matches WHERE id = '${firstMatch}';`);
    }
  });

  it('retains an outgoing phase fork and can fork the shared source before and after transfer', async () => {
    const source = randomUUID();
    const planned = randomUUID();
    const transferred = randomUUID();
    const before = randomUUID();
    const after = randomUUID();
    const token = randomUUID();
    try {
      await ok(`${insert('phase_teams', planned, null)} ${insert('phase_teams', transferred, token, matchId)}
        INSERT INTO public.phase_teams (id,phase_id,player_id) VALUES ('${source}','${phaseId}','${players[1]}');
        UPDATE public.phase_teams SET forked_from_phase_team_id = '${source}' WHERE id = '${transferred}';
        INSERT INTO public.teams (id,player_id,pokemon,forked_from_phase_team_id)
          SELECT '${before}','${players[1]}',pokemon,id FROM public.phase_teams WHERE share_token = '${token}' AND share_enabled_at IS NOT NULL;
        ${release()}
        INSERT INTO public.teams (id,player_id,pokemon,forked_from_team_id)
          SELECT '${after}','${players[1]}',pokemon,id FROM public.teams WHERE share_token = '${token}' AND share_enabled_at IS NOT NULL;`);
      expect(await ok(`SELECT forked_from_phase_team_id FROM public.teams WHERE id = '${transferred}';`)).toBe(source);
      expect(await ok(`SELECT count(*) FROM public.teams WHERE id IN ('${before}','${after}')
        AND forked_from_team_id = '${transferred}' AND forked_from_phase_team_id IS NULL;`)).toBe('2');
    } finally {
      await ok(`DELETE FROM public.teams WHERE id IN ('${transferred}','${before}','${after}');
        DELETE FROM public.phase_teams WHERE id IN ('${planned}','${source}','${transferred}');`);
    }
  });

  it('enforces completed locks, corrections, manual locks, participant prep and closed planned deletion', async () => {
    const planned = randomUUID();
    try {
      const created = await ok(`SET ROLE service_role; ${roster('match_prep', null, matchId, 'participant')}`);
      expect(created).toMatch(/^[a-f0-9-]{36}$/);
      await ok(`UPDATE public.phase_matches SET status = 'completed' WHERE id = '${matchId}';`);
      const refused = await sql(`SET ROLE service_role; ${roster('edit', created, null, 'owner', '[{"species":"Pikachu"}]')}`);
      expect(refused.errors).toContain('TEAM_MATCH_COMPLETED');
      const direct = await sql(`UPDATE public.phase_teams SET pokemon = '[{"species":"Pikachu"}]' WHERE id = '${created}';`);
      expect(direct.errors).toContain('TEAM_MATCH_COMPLETED');
      await ok(`SET ROLE service_role; ${roster('edit', created, null, 'admin', '[{"species":"Pikachu"}]')}`);
      await ok(`UPDATE public.phase_teams SET locked = true WHERE id = '${created}';`);
      expect((await sql(`SET ROLE service_role; ${roster('edit', created, null, 'admin')}`)).errors).toContain('team_locked');
      await ok(`SET ROLE service_role; ${roster('delete', created, null, 'admin')}`);
      await ok(`${insert('phase_teams', planned, null)} UPDATE public.league_phases SET status = 'completed' WHERE id = '${phaseId}';`);
      expect((await sql(`SET ROLE service_role; ${roster('edit', planned, null, 'owner')}`)).errors).toContain('team_submission_closed');
      await ok(`SET ROLE service_role; ${roster('delete', planned, null, 'owner')}`);
    } finally {
      await ok(`UPDATE public.phase_matches SET status = 'scheduled' WHERE id = '${matchId}';
        UPDATE public.league_phases SET status = 'upcoming' WHERE id = '${phaseId}';
        DELETE FROM public.phase_teams WHERE phase_id = '${phaseId}'; DELETE FROM public.phase_match_prep_teams WHERE match_id = '${matchId}';`);
    }
  });

  it('requires native enrollment for ordinary creation and closes completed-phase creation even for admins', async () => {
    try {
      const unenrolled = await sql(`SET ROLE service_role; ${roster('create', null, null, 'owner')}`);
      expect(unenrolled.errors).toContain('team_not_tournament_participant');
      await ok(`INSERT INTO public.phase_participants (phase_id,player_id) VALUES ('${phaseId}','${players[0]}');`);
      const id = await ok(`SET ROLE service_role; ${roster('create', null, null, 'owner')}`);
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect((await sql(`SET ROLE service_role; ${roster('create', null, null, 'owner')}`)).errors).toContain('team_already_submitted');
      await ok(`UPDATE public.league_phases SET status = 'completed' WHERE id = '${phaseId}';`);
      expect((await sql(`SET ROLE service_role; ${roster('create', null, null, 'admin')}`)).errors).toContain('team_submission_closed');
      await ok(`SET ROLE service_role; ${roster('edit', id, null, 'admin')}`);
      expect(await ok(`SET ROLE service_role; ${roster('match_prep', null, matchId, 'participant')}`)).toMatch(/^[a-f0-9-]{36}$/);
    } finally {
      await ok(`DELETE FROM public.phase_teams WHERE phase_id = '${phaseId}';
        DELETE FROM public.phase_match_prep_teams WHERE match_id = '${matchId}';
        UPDATE public.league_phases SET status = 'upcoming' WHERE id = '${phaseId}';
        DELETE FROM public.phase_participants WHERE phase_id = '${phaseId}';`);
    }
  });

  it('restores shared phase teams and outside fork pointers through the league trash', async () => {
    const id = randomUUID();
    const fork = randomUUID();
    const token = randomUUID();
    const collision = randomUUID();
    let trashId: string | undefined;
    try {
      await ok(`${insert('phase_teams', id, token)} ${insert('teams', fork, null)}
        UPDATE public.teams SET forked_from_phase_team_id = '${id}' WHERE id = '${fork}';`);
      trashId = await ok(`SELECT public.league_trash_delete('${seasonId}','${players[0]}',90)->>'trash_id';`);
      expect(trashId).toMatch(/^[a-f0-9-]{36}$/);
      expect(await ok(`SELECT forked_from_phase_team_id IS NULL FROM public.teams WHERE id = '${fork}';`)).toBe('t');
      await ok(`SELECT public.league_trash_rebuild_done('${trashId}'); ${insert('teams', collision, token)}`);
      const refused = await sql(`SELECT public.league_trash_restore('${trashId}');`);
      expect(refused.code).not.toBe(0);
      expect(refused.errors).toContain('teams_global_share_token_key');
      expect(await ok(`SELECT count(*) FROM public.league_trash WHERE id = '${trashId}';`)).toBe('1');
      expect(await ok(`SELECT count(*) FROM public.phase_teams WHERE id = '${id}';`)).toBe('0');
      await ok(`DELETE FROM public.teams WHERE id = '${collision}'; SELECT public.league_trash_restore('${trashId}');
        SELECT public.league_trash_restore_rebuild_done('${seasonId}');`);
      trashId = undefined;
      expect(await ok(`SELECT share_token FROM public.phase_teams WHERE id = '${id}';`)).toBe(token);
      expect(await ok(`SELECT forked_from_phase_team_id FROM public.teams WHERE id = '${fork}';`)).toBe(id);
    } finally {
      await sql(`DELETE FROM public.teams WHERE id = '${collision}';`);
      if (trashId) await sql(`SELECT public.league_trash_rebuild_done('${trashId}'); SELECT public.league_trash_restore('${trashId}'); SELECT public.league_trash_restore_rebuild_done('${seasonId}');`);
      await ok(`DELETE FROM public.teams WHERE id = '${fork}'; DELETE FROM public.phase_teams WHERE id = '${id}';`);
    }
  }, 60_000);

  it('fences even no-op release and roster RPCs before activation', async () => {
    for (const statement of [`SELECT public.phase_teams_release_matches('{}'::uuid[]);`, roster('create', null, null, 'owner')]) {
      const result = await sql(`BEGIN; UPDATE public.phase_storage_state SET mode = 'legacy'; SET LOCAL ROLE service_role; ${statement} ROLLBACK;`);
      expect(result.code).not.toBe(0);
      expect(result.errors).toContain('phase_storage_not_ready');
    }
  });
});
