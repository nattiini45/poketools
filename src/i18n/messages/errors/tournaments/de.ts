import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  STRUCTURE_ELIM_ROUND_DELETE:
    'Vom Turnierbaum erzeugte K.-o.-Runden lassen sich nicht einzeln löschen. Nutze „Turnierbaum neu erstellen“, um die Plätze neu aufzubauen.',
  BRACKET_V2_MANAGED:
    'Dieser Turnierbaum wird automatisch verwaltet. Erstelle ihn stattdessen über „Turnierbaum erstellen“ oder „Turnierbaum neu erstellen“.',
  BRACKET_LOCKED_USE_SUBSTITUTE:
    'Die Zahl der Plätze im Turnierbaum steht nach dem Erstellen fest – nutze den Spielerwechsel oder erstelle den Turnierbaum neu.',
  INVALID_ROUND_ID: 'Runde nicht gefunden.',
  TOURNAMENT_SEASON_ID_DEPRECATED: 'Ligaphasen werden über POST /api/seasons/‹id›/phases angelegt.',
  REGENERATE_PLAYED: {
    one: '{count} bereits gespieltes Spiel wird zurückgesetzt, alle Ergebnisse werden zurückgenommen.',
    other: '{count} bereits gespielte Spiele werden zurückgesetzt, alle Ergebnisse werden zurückgenommen.',
  },
  ENROLLMENT_FROZEN:
    'Die Teilnehmerliste ist eingefroren. Bestätige, um die importierten Tabellenstände zu überschreiben.',
  ENROLLMENT_ROUNDS_EXIST:
    'Solange es Runden gibt, lässt sich die Teilnehmerliste nicht neu abgleichen. Bestätige, um sie zu überschreiben.',
  SEED_CONFLICT:
    'Setzplatz {seed} ist bereits an einen anderen Teilnehmer vergeben – nimm ihn in die Neusetzung auf oder wähle einen freien Setzplatz.',
  SEED_UPDATE_PARTIAL: {
    one: 'Die Setzliste wurde nur teilweise gespeichert – {count} Teilnehmer konnte nicht aktualisiert werden. Lade die Seite neu und speichere die Setzliste noch einmal.',
    other:
      'Die Setzliste wurde nur teilweise gespeichert – {count} Teilnehmer konnten nicht aktualisiert werden. Lade die Seite neu und speichere die Setzliste noch einmal.',
  },

  // Tournaments
  tournament_not_found: 'Turnier nicht gefunden.',
  tournament_already_completed: 'Das Turnier ist bereits abgeschlossen.',
  tournament_participants_too_few: 'Dafür sind mindestens 2 Teilnehmer nötig.',
  tournament_current_round_incomplete: 'Die aktuelle Runde ({round}) ist noch nicht abgeschlossen.',

  // Participants and seeding
  tournament_participant_add_locked: 'Nach dem Turnierstart lassen sich keine Teilnehmer mehr hinzufügen.',
  tournament_participant_remove_locked: 'Nach dem Turnierstart lassen sich keine Teilnehmer mehr entfernen.',
  tournament_seeding_locked: 'Die Setzliste ist gesperrt – das Turnier hat bereits begonnen.',
  tournament_seed_duplicate: 'Jeder Setzplatz darf nur einmal vergeben werden.',
  tournament_player_not_participant: 'Spieler {player} nimmt nicht an diesem Turnier teil.',

  // Rounds
  round_not_found: 'Runde nicht gefunden.',
  round_wrong_tournament: 'Diese Runde gehört nicht zu diesem Turnier.',
  round_best_of_locked: 'Das Best-of lässt sich nur bei Runden ändern, die noch nicht begonnen haben.',
  rounds_round_robin_only: 'Alle Runden auf einmal lassen sich nur im Modus „Jeder gegen jeden“ erstellen.',
  rounds_all_generated: 'Alle Runden wurden bereits erstellt.',
  rounds_double_elim_starters_too_few:
    'Doppel-K.-o. braucht mindestens 2 Teilnehmer, die auf der Gewinnerseite starten.',

  // Manual rounds (pairings)
  pairing_players_missing: 'Jede Paarung braucht zwei Spieler.',
  pairing_self: 'Ein Spieler kann nicht gegen sich selbst antreten.',
  pairing_player_repeated: 'Spieler {player} kommt in mehreren Paarungen vor.',
  pairing_players_unpaired: {
    one: 'Alle Teilnehmer müssen einer Paarung zugeordnet sein. {count} Teilnehmer ist in keiner Paarung.',
    other: 'Alle Teilnehmer müssen einer Paarung zugeordnet sein. {count} Teilnehmer sind in keiner Paarung.',
  },

  // Elimination brackets
  bracket_generate_elim_only: 'Den kompletten Turnierbaum gibt es nur im K.-o.-System und im Doppel-K.-o.',
  bracket_regenerate_elim_only:
    'Den Turnierbaum neu erstellen geht nur im K.-o.-System und im Doppel-K.-o.',
  bracket_repair_elim_only: 'Den Turnierbaum reparieren geht nur im K.-o.-System und im Doppel-K.-o.',

  // Re-pairing one match
  repair_match_not_found: 'Spiel nicht gefunden.',
  repair_match_wrong_round: 'Dieses Spiel gehört nicht zu dieser Runde.',
  repair_match_wrong_tournament: 'Dieses Spiel gehört nicht zu diesem Turnier.',
  repair_match_status_locked: 'Neu paaren lassen sich nur angesetzte oder laufende Spiele.',
  repair_match_has_games:
    'Ein Spiel mit eingetragenen Partien lässt sich nicht neu paaren. Setze das Spiel zuerst zurück.',
  repair_round_not_found: 'Diese Runde gibt es in diesem Turnier nicht.',
  repair_players_not_participants: 'Beide Spieler müssen am Turnier teilnehmen.',

  // Rulesets and the ruleset seeder
  ruleset_not_found: 'Regelwerk nicht gefunden.',
  seed_rulesets_admin_required: 'Dafür musst du als Admin angemeldet sein.',
  seed_rulesets_secret_invalid: 'Das Bootstrap-Secret fehlt oder ist ungültig.',

  // Resource admins
  resource_admin_target_required: 'Ressourcentyp und Ressourcen-ID sind erforderlich.',
});
