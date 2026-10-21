import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  NOT_GUEST: 'Der Zielspieler ist kein Gastkonto.',
  SOURCE_NOT_FOUND: 'Quellspieler nicht gefunden.',
  SOURCE_IS_GUEST: 'Der Quellspieler muss ein registriertes Konto sein.',
  SOURCE_HAS_ACTIVITY: 'Das Quellkonto hat bereits Aktivität – nutze stattdessen den Spielerwechsel.',
  SOURCE_NOT_ACTIVE: 'Das Quellkonto ist gesperrt.',
  claim_same_player: 'Gastkonto und Quellkonto müssen verschiedene Spieler sein.',
  player_not_found: 'Spieler nicht gefunden.',
  INVALID_PLAYER_ID: 'Spieler nicht gefunden.',
  player_identity_required:
    'Ein registrierter Spieler braucht eine Discord-ID oder ein verknüpftes Konto. Nur Gäste dürfen beides weglassen.',
  player_identity_taken: 'Diese Discord-ID oder dieses Konto gehört bereits einem anderen Spieler.',
  player_update_forbidden: 'Du darfst diesen Spieler nicht bearbeiten.',
  creator_status_superadmin_only: 'Nur der Superadmin kann den Creator-Status vergeben.',
  player_has_match_history: {
    one: 'Ein Spieler mit Spielhistorie ({count} Spiel) lässt sich nicht löschen. Sperre ihn stattdessen vorübergehend oder dauerhaft.',
    other:
      'Ein Spieler mit Spielhistorie ({count} Spiele) lässt sich nicht löschen. Sperre ihn stattdessen vorübergehend oder dauerhaft.',
  },
  player_still_referenced:
    'Dieser Spieler lässt sich nicht löschen, weil noch andere Einträge auf ihn verweisen.',
  player_in_active_draft:
    'Dieser Spieler sitzt in einem noch nicht abgeschlossenen Draft und lässt sich nicht löschen. Schließ den Draft ab oder brich ihn ab – oder nimm den Spieler vorher aus dem Draft.',
  avatar_edit_forbidden: 'Du darfst diesen Avatar nicht bearbeiten.',
  showdown_sprite_invalid: 'Ungültige Showdown-Sprite-ID.',
  showdown_sprite_url_invalid: 'Ungültige Showdown-Sprite-URL.',
  gallery_item_not_found: 'Galeriebild nicht gefunden.',
  gallery_item_not_owned: 'Du kannst kein Galeriebild eines anderen Spielers verwenden.',
  gallery_item_delete_forbidden: 'Du kannst kein Galeriebild eines anderen Spielers löschen.',
  gallery_item_delete_failed: 'Das Galeriebild konnte nicht gelöscht werden.',
  avatar_fields_missing: 'Pflichtfelder fehlen: image, config.',
  avatar_config_invalid: 'Ungültige Avatar-Konfiguration.',
  avatar_image_invalid: 'Ungültiges Bild.',
  avatar_image_invalid_base64: 'Ungültige Base64-Kodierung.',
  avatar_file_too_large: 'Die Datei ist zu groß (max. {max} MB).',
  avatar_image_too_small: 'Die Datei ist zu klein für ein gültiges Bild.',
  avatar_image_format_unsupported: 'Dieses Bildformat wird nicht unterstützt. Nutze JPEG, PNG oder WebP.',
  avatar_image_format_mismatch: 'Das Bildformat passt nicht zum angegebenen Dateityp.',
  avatar_image_too_large: 'Das Avatarbild ist zu groß (max. {max}).',
  avatar_image_unprocessable: 'Das Avatarbild konnte nicht verarbeitet werden.',
  avatar_upload_failed: 'Der Avatar konnte nicht hochgeladen werden.',
  avatar_thumbnail_upload_failed: 'Das Vorschaubild des Avatars konnte nicht hochgeladen werden.',
  avatar_delete_failed: 'Der Avatar konnte nicht entfernt werden.',
  avatar_choices_invalid: 'Ungültige Auswahl.',
  avatar_generation_failed: 'Das Bild konnte nicht erzeugt werden.',
  avatar_consent_outdated:
    'Der Einwilligungstext hat sich geändert. Lies ihn bitte noch einmal durch und stimme erneut zu.',
  avatar_moderation_unavailable:
    'Die Sicherheitsprüfung für Bilder ist gerade nicht verfügbar. Versuche es bitte später noch einmal.',
  avatar_image_rejected: 'Dieses Bild konnte nicht verarbeitet werden. Probier es bitte mit einem anderen Foto.',
  avatar_transform_failed: 'Das Foto konnte nicht umgewandelt werden.',
  avatar_3d_not_owned: 'Du kannst den Avatar eines anderen Spielers nicht ändern.',
  avatar_3d_config_invalid: 'Ungültige Trainer-Konfiguration.',
  avatar_3d_save_failed: 'Der 3D-Avatar konnte nicht gespeichert werden.',
  bootstrap_not_configured: 'BOOTSTRAP_SECRET ist auf dem Server nicht konfiguriert.',
  bootstrap_secret_invalid: 'Das Bootstrap-Secret fehlt oder ist falsch.',
  bootstrap_admin_exists:
    'Bootstrap deaktiviert – es gibt bereits einen Admin. Bitte einen Admin, dir im Admin-Panel Rollen zu geben.',
  bootstrap_sign_in_required: 'Für den Bootstrap musst du angemeldet sein.',
  bootstrap_player_missing: 'Dein Spielerprofil wurde nicht gefunden. Melde dich ab und wieder an und versuche es dann noch einmal.',
  INVALID_GALLERY_ITEM_ID: 'Galeriebild nicht gefunden.',
  INVALID_ACHIEVEMENT_ID: 'Erfolgsdefinition nicht gefunden.',
});
