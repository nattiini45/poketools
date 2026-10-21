import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.draftRedraft;

// Deutsch nach i18n-core §10 (du-Form, Glossar). Liga-Begriffe kommen aus `glossary`.
export default defineDe<typeof en>()({
  page: {
    title: '{league} – Redraft',
    notEpb: 'Den Redraft gibt es nur in Evolution-Point-Buy-Ligen.',
    noRedraft: 'Für diese Liga gibt es noch keinen Redraft.',
    noList: 'Für diese Liga ist noch keine Point-Buy-Liste hinterlegt, deshalb kann der Redraft nicht angezeigt werden.',
    signIn: 'Melde dich an, um deine Abgaben auszuwählen.',
    signInLink: 'Anmelden',
    backToLeague: 'Zurück zur Liga',
  },
  center: {
    loading: 'Redraft wird geladen …',
    loadFailed: 'Der Redraft konnte nicht geladen werden. Neuer Versuch läuft …',
    notOpen: 'Der Redraft ist noch nicht eröffnet.',
    secretPhase: 'Alle wählen ihre Abgaben verdeckt. Sie werden nach Ablauf der Frist veröffentlicht.',
    lockedPublic: 'Die Abgabephase ist beendet. Die Abgaben werden in Kürze veröffentlicht.',
    submissionLoadFailed: 'Deine Abgabe konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
  },
  locked: {
    cosmog: '{line} kann nicht geredraftet werden.',
    noRedraft: 'Diese Linie kann nicht geredraftet werden.',
  },
  counter: '{n}/{max} Linien abgeben',
  secretNote: 'Bis zur Frist sehen das nur du und die Admins.',
  budgetPreview: 'Redraft-Budget: {n} P (Rest {left} + Erstattung {refund})',
  ...P,
  save: 'Speichern',
  saving: 'Wird gespeichert …',
  withdrawAll: 'Alle zurückziehen',
  saved: 'Gespeichert',
  unsaved: 'Nicht gespeicherte Änderungen',
  lockedAfterDeadline: 'Die Frist ist abgelaufen – deine Abgaben lassen sich nicht mehr ändern.',
  goToRoom: 'Zum Draft-Raum',
  panel: {
    title: 'Deine Abgaben',
    intro:
      'Wähle bis zu {max} Linien, die du abgibst. Ihr Preis fließt zurück in dein Budget, und ihre KOs gehen als übertragener Fortschritt auf die Linie über, die du stattdessen pickst.',
    capReached: 'Du hast das Maximum von {max} Linien gewählt.',
    noLines: 'Du hast keine Linien im Kader.',
    nothingChosen: 'Keine Linie gewählt – du behältst deinen ganzen Kader.',
    refund: '+{n} P zurück',
    kosTransfer: { zero: 'kein KO wird übertragen', one: '{count} KO wird übertragen', other: '{count} KOs werden übertragen' },
    timeLeft: 'noch {time}',
    listLabel: 'Linien in deinem Kader',
  },
  reveal: {
    title: 'Redraft-Abgaben',
    published: 'Veröffentlicht',
    standing: 'Platz {rank} nach der Hinrunde',
    noDrops: 'Keine Abgaben',
    released: 'Wieder im Pool',
    free: 'Frei',
    yourSlots: 'Deine Redraft-Plätze',
    slot: 'Platz {label}',
    replaces: 'ersetzt {line}',
    slotFilled: 'Besetzt',
    slotOpen: 'Offen',
    budget: 'Redraft-Budget: {n} P',
    order: 'Redraft-Reihenfolge',
    orderHint:
      'Wer nach der Hinrunde am schlechtesten steht, pickt zuerst. Jede Runde dreht sich die Reihenfolge um (Snake), und wer alle Plätze besetzt hat, fällt aus ihr heraus.',
    complete: 'Der Redraft ist abgeschlossen.',
  },
  notice: {
    submissions:
      'Abgabephase des Redrafts: Wähle vor Ablauf der Frist die Linien, die du abgibst. Gepickt wird, sobald die Abgaben veröffentlicht sind.',
    locked: 'Die Abgabephase des Redrafts ist beendet. Die Abgaben werden in Kürze veröffentlicht.',
    link: 'Zum Redraft',
  },
});
