import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.draftShared;

export default defineDe<typeof en>()({
  points: '{n} P',
  player: {
    unknown: 'einem anderen Spieler',
  },
  progress: {
    label: 'Fortschritt',
    sources: 'Fortschrittsquellen',
    kos: { one: '{count} KO', other: '{count} KOs' },
    transferredChip: '+{n} übertragen',
    draftKillChip: { one: '+{count} Draft-Kill-Token', other: '+{count} Draft-Kill-Tokens' },
    comebackChip: '+{n} Comeback',
    ...P.progress,
  },
  reasons: {
    LINE_TAKEN: 'Bereits von {player} gedraftet.',
    INSUFFICIENT_BUDGET: 'Zu wenig Punkte: kostet {price} P, du hast {remaining} P.',
    INSUFFICIENT_BUDGET_PLAIN: 'Für diese Linie hast du nicht mehr genug Punkte.',
    BUDGET_INFEASIBLE: {
      one: 'Nicht draftbar – nach diesem Pick fehlen dir mindestens {shortfall} Punkte, um deinen letzten Kaderplatz zu füllen.',
      other:
        'Nicht draftbar – nach diesem Pick fehlen dir mindestens {shortfall} Punkte, um deine letzten {count} Kaderplätze zu füllen.',
    },
    BUDGET_INFEASIBLE_PLAIN: 'Dieser Pick würde deine restlichen Kaderplätze unbezahlbar machen.',
    NOT_ENOUGH_LINES: {
      zero: 'Nicht draftbar – es ist keine Linie mehr übrig, um deinen Kader zu füllen.',
      one: 'Nicht draftbar – für deine letzten {slots} Kaderplätze ist nur noch {count} Linie übrig.',
      other: 'Nicht draftbar – für deine letzten {slots} Kaderplätze sind nur noch {count} Linien übrig.',
    },
    NOT_ENOUGH_LINES_PLAIN: 'Nicht draftbar – für deine restlichen Kaderplätze sind zu wenige Linien übrig.',
    LINE_RESTRICTED: 'Diese Linie ist für dich gesperrt.',
    OWN_REDRAFT_DROP: 'Du hast diese Linie in diesem Redraft abgegeben und kannst sie nicht zurückdraften.',
    ...P.reasons,
    NOT_IN_LIST: 'Diese Linie steht nicht auf der Liga-Liste.',
    NOT_YOUR_TURN: 'Du bist nicht am Zug.',
    DRAFT_PAUSED: 'Der Draft ist pausiert.',
    ROSTER_FULL: { one: 'Dein Kader ist voll ({size} Linie).', other: 'Dein Kader ist voll ({size} Linien).' },
    ROSTER_FULL_PLAIN: 'Dein Kader ist voll.',
    NOT_PARTICIPANT: 'Du nimmst an diesem Draft nicht teil.',
    SIGNED_OUT: 'Melde dich an, um zu draften.',
    DRAFT_NOT_STARTED: 'Der Draft hat noch nicht begonnen.',
    DRAFT_COMPLETE: 'Der Draft ist abgeschlossen.',
    SLOT_BLOCKED: 'Dieser Pick ist blockiert – ein Admin kümmert sich darum.',
    NO_OPEN_REDRAFT_SLOT: 'Du hast keinen offenen Redraft-Platz.',
    SUBMISSION_PHASE: 'Die Redraft-Abgaben werden gesammelt; gepickt wird nach der Veröffentlichung.',
  },
  countdown: {
    daysHours: '{d} T. {h} Std.',
    hoursMinutes: '{h} Std. {m} Min.',
    minutesSeconds: '{m} Min. {s} Sek.',
    hours: '{h} Std.',
    minutes: '{m} Min.',
  },
});
