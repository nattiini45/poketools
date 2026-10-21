import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  editor: {
    title: 'Ligagruppen',
    subtitle:
      'Teile die Liga in Gruppen auf. Jede Gruppe spielt ihr eigenes Jeder gegen jeden, hat ihre eigene Tabelle und draftet aus der gemeinsamen Liste ihren eigenen Draft. Ohne Gruppen spielt und draftet die Liga gemeinsam.',
    loading: 'Gruppen werden geladen …',
    retry: 'Erneut versuchen',
    noGroups: 'Diese Liga hat keine Gruppen: Sie spielt und draftet gemeinsam.',
    groupCount: 'Anzahl der Gruppen',
    groupCountOption: { one: '{count} Gruppe', other: '{count} Gruppen' },
    serpentine: 'Nach Setzplatz aufteilen',
    serpentineHint:
      'Schlangenreihenfolge nach Setzplatz: Die Setzplätze laufen der Reihe nach durch die Gruppen, dann in umgekehrter Reihenfolge zurück und so weiter, damit jede Gruppe eine faire Mischung bekommt. Die Setzplätze stammen aus der ersten Phase; Trainer ohne Setzplatz folgen nach Namen.',
    resplit: 'Neu nach Setzplatz aufteilen',
    clear: 'Gruppen entfernen',
    confirmClear: 'Alle Gruppen entfernen? Die Liga spielt und draftet dann gemeinsam.',
    replaceLocked:
      'Eine Gruppe hat bereits einen Draft, daher lassen sich die Gruppen nicht mehr neu aufteilen oder entfernen. Umbenennen geht weiterhin, und Trainer können zwischen Gruppen ohne Draft wechseln.',
    scheduleLocked:
      'Diese Liga hat schon Runden, deshalb stehen ihre Gruppen fest: Spielplan, Gruppentabellen und Draft-Reihenfolge bauen auf ihnen auf. Umbenennen kannst du eine Gruppe weiterhin.',
    scheduledBadge: 'Fest',
    scheduledHint: 'Die Liga hat schon Runden: Niemand kommt mehr hinzu oder wechselt aus dieser Gruppe heraus.',
    unplacedLockedHint:
      'Diese Teilnehmer sind nach dem Aufteilen dazugekommen. Die Liga hat schon Runden, deshalb können sie keiner Gruppe mehr beitreten.',
    minSizeHint: 'Eine Gruppe behält mindestens {min} Trainer, deshalb kann hier niemand wechseln.',
    lockedBadge: 'Hat einen Draft',
    lockedHint: 'Diese Gruppe hat einen Draft: Niemand kommt hinzu oder wechselt heraus, außer der Draft wird abgebrochen.',
    members: { one: '{count} Trainer', other: '{count} Trainer' },
    noMembers: 'Noch keine Trainer.',
    seed: '#{seed}',
    rename: 'Umbenennen',
    renameLabel: 'Gruppenname',
    renameAria: '{name} umbenennen',
    save: 'Speichern',
    cancel: 'Abbrechen',
    moveAria: 'Gruppe von {name}',
    unplacedTitle: 'In keiner Gruppe',
    unplacedHint: 'Diese Teilnehmer sind nach dem Aufteilen dazugekommen. Ordne jeden einer Gruppe zu.',
    choose: 'Gruppe wählen',
    saved: 'Gruppen gespeichert.',
    errors: {
      loadFailed: 'Die Gruppen ließen sich nicht laden.',
      saveFailed: 'Die Gruppen ließen sich nicht speichern.',
      renameFailed: 'Die Gruppe ließ sich nicht umbenennen.',
      moveFailed: 'Der Trainer ließ sich nicht verschieben.',
    },
  },
  draft: {
    intro:
      'Diese Liga draftet pro Gruppe: Jede Gruppe bekommt ihren eigenen Draft, mit ihren Mitgliedern als Plätzen. Liste, Budget und Regeln gelten für alle.',
    legacyUnsupported:
      'Diese Liga hat Gruppen. Gruppen draften getrennt, und das geht nur in Evolution-Point-Buy-Ligen. Entferne die Gruppen im Tab <link>Teilnehmer</link>, um einen gemeinsamen Draft für alle anzulegen.',
    members: { one: '{count} Trainer', other: '{count} Trainer' },
    seats: 'Einer pro Gruppenmitglied.',
    initial: 'Initial-Draft',
    redraft: 'Redraft',
    poolPhase: '{phase}',
    openPanel: 'In der Draft-Steuerung öffnen',
    openRoom: 'Draft-Raum öffnen',
    noMembers: 'Diese Gruppe hat keine Trainer. Ordne ihr zuerst im Tab <link>Teilnehmer</link> Trainer zu.',
    tooFew:
      'Ein Draft braucht mindestens {min} Trainer, und diese Gruppe hat {count}. Verschiebe zuerst Trainer im Tab <link>Teilnehmer</link>.',
    tooMany:
      'Ein Draft hat Platz für höchstens {max} Trainer, und diese Gruppe hat {count}. Teile die Teilnehmer im Tab <link>Teilnehmer</link> auf mehr Gruppen auf.',
    notCompletable:
      'Der Draft dieser Gruppe könnte nie fertig werden: Die {lines} Linien der Liste reichen nicht, um alle {slots} Kaderplätze ihrer {participants} Trainer im Budget zu füllen. Teile die Teilnehmer im Tab <link>Teilnehmer</link> in kleinere Gruppen auf.',
    undecided:
      'Ob sich jeder Kader dieser Gruppe füllen lässt, ließ sich nicht rechtzeitig prüfen. Beim Start des Drafts wird es erneut geprüft.',
    unplaced: {
      one: '{count} Teilnehmer ist in keiner Gruppe und bekommt keinen Platz. Ordne ihn im Tab <link>Teilnehmer</link> zu.',
      other: '{count} Teilnehmer sind in keiner Gruppe und bekommen keinen Platz. Ordne sie im Tab <link>Teilnehmer</link> zu.',
    },
  },
});
