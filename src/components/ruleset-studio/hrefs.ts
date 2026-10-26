/** Addresses of the Ruleset Studio pages, in one place so the gallery, the starts and the editor agree. */

/** The gallery: the page the editor's "back" link and a deleted draft lead to. */
export const RULESETS_HREF = '/admin/rulesets';

/** The read-only page of a stored ruleset. */
export function rulesetReadOnlyHref(definitionId: string): string {
  return `${RULESETS_HREF}/${encodeURIComponent(definitionId)}`;
}

/** The editor of a stored ruleset. */
export function rulesetEditorHref(definitionId: string): string {
  return `${rulesetReadOnlyHref(definitionId)}/edit`;
}

/** The read-only page of a catalog rule preset. */
export function rulesetPresetHref(presetId: string): string {
  return `${RULESETS_HREF}/catalog/${encodeURIComponent(presetId)}`;
}
