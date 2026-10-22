import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  INVALID_MATCH_ID: 'Spiel nicht gefunden.',
  STORAGE_REMOVE_FAILED: 'Die Datei des Social-Media-Bilds konnte nicht entfernt werden.',
  MISSING_PARAM: '{name} ist erforderlich.',
  INVALID_PARAM: '{name} muss eine gültige UUID sein.',
  SAME_PLAYER: 'Die beiden Spieler müssen verschieden sein.',
  name_mismatch:
    'Der Showdown-Name „{username}“ gehört zu keinem registrierten Spieler. Spieler müssen ihren Showdown-Namen im Profil hinterlegen.',
  duplicate_replay: 'Diese Replay-URL wurde für eine Partie dieses Spiels bereits eingereicht.',
  DOWNSTREAM_PLAYED: {
    one: '{count} nachfolgendes Spiel hat schon ein Ergebnis oder läuft gerade. Setze cascade: true, um die ganze Kette zurückzusetzen.',
    other:
      '{count} nachfolgende Spiele haben schon Ergebnisse oder laufen gerade. Setze cascade: true, um die ganze Kette zurückzusetzen.',
  },

  match_not_found: 'Spiel nicht gefunden.',
  match_access_required: 'Du hast keinen Zugriff auf dieses Spiel.',
  game_not_found: 'Partie nicht gefunden.',

  match_override_admin_only: 'Nur Admins können den Sieger oder die Notizen eines Spiels überschreiben.',
  match_winner_not_participant: 'Der Sieger muss einer der beiden Spieler dieses Spiels sein.',
  match_confirm_own_submission: 'Du kannst dein eigenes Ergebnis nicht selbst bestätigen.',
  match_transition_invalid: 'Ungültiger Statuswechsel: {from} → {to}',
  match_reset_admin_only: 'Nur Admins können den Spielstatus zurücksetzen.',
  match_status_override_admin_only: 'Nur Admins können ein laufendes Spiel direkt abschließen oder als strittig markieren.',
  match_dispute_resolve_admin_only: 'Nur Admins können strittige Spiele entscheiden.',
  match_complete_no_winner: 'Ein Spiel ohne Sieger kann nicht abgeschlossen werden.',
  match_confirm_participants_only: 'Nur die Spieler dieses Spiels oder Admins können Ergebnisse bestätigen.',
  match_dispute_participants_only: 'Nur die Spieler dieses Spiels oder Admins können Ergebnisse anfechten.',

  match_player_not_participant: 'Spieler {playerId} gehört nicht zu diesem Spiel.',
  manual_result_winner_not_participant: 'Der Sieger muss einer der beiden Spieler dieses Spiels sein.',
  replay_player_not_in_match: 'Spieler „{username}“ ({player}) gehört nicht zu diesem Spiel.',
  replay_winner_unknown: 'Aus dem Replay ließ sich kein Sieger ermitteln.',
  replay_already_recorded:
    'Mit diesem Replay wurde schon ein Partieergebnis eingetragen. Jeder Kampf kann nur einmal eingetragen werden.',
  replay_sides_not_distinct: 'Beide Seiten des Replays gehören zum selben Spieler.',
  battle_stats_duplicate_pokemon:
    'Ein Pokémon steht für denselben Spieler zweimal in dieser Partie. Jedes Pokémon kann pro Spieler und Partie nur einmal eingetragen werden.',
  match_result_conflict:
    'Im selben Moment wurde ein anderes Ergebnis für dieses Spiel eingetragen. Lade das Spiel neu und reiche es noch einmal ein.',
  match_finalize_incomplete: {
    one: 'Das Ergebnis wurde bestätigt, aber {count} Folgeschritt ist fehlgeschlagen. Der Fehler wurde für die Admins protokolliert; sichere Schritte werden automatisch wiederholt.',
    other: 'Das Ergebnis wurde bestätigt, aber {count} Folgeschritte sind fehlgeschlagen. Der Fehler wurde für die Admins protokolliert; sichere Schritte werden automatisch wiederholt.',
  },
  manual_result_moments_not_saved: {
    one: 'Die Partie wurde eingetragen, aber {count} markierter Moment konnte nicht gespeichert werden. Der Fehler wurde protokolliert.',
    other: 'Die Partie wurde eingetragen, aber {count} markierte Momente konnten nicht gespeichert werden. Der Fehler wurde protokolliert.',
  },
  admin_game_match_status_conflict:
    'Die Änderung an der Partie wurde gespeichert, aber das Spiel hat sich im selben Moment geändert, daher wurde sein Status nicht neu bewertet. Lade das Spiel neu und prüfe seinen Status.',
  admin_game_changed_concurrently:
    'Diese Partie wurde im selben Moment von einem anderen Admin geändert. Deine Anfrage hat nichts geändert; lade das Spiel neu und versuche es noch einmal.',
  admin_game_edit_stale:
    'Diese Partie hat sich geändert, nachdem du den Editor geöffnet hast (eine Bearbeitung wurde gespeichert oder versucht, vielleicht dein eigener früherer Speicherversuch, oder ihre Statistiken wurden gezählt). Es wurde nichts gespeichert; lade die Seite neu und nimm deine Änderung noch einmal vor.',
  admin_game_edit_in_progress:
    'Gerade wird eine andere Bearbeitung dieser Partie gespeichert. Es wurde nichts gespeichert; warte einen Moment, lade die Seite neu und nimm deine Änderung noch einmal vor.',
  admin_game_delete_recounted:
    'Die Bearbeitung eines anderen Admins hat diese Partie im selben Moment wieder gezählt, daher wurde sie nicht gelöscht. Ihre Statistiken passen zur Partie, wie sie jetzt ist; lade das Spiel neu und lösche sie noch einmal, wenn du das weiterhin willst.',
  admin_game_left_uncounted:
    'Die Änderung an der Partie ist fehlgeschlagen, und die Partie konnte nicht erneut zur Zählung eingereiht werden, daher fehlt sie möglicherweise in den Statistiken. Baue die Aggregate ihres Turniers und ihrer Saison neu auf (Admin-Datenwerkzeuge).',
  admin_game_evolution_recheck_failed:
    'Die Änderung an der Partie wurde gespeichert, aber die erneute Prüfung des Entwicklungsfortschritts ist fehlgeschlagen. Der Fehler wurde protokolliert; führe im Datenabgleich (Admin-Datenwerkzeuge) „Reparieren“ aus, um den Entwicklungsstand zu reparieren.',
  admin_match_reset_partial: {
    one: 'Das Zurücksetzen wurde abgebrochen, weil ein anderer Admin im selben Moment eine Partie dieses Spiels geändert hat. {count} Partie wurde bereits entfernt (ihre Statistiken zurückgerechnet); das Spiel selbst wurde nicht zurückgesetzt. Lade das Spiel neu und setze es noch einmal zurück.',
    other: 'Das Zurücksetzen wurde abgebrochen, weil ein anderer Admin im selben Moment eine Partie dieses Spiels geändert hat. {count} Partien wurden bereits entfernt (ihre Statistiken zurückgerechnet); das Spiel selbst wurde nicht zurückgesetzt. Lade das Spiel neu und setze es noch einmal zurück.',
  },
  match_already_scheduled: 'Das Spiel ist bereits angesetzt und hat keine Ergebnisse, die zurückgesetzt werden können.',

  match_proposal_not_found: 'Terminvorschlag nicht gefunden.',
  match_proposal_participants_only: 'Nur die Spieler dieses Spiels können einen Termin vorschlagen.',
  match_proposal_match_closed: 'Für abgeschlossene oder strittige Spiele kannst du keinen Termin vorschlagen.',
  match_proposal_time_past: 'Der vorgeschlagene Termin muss in der Zukunft liegen.',
  match_proposal_pending_exists: 'Für dieses Spiel gibt es schon einen offenen Terminvorschlag.',
  match_proposal_accept_responder_only: 'Nur wer den Vorschlag bekommen hat, kann ihn annehmen.',
  match_proposal_reject_responder_only: 'Nur wer den Vorschlag bekommen hat, kann ihn ablehnen.',
  match_proposal_not_pending: 'Dieser Terminvorschlag ist nicht mehr offen.',
  match_proposal_expired: 'Dieser Terminvorschlag ist abgelaufen.',
  match_schedule_closed: 'Abgeschlossene oder strittige Spiele können nicht mehr terminiert werden.',

  match_social_image_invalid: 'Ungültige Bilddaten.',
  match_social_image_not_png: 'Es werden nur PNG-Bilder akzeptiert.',
  match_social_image_too_large: 'Das Bild ist zu groß (max. 5 MB).',
  match_social_image_upload_failed: 'Das Social-Media-Bild konnte nicht hochgeladen werden.',

  cron_not_configured: 'Der Cronjob ist nicht konfiguriert.',
  cron_unauthorized: 'Nicht autorisiert.',
  aggregate_jobs_stranded:
    'Statistik-Aufträge hängen fest ({stranded} nicht mehr abholbar, {stale} bleiben in Bearbeitung).',
  aggregate_claim_failed: 'Statistik-Aufträge konnten nicht abgeholt werden.',
  aggregate_queue_failed: 'Statistik-Aufträge konnten nicht verarbeitet werden.',
  aggregate_health_failed: 'Der Zustand der Statistik-Aufträge konnte nicht geprüft werden.',
  auto_confirm_partial_failure: {
    one: 'Die automatische Bestätigung ist bei {count} Spiel fehlgeschlagen.',
    other: 'Die automatische Bestätigung ist bei {count} Spielen fehlgeschlagen.',
  },
  INVALID_GAME_ID: 'Partie nicht gefunden.',
  INVALID_PROPOSAL_ID: 'Terminvorschlag nicht gefunden.',
});
