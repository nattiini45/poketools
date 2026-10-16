/**
 * 3D trainer creator (`/draft-room/trainer-creator`, owner T18). `hairStyles` /
 * `hatStyles` keys are `HAIR_STYLE_IDS` / `HAT_STYLE_IDS` (`src/lib/draft-room/trainer-config.ts`).
 */
export default {
  title: 'Trainer Creator',
  subtitle: 'Customize your 3D trainer avatar for the draft room',
  fields: {
    skinTone: 'Skin Tone',
    hairStyle: 'Hair Style',
    hairColor: 'Hair Color',
    outfitColor: 'Outfit Color',
    pantsColor: 'Pants Color',
    hat: 'Hat',
    hatColor: 'Hat Color',
    teamAccent: 'Team Accent',
  },
  hairStyles: {
    short: 'Short',
    spiky: 'Spiky',
    long: 'Long',
    ponytail: 'Ponytail',
    buzz: 'Buzz',
    mohawk: 'Mohawk',
  },
  hatStyles: {
    none: 'None',
    cap: 'Cap',
    beanie: 'Beanie',
    visor: 'Visor',
    topHat: 'Top Hat',
  },
  save: 'Save Avatar',
  saving: 'Saving...',
  saved: 'Saved!',
} as const;
