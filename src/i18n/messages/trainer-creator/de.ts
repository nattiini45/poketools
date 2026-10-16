import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  title: 'Trainer-Editor',
  subtitle: 'Gestalte deinen 3D-Trainer-Avatar für den Draft-Raum',
  fields: {
    skinTone: 'Hautton',
    hairStyle: 'Frisur',
    hairColor: 'Haarfarbe',
    outfitColor: 'Outfitfarbe',
    pantsColor: 'Hosenfarbe',
    hat: 'Kopfbedeckung',
    hatColor: 'Farbe der Kopfbedeckung',
    teamAccent: 'Team-Akzent',
  },
  hairStyles: {
    short: 'Kurz',
    spiky: 'Stachelig',
    long: 'Lang',
    ponytail: 'Pferdeschwanz',
    buzz: 'Bürstenschnitt',
    mohawk: 'Irokese',
  },
  hatStyles: {
    none: 'Keine',
    cap: 'Kappe',
    beanie: 'Mütze',
    visor: 'Schirmblende',
    topHat: 'Zylinder',
  },
  save: 'Avatar speichern',
  saving: 'Wird gespeichert …',
  saved: 'Gespeichert!',
});
