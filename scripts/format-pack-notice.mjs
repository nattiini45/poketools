/**
 * Build-log warning for a production build that runs the public example format pack
 * (docs/format-packs.md, "Choosing the Active Pack"; README, "Format packs").
 *
 * `next.config.mjs` resolves the pack and prints `[format-pack] using <pack> pack` on every run.
 * That line is informational; this module adds a warning for the one case that is easy to miss:
 * a production build (or `next start`) that fell back to the example pack because no private pack
 * was on disk and FORMAT_PACK was left unset. The example numbers are placeholders, and creating a
 * point-buy season writes them to the database. Setting FORMAT_PACK=example acknowledges the
 * example pack on purpose (CI does this) and silences the warning; FORMAT_PACK=private already
 * fails the build when the pack is missing.
 *
 * Pure (no I/O, no process access) so scripts/__tests__/format-pack-notice.test.mjs covers every case.
 */

/**
 * @param {{ pack: 'example' | 'private', formatPackEnv: string | undefined, nodeEnv: string | undefined }} input
 *   `pack`: the pack next.config.mjs resolved; `formatPackEnv`: the raw FORMAT_PACK value;
 *   `nodeEnv`: NODE_ENV (`production` for `next build` and `next start`).
 * @returns {string | null} the warning text, or null when there is nothing to warn about.
 */
export function examplePackProductionWarning({ pack, formatPackEnv, nodeEnv }) {
  if (pack !== 'example') return null;
  if (nodeEnv !== 'production') return null;
  if ((formatPackEnv ?? '').trim() === 'example') return null;
  return [
    '[format-pack] WARNING: this production build uses the example format pack (src/format-packs/example/).',
    '[format-pack] Its budgets, prices, token ratios, tiebreakers and rule text are placeholders, and creating a',
    '[format-pack] point-buy season writes them to the database. Provide your own pack in src/format-packs/private/',
    '[format-pack] and set FORMAT_PACK=private, or set FORMAT_PACK=example to use the example pack on purpose.',
    '[format-pack] See docs/format-packs.md ("Writing Your Own Pack").',
  ].join('\n');
}
