import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  fields: {
    email: 'E-Mail',
    password: 'Passwort',
    confirmPassword: 'Passwort bestätigen',
    newPassword: 'Neues Passwort',
    confirmNewPassword: 'Neues Passwort bestätigen',
    displayName: 'Anzeigename',
    displayNameHint: 'Wird in Tabellen, auf Spielseiten und in deinem Profil angezeigt.',
    passwordHint: 'Mindestens 8 Zeichen.',
  },
  passwordsMismatch: 'Die Passwörter stimmen nicht überein.',
  signIn: {
    title: 'Anmelden',
    discord: 'Mit Discord anmelden',
    orEmail: 'oder mit E-Mail',
    submit: 'Anmelden',
    forgotPassword: 'Passwort vergessen?',
    createAccount: 'Konto erstellen',
    invalidCredentials: 'E-Mail oder Passwort ist falsch.',
    tooManyAttempts: 'Zu viele Anmeldeversuche. Warte ein paar Minuten und versuche es dann noch einmal.',
    verifyFirst: 'Bitte bestätige deine E-Mail-Adresse, bevor du dich anmeldest.',
    resendVerification: 'Bestätigungs-E-Mail erneut senden',
    errors: {
      OAuthCallbackError: 'Die Anmeldung mit Discord ist fehlgeschlagen. Bitte versuche es noch einmal.',
      OAuthSignin: 'Die Anmeldung mit Discord ist fehlgeschlagen. Bitte versuche es noch einmal.',
      AccessDenied: 'Die Anmeldung wurde abgebrochen oder abgelehnt.',
      Configuration: 'Die Anmeldung ist falsch eingerichtet. Bitte wende dich an einen Admin.',
      Default: 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es noch einmal.',
    },
  },
  signUp: {
    title: 'Konto erstellen',
    discordHint: 'Du hast Discord? Dann kannst du dich direkt damit anmelden – ganz ohne Registrierung.',
    submit: 'Konto erstellen',
    haveAccount: 'Du hast schon ein Konto?',
    signIn: 'Anmelden',
    failed: 'Die Registrierung ist fehlgeschlagen. Bitte versuche es noch einmal.',
  },
  forgotPassword: {
    title: 'Passwort zurücksetzen',
    intro:
      'Gib deine E-Mail-Adresse ein, dann schicken wir dir einen Link zum Zurücksetzen. (Reine Discord-Konten haben kein Passwort – melde dich einfach mit Discord an.)',
    submit: 'Link senden',
    backToSignIn: 'Zurück zur Anmeldung',
    sent: 'Falls es ein Konto mit dieser E-Mail-Adresse gibt, ist ein Link zum Zurücksetzen unterwegs.',
    failed: 'Da ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
  },
  resetPassword: {
    title: 'Neues Passwort festlegen',
    missingToken:
      'Diesem Link fehlt sein Token. Öffne den Link aus deiner E-Mail noch einmal oder fordere einen neuen an.',
    requestNew: 'Neuen Link anfordern',
    submit: 'Neues Passwort speichern',
    done: 'Passwort geändert! Du kannst dich jetzt anmelden.',
    signIn: 'Anmelden',
    failed: 'Das Passwort konnte nicht zurückgesetzt werden. Bitte versuche es noch einmal.',
  },
  verifyEmail: {
    title: 'Schau in dein Postfach',
    intro:
      'Wir haben dir einen Bestätigungslink geschickt. Klick darauf, um dein Konto zu aktivieren, und melde dich dann an. Nichts angekommen? Schau im Spam-Ordner nach oder fordere den Link unten neu an.',
    introTo:
      'Wir haben einen Bestätigungslink an {email} geschickt. Klick darauf, um dein Konto zu aktivieren, und melde dich dann an. Nichts angekommen? Schau im Spam-Ordner nach oder fordere den Link unten neu an.',
    resend: 'Bestätigungs-E-Mail erneut senden',
    resent: 'Falls für diese E-Mail-Adresse eine Registrierung offen ist, ist eine neue Bestätigungs-E-Mail unterwegs.',
    failed: 'Erneutes Senden fehlgeschlagen. Bitte versuche es noch einmal.',
  },
  confirmEmail: {
    title: 'E-Mail-Adresse bestätigen',
    missingToken:
      'Diesem Bestätigungslink fehlt sein Token. Öffne den Link aus deiner E-Mail noch einmal oder fordere einen neuen an.',
    resend: 'Bestätigungs-E-Mail erneut senden',
    prompt: 'Klick unten, um die Einrichtung deines Kontos abzuschließen.',
    submit: 'E-Mail-Adresse bestätigen',
    done: 'E-Mail-Adresse bestätigt! Dein Konto ist bereit.',
    signIn: 'Anmelden',
    failed: 'Die Bestätigung ist fehlgeschlagen. Bitte versuche es noch einmal.',
  },
  errorPage: {
    title: 'Problem bei der Anmeldung',
    backToSignIn: 'Zurück zur Anmeldung',
    home: 'Startseite',
    codes: {
      LinkExpired:
        'Die Discord-Verknüpfung ist abgelaufen oder ungültig. Geh in die Einstellungen und versuche es dort noch einmal.',
      DiscordAlreadyLinked:
        'Dieses Discord-Konto ist bereits mit einem anderen Spieler verknüpft. Melde dich direkt mit Discord an oder bitte einen Admin, die Konten zusammenzuführen.',
      AccessDenied: 'Die Anmeldung wurde abgebrochen oder abgelehnt.',
      Verification: 'Der Anmeldelink ist nicht mehr gültig.',
      Configuration: 'Die Anmeldung ist falsch eingerichtet. Bitte wende dich an einen Admin.',
      Default: 'Bei der Anmeldung ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
    },
  },
});
