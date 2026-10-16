/**
 * `draft/redraft` (draft-frontend §6.1, §10.4; owner DF5): the redraft page,
 * the secret drop submission, the reveal and the draft-room phase notice.
 *
 * - League terms (Redraft, deadline, snake order, token names) come from
 *   `glossary`; API error texts from `errors/draft`.
 * - Pokémon line names come from the pkmn layer, never from this file.
 * - Sentence case in storage; ALL-CAPS only through CSS.
 * - The league's own rule prose (`tokenNote`) comes from the active format
 *   pack (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.draftRedraft;

export default {
  page: {
    title: '{league} – Redraft',
    notEpb: 'The redraft only exists in Evolution Point Buy leagues.',
    noRedraft: 'There is no redraft for this league yet.',
    noList: 'This league has no Point Buy list yet, so the redraft cannot be shown.',
    signIn: 'Sign in to choose the lines you drop.',
    signInLink: 'Sign in',
    backToLeague: 'Back to the league',
  },
  center: {
    loading: 'Loading the redraft …',
    loadFailed: 'The redraft could not be loaded. Trying again …',
    notOpen: 'The redraft has not opened yet.',
    secretPhase: 'Every player picks their drops in secret. They are published after the deadline.',
    lockedPublic: 'Submissions are closed. The drops will be published shortly.',
    submissionLoadFailed: 'Your submission could not be loaded.',
    retry: 'Try again',
  },
  /** Mandatory keys (§10.4). */
  locked: {
    /** `{line}`: the locked pre-evolutions (the participation line's pre-evolutions), named through the pkmn layer. */
    cosmog: '{line} cannot be redrafted.',
    noRedraft: 'This line cannot be redrafted.',
  },
  counter: '{n}/{max} lines to drop',
  secretNote: 'Only you and the admins can see this until the deadline.',
  budgetPreview: 'Redraft budget: {n} P (leftover {left} + refunds {refund})',
  ...P,
  save: 'Save',
  saving: 'Saving …',
  withdrawAll: 'Withdraw all',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  lockedAfterDeadline: 'The deadline has passed – your drops can no longer be changed.',
  goToRoom: 'Go to the draft room',
  panel: {
    title: 'Your drops',
    intro: 'Choose up to {max} lines to give up. Their price comes back to your budget, and the real KOs they earned carry over to the line you pick in their place.',
    capReached: 'You have chosen the maximum of {max} lines.',
    noLines: 'You have no lines on your roster.',
    nothingChosen: 'No lines chosen – you keep your whole roster.',
    refund: '+{n} P back',
    kosTransfer: { zero: 'no KOs transfer', one: '{count} KO transfers', other: '{count} KOs transfer' },
    timeLeft: '{time} left',
    listLabel: 'Lines on your roster',
  },
  reveal: {
    title: 'Redraft drops',
    published: 'Published',
    standing: 'Rank {rank} after the first half',
    noDrops: 'No drops',
    released: 'Back in the pool',
    free: 'Free',
    yourSlots: 'Your redraft slots',
    slot: 'Slot {label}',
    replaces: 'replaces {line}',
    slotFilled: 'Filled',
    slotOpen: 'Open',
    budget: 'Redraft budget: {n} P',
    order: 'Redraft order',
    orderHint: 'The worst first-half standing picks first. The order snakes back each round, and a player leaves it once all their slots are filled.',
    complete: 'The redraft is complete.',
  },
  notice: {
    submissions: 'Redraft submission phase: choose the lines you drop before the deadline. Picking starts once the drops are published.',
    locked: 'Redraft submissions are closed. The drops will be published shortly.',
    link: 'Go to the redraft',
  },
} as const;
