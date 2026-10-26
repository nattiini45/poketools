/**
 * Namespace `ruleset-studio/editor`: the chrome of the Ruleset Studio editor (`/admin/rulesets/[id]/edit`). The shell
 * words (`toolbar.*`, `save.*`, `publish.*`, `share.*`, `fork.*`, `delete.*`) are the keys the shared editor shell reads
 * (`src/components/studio-shell/text.ts`, `SHELL_KEYS`): the Format Studio keeps the same keys with its own nouns in
 * `format-studio/editor`, because a noun placeholder cannot carry German gender and case.
 *
 * The editor's own sections (outline, base, clauses, pickers) are added next to these by the editor package. Errors of the
 * library API are not here: they come from the `errors/admin` and `errors/common` catalogs by code.
 */
export default {
  toolbar: {
    back: 'Back to rulesets',
    readOnly: 'Read-only view',
    actions: 'Ruleset actions',
    save: 'Save draft',
    saving: 'Saving…',
    saved: 'All changes saved',
    savedAt: 'Saved at {time}',
    unsaved: 'Unsaved changes',
    conflict: 'Changed elsewhere',
    publish: 'Publish…',
    share: 'Share…',
    fork: 'Fork',
    delete: 'Delete',
    visibility: {
      private: 'Private',
      league: 'Shared with league admins',
      gallery: 'In the gallery',
    },
    version: 'Version {n}',
    draftOnly: 'Not published yet',
    noIssues: 'No problems found',
    issues: {
      errors: { one: '{count} error', other: '{count} errors' },
      warnings: { one: '{count} warning', other: '{count} warnings' },
      notes: { one: '{count} note', other: '{count} notes' },
    },
  },
  save: {
    conflictTitle: 'Changed elsewhere',
    conflictBody: 'This ruleset was changed elsewhere (saved revision {rev}). Your unsaved edits are not on the server.',
    reload: 'Reload',
    reloadConfirm: 'Reloading discards your unsaved changes.',
    reloadDiscard: 'Reload and discard my changes',
    keepMine: 'Keep mine',
    cancel: 'Cancel',
    failed: 'Saving failed.',
    retry: 'Try again',
    guardConfirm: 'You have unsaved changes. Leave this page without saving?',
  },
  publish: {
    title: 'Publish version {n}',
    doneTitle: 'Published',
    creates: 'This creates version {n}. Leagues keep the version they use until an admin moves them to the new one.',
    blocked: { one: 'Fix {count} error before publishing.', other: 'Fix {count} errors before publishing.' },
    nothingNew: 'Nothing changed since version {n}.',
    changelog: 'What changed (optional)',
    changelogEn: 'Changelog in English',
    changelogDe: 'Changelog in German',
    savesFirst: 'Your unsaved changes are saved first.',
    confirm: 'Publish',
    done: 'Published version {n}.',
    openReadOnly: 'Open the read-only view',
    shareHint: 'Share it with other admins from Share….',
    close: 'Close',
  },
  share: {
    title: 'Who can use this ruleset?',
    private: 'Private',
    privateHelp: 'Only you and site admins can see this ruleset.',
    league: 'Shared with league admins',
    leagueHelp: 'Other admins can read and fork the published version, and use it in their leagues.',
    gallery: 'In the gallery',
    galleryHelp: 'Every admin finds the published version in the gallery. Only site admins can choose this.',
    needPublish: 'Publish a version first.',
    siteAdminOnly: 'Only site admins can move a ruleset in or out of the gallery.',
    galleryOwned: 'A gallery ruleset belongs to the site.',
    apply: 'Apply',
  },
  fork: {
    title: 'Fork this ruleset',
    body: 'Fork creates a private copy of the last published version (or of the saved draft when nothing is published). Unsaved changes are not included.',
    confirm: 'Fork',
  },
  delete: {
    title: 'Delete this ruleset?',
    body: 'The ruleset and all its versions are deleted for good, unless a league or phase still uses one of them. This cannot be undone.',
    confirm: 'Delete ruleset',
  },
} as const;
