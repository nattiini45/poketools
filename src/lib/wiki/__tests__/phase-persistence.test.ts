import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import type { PhaseWikiNote } from '@/types/phase-wiki';

vi.mock('@/lib/supabase/client', () => ({ supabase: createMockSupabase() }));
import { supabase } from '@/lib/supabase/client';
import { phaseWikiStorage } from '@/lib/supabase/queries/phase-wiki-notes';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';

const db = supabase as unknown as ReturnType<typeof createMockSupabase>;
const note: PhaseWikiNote = {
  id: 'note', phase_id: 'phase', author_id: 'author', entity_type: 'item', entity_name: 'leftovers',
  content: 'Useful', approved: false, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null,
  rejection_reason: null, moderation_flags: [], resubmission_blocked_at: null, resubmission_blocked_by: null,
  created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
};

beforeEach(() => db.__reset());

describe('native phase wiki persistence', () => {
  it('leaves default wiki reads on legacy storage without a generation or RPC read', async () => {
    db.__setResult([]);
    expect(await getApprovedNotes('move', 'tackle')).toEqual([]);
    expect(db.from).toHaveBeenCalledExactlyOnceWith('wiki_notes');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('guards edits and deletes by real owner, state fields and exact text version', async () => {
    db.__setResult([{ id: note.id }]);
    expect(await phaseWikiStorage.writeNote(note, { content: 'New' })).toBe(true);
    expect(db.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(db.eq).toHaveBeenCalledWith('id', 'note');
    expect(db.eq).toHaveBeenCalledWith('updated_at', note.updated_at);
    expect(db.eq).toHaveBeenCalledWith('approved', false);
    expect(db.is).toHaveBeenCalledWith('rejected_at', null);
    expect(db.is).toHaveBeenCalledWith('resubmission_blocked_at', null);
    const fields = db.update.mock.calls[0][0] as { updated_at: string };
    expect(Date.parse(fields.updated_at)).toBeGreaterThan(Date.parse(note.updated_at));
    await phaseWikiStorage.writeNote(note, {}, true);
    expect(db.delete).toHaveBeenCalledOnce();
    db.__setResult([]);
    expect(await phaseWikiStorage.writeNote(note, {})).toBe(false);
  });

  it('pages all notes below max_rows, orders uniquely and embeds names only', async () => {
    const range = db.range as ReturnType<typeof vi.fn>;
    range.mockResolvedValueOnce({ data: [{ ...note, players: { name: 'Fixture' } }], error: null })
      .mockResolvedValueOnce({ data: [{ ...note, id: 'second', players: { name: 'Other' } }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    expect(await phaseWikiStorage.listNotes('phase', true)).toEqual([
      { ...note, author_name: 'Fixture' }, { ...note, id: 'second', author_name: 'Other' },
    ]);
    expect(range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(db.select).toHaveBeenCalledWith('*, players!phase_wiki_notes_author_id_fkey(name)');
    expect(db.eq).toHaveBeenCalledWith('approved', true);
    expect(db.order).toHaveBeenCalledWith('id');
  });

  it('keeps report ownership phase-scoped and strips join wrappers', async () => {
    const report = { id: 'report', note_id: 'note', status: 'open' };
    db.__setResult({ ...report, phase_wiki_notes: { phase_id: 'phase' } });
    expect(await phaseWikiStorage.getReport('phase', 'report')).toEqual(report);
    expect(db.eq).toHaveBeenCalledWith('phase_wiki_notes.phase_id', 'phase');
    expect(db.select).toHaveBeenCalledWith('*, phase_wiki_notes!inner(phase_id)');
  });

  it('does not mask storage failures and distinguishes report RPC conflicts', async () => {
    const error = Object.assign(new Error('wiki_report_changed'), { code: 'P0001' });
    db.__setError(error);
    await expect(phaseWikiStorage.submitReport(note, 'reporter', 'spam', null, null)).rejects.toMatchObject({ code: 'wiki_report_changed', statusCode: 409 });
    const outage = new Error('connection failed');
    db.__setError(outage);
    await expect(phaseWikiStorage.getNote('phase', 'note')).rejects.toBe(outage);
  });

  it('adds only a fenced service-role invoker RPC, with no triggers or legacy dependencies', () => {
    const sql = readFileSync('supabase/migrations/20261117140000_phase_wiki_services.sql', 'utf8');
    expect(sql).toContain("public.phase_storage_mode() IS DISTINCT FROM 'phase'");
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).not.toMatch(/CREATE (TABLE|TRIGGER|POLICY)|SECURITY DEFINER/i);
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain('WHERE id = p_note_id AND phase_id = p_phase_id FOR UPDATE');
    expect(sql).toContain('v_note.updated_at IS DISTINCT FROM p_note_updated_at');
    expect(sql).toContain('v_report.updated_at IS DISTINCT FROM p_report_updated_at');
    expect(sql).toContain("status = 'open'");
    expect(sql).toContain('AND status = v_report.status AND updated_at = p_report_updated_at');
    expect(sql).not.toMatch(/\bpublic\.(wiki_notes|wiki_note_reports|tournaments)\b/);
  });
});
