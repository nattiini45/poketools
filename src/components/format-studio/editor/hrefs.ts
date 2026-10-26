/** Addresses of the Format Studio pages, in one place so the editor, the starts and the gallery agree. */

/** The gallery: the page the editor's "back" link and a deleted draft lead to. */
export const FORMATS_HREF = '/admin/formats';

/** The read-only page of a stored format. */
export function formatReadOnlyHref(definitionId: string): string {
  return `${FORMATS_HREF}/${encodeURIComponent(definitionId)}`;
}

/** The editor of a stored format. */
export function formatEditorHref(definitionId: string): string {
  return `${formatReadOnlyHref(definitionId)}/edit`;
}
