import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  signup_failed:
    'Die Registrierung hat nicht geklappt. Prüfe deine E-Mail-Adresse und dein Passwort und versuche es noch einmal.',
  signup_error: 'Die Registrierung ist fehlgeschlagen.',
  confirm_link_invalid:
    'Der Bestätigungslink ist ungültig oder abgelaufen. Fordere unten einen neuen an.',
  email_confirmation_failed: 'Deine E-Mail-Adresse konnte nicht bestätigt werden.',
  verification_resend_failed: 'Die Bestätigungs-E-Mail konnte nicht erneut verschickt werden.',
  password_reset_email_failed: 'Die E-Mail zum Zurücksetzen des Passworts konnte nicht verschickt werden.',
  reset_link_invalid: 'Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen an.',
  password_reset_failed: 'Dein Passwort konnte nicht zurückgesetzt werden.',
  player_registration_required: 'Dafür brauchst du ein Spielerprofil.',
  discord_already_linked: 'Es ist bereits ein Discord-Konto verknüpft.',
  discord_link_start_failed: 'Die Verknüpfung mit Discord konnte nicht gestartet werden.',
  email_login_already_linked: 'Mit diesem Konto ist bereits eine E-Mail-Anmeldung verknüpft.',
  email_login_create_failed:
    'Die E-Mail-Anmeldung konnte nicht angelegt werden. Prüfe E-Mail-Adresse und Passwort und versuche es noch einmal.',
  email_already_registered: 'Diese E-Mail-Adresse ist bereits registriert.',
  email_login_link_failed: 'Die E-Mail-Anmeldung konnte nicht verknüpft werden.',
  world_experience_invalid: '„worldExperience“ muss „auto“, „on“ oder „off“ sein.',
  world_experience_save_failed: 'Die 3D-Welt-Einstellung konnte nicht gespeichert werden.',
});
