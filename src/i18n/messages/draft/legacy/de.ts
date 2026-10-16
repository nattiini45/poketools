import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  pts: '{n} Pkt.',
  ptsRemaining: '{n} Pkt. übrig',
  picksLeft: { one: 'noch {count} Pick', other: 'noch {count} Picks' },
  noPicksYet: 'Noch keine Picks',
  unknownPlayer: 'Unbekannt',
  stageShort: 'S{n}',
  stage: 'Stufe {n}',
  suspended: 'Gesperrt',
  tera: {
    any: 'Tera: alle',
    stab_only: 'Tera: nur STAB',
    none: 'Kein Tera',
  },
  teamRole: {
    hazard_setting: 'Hazards legen',
    hazard_removal: 'Hazards entfernen',
    healing_cleric: 'Heilung / Cleric',
    momentum: 'Momentum',
    item_removal: 'Item-Entfernung',
    status: 'Status',
    priority: 'Priorität',
    disruption: 'Störung',
  },
  priceGroupRange: '{group} ({min}–{max})',
});
