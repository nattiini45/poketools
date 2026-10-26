import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  not_a_test_account: 'Dieser Spieler ist kein Testkonto.',
  login_already_minted:
    'Für dieses Testkonto werden gerade schon Zugangsdaten erstellt; lade die Seite neu und versuche es noch einmal.',
  test_player_action_invalid: 'action muss einer dieser Werte sein: {actions}',

  admin_param_required: '{name} fehlt.',

  aggregate_action_invalid: 'action muss „drain“ oder „rebuild“ sein.',
  aggregate_scope_type_invalid: 'scope_type muss „tournament“, „league“ oder „all_time“ sein.',
  aggregate_scope_id_required: 'Für die Bereiche Turnier und Liga ist eine scope_id nötig.',

  reconcile_body_not_object: 'Der Request-Body muss ein JSON-Objekt sein.',
  reconcile_repair_not_boolean: 'repair muss true oder false sein.',
  reconcile_scope_invalid: 'scope muss „season“ oder „all“ sein.',
  reconcile_season_id_required: 'Für den Bereich „season“ ist eine season_id nötig.',

  rating_history_incomplete: {
    one: 'Die Rating-Historie hat für {count} abgeschlossenes Spiel Lücken, die sich in keiner Reihenfolge neu aufbauen lassen (Spieler: {players}). Diese Spieler wurden nicht neu aufgebaut; die fehlenden Einträge der Rating-Historie muss ein Entwickler wiederherstellen.',
    other:
      'Die Rating-Historie hat für {count} abgeschlossene Spiele Lücken, die sich in keiner Reihenfolge neu aufbauen lassen (Spieler: {players}). Diese Spieler wurden nicht neu aufgebaut; die fehlenden Einträge der Rating-Historie muss ein Entwickler wiederherstellen.',
  },

  rating_rebuild_plan_too_large:
    'Der Neuaufbau dieser Ratings würde mehr als {limit} Spieler einbeziehen, um Lücken in der Rating-Historie zu schließen, daher wurde nichts neu aufgebaut. Ein Entwickler muss die Rating-Historie prüfen, bevor neu aufgebaut wird.',

  derived_data_rebuild_failed:
    'Das Löschen hat geklappt, aber der anschließende Neuaufbau der abgeleiteten Daten (Statistiken, Ratings, Serien) ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann die Daten mit „Reparieren“ im Datenabgleich (Admin-Datenwerkzeuge) wieder in Ordnung bringen.',
  delete_rebuild_aggregates_failed:
    'Das Löschen hat geklappt, aber der anschließende Neuaufbau der Nutzungsstatistiken (Aggregate) ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann die Aggregate in den Admin-Datenwerkzeugen neu aufbauen.',
  delete_rebuild_ratings_failed:
    'Das Löschen hat geklappt, aber der anschließende Neuaufbau der Ratings ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann sie mit dem Datenabgleich in den Admin-Datenwerkzeugen reparieren.',
  delete_rebuild_streaks_failed:
    'Das Löschen hat geklappt, aber der anschließende Neuaufbau der Siegesserien ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann sie mit dem Datenabgleich in den Admin-Datenwerkzeugen reparieren.',
  delete_rebuild_evolution_failed:
    'Das Löschen hat geklappt, aber die anschließende Reparatur des Entwicklungsfortschritts der Liga ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann ihn mit dem Datenabgleich in den Admin-Datenwerkzeugen reparieren.',
  restore_rebuild_failed:
    'Die Liga wurde wiederhergestellt, aber der anschließende Neuaufbau der abgeleiteten Daten (Statistiken, Ratings, Serien) ist fehlgeschlagen. Der Fehler wurde protokolliert; führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  restore_rebuild_aggregates_failed:
    'Die Liga wurde wiederhergestellt, aber das anschließende Einrechnen ihrer Spiele in die Nutzungsstatistiken (Aggregate) ist fehlgeschlagen. Der Fehler wurde protokolliert; führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  restore_rebuild_ratings_failed:
    'Die Liga wurde wiederhergestellt, aber der anschließende Neuaufbau der Ratings ist fehlgeschlagen. Der Fehler wurde protokolliert; führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  restore_rebuild_streaks_failed:
    'Die Liga wurde wiederhergestellt, aber der anschließende Neuaufbau der Siegesserien ist fehlgeschlagen. Der Fehler wurde protokolliert; führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  restore_rebuild_evolution_failed:
    'Die Liga wurde wiederhergestellt, aber die anschließende Reparatur des Entwicklungsfortschritts der Liga ist fehlgeschlagen. Der Fehler wurde protokolliert; führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  restore_rebuild_ratings_unsettled:
    'Die Liga wurde wiederhergestellt und die Ratings wurden neu aufgebaut, haben sich aber noch nicht ganz eingependelt. Führe den ausstehenden Neuaufbau auf der Papierkorb-Seite noch einmal aus.',
  test_flag_rating_rebuild_failed:
    'Die Testliga-Einstellung wurde gespeichert, aber der anschließende Neuaufbau der Ratings der Liga-Spieler ist fehlgeschlagen. Der Fehler wurde protokolliert; ein Site-Admin kann sie mit dem Datenabgleich in den Admin-Datenwerkzeugen reparieren und die Reparatur wiederholen, bis ihr Probelauf keine Rating-Abweichung mehr auflistet.',
  test_flag_rating_rebuild_unsettled:
    'Die Testliga-Einstellung wurde gespeichert und die Ratings der Liga-Spieler wurden neu aufgebaut, haben sich aber noch nicht ganz eingependelt. Ein Site-Admin kann das mit dem Datenabgleich in den Admin-Datenwerkzeugen abschließen und die Reparatur wiederholen, bis ihr Probelauf keine Rating-Abweichung mehr auflistet.',

  game_edit_empty: 'Gib winner_id und/oder battle_stats an, damit sich etwas ändert.',
  round_delete_not_allowed: 'Löschen kannst du nur die neueste Runde oder Runden ohne gespielte Partien.',
  replay_import_winner_not_participant: 'Der Sieger muss einer der beiden Spieler dieses Spiels sein.',
  replay_changed_since_preview:
    'Das Replay hat sich seit der Vorschau geändert. Lies es erneut aus und prüfe es, bevor du es importierst.',

  player_import_duplicate_discord_id: 'Diese discord_id kommt im Import mehrfach vor.',
  player_import_discord_id_exists: 'Es gibt schon einen Spieler mit dieser discord_id.',

  match_bulk_not_pending: 'Nur Spiele, die auf Bestätigung warten, lassen sich gesammelt bestätigen.',
  match_bulk_schedule_completed: 'Die Zeit eines abgeschlossenen Spiels lässt sich nicht ändern.',
  match_bulk_conflict:
    'Das Spiel hat sich während der Aktion geändert, daher wurde nichts geändert. Lade die Liste neu und versuche es noch einmal.',
  match_bulk_notes_full: 'Die Notizen dieses Spiels sind voll, daher wurde die Notiz nicht hinzugefügt.',
  match_bulk_not_processed:
    'Der Aktion ging vor diesem Spiel die Zeit aus, daher wurde nichts geändert. Führe sie für die übrigen Spiele noch einmal aus.',
  match_bulk_item_failed: 'Die Aktion ist für dieses Spiel fehlgeschlagen. Der Fehler wurde protokolliert.',

  admin_export_rate_limited: 'Export-Limit erreicht. Versuche es nach {resetAt} noch einmal.',

  format_not_found: 'Format nicht gefunden',
  format_preset_not_found: 'Beispielformat nicht gefunden',
  format_stale_revision:
    'Dieses Format wurde zwischenzeitlich geändert. Lade es neu und wende deine Änderung erneut an.',
  format_slug_taken: 'Diese Format-Adresse ist bereits vergeben.',
  format_document_not_json: 'Das Formatdokument ist kein gültiges JSON.',
  format_document_not_object: 'Das Formatdokument muss ein JSON-Objekt sein.',
  format_document_too_deep: 'Das Formatdokument ist zu tief verschachtelt.',
  format_document_too_many_nodes: 'Das Formatdokument hat zu viele Einträge.',
  format_document_too_large: 'Das Formatdokument ist zu groß (Limit 256 KB).',
  format_document_too_large_to_store: 'Das Formatdokument ist zu groß zum Speichern.',
  format_document_name_required: 'Das Formatdokument braucht einen gültigen Namen unter identity.',
  format_publish_invalid: {
    one: 'Dieses Format hat {count} Fehler und kann nicht veröffentlicht werden. Behebe ihn zuerst.',
    other: 'Dieses Format hat {count} Fehler und kann nicht veröffentlicht werden. Behebe sie zuerst.',
  },
  format_nothing_to_publish: 'Seit der letzten veröffentlichten Version gibt es keine Änderungen.',
  format_not_published: 'Dieses Format hat noch keine veröffentlichte Version.',
  format_published_locked: 'Ein Format in der Galerie können nur Site-Admins veröffentlichen.',
  format_visibility_forbidden:
    'Nur Site-Admins können ein Format in die Galerie stellen oder ein Galerie-Format ändern.',
  format_preset_locked: 'Beispielformate können nur Site-Admins ändern.',
  format_attached: {
    one: 'Dieses Format ist an {count} Liga angehängt und kann nicht gelöscht werden.',
    other: 'Dieses Format ist an {count} Ligen angehängt und kann nicht gelöscht werden.',
  },
  format_has_versions: 'Dieses Format hat veröffentlichte Versionen und kann deshalb nicht gelöscht werden.',
  format_version_immutable: 'Eine veröffentlichte Version kann nicht geändert werden.',

  ruleset_forbidden: 'Du kannst dieses Regelwerk nicht verwenden: Es ist privat bei einem anderen Admin oder hat noch keine veröffentlichte Version.',
  ruleset_slug_taken: 'Diese Regelwerk-Adresse ist bereits vergeben.',
  ruleset_stale_revision:
    'Dieses Regelwerk wurde zwischenzeitlich geändert. Lade es neu und wende deine Änderung erneut an.',
  ruleset_document_not_json: 'Das Regelwerk-Dokument ist kein gültiges JSON.',
  ruleset_document_not_object: 'Das Regelwerk-Dokument muss ein JSON-Objekt sein.',
  ruleset_document_too_deep: 'Das Regelwerk-Dokument ist zu tief verschachtelt.',
  ruleset_document_too_many_nodes: 'Das Regelwerk-Dokument hat zu viele Einträge.',
  ruleset_document_too_large: 'Das Regelwerk-Dokument ist zu groß (Limit 256 KB).',
  ruleset_document_too_large_to_store: 'Das Regelwerk-Dokument ist zu groß zum Speichern.',
  ruleset_document_invalid: {
    one: 'Dieses Regelwerk hat {count} Fehler und kann nicht veröffentlicht werden. Behebe ihn zuerst.',
    other: 'Dieses Regelwerk hat {count} Fehler und kann nicht veröffentlicht werden. Behebe sie zuerst.',
  },
  ruleset_nothing_to_publish: 'Seit der letzten veröffentlichten Version gibt es keine Änderungen.',
  ruleset_not_published: 'Dieses Regelwerk hat noch keine veröffentlichte Version.',
  ruleset_published_locked: 'Ein Regelwerk in der Galerie können nur Site-Admins veröffentlichen.',
  ruleset_visibility_forbidden:
    'Nur Site-Admins können ein Regelwerk in die Galerie stellen oder ein Galerie-Regelwerk ändern.',
  ruleset_preset_locked: 'Regelwerke der Seite können nur Site-Admins ändern.',
  ruleset_preset_unknown: 'Regel-Vorlage nicht gefunden',
  ruleset_in_use: {
    one: 'Dieses Regelwerk wird von {count} Liga oder Phase verwendet und kann nicht gelöscht werden.',
    other: 'Dieses Regelwerk wird von {count} Ligen oder Phasen verwendet und kann nicht gelöscht werden.',
  },
  ruleset_version_immutable: 'Eine veröffentlichte Version kann nicht geändert werden.',
  ruleset_legacy_editor_unsupported:
    'Dieses Regelwerk nutzt Funktionen, die der alte Regelwerk-Editor nicht anzeigen kann (eine Vorlage als Basis oder eine Erlaubnisliste). Bearbeite es im Regelwerk-Studio.',
  ruleset_version_quota_exceeded: 'Ein Regelwerk kann höchstens {max} veröffentlichte Versionen haben.',
  ruleset_owner_quota_exceeded: 'Du kannst höchstens {max} Regelwerke besitzen. Lösche eines, das du nicht mehr brauchst.',
  ruleset_pin_mismatch: 'Diese Version gehört nicht zu diesem Regelwerk.',
  ruleset_pin_locked: 'Diese Liga oder Phase ist abgeschlossen, daher kann ihr Regelwerk nicht mehr geändert werden.',
  ruleset_pin_started:
    'Diese Liga oder Phase hat bereits begonnen. Wechsle mit dem Regelwerk-Werkzeug auf eine andere Version; dort musst du bestätigen.',
  ruleset_pin_confirm_required: 'Diese Liga oder Phase hat bereits begonnen. Bestätige die Änderung für: {targets}.',
  ruleset_pin_moved: 'Das Regelwerk von {target} wurde während des Verschiebens von jemand anderem geändert. Die Seite zeigt jetzt den aktuellen Stand; prüfe ihn und versuche es erneut. Die davor wurden bereits verschoben.',
});
