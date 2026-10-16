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
  match_dispute_resolve_admin_only: 'Nur Admins können strittige Spiele entscheiden.',
  match_complete_no_winner: 'Ein Spiel ohne Sieger kann nicht abgeschlossen werden.',
  match_confirm_participants_only: 'Nur die Spieler dieses Spiels oder Admins können Ergebnisse bestätigen.',
  match_dispute_participants_only: 'Nur die Spieler dieses Spiels oder Admins können Ergebnisse anfechten.',

  match_player_not_participant: 'Spieler {playerId} gehört nicht zu diesem Spiel.',
  manual_result_winner_not_participant: 'Der Sieger muss einer der beiden Spieler dieses Spiels sein.',
  replay_player_not_in_match: 'Spieler „{username}“ ({player}) gehört nicht zu diesem Spiel.',
  replay_winner_unknown: 'Aus dem Replay ließ sich kein Sieger ermitteln.',

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
});
