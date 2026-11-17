import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_WIKI');

describe.skipIf(!optedIn)('phase wiki on a disposable phase-mode stack', () => {
  const phase = randomUUID();
  const season = randomUUID();
  const player = randomUUID();
  const ruleset = randomUUID();
  let client: SupabaseClient<Database>;
  let storage: typeof import('@/lib/supabase/queries/phase-wiki-notes')['phaseWikiStorage'];

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await client.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(client, { id: ruleset, name: 'Wiki fixture' })).error).toBeNull();
    expect((await client.from('players').insert({ id: player, name: 'Fixture trainer', is_guest: true })).error).toBeNull();
    expect((await client.from('seasons').insert({ id: season, name: 'Wiki league', format_type: 'singles', ruleset_id: ruleset })).error).toBeNull();
    expect((await client.from('league_phases').insert({ id: phase, season_id: season, name: 'Wiki phase', bracket_type: 'round_robin', ruleset_id: ruleset })).error).toBeNull();
    storage = (await import('@/lib/supabase/queries/phase-wiki-notes')).phaseWikiStorage;
  });

  afterAll(async () => {
    if (!client) return;
    expect((await client.from('league_phases').delete().eq('id', phase)).error).toBeNull();
    expect((await client.from('seasons').delete().eq('id', season)).error).toBeNull();
    expect((await client.from('players').delete().eq('id', player)).error).toBeNull();
    expect((await deleteLocalRuleset(client, ruleset)).error).toBeNull();
  });

  async function approvedNote() {
    const { data, error } = await client.from('phase_wiki_notes').insert({
      phase_id: phase, author_id: player, entity_type: 'move', entity_name: 'tackle', content: 'Fixture text', approved: true,
    }).select().single();
    expect(error).toBeNull();
    if (!data) throw new Error('missing fixture');
    return data;
  }

  it('lets one concurrent verdict/edit win without overwriting newer text', async () => {
    const note = await approvedNote();
    const results = await Promise.all([
      storage.writeNote(note, { approved: false, content: 'Author edit' }),
      storage.writeNote(note, { approved: false, rejected_at: new Date().toISOString() }),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });

  it('keeps report uniqueness, reopens the same report, and refuses a stale close', async () => {
    const note = await approvedNote();
    const submitted = await Promise.allSettled([
      storage.submitReport(note, player, 'spam', null, null),
      storage.submitReport(note, player, 'other', null, null),
    ]);
    expect(submitted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(submitted.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'wiki_report_changed' } });
    const report = await storage.findReport(note.id, player);
    if (!report) throw new Error('missing report');
    expect(await storage.closeReport(report, 'reviewed')).toBe(true);
    const closed = await storage.findReport(note.id, player);
    const reopened = await storage.submitReport(note, player, 'other', 'New reason', closed);
    expect(reopened.id).toBe(report.id);
    expect(reopened.status).toBe('open');
    expect(await storage.closeReport(report, 'dismissed')).toBe(false);
  });

  it('refuses reports after an intervening edit/unpublish and cross-phase ownership', async () => {
    const note = await approvedNote();
    expect(await storage.writeNote(note, { approved: false, content: 'Pending edit' })).toBe(true);
    await expect(storage.submitReport(note, player, 'spam', null, null)).rejects.toMatchObject({ code: 'wiki_note_not_found' });
    expect(await storage.getNote(randomUUID(), note.id)).toBeNull();
    expect(await storage.findReport(note.id, player)).toBeNull();
  });
});
