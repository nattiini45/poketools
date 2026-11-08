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
  advance_manual_list_required: 'Für dieses Weiterkommen braucht es die Liste der Spieler, die weiterkommen.',
  advance_threshold_failed: 'Die Bedingung fürs Weiterkommen ließ sich nicht für jeden Spieler prüfen.',
  groups_forming_in_progress: 'Gerade bildet eine andere Anfrage die Gruppen dieser Phase. Versuche es gleich noch einmal.',
  pairing_expr_failed: 'Der Filter dieser Stage ließ sich für ein Spielerpaar nicht auswerten, deshalb wurde die Runde nicht gepaart.',
  season_not_found: 'Saison nicht gefunden.',
  INVALID_SEASON_ID: 'Liga nicht gefunden.',
  INVALID_PHASE_ID: 'Phase nicht gefunden.',
  INVALID_GROUP_ID: 'Gruppe nicht gefunden.',
  INVALID_LEAGUE_TRASH_ID: 'Gelöschte Liga nicht gefunden.',
  INVALID_CHALLENGE_ID: 'Herausforderung nicht gefunden.',
  INVALID_CHECK_ID: 'Prüfung nicht gefunden.',
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
  format_phases_in_use:
    'Teams verweisen noch auf eine Phase, die diese Formatänderung entfernen würde. Entferne zuerst diese Teams.',
  format_phase_owned:
    'Diese Phase gehört zum Format der Liga, deshalb lässt sie sich nicht hinzufügen, löschen, umsortieren oder umbauen, und ihre Teilnehmer und ihr Status lassen sich über diese Anfrage nicht ändern. Ersetze das Format, ändere den Status in den Phaseneinstellungen oder nutze einen Ersatzspieler.',
  format_runtime_has_data:
    'Diese Liga hat bereits Daten ihres aktuellen Formats: {links} Verknüpfungen, {items} Gegenstände, {submissions} Abgaben und {adjustments} Anpassungen. Beim Ersetzen oder Abhängen des Formats wird alles gelöscht. Bestätige, um fortzufahren.',
  season_format_type_locked:
    'Der Ligatyp lässt sich nicht auf oder von einem eigenen Format umstellen, solange ein Format angehängt ist oder nachdem die Liga begonnen hat.',
  action_locked: 'Diese Aktion ist gesperrt, deshalb lässt sie sich nicht mehr ändern.',
  resource_item_taken: 'Ein anderer Spieler hat dieses Item schon, deshalb kannst du es nicht noch einmal wählen.',
  resource_capacity_reached: 'Dieser Spieler hält von dieser Ressource bereits so viel, wie erlaubt ist, deshalb lässt sich nichts mehr hinzufügen.',
  format_context_stale: 'Das Ligaformat hat sich geändert, während du gearbeitet hast, deshalb wurde deine Änderung nicht gespeichert. Die Ansicht wurde aktualisiert: Prüfe sie und versuche es erneut.',
  domain_amendment_locked: 'Diese Liste lässt sich nicht ändern, weil eine Aktion, die sie nutzt, schon gesperrt ist.',
  reason_required: 'Für diese Anpassung ist eine Begründung nötig.',
  reason_too_long: 'Die Begründung ist zu lang: erlaubt sind höchstens 500 Zeichen.',
  challenge_self: 'Du kannst dich nicht selbst herausfordern.',
  challenge_phase_not_found: 'Diese Phase gehört nicht zur Liga.',
  challenge_phase_closed: 'Diese Phase ist abgeschlossen, deshalb nimmt sie keine Herausforderungen mehr an.',
  challenge_not_participant: 'Beide Spieler müssen an dieser Phase teilnehmen.',
  challenge_no_open_round: 'Diese Phase hat noch keine offene Runde. Ein Admin muss zuerst eine Runde öffnen.',
  challenge_rank_range: 'Du kannst nur einen Spieler herausfordern, der über dir steht, und zwar im Abstand, den diese Leiter erlaubt.',
  challenge_max_open: 'Du hast so viele offene Herausforderungen, wie diese Leiter erlaubt.',
  challenge_already_open: 'Zwischen dir und diesem Spieler gibt es schon eine offene Herausforderung.',
  challenge_cooldown: 'Du hast diesen Spieler erst vor kurzem herausgefordert. Warte ein paar Runden, bevor du es wieder tust.',
  challenge_not_found: 'Diese Herausforderung gibt es nicht.',
  challenge_not_defender: 'Nur der herausgeforderte Spieler kann diese Herausforderung beantworten.',
  challenge_not_challenger: 'Nur der Spieler, der diese Herausforderung gestellt hat, kann sie zurückziehen.',
  challenge_not_open: 'Diese Herausforderung wurde schon beantwortet oder zurückgezogen oder ist abgelaufen.',
  challenge_expired: 'Die Zeit zum Beantworten dieser Herausforderung ist abgelaufen.',
  challenge_player_not_enrolled: 'Einer der beiden Spieler gehört nicht mehr zu dieser Phase, deshalb wurde die Herausforderung abgebrochen.',
  challenge_not_ladder: 'Diese Phase ist keine Herausforderungsleiter.',
  challenge_ladder_inactive: 'Die Herausforderungsleiter dieser Liga läuft im Moment nicht, deshalb können Herausforderungen weder gestellt noch angenommen werden. Ablehnen oder zurückziehen geht weiterhin.',
  format_not_running: 'Diese Liga läuft gerade nicht mit einem eigenen Format.',
  format_not_participant: 'Du nimmst an dieser Liga nicht teil.',
  format_season_closed: 'Diese Liga ist abgeschlossen, deshalb sind keine Züge mehr möglich.',
  unmask_audit_unavailable:
    'Die verborgenen Beziehungen konnten nicht angezeigt werden, weil der Zugriff nicht protokolliert werden konnte. Versuche es gleich noch einmal.',
  format_action_unknown: 'Diese Aktion gibt es in dieser Liga nicht.',
  format_action_already_submitted: 'Du hast diese Aktion schon abgegeben. Gib sie erneut ab, um deine Auswahl zu ändern.',
  format_action_invalid: 'Deine Abgabe hat Probleme.',
  format_adjust_not_allowed: 'Dieses Format erlaubt diese Art von Anpassung nicht.',
  format_adjust_unknown_target: 'Die Anpassung zeigt auf etwas, das nicht zu dieser Liga gehört.',
  format_adjust_invalid_amount: 'Dieser Betrag ist für die Anpassung nicht gültig.',
  format_adjust_invalid_links:
    'Diese Verknüpfungen passen nicht zur Beziehung: Sie dürfen nur Spieler der Liga nennen und müssen zum Typ der Beziehung passen.',
  format_adjust_invalid_order: 'Die Reihenfolge muss jeden Spieler der Stage genau einmal nennen.',
  format_adjust_unknown_item: 'Dieses Item gehört nicht zur Liste, die diese Ressource enthält.',
  format_adjust_item_required: 'Diese Ressource enthält Einträge einer Liste, deshalb muss die Anpassung das Item nennen.',
  format_adjust_item_not_allowed: 'Diese Ressource ist ein einfacher Zähler und nimmt kein Item an.',
  format_adjust_attr_missing: 'Einem hinzugefügten Eintrag fehlt ein Attribut, das ein Schritt einer Aktion über diese Liste braucht.',
  format_adjust_insufficient_holding: 'Der Spieler hat nicht so viele von diesem Item, deshalb lassen sie sich nicht wegnehmen.',
  format_adjust_domain_too_large: 'Die Liste hätte mehr Einträge, als eine Liste haben darf.',
  format_adjust_amendment_limit: 'Diese Liga hat die Zahl der erlaubten Listenänderungen erreicht.',
  format_adjust_relation_has_links: 'Diese Beziehung hat schon Verknüpfungen, und bestehende Verknüpfungen lassen sich nicht ändern.',
  format_adjust_action_unchanged: 'Die Aktion ist schon in diesem Zustand, deshalb wurde nichts geändert.',
  format_adjust_domain_in_use:
    'Diese Listenänderung wird abgelehnt: Ein Spieler hat schon einen Eintrag, der entfernt würde, oder eine Stage, die diese Liste zählt, hat schon begonnen.',
  format_check_not_found: 'Diese Prüfung gibt es in dieser Liga nicht.',
  format_check_not_open: 'Diese Prüfung ist schon entschieden.',
  format_request_too_large: 'Diese Anfrage ist zu groß.',
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
