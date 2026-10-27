/**
 * Where a problem lives in the ruleset editor: the section a JSON pointer belongs to (what the compile reports), and the
 * DOM ids the form fields carry so an issue can jump to its field (the id scheme is the studio core's, with the `rf`
 * prefix of ruleset fields). Pure and client-safe: ids only, no text.
 */
import { errorId as studioErrorId, fieldId as studioFieldId, jumpCandidates as studioJumpCandidates } from '@/lib/studio-core/targets';
import { parsePointer } from '@/lib/studio-core/patch';

/** DOM id prefix of the ruleset form fields. */
const FIELD_PREFIX = 'rf';

/** The sections of the editor, in outline order. */
export const EDITOR_SECTIONS = ['base', 'clauses', 'pokemon', 'moves', 'items', 'abilities', 'constraints', 'notes'] as const;
export type EditorSection = (typeof EDITOR_SECTIONS)[number];

export interface Selection {
  section: EditorSection;
}

export const DEFAULT_SELECTION: Selection = { section: 'pokemon' };

/** The four list sections; each edits the category of the same name. */
export const LIST_SECTIONS = ['pokemon', 'moves', 'items', 'abilities'] as const satisfies readonly EditorSection[];
export type ListSection = (typeof LIST_SECTIONS)[number];

export function isListSection(section: EditorSection): section is ListSection {
  return (LIST_SECTIONS as readonly string[]).includes(section);
}

/** The section a pointer belongs to; the document root and the identity belong to "Base and basics". */
export function sectionOfPointer(pointer: string): EditorSection {
  const segments = parsePointer(pointer);
  const head = segments === null || segments.length === 0 ? '' : segments[0];
  switch (head) {
    case 'clauses':
      return 'clauses';
    case 'pokemon':
    case 'moves':
    case 'items':
    case 'abilities':
      return head;
    case 'min_shared_type_pct':
    case 'team_constraints':
      return 'constraints';
    case 'custom_rules':
      return 'notes';
    default:
      return 'base';
  }
}

export const fieldId = (pointer: string): string => studioFieldId(FIELD_PREFIX, pointer);
export const errorId = (pointer: string): string => studioErrorId(FIELD_PREFIX, pointer);
export const jumpCandidates = (pointer: string): string[] => studioJumpCandidates(FIELD_PREFIX, pointer);

/** The id of the active section's heading: the focus target when the outline moves the reader to the section. */
export const SECTION_HEADING_ID = 'rf-section-heading';
