/**
 * The admin pages the system prompt names when the assistant has to say "this is not something I can do" (plan 3.6.8,
 * spec §18.1). It is the page map of the prompt's "What you cannot do" section: one line per page, so the model writes a
 * real path instead of guessing one.
 *
 * A leaf on purpose (the prompt imports no other assistant module), so the data is written here and
 * `registry/not-tools.ts` is checked against it: `prompts/__tests__/system-prompt.test.ts` asserts that every `adminPath` of
 * `NOT_TOOLS` is listed, that every path is a real `src/app/admin` route, and that every `/admin/...` path in the prompt is
 * on this map. English only (the prompt is exempt from the i18n rule); no deployment fact, no name.
 */
export interface AdminPage {
  /** The route, exactly as the model should write it. */
  readonly path: string;
  /** Who can open it. */
  readonly access: string;
  /** What a person does there that the assistant cannot do for them. */
  readonly covers: string;
}

export const ADMIN_PAGES: readonly AdminPage[] = [
  {
    path: '/admin/leagues',
    access: 'any admin, within their scope',
    covers:
      'a league and its pages: deleting a phase or a draft pool, bracket regeneration with cascade, round and match resets, draft voiding, correcting or ending, generating all rounds at once, manual rounds, importing point-buy lists, and granting or revoking resource-admin rights on a league, and marking a league as a test league (its Settings panel)',
  },
  { path: '/admin/leagues/trash', access: 'the superadmin only', covers: 'restoring or rebuilding a league that was moved to the trash (trashed leagues are purged automatically after the retention period, by neither a person nor the assistant)' },
  { path: '/admin/tournaments', access: 'any admin, within their scope', covers: 'deleting a standalone tournament' },
  { path: '/admin/rulesets', access: 'any admin', covers: 'deleting a ruleset, putting one in the gallery, legacy rulesets' },
  { path: '/admin/formats', access: 'any admin', covers: 'deleting a format, putting one in the gallery' },
  { path: '/admin/players', access: 'site admins', covers: 'granting or revoking admin rights, creating guest players, and the directory of player accounts' },
  { path: '/admin/test-players', access: 'site admins', covers: 'creating test players and minting a test login' },
  { path: '/admin/social', access: 'site admins', covers: 'webhooks, social integrations, and writing Discord or social text' },
];

/** The page map as the prompt prints it: one bullet per page. */
export function renderAdminPageMap(pages: readonly AdminPage[] = ADMIN_PAGES): string {
  return pages.map((page) => `- ${page.path} (${page.access}): ${page.covers}.`).join('\n');
}
