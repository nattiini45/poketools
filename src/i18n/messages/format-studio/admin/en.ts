/**
 * Namespace `format-studio/admin`: the chrome of the read-only Format Studio (`/admin/formats`, the three routes)
 * and of the league admin's Format tab. The generated rules text itself comes from `format-studio/describe`,
 * the diagnostic sentences from `format-studio`.
 *
 * - `gallery.*`: the examples section of the gallery; `leagues.*`: the "Your leagues" cards.
 * - `detail.*`: the detail view shared by both routes and the tab; `tab.*`: the Format tab's own header.
 * - `detail.noPhases` is a rich message: `<link>` wraps the link to the league's Phases tab.
 */
export default {
  title: 'Formats',
  subtitle: 'How leagues and example formats are set up, written out in plain words. Read-only for now.',
  gallery: {
    heading: 'Examples',
    intro: 'Three example formats show what the Studio can describe. Open one to read its stages, rules and checks.',
    exampleBadge: 'Example. Change anything.',
    readOnlyNote: 'Examples are read-only for now. You can read them, but not edit or save them yet.',
    open: 'Open',
  },
  leagues: {
    heading: 'Your leagues',
    intro: 'The format of each league, generated from its phases and settings.',
    empty: 'No leagues to show yet.',
    capNote: 'Showing the first {count} leagues only.',
    testBadge: 'Test league',
    noPhases: 'No phases yet',
    stages: { one: '{count} stage', other: '{count} stages' },
    noProblems: 'No problems found',
    errors: { one: '{count} error', other: '{count} errors' },
    warnings: { one: '{count} warning', other: '{count} warnings' },
    notes: { one: '{count} note', other: '{count} notes' },
  },
  detail: {
    back: 'Back to formats',
    backToLeague: 'Back to the league',
    outline: 'Stages',
    rules: 'Rules text',
    rulesLanguage: 'Language of the rules text',
    languageEn: 'English',
    languageDe: 'Deutsch',
    rulesShownEn: 'Rules text shown in English.',
    rulesShownDe: 'Rules text shown in German.',
    diagnostics: 'Checks',
    diagnosticsNone: 'No problems found.',
    coverage: 'Coverage',
    modules: 'Settings read from the league',
    factLabel: 'Setting',
    factValue: 'Value',
    legacyNote: 'These settings are read from the league. Change them in the league admin.',
    editIn: 'Open in the league admin',
    invalid: 'This format could not be shown. The checks below say why.',
    noPhases: 'This league has no phases yet. Add them on the <link>Phases</link> tab and the format shows up here.',
    forbidden: 'Only admins of this league can open its format.',
  },
  tab: {
    title: 'Format',
    subtitle: 'The generated outline, rules text and checks for this league. Read-only: change settings on the other tabs.',
    openStudio: 'Open in Format Studio',
  },
} as const;
