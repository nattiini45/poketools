export type WikiEntityType = 'pokemon' | 'move' | 'item' | 'ability' | 'tera';

export interface WikiNote {
  id: string;
  entity_type: WikiEntityType;
  entity_name: string;
  author_id: string;
  author_name?: string; // joined from players
  content: string;
  scope_type: 'global' | 'tournament' | 'league';
  scope_id: string | null;
  approved: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  /** Set only on a blocked note (the superadmin closed it for resubmission); absent otherwise. */
  resubmission_blocked_at?: string | null;
  resubmission_blocked_by?: string | null;
  moderation_flags?: string[];
  created_at: string;
  updated_at: string;
}

export interface WikiNoteInsert {
  entity_type: WikiEntityType;
  entity_name: string;
  content: string;
  scope_type?: 'global' | 'tournament' | 'league';
  scope_id?: string | null;
}

export type WikiNoteReportStatus = 'open' | 'reviewed' | 'dismissed';

export interface WikiNoteReport {
  id: string;
  note_id: string;
  reporter_id: string;
  reporter_name?: string;
  reason: string;
  details: string | null;
  status: WikiNoteReportStatus;
  created_at: string;
  updated_at: string;
  note?: Pick<WikiNote, 'id' | 'entity_type' | 'entity_name' | 'content' | 'author_id' | 'approved'>;
}

export interface WikiMoveEntry {
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | null;
  pp: number;
  priority: number;
  description: string;
  shortDesc: string;
  flags: string[];
  generation: number;
}

export interface WikiItemEntry {
  name: string;
  description: string;
  shortDesc: string;
  generation: number;
  fpierce?: boolean;
}

export interface WikiAbilityEntry {
  name: string;
  description: string;
  shortDesc: string;
  generation: number;
  rating: number;
}

export interface WikiSearchResult {
  type: WikiEntityType;
  name: string;
  shortDesc: string;
}
