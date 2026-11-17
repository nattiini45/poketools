import type { Tables, TablesUpdate } from './database';
import type { WikiEntityType } from './wiki';

export type PhaseWikiNote = Tables<'phase_wiki_notes'> & { author_name?: string };
export type PhaseWikiReport = Tables<'phase_wiki_note_reports'>;
export type PhaseWikiNoteInput = {
  entity_type: WikiEntityType;
  entity_name: string;
  content: string;
};
export type PhaseWikiNoteChanges = Pick<TablesUpdate<'phase_wiki_notes'>,
  'content' | 'approved' | 'approved_by' | 'approved_at' | 'rejected_by' | 'rejected_at' |
  'rejection_reason' | 'moderation_flags' | 'resubmission_blocked_at' | 'resubmission_blocked_by'>;

export interface PublicPhaseWikiNote {
  id: string;
  phase_id: string;
  entity_type: WikiEntityType;
  entity_name: string;
  author_name?: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface PhaseWikiActor {
  playerId: string;
  isSiteAdmin: boolean;
  isSuperadmin: boolean;
}
