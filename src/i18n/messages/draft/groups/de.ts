import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  preview: {
    toggle: 'Ligagruppen',
    on: 'Umschalter sichtbar',
    off: 'Keine Gruppen',
    groupA: 'Gruppe A',
    groupB: 'Gruppe B',
  },
  picker: {
    label: 'Draft-Gruppen',
    mine: 'deine Gruppe',
    showing: 'Du siehst den Draft von {group}.',
    mineHasNoPool: 'Deine Gruppe hat noch keinen Draft.',
    readOnly: 'Du kannst diesen Draft verfolgen, wählst aber nur im Draft deiner eigenen Gruppe.',
  },
});
