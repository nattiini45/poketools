import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  network_error: 'Netzwerkfehler. Prüfe deine Verbindung und versuche es noch einmal.',
  unknown_error: 'Da ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
  upstream_timeout: 'Der Server hat zu lange für eine Antwort gebraucht. Versuche es gleich noch einmal.',
  validation_failed: 'Ungültige Eingabe: {issues}',
  rate_limited: 'Zu viele Anfragen. Versuche es in {seconds} Sek. noch einmal.',
  rate_limit_unavailable: 'Diese Aktion ist gerade nicht verfügbar. Versuche es in einer Minute noch einmal.',
  daily_limit_reached: 'Tageslimit erreicht ({limit} pro Tag). Versuche es später noch einmal.',
  unauthenticated: 'Du bist nicht angemeldet.',
  forbidden: 'Dafür fehlt dir die Berechtigung.',
  account_banned: 'Dein Konto wurde gesperrt.',
  account_suspended: 'Dein Konto ist vorübergehend gesperrt.',
  invalid_json: 'Die Anfrage enthält kein gültiges JSON.',
  not_found_generic: 'Nicht gefunden.',
  locale_invalid: 'Ungültige Spracheinstellung: „locale“ muss „en“ oder „de“ sein, „pkmnTerms“ muss „follow“ oder „en“ sein.',
  locale_cross_origin: 'Sprachwechsel von einer fremden Website abgelehnt.',
  locale_save_failed: 'Die Spracheinstellung konnte nicht gespeichert werden.',
  sprite_style_invalid: 'Ungültiger Sprite-Stil: „style“ muss „site“, „broadcast“, „home“, „animated“ oder „pixel“ sein.',
  sprite_style_cross_origin: 'Änderung des Sprite-Stils von einer fremden Website abgelehnt.',
  sprite_style_save_failed: 'Der Sprite-Stil konnte nicht gespeichert werden.',
  sprite_style_load_failed: 'Der Sprite-Stil konnte nicht geladen werden.',
});
