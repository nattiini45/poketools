import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhaseWikiNote, PhaseWikiNoteChanges, PhaseWikiNoteInput, PhaseWikiReport } from '@/types/phase-wiki';
import type { WikiEntityType, WikiNoteReportStatus } from '@/types/wiki';
import { UserFacingError } from '@/lib/api/user-facing-error';
import wikiErrors from '@/i18n/messages/errors/stats/en';

type WikiRpcDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      phase_wiki_report_submit: {
        Args: { p_phase_id: string; p_note_id: string; p_reporter_id: string; p_reason: string;
          p_details: string | null; p_note_updated_at: string; p_report_updated_at: string | null };
        Returns: PhaseWikiReport;
      };
    };
  };
};

function noteGuard(note: PhaseWikiNote) {
  return { approved: note.approved, rejected_at: note.rejected_at, resubmission_blocked_at: note.resubmission_blocked_at };
}

export const phaseWikiStorage = {
  async getNote(phaseId: string, id: string): Promise<PhaseWikiNote | null> {
    const { data, error } = await supabase.from('phase_wiki_notes').select('*').eq('phase_id', phaseId).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async listNotes(phaseId: string, approvedOnly: boolean, entity?: { type: WikiEntityType; name: string }): Promise<PhaseWikiNote[]> {
    const rows = await readAllPages((from, to) => {
      let query = supabase.from('phase_wiki_notes').select('*, players!phase_wiki_notes_author_id_fkey(name)').eq('phase_id', phaseId);
      if (approvedOnly) query = query.eq('approved', true).is('rejected_at', null).is('resubmission_blocked_at', null);
      if (entity) query = query.eq('entity_type', entity.type).eq('entity_name', entity.name);
      return query.order('created_at').order('id').range(from, to);
    });
    return rows.map(({ players, ...note }) => ({ ...note, author_name: players?.name }));
  },
  async createNote(phaseId: string, authorId: string, input: PhaseWikiNoteInput, flags: string[]): Promise<PhaseWikiNote> {
    const { data, error } = await supabase.from('phase_wiki_notes').insert({
      phase_id: phaseId, author_id: authorId, entity_type: input.entity_type, entity_name: input.entity_name,
      content: input.content, approved: false, moderation_flags: flags,
    }).select().single();
    if (error) throw error;
    return data;
  },
  async writeNote(note: PhaseWikiNote, fields: PhaseWikiNoteChanges, remove = false): Promise<boolean> {
    const nextVersion = new Date(Math.max(Date.now(), Date.parse(note.updated_at) + 1)).toISOString();
    let query = remove ? supabase.from('phase_wiki_notes').delete() : supabase.from('phase_wiki_notes').update({ ...fields, updated_at: nextVersion });
    query = query.eq('phase_id', note.phase_id).eq('id', note.id).eq('updated_at', note.updated_at);
    for (const [key, value] of Object.entries(noteGuard(note))) {
      query = value === null ? query.is(key, null) : query.eq(key, value);
    }
    const { data, error } = await query.select('id');
    if (error) throw error;
    return data.length === 1;
  },
  async getReport(phaseId: string, id: string): Promise<PhaseWikiReport | null> {
    const { data, error } = await supabase.from('phase_wiki_note_reports')
      .select('*, phase_wiki_notes!inner(phase_id)').eq('phase_wiki_notes.phase_id', phaseId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { phase_wiki_notes: _owner, ...report } = data;
    return report;
  },
  async findReport(noteId: string, reporterId: string): Promise<PhaseWikiReport | null> {
    const { data, error } = await supabase.from('phase_wiki_note_reports').select('*').eq('note_id', noteId).eq('reporter_id', reporterId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async listReports(phaseId: string): Promise<PhaseWikiReport[]> {
    const rows = await readAllPages((from, to) => supabase.from('phase_wiki_note_reports')
      .select('*, phase_wiki_notes!inner(phase_id)').eq('phase_wiki_notes.phase_id', phaseId)
      .order('created_at').order('id').range(from, to));
    return rows.map(({ phase_wiki_notes: _owner, ...report }) => report);
  },
  async submitReport(note: PhaseWikiNote, reporterId: string, reason: string, details: string | null, previous: PhaseWikiReport | null): Promise<PhaseWikiReport> {
    const client = supabase as unknown as SupabaseClient<WikiRpcDatabase>;
    const { data, error } = await client.rpc('phase_wiki_report_submit', {
      p_phase_id: note.phase_id, p_note_id: note.id, p_reporter_id: reporterId, p_reason: reason,
      p_details: details, p_note_updated_at: note.updated_at, p_report_updated_at: previous?.updated_at ?? null,
    });
    if (error) {
      if (error.code === 'P0001') {
        if (error.message === 'wiki_note_not_found') throw new UserFacingError(wikiErrors.wiki_note_not_found, { code: 'wiki_note_not_found', status: 404 });
        if (error.message === 'wiki_note_changed') throw new UserFacingError(wikiErrors.wiki_note_changed, { code: 'wiki_note_changed', status: 409 });
        if (error.message === 'wiki_report_changed') throw new UserFacingError(wikiErrors.wiki_report_changed, { code: 'wiki_report_changed', status: 409 });
      }
      throw error;
    }
    if (!data) throw new Error('phase_wiki_report_empty_result');
    return data;
  },
  async closeReport(report: PhaseWikiReport, status: WikiNoteReportStatus): Promise<boolean> {
    const { data, error } = await supabase.from('phase_wiki_note_reports').update({
      status, updated_at: new Date(Math.max(Date.now(), Date.parse(report.updated_at) + 1)).toISOString(),
    }).eq('id', report.id).eq('note_id', report.note_id).eq('status', report.status).eq('updated_at', report.updated_at).select('id');
    if (error) throw error;
    return data.length === 1;
  },
};

export type PhaseWikiStorage = typeof phaseWikiStorage;
