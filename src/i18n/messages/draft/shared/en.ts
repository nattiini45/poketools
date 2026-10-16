/**
 * `draft/shared` (draft-frontend §10.1, owner DF0): texts every draft surface
 * shares — draftability reasons, progress-source chips, slow-draft countdowns.
 *
 * - `reasons` is keyed by the DC-0 `ReasonCode` values verbatim (critique S4);
 *   `*_PLAIN` variants render a reason whose params are missing.
 *   `src/lib/draft-ui/reasons.ts` maps the params (player id → name).
 * - League terms (token names, utility categories, "on the clock") live in
 *   `glossary`; API error texts live in `errors/draft`.
 * - Sentence case in storage; ALL-CAPS only through CSS.
 * - The league's own words (`progress.cosmoChip`,
 *   `reasons.COSMOG_REDRAFT_LOCKED`) come from the active format pack (design
 *   spec §E.1); the reason key stays, it is the SQL error code.
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.draftShared;

export default {
  /** The draft price/budget unit: `30 P` in both languages. */
  points: '{n} P',
  player: {
    /** Stand-in for a player id the snapshot does not name (reads after "by"). */
    unknown: 'another player',
  },
  progress: {
    label: 'Progress',
    /** Group label of the chip row (screen readers). */
    sources: 'Progress sources',
    /** Self-earned KOs (`real_kills`): the only number labelled KOs. */
    kos: { one: '{count} KO', other: '{count} KOs' },
    transferredChip: '+{n} transferred',
    draftKillChip: { one: '+{count} Draft Kill Token', other: '+{count} Draft Kill Tokens' },
    comebackChip: '+{n} Comeback',
    ...P.progress,
  },
  reasons: {
    LINE_TAKEN: 'Already drafted by {player}.',
    INSUFFICIENT_BUDGET: 'Not enough points: costs {price} P, you have {remaining} P.',
    INSUFFICIENT_BUDGET_PLAIN: 'You do not have enough points left for this line.',
    /** `count` = the `slots` param (reasons.ts). */
    BUDGET_INFEASIBLE: {
      one: 'Not draftable – after this pick you would be at least {shortfall} points short of filling your last roster slot.',
      other:
        'Not draftable – after this pick you would be at least {shortfall} points short of filling your last {count} roster slots.',
    },
    BUDGET_INFEASIBLE_PLAIN: 'This pick would make your remaining roster slots unaffordable.',
    /**
     * `count` = the `available` param (reasons.ts). `available < slots`, so `one`/`other` always see
     * `slots >= 2`; `zero` (where `slots` may be 1) does not name the slot count.
     */
    NOT_ENOUGH_LINES: {
      zero: 'Not draftable – no lines are left to fill your roster.',
      one: 'Not draftable – only {count} line is left for your last {slots} roster slots.',
      other: 'Not draftable – only {count} lines are left for your last {slots} roster slots.',
    },
    NOT_ENOUGH_LINES_PLAIN: 'Not draftable – too few lines are left for your remaining roster slots.',
    LINE_RESTRICTED: 'This line is restricted for you.',
    OWN_REDRAFT_DROP: 'You dropped this line in this Redraft and cannot draft it back.',
    ...P.reasons,
    NOT_IN_LIST: 'This line is not on the league’s list.',
    NOT_YOUR_TURN: 'It is not your turn.',
    DRAFT_PAUSED: 'The draft is paused.',
    /** Plural on `size` once reasons.ts maps it to `count` (until then `other`). */
    ROSTER_FULL: { one: 'Your roster is full ({size} line).', other: 'Your roster is full ({size} lines).' },
    ROSTER_FULL_PLAIN: 'Your roster is full.',
    NOT_PARTICIPANT: 'You are not taking part in this draft.',
    SIGNED_OUT: 'Sign in to draft.',
    DRAFT_NOT_STARTED: 'The draft has not started yet.',
    DRAFT_COMPLETE: 'The draft is complete.',
    SLOT_BLOCKED: 'This pick is blocked – an admin is resolving it.',
    NO_OPEN_REDRAFT_SLOT: 'You have no open Redraft slot.',
    SUBMISSION_PHASE: 'Redraft drops are being collected; picking starts after publication.',
  },
  /** Slow-draft long forms; live digits use `formatter.clock`. */
  countdown: {
    /** Slow mode from 24 h on. */
    daysHours: '{d}d {h}h',
    hoursMinutes: '{h}h {m}m',
    minutesSeconds: '{m}m {s}s',
    hours: '{h}h',
    minutes: '{m}m',
  },
} as const;
