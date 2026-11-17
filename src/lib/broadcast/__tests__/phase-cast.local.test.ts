import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_CAST');

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

describe.skipIf(!optedIn)('native cast capabilities on the disposable database', () => {
  const seasonId = randomUUID();
  const phaseId = randomUUID();
  const rulesetId = randomUUID();
  const ownerId = randomUUID();
  let admin: SupabaseClient<Database>;
  let storage: typeof import('@/lib/supabase/queries/phase-cast-sessions');
  const insert = (table: 'cast_sessions' | 'phase_cast_sessions', id: string, key: string) =>
    `INSERT INTO public.${table} (id,owner_id,realtime_key${table === 'phase_cast_sessions' ? ',phase_id' : ''})
      VALUES ('${id}','${ownerId}','${key}'${table === 'phase_cast_sessions' ? `,'${phaseId}'` : ''});`;

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await admin.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: 'Cast fixture' })).error).toBeNull();
    expect((await admin.from('players').insert({ id: ownerId, name: 'Fixture caster', is_guest: true })).error).toBeNull();
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Cast league', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('league_phases').insert({ id: phaseId, season_id: seasonId, name: 'Cast phase', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
    storage = await import('@/lib/supabase/queries/phase-cast-sessions');
  });

  afterAll(async () => {
    if (!admin) return;
    await ok(`DELETE FROM public.cast_sessions WHERE owner_id = '${ownerId}';
      DELETE FROM public.phase_cast_sessions WHERE owner_id = '${ownerId}';
      DELETE FROM public.league_phases WHERE id = '${phaseId}';
      DELETE FROM public.seasons WHERE id = '${seasonId}';
      DELETE FROM public.players WHERE id = '${ownerId}';`);
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  });

  for (const first of ['cast_sessions', 'phase_cast_sessions'] as const) {
    const second = first === 'cast_sessions' ? 'phase_cast_sessions' : 'cast_sessions';
    it(`serializes ${first} first against ${second} for insert/update and commit/rollback`, async () => {
      for (const write of ['insert', 'update']) for (const commit of [true, false]) {
        const firstId = randomUUID();
        const secondId = randomUUID();
        const key = randomUUID();
        const writer = session();
        const contender = session();
        const name = `cast-${secondId}`;
        try {
          if (write === 'update') await ok(`${insert(first, firstId, randomUUID())} ${insert(second, secondId, randomUUID())}`);
          const firstWrite = write === 'insert' ? insert(first, firstId, key) : `UPDATE public.${first} SET realtime_key = '${key}' WHERE id = '${firstId}';`;
          const secondWrite = write === 'insert' ? insert(second, secondId, key) : `UPDATE public.${second} SET realtime_key = '${key}' WHERE id = '${secondId}';`;
          writer.send(`BEGIN; SET LOCAL ROLE service_role; ${firstWrite} SELECT 'held';`);
          await writer.waitFor('held');
          contender.send(`SET application_name = '${name}'; SET ROLE service_role; ${secondWrite} SELECT 'written';`);
          let blocked = false;
          const until = Date.now() + 10_000;
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
            expect(result.errors).toContain('cast_sessions_global_realtime_key');
            await ok(`DELETE FROM public.${first} WHERE id = '${firstId}'; ${secondWrite}`);
          } else {
            expect(result.code).toBe(0);
            expect(result.output).toContain('written');
          }
        } finally {
          writer.send('ROLLBACK;');
          await writer.finish();
          await contender.finish();
          await ok(`DELETE FROM public.cast_sessions WHERE id IN ('${firstId}','${secondId}');
            DELETE FROM public.phase_cast_sessions WHERE id IN ('${firstId}','${secondId}');`);
        }
      }
    }, 60_000);

    it(`defers same-ID duplication checks for a real ${first} transfer only`, async () => {
      const id = randomUUID();
      const key = randomUUID();
      try {
        await ok(insert(first, id, key));
        const duplicate = await sql(`BEGIN; ${insert(second, id, key)} COMMIT;`);
        expect(duplicate.code).not.toBe(0);
        expect(duplicate.errors).toContain('cast_sessions_global_realtime_key');
        await ok(`BEGIN; ${insert(second, id, key)} DELETE FROM public.${first} WHERE id = '${id}'; COMMIT;`);
        expect(await ok(`SELECT realtime_key FROM public.${second} WHERE id = '${id}';`)).toBe(key);
      } finally {
        await ok(`DELETE FROM public.cast_sessions WHERE id = '${id}'; DELETE FROM public.phase_cast_sessions WHERE id = '${id}';`);
      }
    });
  }

  it('applies the native state/version fence and preserves its realtime key', async () => {
    const current = await storage.createPhaseCastSession(ownerId, { phase_id: phaseId });
    const live = await storage.updatePhaseCastSession(current, { status: 'live' }, 'owner');
    expect(live).toMatchObject({ status: 'live', realtime_key: current.realtime_key, phase_id: phaseId, season_id: seasonId });
    await expect(storage.updatePhaseCastSession(current, { status: 'archived' }, 'owner')).resolves.toBeNull();
    if (!live) throw new Error('Missing live cast session');
    const archived = await storage.updatePhaseCastSession(live, { status: 'archived' }, 'owner');
    if (!archived) throw new Error('Missing archived cast session');
    await expect(storage.updatePhaseCastSession(archived, { status: 'live' }, 'owner')).rejects.toMatchObject({ code: 'state_transition_invalid' });
    expect(await storage.deletePhaseCastSession(archived)).toBe(true);
  });

  it('rolls back a conflicting trash restore and retries without replacing the channel key', async () => {
    const id = randomUUID();
    const collision = randomUUID();
    const key = randomUUID();
    let trashId: string | undefined;
    try {
      await ok(insert('phase_cast_sessions', id, key));
      trashId = await ok(`SELECT public.league_trash_delete('${seasonId}','${ownerId}',90)->>'trash_id';`);
      expect(trashId).toMatch(/^[a-f0-9-]{36}$/);
      await ok(`SELECT public.league_trash_rebuild_done('${trashId}'); ${insert('cast_sessions', collision, key)}`);
      const refused = await sql(`SELECT public.league_trash_restore('${trashId}');`);
      expect(refused.code).not.toBe(0);
      expect(refused.errors).toContain('cast_sessions_global_realtime_key');
      expect(await ok(`SELECT count(*) FROM public.phase_cast_sessions WHERE id = '${id}';`)).toBe('0');
      expect(await ok(`SELECT count(*) FROM public.league_trash WHERE id = '${trashId}';`)).toBe('1');
      await ok(`DELETE FROM public.cast_sessions WHERE id = '${collision}'; SELECT public.league_trash_restore('${trashId}');
        SELECT public.league_trash_restore_rebuild_done('${seasonId}');`);
      trashId = undefined;
      expect(await ok(`SELECT realtime_key FROM public.phase_cast_sessions WHERE id = '${id}';`)).toBe(key);
    } finally {
      await sql(`DELETE FROM public.cast_sessions WHERE id = '${collision}';`);
      if (trashId) await sql(`SELECT public.league_trash_rebuild_done('${trashId}'); SELECT public.league_trash_restore('${trashId}'); SELECT public.league_trash_restore_rebuild_done('${seasonId}');`);
      await ok(`DELETE FROM public.phase_cast_sessions WHERE id = '${id}';`);
    }
  }, 60_000);
});
