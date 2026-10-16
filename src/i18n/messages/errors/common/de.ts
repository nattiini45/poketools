import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  network_error: 'Netzwerkfehler. Prüfe deine Verbindung und versuche es noch einmal.',
  unknown_error: 'Da ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
  validation_failed: 'Ungültige Eingabe: {issues}',
  rate_limited: 'Zu viele Anfragen. Versuche es in {seconds} Sek. noch einmal.',
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
});
