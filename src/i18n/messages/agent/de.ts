import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  name: 'Professor Linden',
  tagline: 'Dein Teambuilding-Assistent',
  badge: 'KI',
  intro: 'Lass dir vom Professor ein Team zusammenstellen, Sets vorschlagen oder ein Matchup durchsprechen.',
  thinking: 'Professor Linden denkt nach …',
  placeholder: 'Bau mir ein ausgewogenes Team um {pokemon} …',
  disclaimer:
    'KI-generiert – nicht immer 100 % korrekt. Enter zum Senden, Umschalt+Enter für eine neue Zeile.',
  stop: 'Stopp',
  send: 'Senden',
  signedOutPlaceholder: 'Melde dich mit Discord an, um mit Professor Linden zu chatten …',
  signInHint: 'Melde dich mit Discord an, um zu chatten.',
  errors: {
    rateLimited: 'Du hast dein heutiges Chat-Limit mit Professor Linden erreicht – schau morgen wieder vorbei!',
    signInRequired: 'Bitte melde dich mit Discord an, um zu chatten.',
    unavailable: 'Professor Linden ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    unreachable: 'Professor Linden konnte nicht erreicht werden. Bitte versuche es noch einmal.',
  },
});
