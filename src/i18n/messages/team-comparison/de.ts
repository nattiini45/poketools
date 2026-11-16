import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  title: 'Teamvergleich',
  open: 'Teams vergleichen',
  compareTrainer: 'Teams vergleichen mit {name}',
  description: 'Aktuelle Liga-Kader und sehr effektive STAB-Abdeckung in beide Richtungen.',
  league: 'Liga für den Vergleich',
  mine: 'Dein Team',
  theirs: 'Team von {name}',
  myHits: 'Deine STAB-Treffer gegen das andere Team',
  theirHits: 'Andere STAB-Treffer gegen dein Team',
  hit: '{attacker} → {defender}: {type} ×{multiplier}',
  emptyHits: 'Keine sehr effektiven STAB-Treffer.',
  emptyRoster: 'Noch kein aktueller Kader registriert.',
  unknown: 'Keine Typdaten verfügbar',
  partial: 'Die Abdeckung ist unvollständig, weil für manche Pokémon Typdaten fehlen. Du siehst nur bekannte Treffer.',
  hidden: 'Dieser Kader ist durch die Teamsichtbarkeit der Liga verborgen.',
  unavailable: 'Solange ein Kader verborgen oder leer ist, ist keine Abdeckung verfügbar.',
  note: 'Nur Typen auf der aktuellen Entwicklungsstufe. Attacken, Fähigkeiten, Items und Tera zählen nicht. Ein STAB-Typ garantiert keine verfügbare Schadensattacke.',
  loading: 'Aktuelle Kader werden geladen…',
  error: 'Der Teamvergleich konnte nicht geladen werden. Versuch es noch mal.',
  retry: 'Vergleich erneut laden',
  noLeague: 'Du teilst keine Liga mit diesem Trainer.',
  close: 'Vergleich schließen',
});
