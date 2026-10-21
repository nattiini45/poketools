/**
 * Shared league vocabulary (i18n-core §10.3/§10.4). The draft packages, T03,
 * T04 and T19 read these keys; no other namespace holds a copy of them.
 * Wording changes to the shared vocabulary are made here only.
 *
 * Sentence case in storage; banners render ALL CAPS with CSS `uppercase` or
 * `upperForPaint` (canvas).
 *
 * The league's token names (`token.*`, `tokenCount.*`) come from the active
 * format pack (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.glossary;

export default {
  draft: {
    draft: 'Draft',
    draftRoom: 'Draft room',
    liveDraft: 'Live draft',
    slowDraft: 'Slow draft',
    initialDraft: 'Initial draft',
    redraft: 'Redraft',
    secretDrop: 'Secret drop',
    submissionPhase: 'Submission phase',
    pick: 'Pick',
    makeupPick: 'Make-up pick',
    snakeOrder: 'Snake order',
    youOnClock: 'You are on the clock',
    playerOnClock: '{name} is on the clock',
    youNext: 'You’re up next',
    paused: 'Draft paused',
    /** The daily window in which pick clocks stand still (picking stays allowed). */
    quietHours: 'Quiet hours',
    draftCta: 'Draft',
    confirmPick: 'Confirm pick',
    timeLeft: 'Time left',
    extension: 'Extension',
    timeExpired: 'Time expired',
    deadline: 'Deadline',
    adminOverride: 'Admin override',
    auditTrail: 'Audit trail',
  },
  roster: {
    roster: 'Roster',
    rosterSlot: 'Roster slot',
    line: 'Evolution line',
    base: 'Base',
    stage2: 'Stage 2',
    stage3: 'Stage 3',
  },
  price: {
    price: 'Price',
    budget: 'Budget',
    remainingAfterPick: 'Remaining budget after pick',
    points: 'Points',
  },
  state: {
    notDraftable: 'Not draftable',
    draftedBy: 'Drafted by {name}',
    showDrafted: 'Show drafted',
    favourites: 'Favourites',
    compare: 'Compare',
    filters: 'Filters',
    all: 'All',
  },
  /** Token names, singular and counted (`token.*`, `tokenCount.*`). */
  ...P,
  progress: {
    /** The only number labelled kills/KOs (`real_kills`). */
    selfEarnedKills: 'KOs',
    transferred: 'transferred',
    progress: 'Progress',
    evolutionProgress: 'Evolution progress',
    evolutionPoints: 'Evolution points',
    evolutionPointsShort: 'EP',
    realKills: 'KOs',
  },
  league: {
    matchday: 'Matchday',
    season: 'Season',
    league: 'League',
    tournament: 'Tournament',
  },
} as const;
