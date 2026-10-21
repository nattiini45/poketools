/**
 * Namespace `draft/groups` (unit G2, league groups): the group switch of the draft room and the redraft page in a
 * league that drafts per group (`src/components/draft-tool/shared/GroupPoolPicker.tsx`). Group names are stored
 * English engine names, translated at display time (`translateEngineLabel('group', …)`).
 */
export default {
  /** `/draft-preview` (dev only): the group switch toggle and its fixture groups. */
  preview: {
    toggle: 'League groups',
    on: 'Switch shown',
    off: 'No groups',
    groupA: 'Group A',
    groupB: 'Group B',
  },
  picker: {
    /** The `<nav>` landmark name of the group switch. */
    label: 'Draft groups',
    /** Appended to the viewer's own group. */
    mine: 'your group',
    /** Line above the switch: `{group}` = the group shown now. */
    showing: 'Showing the draft of {group}.',
    /** The viewer's own group has no draft yet, so another group's draft is shown. */
    mineHasNoPool: 'Your group has no draft yet.',
    /** A trainer of the league looks at another group's draft (open to everyone, read-only for them). */
    readOnly: 'You can follow this draft, but you pick only in your own group’s draft.',
  },
} as const;
