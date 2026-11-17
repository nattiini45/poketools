import type { PhaseWikiNote, PhaseWikiReport, PublicPhaseWikiNote } from '@/types/phase-wiki';

export function toPublicPhaseWikiNote(note: PhaseWikiNote): PublicPhaseWikiNote | null {
  if (!note.approved || note.rejected_at || note.resubmission_blocked_at) return null;
  if (!['pokemon', 'move', 'item', 'ability', 'tera'].includes(note.entity_type)) return null;
  return {
    id: note.id,
    phase_id: note.phase_id,
    entity_type: note.entity_type as PublicPhaseWikiNote['entity_type'],
    entity_name: note.entity_name,
    author_name: note.author_name,
    content: note.content,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

export function phaseWikiReportReceipt(report: PhaseWikiReport) {
  return { id: report.id, status: report.status, created_at: report.created_at, updated_at: report.updated_at };
}
