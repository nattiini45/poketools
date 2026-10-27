/**
 * Namespace `league-admin/groups` (unit G2, league groups): the league groups editor on the admin league page's
 * Participants tab (`src/components/league/groups/LeagueGroupsEditor.tsx`) and the per-group draft cards on its
 * Draft tab (`src/app/admin/leagues/[id]/_components/panels/DraftPanel.tsx`).
 *
 * Group names are stored English engine names (`Group A`, …) and translated at display time
 * (`translateEngineLabel('group', …)`); a name an admin typed is shown as typed. Draft phase labels come from
 * `draft/admin` (`panel.phase.*`), API refusals from `errors/seasons` and `errors/draft`.
 */
export default {
  editor: {
    title: 'League groups',
    subtitle:
      'Split the league into groups. Each group plays its own round robin, has its own table and drafts its own pool from the shared list. Without groups the league plays and drafts as one.',
    loading: 'Loading groups…',
    retry: 'Retry',
    noGroups: 'This league has no groups: it plays and drafts as one.',
    groupCount: 'Number of groups',
    /** `{count}` = number of groups. */
    groupCountOption: { one: '{count} group', other: '{count} groups' },
    serpentine: 'Split by seed',
    serpentineHint:
      'Snake order by seed: the seeds go through the groups in order, then back in reverse order, and so on, so every group gets a fair mix. Seeds come from the first phase; trainers without a seed follow by name.',
    resplit: 'Split again by seed',
    clear: 'Remove groups',
    confirmClear: 'Remove every group? The league then plays and drafts as one.',
    /** The league has a live draft pool: `season_groups_replace` refuses re-creating or removing groups. */
    replaceLocked:
      'A group already has a draft, so the groups can no longer be split again or removed. Renaming stays possible, and trainers can move between groups that have no draft.',
    /** A phase of the league has a round: `season_groups_replace` and every move refuse (SEASON_GROUPS_SCHEDULED). */
    scheduleLocked:
      'This league already has rounds, so its groups are final: the schedule, the group tables and the draft order use them. You can still rename a group.',
    /** Badge of every group once the league has rounds. */
    scheduledBadge: 'Fixed',
    scheduledHint: 'The league already has rounds: nobody joins or leaves this group any more.',
    /** Unplaced participants once the league has rounds: they can no longer be placed. */
    unplacedLockedHint:
      'These participants joined after the groups were made. The league already has rounds, so they can no longer join a group.',
    /** `{min}` = smallest group size. A move would leave the group too small. */
    minSizeHint: 'A group keeps at least {min} trainers, so nobody can leave this one.',
    lockedBadge: 'Has a draft',
    lockedHint:
      'This group has a draft: nobody joins or leaves it unless that draft is deleted (while it has not started) or cancelled.',
    /** `{count}` = trainers in the group. */
    members: { one: '{count} trainer', other: '{count} trainers' },
    noMembers: 'No trainers yet.',
    /** `{seed}` = the trainer's seed. */
    seed: '#{seed}',
    rename: 'Rename',
    renameLabel: 'Group name',
    /** `{name}` = the group's current name. */
    renameAria: 'Rename {name}',
    save: 'Save',
    cancel: 'Cancel',
    /** `{name}` = trainer name. */
    moveAria: 'Group of {name}',
    unplacedTitle: 'Not in a group',
    unplacedHint: 'These participants joined after the groups were made. Place each one in a group.',
    choose: 'Choose a group',
    saved: 'Groups saved.',
    errors: {
      loadFailed: 'The groups could not be loaded.',
      saveFailed: 'The groups could not be saved.',
      renameFailed: 'The group could not be renamed.',
      moveFailed: 'The trainer could not be moved.',
    },
  },
  draft: {
    /** Draft tab of a league with groups (Evolution Point Buy). */
    intro:
      'This league drafts per group: every group gets its own draft, with its members as the seats. List, budget and rules are shared.',
    /** Draft tab of a league with groups in a format without per-group drafts. */
    legacyUnsupported:
      'This league has groups. Groups draft separately, which only Evolution Point Buy leagues support. Remove the groups on the <link>Participants</link> tab to run one draft for everyone.',
    /** `{count}` = trainers in the group. */
    members: { one: '{count} trainer', other: '{count} trainers' },
    seats: 'One per group member.',
    initial: 'Initial draft',
    redraft: 'Redraft',
    /** `{phase}` = `draft/admin` `panel.phase.*`. */
    poolPhase: '{phase}',
    openPanel: 'Open in the draft control panel',
    openRoom: 'Open the draft room',
    noMembers: 'This group has no trainers. Place trainers in it on the <link>Participants</link> tab first.',
    tooFew:
      'A draft needs at least {min} trainers, and this group has {count}. Move trainers on the <link>Participants</link> tab first.',
    tooMany:
      'A draft has room for at most {max} trainers, and this group has {count}. Split the participants into more groups on the <link>Participants</link> tab.',
    /** The group as configured can never fill every roster (TS twin of draft_start's LEAGUE_NOT_COMPLETABLE). */
    notCompletable:
      'This group’s draft could never finish: the {lines} lines of the list cannot fill all {slots} roster slots of its {participants} trainers within their budgets. Split the participants into smaller groups on the <link>Participants</link> tab.',
    /** The completability search hit its step cap. */
    undecided:
      'Whether every roster of this group can be filled could not be checked in time. Starting the draft checks it again.',
    unplaced: {
      one: '{count} participant is in no group and gets no seat. Place them on the <link>Participants</link> tab.',
      other: '{count} participants are in no group and get no seat. Place them on the <link>Participants</link> tab.',
    },
  },
} as const;
