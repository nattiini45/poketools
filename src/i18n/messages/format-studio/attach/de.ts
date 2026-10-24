import { defineDe } from '@/i18n/define';
import type en from './en';

/** German for `format-studio/attach`. Casual du; stages are "Phasen", as on the league admin pages. */
export default defineDe<typeof en>()({
  panel: {
    title: 'Format',
    intro: 'Eine eigene Liga spielt die Phasen eines veröffentlichten Formats. Hänge eines an, und die Liga bekommt für jede Stufe eine Phase.',
    startedNotice: 'Diese Liga hat begonnen. Ihr Format ist gesperrt.',
    attachedHeading: 'Angehängtes Format',
    attachedName: 'Format',
    version: 'Version {n}',
    hash: 'Eingefrorener Hash',
    copyHash: 'Kopieren',
    copied: 'Hash kopiert.',
    copyFailed: 'Kopieren hat nicht geklappt. Der Hash ist markiert: kopiere ihn mit der Tastatur.',
    frozenAt: 'Angehängt am {date}',
    phases: { one: '{count} Phase erstellt', other: '{count} Phasen erstellt' },
    openPhases: 'Phasen öffnen',
    sourceDeleted: 'Das Ursprungsformat wurde gelöscht. Die Liga behält ihre eingefrorene Kopie.',
    openSource: 'Ursprungsformat öffnen',
    reattach: 'Neu anhängen …',
    cancelReattach: 'Aktuelles Format behalten',
    detach: 'Format entfernen',
    detachTitle: 'Dieses Format entfernen?',
    detachBody: {
      one: 'Beim Entfernen wird die aus diesem Format erstellte Phase ({count}) entfernt. Das geht nur, solange noch keine Runde existiert.',
      other: 'Beim Entfernen werden die {count} aus diesem Format erstellten Phasen entfernt. Das geht nur, solange noch keine Runde existiert.',
    },
    detachConfirm: 'Entfernen',
    detached: {
      one: 'Format gelöst. {count} Phase entfernt.',
      other: 'Format gelöst. {count} Phasen entfernt.',
    },
    reattachTitle: 'Angehängtes Format ersetzen?',
    reattachBody:
      'Beim erneuten Anhängen wird das aktuelle Format ersetzt. Phasen, die in beiden Versionen vorkommen, bleiben erhalten; Phasen, die die neue Version nicht mehr hat, werden entfernt.',
    reattachConfirm: 'Neu anhängen',
    pickerLabel: 'Veröffentlichtes Format auswählen',
    pickerPlaceholder: 'Format auswählen …',
    group: {
      mine: 'Deine Formate',
      league: 'Mit Liga-Admins geteilt',
      gallery: 'Galerie',
      others: 'Formate anderer Admins',
    },
    optionLabel: '{name} (Version {version}, {owner})',
    ownerYou: 'von dir',
    ownerOther: 'anderer Admin',
    ownerGallery: 'Galerie',
    capNote: 'Es werden nur die ersten {count} Formate angezeigt.',
    emptyTitle: 'Noch keine veröffentlichten Formate',
    emptyBody: 'Veröffentliche ein eigenes Format oder nutze ein geteiltes oder ein Galerie-Format, dann erscheint es hier.',
    openStudio: 'Formate im Format-Studio erstellen oder ansehen',
    loadingPreview: 'Phasen werden geladen …',
    previewFailed: 'Das Format konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
    attach: 'Anhängen',
    reattachSubmit: 'Neu anhängen',
    attachBusy: 'Wird ausgeführt …',
    done: {
      one: 'Format angehängt. {count} Phase erstellt.',
      other: 'Format angehängt. {count} Phasen erstellt.',
    },
    createdHeading: 'Erstellte Phasen',
  },
  preview: {
    heading: 'Diese Phasen werden erstellt',
    phase: 'Phase {order}',
    bestOf: 'Best of {n}',
    doubles: 'Doppel',
    rulesetLeague: 'Regelwerk der Liga',
    rulesetOwn: 'Eigenes Regelwerk',
    invalid: 'Diese Version kann nicht angehängt werden: Sie enthält Fehler. Öffne sie im Editor, um sie zu sehen.',
    openFormat: 'Format öffnen',
    gapsHeading: 'Von der Engine noch nicht umgesetzt',
    gaps: {
      override_unmapped:
        'Phase „{stage}“: Die Best-of-{best_of}-Ausnahme für Runde {round} passt zu keiner Runde der Phase und wird ignoriert.',
      rr_legs_not_run: 'Phase „{stage}“: Es wird nur ein Durchgang der Jeder-gegen-jeden-Runde gespielt ({legs} geplant).',
      third_place_not_run: 'Phase „{stage}“: Das Spiel um Platz 3 wird nicht gespielt.',
      edge_select_not_run:
        'Aufstieg „{edge}“: Die Auswahl „{kind}“ wird nicht ausgeführt. Ein Admin verschiebt die Spieler von Hand.',
      groups_not_created: 'Phase „{stage}“: Die {count} Gruppen werden nicht automatisch angelegt.',
    },
    gapKinds: {
      wildcard: 'Wildcards',
      threshold: 'Bedingung',
      bottom_n: 'Letzte N',
    },
  },
  blocked: {
    reasonStarted: 'Diese Liga hat begonnen. Ihr Format ist gesperrt.',
    reasonNothing: 'Wähle zuerst ein veröffentlichtes Format.',
    reasonLoading: 'Die Phasen werden noch geladen.',
    reasonInvalid: 'Diese Version hat Fehler. Wähle eine andere oder behebe sie zuerst im Editor.',
    reasonRuleset: {
      one: '{count} Stufe nutzt das Standard-Regelwerk der Liga, aber diese Liga hat keins. Wähle ein Format, das für jede Stufe ein Regelwerk nennt.',
      other:
        '{count} Stufen nutzen das Standard-Regelwerk der Liga, aber diese Liga hat keins. Wähle ein Format, das für jede Stufe ein Regelwerk nennt.',
    },
    reasonManual: 'Entferne zuerst die von Hand angelegten Phasen im Tab „Phasen“.',
    manualNotice: {
      one: 'Diese Liga hat {count} von Hand angelegte Phase. Zum Anhängen eines Formats darf es keine geben.',
      other: 'Diese Liga hat {count} von Hand angelegte Phasen. Zum Anhängen eines Formats darf es keine geben.',
    },
    reasonBusy: 'Wird ausgeführt …',
  },
  readiness: {
    title: 'Bereit zum Start?',
    intro: 'Das braucht eine eigene Liga vor der ersten Runde.',
    ready: 'Alles bereit. Du kannst die Liga starten.',
    state: {
      met: 'Erledigt',
      unmet: 'Offen',
      waiting: 'Wartet auf den Schritt davor',
    },
    format_attached: {
      met: 'Ein Format ist angehängt.',
      unmet: 'Hänge ein veröffentlichtes Format an. Ohne Format kann die Liga nicht starten.',
      waiting: 'Ein Format ist angehängt.',
    },
    phases_created: {
      met: 'Aus dem Format erstellte Phasen: {have} von {need}.',
      unmet: 'Aus dem Format erstellte Phasen: {have} von {need}.',
      unmetManual: {
        one: 'Aus dem Format erstellte Phasen: {have} von {need}. Die Liga hat außerdem {manual} von Hand angelegte Phase, die ein Format nicht ersetzen kann.',
        other:
          'Aus dem Format erstellte Phasen: {have} von {need}. Die Liga hat außerdem {manual} von Hand angelegte Phasen, die ein Format nicht ersetzen kann.',
      },
      waiting: 'Die Phasen werden erstellt, sobald ein Format angehängt ist.',
    },
    roster_size: {
      met: 'Angemeldete Spieler: {have}. Das Format braucht mindestens {need}.',
      unmet: 'Angemeldete Spieler: {have}. Das Format braucht mindestens {need}.',
      waiting: 'Wie viele Spieler nötig sind, steht fest, sobald ein Format angehängt ist.',
    },
    rulesets: {
      met: 'Jede Phase hat ein Regelwerk.',
      unmet: {
        one: '{count} Stufe nutzt das Standard-Regelwerk der Liga, aber diese Liga hat keins. Wähle ein Format, das für jede Stufe ein Regelwerk nennt.',
        other:
          '{count} Stufen nutzen das Standard-Regelwerk der Liga, aber diese Liga hat keins. Wähle ein Format, das für jede Stufe ein Regelwerk nennt.',
      },
      waiting: 'Die Regelwerke werden geprüft, sobald ein Format angehängt ist.',
    },
    action: {
      format_attached: 'Format anhängen',
      phases_created: 'Format öffnen',
      phases_manual: 'Phasen öffnen',
      roster_size: 'Teilnehmer öffnen',
      rulesets: 'Anderes Format wählen',
    },
  },
  status: {
    blockedNoFormat: 'Hänge zuerst ein Format an. Eine eigene Liga kann ohne Format nicht starten.',
  },
});
