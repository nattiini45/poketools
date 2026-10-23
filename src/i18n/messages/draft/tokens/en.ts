/**
 * `draft/tokens` (draft-frontend §6.2, §10.4; owner DF6): the token centre at
 * `/leagues/[id]/tokens`.
 *
 * - Token names (Draft Kill Token, Comeback Token, participation token) and the
 *   progress terms come from `glossary`; this namespace never drops the
 *   "Draft" from the Draft Kill Token (SPEC:869-874).
 * - `reason` is keyed by the `TokenRefusalCode` verbatim;
 *   its params come from the `TokenOverviewDTO`.
 * - API error texts live in `errors/draft`.
 * - Sentence case in storage; ALL-CAPS only through CSS.
 * - The league's own rule prose (`dk.intro`, `cb.intro`, `cosmo.intro`,
 *   `cosmo.note`) comes from the active format pack (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.draftTokens;

export default {
  page: {
    title: '{league} – Tokens',
    notEpb: 'Tokens exist only in Evolution Point Buy leagues.',
    noList: 'This league has no point-buy list yet, so its tokens cannot be shown.',
    signIn: 'Sign in to see and use your tokens.',
    signInLink: 'Sign in',
    backToLeague: 'Back to league',
    toDraftRoom: 'Draft room',
  },
  center: {
    loading: 'Loading tokens…',
    loadFailed: 'Your tokens could not be loaded.',
    retry: 'Retry',
    adminView: 'Admin view: read only.',
    bought: 'Draft Kill Token added to {line}.',
    spent: { one: '{count} Comeback Token spent.', other: '{count} Comeback Tokens spent.' },
    dismiss: 'Dismiss',
  },
  /** Draft Kill Token card (title = `glossary.token.draftKill`). */
  dk: {
    ...P.dk,
    windowOpen: 'Available until <time></time>',
    windowOpenUntilResult: 'Available until the first match result is confirmed.',
    windowBefore: 'Available once the Initial draft is complete.',
    windowClosed: 'The purchase window is closed.',
    owned: '{owned}/{max} owned',
    unspent: 'Unspent points: {n} P',
    progress: 'Progress {progress}/{next}',
    progressMax: 'Progress {progress} · fully evolved',
    hasToken: 'Token used',
    buy: 'Buy for {cost} P',
    buyFor: 'Buy a Draft Kill Token for {line}',
    noLines: 'You have no lines yet.',
    confirmTitle: 'Buy a Draft Kill Token for {line}?',
    confirmBody: '{cost} points are spent permanently. +1 evolution progress, never a KO.',
    confirm: 'Buy token',
  },
  /** Why a line cannot get a Draft Kill Token right now (`draft_kill.lines[].reason`). */
  reason: {
    TOKEN_WOULD_EVOLVE: 'Cannot be used: it would trigger the evolution (progress {progress}, next at {next}).',
    TOKEN_LINE_LIMIT: 'This line already has a Draft Kill Token.',
    TOKEN_PLAYER_LIMIT: 'Maximum of {max} per player reached.',
    TOKEN_POINTS_SHORT: 'Needs {cost} unspent points (you have {unspent}).',
    LINE_FULLY_EVOLVED: 'Fully evolved – there is nothing left to progress.',
    TOKEN_WINDOW_CLOSED: 'The purchase window is closed.',
  },
  /** Comeback Token card (title = `glossary.token.comeback`). */
  cb: {
    ...P.cb,
    earned: 'Earned',
    spent: 'Spent',
    unspent: 'Unspent',
    historyTitle: 'History',
    matchday: 'Matchday',
    score: 'Score',
    tokens: 'Tokens',
    historyTokens: '+{n}',
    noHistory: 'No Comeback Tokens earned yet.',
    locked: 'Comeback Tokens can be spent after the Redraft.',
    nothingToSpend: 'You have no unspent Comeback Tokens.',
    allocTitle: 'Spend on your lines',
    allocHint: 'You can put several tokens on one line and split them across lines.',
    earnFirstHalf: 'Only losses in the first half of the season earn Comeback Tokens.',
    ratioHint: '{ratio} Comeback Tokens = 1 progress on this line',
    decrease: { one: 'One token fewer for {line}', other: '{count} tokens fewer for {line}' },
    increase: { one: 'One token more for {line}', other: '{count} tokens more for {line}' },
    allocated: { one: '{count} token for {line}', other: '{count} tokens for {line}' },
    preview: 'Progress {from} → {to}/{next}',
    previewMax: 'Progress {from} → {to}',
    fullyEvolved: 'Fully evolved',
    willEvolve: 'Will evolve to {form}',
    left: { one: '{count} token left to assign', other: '{count} tokens left to assign' },
    spend: { one: 'Spend {count} token', other: 'Spend {count} tokens' },
    reset: 'Reset',
    confirmTitle: 'Spend Comeback Tokens?',
    confirmBody: 'Spent tokens cannot be taken back. A line that reaches its threshold evolves right away.',
    confirmLine: '{line}: +{n}',
    confirmLineRatio: '{line}: {tokens} tokens → +{n} progress',
    confirm: 'Spend tokens',
  },
  /** Participation token card (title = `glossary.token.cosmo`). */
  cosmo: {
    ...P.cosmo,
    brought: 'In your team on matchdays {list}',
    notBrought: 'Not in your team on any matchday yet.',
    progress: 'Progress {progress}/{next}',
    progressMax: 'Progress {progress} · fully evolved',
    thresholds: 'Evolves at {stage2} and {stage3}',
  },
  table: {
    title: 'Progress by source',
    line: 'Line',
    stage: 'Stage',
    stageValue: '{n} · {form}',
    kos: 'KOs (self-earned)',
    progressValue: '{total}/{next}',
    progressMax: '{total} (max)',
    empty: 'You have no lines yet.',
  },
} as const;
