// The one Pokémon id fold for the whole app.
// This file has no imports by contract: src/lib/pkmn/i18n/__tests__/id.test.ts asserts it, so draft line identity
// (src/lib/draft/line-identity.ts) can use it without pulling any dictionary or @pkmn module.
// The body is duplicated in scripts/pkmn-i18n/build.mjs; the id test pins the two to the same output.
// NFKD (not NFD) so it equals the SQL mirror public.epb_fold_id, which replaces ♀/♂ before normalize(…, NFKD).

/**
 * Folds an English Pokémon, move, item, ability, nature or type name into its @pkmn id:
 * ♀ → f, ♂ → m, accents stripped (Flabébé → flabebe), lowercase, every non `[a-z0-9]` dropped.
 * Unlike @pkmn's own toID it keeps accented letters as their base letter instead of dropping them.
 */
export function toID(text: string): string {
  return text
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
