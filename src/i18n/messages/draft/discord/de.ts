import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  turnStarted: {
    title: 'Am Zug – {season}',
    body: 'Du bist am Zug, **{player}**!',
  },
  turnReminder: {
    title: 'Erinnerung: noch {threshold} – {season}',
    body: 'Du bist immer noch am Zug, **{player}**.',
  },
  threshold: {
    '8h': '8 Stunden',
    '4h': '4 Stunden',
    '1h': '1 Stunde',
  },
  slot: {
    round: 'Runde',
    pick: 'Pick Nr.',
    makeup: 'Nachhol-Pick',
  },
  deadline: {
    line: 'Frist: {discordTime} ({relative})',
    league: 'Ligazeit: {time} {zone}',
  },
  pickTime: {
    minutes: {
      one: 'Du hast **{count} Minute** für deinen Pick.',
      other: 'Du hast **{count} Minuten** für deinen Pick.',
    },
    seconds: {
      one: 'Du hast **{count} Sekunde** für deinen Pick.',
      other: 'Du hast **{count} Sekunden** für deinen Pick.',
    },
  },
  adminAlert: {
    title: 'Admin-Eingriff nötig – {season}',
    blocked:
      '**{player}** kann den Kader mit dem Restbudget nicht mehr füllen. Der Draft ist pausiert, bis ein Admin den Pick klärt.',
    inplaceTimeout:
      'Bei **{player}** ist die Zeit abgelaufen und sonst ist niemand mehr dran, also folgt der Nachhol-Pick direkt. Ein Admin sollte kurz draufschauen.',
  },
  redraft: {
    title: 'Redraft: Abgaben veröffentlicht – {season}',
    none: 'Niemand hat eine Linie abgegeben.',
    dropLine: {
      one: '**{player}** gibt {line} ab ({count} KO wird übertragen)',
      other: '**{player}** gibt {line} ab ({count} KOs werden übertragen)',
    },
  },
  pick: {
    lineDescription: '**{player}** hat **{line}** gepickt',
  },
});
