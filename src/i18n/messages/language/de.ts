import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  legend: 'Sprache',
  trigger: 'Sprache: {language}',
  names: {
    en: 'English',
    de: 'Deutsch',
  },
  keepPkmnEnglish: 'Pokémon-Begriffe auf Englisch',
  keepPkmnEnglishHint: 'Pokémon, Attacken, Items, Fähigkeiten und Typen behalten ihre englischen Namen.',
  saving: 'Wird gespeichert …',
  saveFailed: 'Deine Spracheinstellung konnte nicht gespeichert werden. Bitte versuche es noch einmal.',
  settings: {
    heading: 'Sprache',
    description: 'Wähle die Sprache der Seite. Sie wird in diesem Browser gespeichert.',
  },
});
