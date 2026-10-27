import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  PHASE_NOT_FOUND: 'Phase in dieser Liga nicht gefunden.',
  PHASE_NOT_ELIGIBLE: 'Phase nicht gefunden oder bereits abgeschlossen.',
  PHASE_REORDER_LOCKED: 'Nur kommende Phasen lassen sich neu anordnen.',
  PHASE_REORDER_INCOMPLETE: 'phase_ids muss jede kommende Phase genau einmal enthalten.',
  PHASE_INSERT_INVALID: 'insert_at liegt außerhalb des gültigen Bereichs.',
  PHASE_INSERT_LOCKED: 'Vor bereits gestarteten Phasen lässt sich keine Phase einfügen.',
  PHASE_COMPLETED_LOCKED: 'Abgeschlossene Phasen sind gesperrt. Setze die Phase zuerst wieder auf aktiv.',
  PHASE_NAME_TAKEN: 'Eine andere Phase dieser Liga hat schon diesen Namen.',
  PHASE_DELETE_CONFIRM_REQUIRED: 'Eine Phase mit Runden lässt sich nur mit confirm: true löschen.',
  PHASE_STAGE_ORDER_LOCKED: 'Die Reihenfolge lässt sich nach dem Start der Phase nicht mehr ändern.',
  PHASE_BRACKET_LOCKED: 'Der Turniermodus lässt sich nach dem Start der Phase nicht mehr ändern.',
  PHASE_PARTICIPANTS_LOCKED: 'Bei einer abgeschlossenen Phase lassen sich die Teilnehmer nicht mehr ändern.',
  PHASE_ROSTER_REQUIRED: 'Alle Teilnehmer müssen im Kader der Liga stehen.',
  PHASE_GROUP_INVALID: 'Ungültige Gruppe für diese Phase.',
  PHASE_GROUP_MEMBER_NOT_FOUND: 'Der Spieler ist nicht in der Ausgangsgruppe.',
  PHASE_GROUPS_INSUFFICIENT_SEEDS: 'Es braucht mindestens so viele gesetzte Teilnehmer wie Gruppen.',
  PHASE_GROUPS_LEAGUE_MANAGED:
    'Diese Liga hat Gruppen, ihre Phasen folgen ihnen. Ändere die Gruppen im Tab „Teilnehmer“ der Liga.',
  PHASE_PLAYER_WITHOUT_LEAGUE_GROUP: {
    one: '{count} Trainer dieser Phase ist in keiner Ligagruppe. Teile ihn zuerst im Tab „Teilnehmer“ ein.',
    other: '{count} Trainer dieser Phase sind in keiner Ligagruppe. Teile sie zuerst im Tab „Teilnehmer“ ein.',
  },
  PHASE_GROUPS_STALE: 'Die Ligagruppen haben sich geändert, während die Runde erstellt wurde; erstelle sie noch einmal.',
  PLAN_CHANGED: 'Die Gruppeneinträge haben sich seit der Prüfung geändert; prüfe sie noch einmal.',
  GROUP_SLOT_CHANGED: 'Die Gruppen haben sich zwischenzeitlich geändert; prüfe sie noch einmal.',
  phase_seed_duplicate: 'Jeder Setzplatz darf nur einmal vergeben werden.',
  phase_seed_not_participant: 'Spieler {player_id} ist kein Teilnehmer dieser Phase.',
  phase_seed_no_participants: 'Diese Phase hat keine Teilnehmer, die sich setzen ließen.',
  advance_needs_two_phases: 'Zum Weiterkommen braucht die Liga mindestens 2 Phasen.',
  advance_no_transition:
    'Kein gültiger Phasenübergang gefunden. Dafür braucht es eine abgeschlossene Phase, auf die eine kommende Phase folgt.',
  season_not_found: 'Saison nicht gefunden.',
  INVALID_SEASON_ID: 'Liga nicht gefunden.',
  INVALID_PHASE_ID: 'Phase nicht gefunden.',
  INVALID_GROUP_ID: 'Gruppe nicht gefunden.',
  INVALID_LEAGUE_TRASH_ID: 'Gelöschte Liga nicht gefunden.',
  SEASON_GROUP_NOT_FOUND: 'Diese Gruppe gibt es in dieser Liga nicht.',
  SEASON_GROUP_NAME_TAKEN: 'Eine andere Gruppe dieser Liga hat schon diesen Namen.',
  SEASON_GROUP_PLAYER_NOT_FOUND: 'Dieser Trainer nimmt nicht an dieser Liga teil.',
  SEASON_GROUPS_TOO_MANY:
    '{participants} Teilnehmer lassen sich nicht auf {count} Gruppen aufteilen: Jede Gruppe braucht mindestens zwei Trainer.',
  SEASON_GROUPS_INCOMPLETE: {
    one: '{count} Teilnehmer ist in keiner Gruppe. Ordne alle Teilnehmer genau einer Gruppe zu.',
    other: '{count} Teilnehmer sind in keiner Gruppe. Ordne alle Teilnehmer genau einer Gruppe zu.',
  },
  SEASON_NOT_FOUND: 'Liga nicht gefunden.',
  SEASON_HAS_DEPENDENTS:
    'Diese Liga hat noch Phasen, Draft-Pools, Teams oder Storylines, die auf sie verweisen, daher wurde nichts gelöscht. Lösche diese zuerst und danach die Liga.',
  SEASON_FORMAT_LOCKED: 'Der Liga-Typ lässt sich nicht mehr ändern, sobald die Liga gestartet ist.',
  SEASON_FORMAT_POINT_BUY_LOCKED:
    'Eine Point-Buy-Liga behält ihren Liga-Typ, und andere Ligen lassen sich nicht darauf umstellen.',
  SEASON_DATES_INVALID: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  SEASON_CLONE_FORBIDDEN: 'Du kannst nur aus einer Liga starten, die du selbst verwaltest.',
  SEASON_CLONE_ADMINS_FORBIDDEN: 'Nur Site-Admins können die Liga-Admins übernehmen.',
  SEASON_CLONE_CUSTOM_FORMAT:
    'Eine Liga mit eigenem Format kann nicht als Vorlage dienen: Ihre Phasen kommen aus einem angehängten Format, und eine Kopie könnte keines anhängen.',
  SEASON_CLONE_FAILED: 'Die Liga konnte nicht aus der Vorlage erstellt werden. Es wurde nichts behalten.',
  SEASON_CLONE_CLEANUP_FAILED:
    'Die Liga konnte nicht aus der Vorlage erstellt und auch nicht wieder entfernt werden: Liga {league_id} besteht weiter, mit {phases} Phasen und {participants} Kadereinträgen. Ein Site-Admin kann sie löschen.',
  season_test_flag_site_admin_only: 'Nur Site-Admins können die Testliga-Markierung ändern.',
  participant_update_empty: 'Gib gym_type und/oder core_types an, um den Teilnehmer zu ändern.',
  format_mismatch: 'Diese Saison nutzt nicht das Format Evolution Point Buy.',
  core_pool_missing: 'Für diese Liga ist kein Core-Pool eingerichtet.',
  core_no_participants: 'Die Liga hat keine Teilnehmer, denen sich Cores zuweisen ließen.',
  core_assignment_error: 'Der Core-Pool ist zu klein: Frei sind {available}, gebraucht werden {needed}.',
  core_pool_empty: 'Der Core-Pool ist leer; es lassen sich keine Cores ziehen.',
  core_pool_entry_invalid: 'Ein Eintrag im Core-Pool hat nicht genau drei Typen: {entry}',
  core_pool_entry_duplicate_types: 'Ein Eintrag im Core-Pool enthält einen Typ doppelt: {entry}',
  core_pool_duplicate_triple: 'Der Core-Pool enthält {types} doppelt.',
  core_types_conflict: '{types} ist bereits einem anderen Teilnehmer zugewiesen.',
  core_not_in_pool: '{types} ist nicht im Core-Pool der Saison.',
  SEASON_CLOSED: 'Die Liga ist abgeschlossen oder archiviert: In ihrem Kader kann niemand mehr ausgewechselt werden.',
  substitute_same_player: 'Ausscheidender Spieler und Ersatzspieler müssen verschiedene Spieler sein.',
  ENROLLMENT_CHANGED:
    'Der ausscheidende Spieler ist nicht mehr in der Phase „{phase}“ eingetragen (die Phase hat sich während des Wechsels geändert); prüfe es noch einmal.',
  ROSTER_CHANGED:
    'Der ausscheidende Spieler steht nicht mehr im Kader der Liga (der Kader hat sich während des Wechsels geändert); prüfe es noch einmal.',
  OUT_PLAYER_NOT_FOUND: 'Ausscheidender Spieler nicht gefunden.',
  IN_PLAYER_NOT_FOUND: 'Ersatzspieler nicht gefunden.',
  OUT_NOT_ON_ROSTER: 'Der ausscheidende Spieler steht nicht im Kader der Liga.',
  IN_ALREADY_ON_ROSTER: 'Der Ersatzspieler steht bereits im Kader der Liga.',
  OUT_NOT_IN_PHASE: 'Der ausscheidende Spieler ist nicht in dieser Phase eingetragen.',
  IN_ALREADY_IN_PHASE: 'Der Ersatzspieler ist bereits in der Phase „{phase}“ eingetragen.',
  SUBSTITUTE_LEAGUE_GROUP_MISMATCH:
    'Der Ersatzspieler ist nicht in der Ligagruppe „{group}“, der die Phase „{phase}“ folgt; ersetze stattdessen in der ganzen Liga.',

  format_season_not_custom: 'Diese Liga nutzt kein eigenes Format.',
  format_season_started: 'Die Liga hat bereits begonnen, deshalb lässt sich ihr Format nicht mehr ändern.',
  format_attach_forbidden:
    'Du kannst nur Formate anhängen, die dir gehören oder für alle Admins freigegeben sind.',
  format_attach_ruleset_forbidden: 'Du kannst nur Regelwerke verwenden, die dir gehören oder mit allen Admins geteilt sind.',
  format_attach_invalid: 'Diese Version hat Fehler und kann nicht angehängt werden ({first}).',
  format_attach_ruleset_required: {
    one: '{count} Stage nutzt das Standard-Regelwerk der Liga, die Liga hat aber keines. Lege zuerst ein Standard-Regelwerk fest.',
    other:
      '{count} Stages nutzen das Standard-Regelwerk der Liga, die Liga hat aber keines. Lege zuerst ein Standard-Regelwerk fest.',
  },
  format_attach_manual_phases: {
    one: 'Diese Liga hat bereits {count} Phase, die nicht aus einem Format entstanden ist. Lösche sie zuerst.',
    other: 'Diese Liga hat bereits {count} Phasen, die nicht aus einem Format entstanden sind. Lösche sie zuerst.',
  },
  format_not_attached:
    'Diese Liga nutzt ein eigenes Format, es ist aber noch keines angehängt. Hänge vor dem Start ein Format an.',
  format_nothing_attached: 'An diese Liga ist kein Format angehängt.',
  format_detach_blocked:
    'Teams verweisen noch auf eine Phase dieses Formats, deshalb lässt es sich nicht abhängen.',
  season_format_type_locked:
    'Der Ligatyp lässt sich nicht auf oder von einem eigenen Format umstellen, solange ein Format angehängt ist oder nachdem die Liga begonnen hat.',
  LEAGUE_TRASH_NOT_FOUND: 'Diese Liga liegt nicht im Papierkorb (sie wurde schon wiederhergestellt oder endgültig entfernt).',
  LEAGUE_TRASH_EXPIRED: 'Die Frist zum Wiederherstellen dieser Liga ist abgelaufen, sie lässt sich nicht mehr wiederherstellen.',
  LEAGUE_TRASH_SEASON_EXISTS:
    'Es gibt wieder eine Liga mit derselben ID, daher lässt sich die gelöschte Liga nicht wiederherstellen. Es wurde nichts wiederhergestellt.',
  LEAGUE_TRASH_SCHEMA_DRIFT:
    'Die Liga lässt sich nicht wiederherstellen: Die Tabelle {rel} hat sich nach dem Löschen der Liga geändert und braucht jetzt die Spalten {columns}, die die gespeicherte Kopie nicht hat. Es wurde nichts wiederhergestellt.',
  LEAGUE_TRASH_PARENT_MISSING:
    'Die Liga lässt sich nicht wiederherstellen: Ihre Einträge in {rel} (Spalte {column}) verweisen auf einen Eintrag in {parent}, der zwischenzeitlich gelöscht wurde. Es wurde nichts wiederhergestellt.',
  LEAGUE_TRASH_PLAN_MISMATCH:
    'Die gespeicherte Kopie dieser Liga ließ sich nicht vollständig wiederherstellen, daher wurde nichts wiederhergestellt. Die Details stehen im Server-Log.',
  LEAGUE_TRASH_INVENTORY_INCOMPLETE:
    'Die Liga lässt sich nicht in den Papierkorb verschieben, weil die Datenbank Tabellen hat, die der Papierkorb noch nicht kennt. Es wurde nichts geändert. Die Details stehen im Server-Log.',
  LEAGUE_TRASH_INVENTORY_STALE:
    'Die Liga lässt sich nicht in den Papierkorb verschieben, weil der Papierkorb Tabellen führt, die es in der Datenbank nicht mehr gibt. Es wurde nichts geändert. Die Details stehen im Server-Log.',
  LEAGUE_TRASH_BUSY: 'Gerade läuft eine andere Änderung an dieser Liga. Versuche es gleich noch einmal.',
  LEAGUE_TRASH_TIMEOUT:
    'Die Anfrage hat zu lange gedauert, das Ergebnis ist daher unbekannt. Lade die Seite neu, um zu sehen, ob es geklappt hat.',
  LEAGUE_TRASH_REBUILD_PENDING:
    'Statistiken und Ratings dieser gelöschten Liga wurden noch nicht neu aufgebaut. Führe zuerst den ausstehenden Neuaufbau aus und stelle die Liga danach wieder her.',
});
