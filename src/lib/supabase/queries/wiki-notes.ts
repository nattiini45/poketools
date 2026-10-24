import { supabase } from '../client';
import { scanWikiNoteContent } from '@/lib/wiki/moderation';
import type {
  WikiNote,
  WikiNoteInsert,
  WikiEntityType,
  WikiNoteReport,
  WikiNoteReportStatus,
} from '@/types/wiki';

type WikiNoteRow = {
  id: string;
  entity_type: string;
  entity_name: string;
  author_id: string;
  content: string;
  scope_type: string;
  scope_id: string | null;
  approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  moderation_flags: string[] | null;
  created_at: string;
  updated_at: string;
  players?: { name: string } | null;
};

type WikiNoteReportRow = {
  id: string;
  note_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  players?: { name: string } | null;
  wiki_notes?: Pick<WikiNoteRow, 'id' | 'entity_type' | 'entity_name' | 'content' | 'author_id' | 'approved'> | null;
};

interface WikiModerationFilters {
  status?: 'pending' | 'approved' | 'rejected' | 'all';
  limit?: number;
  offset?: number;
}

interface WikiReportFilters {
  status?: WikiNoteReportStatus;
  limit?: number;
  offset?: number;
}

function toWikiNote(row: WikiNoteRow): WikiNote {
  return {
    id: row.id,
    entity_type: row.entity_type as WikiEntityType,
    entity_name: row.entity_name,
    author_id: row.author_id,
    author_name: row.players?.name ?? undefined,
    content: row.content,
    scope_type: row.scope_type as WikiNote['scope_type'],
    scope_id: row.scope_id,
    approved: row.approved,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    rejected_by: row.rejected_by,
    rejected_at: row.rejected_at,
    rejection_reason: row.rejection_reason,
    moderation_flags: row.moderation_flags ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toWikiReport(row: WikiNoteReportRow): WikiNoteReport {
  return {
    id: row.id,
    note_id: row.note_id,
    reporter_id: row.reporter_id,
    reporter_name: row.players?.name ?? undefined,
    reason: row.reason,
    details: row.details,
    status: row.status as WikiNoteReportStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
    note: row.wiki_notes
      ? {
          id: row.wiki_notes.id,
          entity_type: row.wiki_notes.entity_type as WikiEntityType,
          entity_name: row.wiki_notes.entity_name,
          content: row.wiki_notes.content,
          author_id: row.wiki_notes.author_id,
          approved: row.wiki_notes.approved,
        }
      : undefined,
  };
}

// ── Read ────────────────────────────────────────────────────────────────

export async function getApprovedNotes(
  entityType: WikiEntityType,
  entityName: string,
  scopeType?: string,
  scopeId?: string,
): Promise<WikiNote[]> {
  let query = supabase
    .from('wiki_notes')
    .select('*, players!wiki_notes_author_id_fkey(name)')
    .eq('entity_type', entityType)
    .eq('entity_name', entityName)
    .eq('approved', true)
    .order('created_at', { ascending: false });

  if (scopeType) {
    query = query.eq('scope_type', scopeType);
  }
  if (scopeId) {
    query = query.eq('scope_id', scopeId);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;

  return ((data as unknown as WikiNoteRow[] | null) ?? []).map(toWikiNote);
}

export async function listNotesForModeration(filters: WikiModerationFilters = {}): Promise<WikiNote[]> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  let query = supabase
    .from('wiki_notes')
    .select('*, players!wiki_notes_author_id_fkey(name)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status === 'pending' || !filters.status) {
    query = query.eq('approved', false).is('rejected_at', null);
  } else if (filters.status === 'approved') {
    query = query.eq('approved', true);
  } else if (filters.status === 'rejected') {
    query = query.not('rejected_at', 'is', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as unknown as WikiNoteRow[] | null) ?? []).map(toWikiNote);
}

// ── Write ───────────────────────────────────────────────────────────────

export async function createNote(
  authorId: string,
  insert: WikiNoteInsert,
): Promise<WikiNote> {
  const moderationFlags = scanWikiNoteContent(insert.content);
  const { data, error } = await supabase
    .from('wiki_notes')
    .insert({
      entity_type: insert.entity_type,
      entity_name: insert.entity_name,
      author_id: authorId,
      content: insert.content,
      scope_type: insert.scope_type ?? 'global',
      scope_id: insert.scope_id ?? null,
      approved: false,
      moderation_flags: moderationFlags,
    })
    .select()
    .single();

  if (error) throw error;
  return toWikiNote(data as unknown as WikiNoteRow);
}

/**
 * Edits a note's text and re-runs the automated scan, in one UPDATE.
 *
 * `'author'` also puts the note back in the pending queue (approval and rejection fields cleared in the same
 * statement), so edited text is never public before a moderator has seen it. `'moderator'` (a site admin editing)
 * keeps the note's status.
 */
export async function updateNote(
  id: string,
  content: string,
  editor: 'author' | 'moderator',
): Promise<void> {
  const requeue = editor === 'author'
    ? {
        approved: false,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
      }
    : {};
  const { error } = await supabase
    .from('wiki_notes')
    .update({
      content,
      moderation_flags: scanWikiNoteContent(content),
      ...requeue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase
    .from('wiki_notes')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function approveNote(id: string, moderatorId?: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('wiki_notes')
    .update({
      approved: true,
      approved_by: moderatorId ?? null,
      approved_at: now,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      updated_at: now,
    })
    .eq('id', id);

  if (error) throw error;
}

/** Rejects a note; `reason` is null when the moderator gave none. */
export async function rejectNote(id: string, moderatorId: string, reason: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('wiki_notes')
    .update({
      approved: false,
      rejected_by: moderatorId,
      rejected_at: now,
      rejection_reason: reason,
      updated_at: now,
    })
    .eq('id', id);

  if (error) throw error;
}

export async function getNoteById(id: string): Promise<WikiNote | null> {
  const { data, error } = await supabase
    .from('wiki_notes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  if (!data) return null;

  return toWikiNote(data as unknown as WikiNoteRow);
}

export async function createNoteReport(
  reporterId: string,
  noteId: string,
  reason: string,
  details?: string,
): Promise<WikiNoteReport> {
  const { data, error } = await supabase
    .from('wiki_note_reports')
    .upsert({
      note_id: noteId,
      reporter_id: reporterId,
      reason,
      details: details ?? null,
      status: 'open',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'note_id,reporter_id' })
    .select('*, players!wiki_note_reports_reporter_id_fkey(name), wiki_notes!wiki_note_reports_note_id_fkey(id, entity_type, entity_name, content, author_id, approved)')
    .single();

  if (error) throw error;
  return toWikiReport(data as unknown as WikiNoteReportRow);
}

export async function listNoteReports(filters: WikiReportFilters = {}): Promise<WikiNoteReport[]> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  let query = supabase
    .from('wiki_note_reports')
    .select('*, players!wiki_note_reports_reporter_id_fkey(name), wiki_notes!wiki_note_reports_note_id_fkey(id, entity_type, entity_name, content, author_id, approved)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as unknown as WikiNoteReportRow[] | null) ?? []).map(toWikiReport);
}

export async function updateNoteReportStatus(id: string, status: WikiNoteReportStatus): Promise<void> {
  const { error } = await supabase
    .from('wiki_note_reports')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
