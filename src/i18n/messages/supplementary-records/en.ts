/**
 * Namespace `supplementary-records`: how public pages show results a pack extension supplies
 * from outside the app's own match pipeline (docs/format-packs.md, "Pack extensions"). Shown
 * only when the active pack has such a provider and it counts for the viewer.
 */
export default {
  title: 'Earlier records',
  note: 'Results recorded outside this site. They are not part of the live statistics above.',
  loadFailed: 'Earlier records could not be loaded right now.',
  profile: {
    record: '{wins} W · {draws} D · {losses} L',
    played: {
      one: '{count} match',
      other: '{count} matches',
    },
    titles: {
      one: '{count} title',
      other: '{count} titles',
    },
    runnerUps: {
      one: '{count} runner-up finish',
      other: '{count} runner-up finishes',
    },
  },
  headToHead: {
    record: 'Earlier records: {wins} W · {draws} D · {losses} L',
  },
  pokemon: {
    kos: {
      one: 'Earlier records: {count} KO',
      other: 'Earlier records: {count} KOs',
    },
  },
} as const;
