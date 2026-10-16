import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  prompt: {
    header: 'Offene Handelsvorschläge, die auf deine Zustimmung warten',
    proposal: 'Handelsvorschlag: Du gibst <b>{yourLine}</b> ab und erhältst <b>{receivedLine}</b> von <b>{partnerName}</b>.',
    bothConsented: 'Beide Seiten haben zugestimmt.',
    waitingOther: 'Deine Zustimmung ist vermerkt – wir warten auf {otherName}.',
    waitingBoth: 'Wartet auf deine Zustimmung und die von {otherName}.',
    consentButton: 'Handel zustimmen',
    declineButton: 'Ablehnen',
    errorConsent: 'Zustimmung konnte nicht gespeichert werden',
    errorDecline: 'Handel konnte nicht abgelehnt werden',
    successDeclined: 'Handel abgelehnt und abgebrochen.',
    successExecuted: 'Handel abgeschlossen – der Tausch wurde ausgeführt.',
    successPending: 'Zustimmung vermerkt – wir warten auf den anderen Spieler.',
    errorNetwork: 'Netzwerkfehler – bitte versuche es erneut.',
  },
  admin: {
    intro: 'Offene Handelsvorschläge, die auf die Zustimmung der Spieler warten. Beide Seiten und jeder Admin können sie abbrechen.',
    empty: 'Keine offenen Handelsvorschläge.',
    cancel: 'Abbrechen',
    errorCancel: 'Handel konnte nicht abgebrochen werden',
    errorNetwork: 'Netzwerkfehler – bitte versuche es erneut.',
  },
});
