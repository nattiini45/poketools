import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  STRUCTURE_ELIM_ROUND_DELETE:
    'Vom Turnierbaum erzeugte K.-o.-Runden lassen sich nicht einzeln löschen. Nutze „Turnierbaum neu erstellen“, um die Plätze neu aufzubauen.',
  BRACKET_V2_REQUIRED:
    'K.-o.-Turnierbäume werden automatisch aufgebaut. Nutze stattdessen „Turnierbaum erstellen“.',
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
  ENROLLMENT_SYNC_CONFLICT:
    'Zur gleichen Zeit lief ein weiterer Abgleich der Teilnehmerliste dieser Phase. Versuche es noch einmal.',
  SEED_CONFLICT:
    'Setzplatz {seed} ist bereits an einen anderen Teilnehmer vergeben – nimm ihn in die Neusetzung auf oder wähle einen freien Setzplatz.',
  SEED_UPDATE_PARTIAL: {
    one: 'Die Setzliste wurde nur teilweise gespeichert – {count} Teilnehmer konnte nicht aktualisiert werden. Lade die Seite neu und speichere die Setzliste noch einmal.',
    other:
      'Die Setzliste wurde nur teilweise gespeichert – {count} Teilnehmer konnten nicht aktualisiert werden. Lade die Seite neu und speichere die Setzliste noch einmal.',
  },

  // Tournaments
  tournament_not_found: 'Turnier nicht gefunden.',
  INVALID_TOURNAMENT_ID: 'Turnier nicht gefunden.',
  INVALID_RULESET_ID: 'Regelwerk nicht gefunden.',
  tournament_already_completed: 'Das Turnier ist bereits abgeschlossen.',
  tournament_bracket_locked: 'Der Turniermodus lässt sich nach dem Start des Turniers nicht mehr ändern.',
  tournament_ruleset_locked: 'Das Regelwerk lässt sich nach dem Start des Turniers nicht mehr ändern.',
  tournament_doubles_locked: 'Die Doppel-Einstellung lässt sich nach dem Start des Turniers nicht mehr ändern.',
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
  rounds_manual_pairing: 'Diese Phase wird von Hand gepaart. Lege ihre Runden im Editor für manuelle Runden an.',
  rounds_challenge_ladder:
    'Diese Phase ist eine Herausforderungsleiter: Ihre Matches entstehen aus angenommenen Herausforderungen. Lege ihre Runden im Editor für manuelle Runden an.',
  pairing_forbidden: {
    one: 'Diese Runde hat {count} Paarung, die der Phasenfilter ablehnt: Eine andere Paarung war nicht möglich, oder sie wurde aus dem Spielplan gestrichen.',
    other:
      'Diese Runde hat {count} Paarungen, die der Phasenfilter ablehnt: Andere Paarungen waren nicht möglich, oder sie wurden aus dem Spielplan gestrichen.',
  },
  rounds_stage_ended: 'Diese Phase hat ihre Endbedingung erreicht: Es können keine weiteren Runden erzeugt werden.',
  format_not_ready:
    'Diese Phase kann ihre erste Runde noch nicht starten: Eine Beziehung, die das Format braucht (zum Beispiel eine Auslosung), wurde nicht erstellt, oder Spieler schulden noch eine Aktion. Behebe das oder starte trotzdem mit force.',
  auto_advance_failed: 'Die Phase ist abgeschlossen, aber die Spieler konnten nicht in die nächste Phase übernommen werden. Übernimm sie von Hand.',
  swiss_rematches: {
    one: 'Diese Runde wiederholt {count} frühere Paarung: Es war kein anderer Gegner mehr frei.',
    other: 'Diese Runde wiederholt {count} frühere Paarungen: Es waren keine anderen Gegner mehr frei.',
  },
  rounds_round_already_written: '{round} gibt es schon mit ihren Matches. Lösche sie, um sie neu zu erstellen.',
  round_matches_unfinished: {
    one: '{round} hat noch {count} unfertiges Match. Schließe es ab oder beende die Runde trotzdem mit einer Begründung.',
    other: '{round} hat noch {count} unfertige Matches. Schließe sie ab oder beende die Runde trotzdem mit einer Begründung.',
  },
  rounds_previous_matches_unfinished: {
    one: '{round} hat noch {count} unfertiges Match, daher lässt sich die nächste Runde daraus nicht erstellen. Schließe es zuerst ab.',
    other: '{round} hat noch {count} unfertige Matches, daher lässt sich die nächste Runde daraus nicht erstellen. Schließe sie zuerst ab.',
  },
  round_robin_schedule_drift:
    '{round} würde eine Paarung wiederholen, die in diesem Turnier schon angesetzt ist. Ein Teilnehmer wurde nach der ersten Runde umbenannt oder ersetzt; erstelle diese Runde stattdessen von Hand.',
  rounds_group_placement_not_ready:
    'Woche {week} ist eine Platzierungswoche. Schließe zuerst jedes Match der Wochen davor ab und erstelle sie dann.',
  rounds_group_layout_invalid:
    'Die Gruppen der Phase lassen sich nicht einplanen: Jede Gruppe braucht einen Trainer und jeder Trainer genau eine Gruppe.',
  rounds_group_schedule_unbalanced:
    'Die Gruppen der Phase lassen sich nicht auf zwei ausgeglichene Saisonhälften verteilen.',
  rounds_double_elim_starters_too_few:
    'Doppel-K.-o. braucht mindestens 2 Teilnehmer, die auf der Gewinnerseite starten.',
  rounds_manual_league_grouped:
    'Diese Liga hat Gruppen, ihre Tabellenphase folgt dem Wochenplan. Erstelle die Runde stattdessen mit „Nächste Runde erstellen“.',

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
  bracket_already_generated: 'Der Turnierbaum wurde bereits erstellt.',
  bracket_regenerate_elim_only:
    'Den Turnierbaum neu erstellen geht nur im K.-o.-System und im Doppel-K.-o.',
  bracket_regenerate_phase_completed:
    'Diese Phase ist bereits beendet, deshalb kann ihr Turnierbaum nicht neu erstellt werden. Öffne die Phase zuerst wieder und erstelle den Turnierbaum danach neu.',
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
  ruleset_in_trashed_league:
    'Eine Liga im Papierkorb nutzt dieses Regelwerk noch, daher wurde es nicht gelöscht. Stelle die Liga zuerst wieder her oder entferne sie endgültig.',
  seed_rulesets_admin_required: 'Dafür musst du als Admin angemeldet sein.',
  seed_rulesets_secret_invalid: 'Das Bootstrap-Secret fehlt oder ist ungültig.',

  rounds_batch_end_when_expression:
    'Diese Phase endet durch eine Bedingung, die nach jeder Runde geprüft wird. Ihre Runden können deshalb nicht alle auf einmal erzeugt werden. Erzeuge sie Runde für Runde.',
  rounds_end_when_round_open:
    'Diese Phase endet durch eine Bedingung, die geprüft wird, wenn eine Runde beendet ist. Beende die offenen Matches von {round}, bevor du die nächste Runde anlegst, damit die Bedingung zuerst geprüft werden kann, oder beende {round} trotzdem mit einer Begründung.',
  rounds_mirrored_groups_legs:
    'Diese Jeder-gegen-jeden-Phase spielt mehr als einen Durchgang, aber ihre Gruppen werden von der Liga verwaltet und folgen deren Wochenplan, der keine Durchgänge kennt. Nutze einen einzigen Durchgang oder entferne die Ligagruppen.',
  rounds_phase_completed: 'Diese Phase wurde abgeschlossen, während die Runde angelegt wurde, deshalb wurde keine Runde geschrieben. Es können keine weiteren Runden erzeugt werden.',
  round_format_revert_failed:
    'Die Runde wurde geändert, aber die Auswirkungen einiger nicht mehr geltender Ergebnisse auf das Format der Liga (Item-Vergaben, Punkte) konnten nicht zurückgenommen werden. Der Fehler wurde protokolliert. Prüfe die Anpassungen der Liga für die Punkte und Items dieser Ergebnisse.',
  format_reaction_failed:
    'Der Phasenstatus wurde gespeichert, aber die Reaktion des Ligaformats darauf (Stufenstart oder -ende, Gleichstand-Prüfungen) ist nicht gelaufen. Sende denselben Status erneut, um sie zu wiederholen.',
  round_changed: 'Ein Match dieser Runde hat sich geändert, während sie gelöscht wurde, deshalb wurde nichts gelöscht. Lade die Runde neu und versuche es erneut.',
  rounds_round_completed: '{round} ist bereits abgeschlossen, deshalb wurden keine Matches hineingeschrieben. Lösche sie, um sie neu zu erzeugen.',

  // Resource admins
  resource_admin_target_required: 'Ressourcentyp und Ressourcen-ID sind erforderlich.',
});
