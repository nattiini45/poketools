/**
 * Where a problem lives in the editor: the mapping from a JSON pointer (what the compiler reports) to the part of
 * the form that shows it, and the stable DOM ids the form fields carry so an issue can jump to its field (the id
 * scheme is the studio core's, `@/lib/studio-core/targets`, with the `ff` prefix of format fields).
 *
 * Pure and client-safe: ids and numbers only, no text.
 */
import { parsePointer } from '@/lib/format-kit/client';
import { errorId as studioErrorId, fieldId as studioFieldId, jumpCandidates as studioJumpCandidates } from '@/lib/studio-core/targets';

/** DOM id prefix of the format form fields. */
const FIELD_PREFIX = 'ff';

export type EditorSection = 'identity' | 'stage' | 'edges' | 'rules' | 'text' | 'theme';

/** `index` is the stage, advancement rule, rule card or text section; 0 for identity and theme. */
export interface Selection {
  section: EditorSection;
  index: number;
}

export const DEFAULT_SELECTION: Selection = { section: 'stage', index: 0 };

const INDEX = /^(?:0|[1-9][0-9]{0,8})$/;

/** The section a list pointer belongs to, with the item index (0 when the pointer names the list itself). */
function listTarget(section: EditorSection, segment: string | undefined): Selection | null {
  if (segment === undefined) return { section, index: 0 };
  return INDEX.test(segment) ? { section, index: Number(segment) } : null;
}

/**
 * The part of the form a pointer belongs to, or `null` for a pointer the form has no place for (the document
 * root, the schema version, views, modules, an unknown member). Views and modules are kept but not edited.
 */
export function pointerTarget(pointer: string): Selection | null {
  const segments = parsePointer(pointer);
  if (segments === null || segments.length === 0) return null;
  const [head, second, third] = segments;
  switch (head) {
    case 'identity':
      return { section: 'identity', index: 0 };
    case 'theme':
      return { section: 'theme', index: 0 };
    case 'stages':
      return listTarget('stage', second);
    case 'edges':
      return listTarget('edges', second);
    case 'rules':
      return listTarget('rules', second);
    case 'text':
      if (second !== 'sections') return null;
      return listTarget('text', third);
    default:
      return null;
  }
}

/** The DOM id of the field a pointer names: `ff-` and the segments joined by `-`, only `[a-z0-9_-]`. */
export function fieldId(pointer: string): string {
  return studioFieldId(FIELD_PREFIX, pointer);
}

/** The DOM id of the message that belongs to a field (`aria-describedby` points here). */
export function errorId(pointer: string): string {
  return studioErrorId(FIELD_PREFIX, pointer);
}

/**
 * Field ids to try, in order, when jumping to a problem: the pointer itself, then each parent down to the
 * first segment (`/stages/0/pairing/legs`, `/stages/0/pairing`, `/stages/0`, `/stages`). The caller focuses the
 * first one that exists on the page.
 */
export function jumpCandidates(pointer: string): string[] {
  return studioJumpCandidates(FIELD_PREFIX, pointer);
}
