import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  justNow: 'gerade eben',
  duration: {
    dh: '{d} T. {h} Std.',
    hm: '{h} Std. {m} Min.',
    ms: '{m} Min. {s} Sek.',
    s: '{s} Sek.',
  },
  left: 'noch {duration}',
  until: 'bis {time}',
  hoursLeft: { one: 'noch {count} Stunde', other: 'noch {count} Stunden' },
  minutesLeft: { one: 'noch {count} Minute', other: 'noch {count} Minuten' },
  leagueTime: '{time} {zone} Ligazeit',
  expired: 'Zeit abgelaufen',
});
