import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  board: {
    loading: 'Draft wird geladen …',
    columns: {
      round: 'Runde',
      player: 'Spieler',
      pokemon: 'Pokémon',
      cost: 'Kosten',
    },
    errors: {
      loadState: 'Der Draft-Stand konnte nicht geladen werden.',
      loadFailed: 'Der Draft konnte nicht geladen werden.',
      makePick: 'Der Pick konnte nicht gespeichert werden.',
      undo: 'Der Pick konnte nicht zurückgenommen werden.',
      statusChange: 'Der Draft-Status konnte nicht geändert werden.',
      freeOrder: 'Der Draft konnte nicht auf freie Reihenfolge umgestellt werden.',
    },
    epb: {
      pointsUsed: 'Punkte ausgegeben',
      pointsRemaining: 'Punkte übrig',
      picksUsed: 'Picks genutzt',
      picksRemaining: 'Picks übrig',
      purchasableTokens: {
        one: 'Kaufbare Draft-Kill-Tokens: <b>{count}</b> ({ratio} übrige Punkte = 1 Token, max. {max})',
        other: 'Kaufbare Draft-Kill-Tokens: <b>{count}</b> ({ratio} übrige Punkte = 1 Token, max. {max})',
      },
    },
    roundPick: 'Runde {round} · Pick Nr. {pick}',
    startDraft: 'Draft starten',
    undoLastPick: 'Letzten Pick zurücknehmen',
    yourTurn: 'Du bist am Zug!',
    waitingFor: 'Warte auf den Pick von {name} …',
    makePick: 'Jetzt picken',
    freeOrder: 'Freie Reihenfolge: Alle picken, wann sie wollen. Admins können Picks für alle eintragen.',
    pickFor: 'Picken für',
    stall: {
      you: {
        one: 'Du kannst gerade nicht picken: Du hast {remaining} Punkte, das billigste übrige Pokémon kostet aber {cost}. Ein Admin kann den Draft auf freie Reihenfolge umstellen, damit es weitergeht.',
        other:
          'Du kannst gerade nicht picken: Du hast {remaining} Punkte, deine {count} offenen Picks kosten zusammen aber mindestens {cost}. Ein Admin kann den Draft auf freie Reihenfolge umstellen, damit es weitergeht.',
      },
      named: {
        one: '{name} kann gerade nicht picken: {remaining} Punkte übrig, das billigste übrige Pokémon kostet aber {cost}. Ein Admin kann den Draft auf freie Reihenfolge umstellen, damit es weitergeht.',
        other:
          '{name} kann gerade nicht picken: {remaining} Punkte übrig, die {count} offenen Picks kosten zusammen aber mindestens {cost}. Ein Admin kann den Draft auf freie Reihenfolge umstellen, damit es weitergeht.',
      },
      switch: 'Auf freie Reihenfolge umstellen',
      confirmTitle: 'Auf freie Reihenfolge umstellen?',
      confirmBody:
        'Die Zugreihenfolge gilt dann nicht mehr: Alle picken, wann sie wollen, und {name} pickt, was noch bezahlbar ist. Picks und Punkte bleiben, wie sie sind. Wenn nichts mehr gepickt werden kann, beende den Draft. Zurückstellen geht nicht.',
    },
    endDraft: 'Draft beenden',
    endConfirmTitle: 'Draft beenden?',
    endConfirmBody: 'Der Draft wird mit den bisherigen Picks abgeschlossen. Offene Picks bleiben leer.',
    complete: 'Draft abgeschlossen!',
    tokens: {
      title: 'Draft-Kill-Tokens verteilen',
      intro:
        'Gib übrige Punkte im Token-Bereich für Draft-Kill-Tokens aus, bis das erste Spielergebnis bestätigt ist. Jedes Token bringt einer Entwicklungslinie +1 Entwicklungsfortschritt – eine Entwicklung auslösen kann es aber nicht.',
    },
    rosters: 'Kader',
    pickHistory: 'Pick-Verlauf',
  },
  picker: {
    title: 'Pokémon auswählen',
    filterPool: 'Draft-Pool filtern …',
    searchPokemon: 'Pokémon suchen …',
    poolOnly: 'Gedraftet werden können nur Pokémon aus dem Draft-Pool.',
    searching: 'Suche läuft …',
    drafted: 'Gedraftet',
    tierFull: 'Tier voll',
    overBudget: 'Über Budget',
    pointsLabel: 'Punkte:',
    remaining: '({n} übrig)',
    minBid: 'Mindestgebot: {n} Pkt.',
    bidNotWhole: 'Dein Gebot muss eine ganze Zahl sein.',
    bidOverBudget: 'Dein Gebot ist höher als dein Restbudget von {n} Pkt.',
    bidBelowReserve: 'Dein Gebot liegt unter dem Mindestgebot von {n} Pkt.',
    cost: 'Kosten: <b>{cost}</b> Punkte',
    costWithRemaining: 'Kosten: <b>{cost}</b> Punkte · Restbudget nach dem Pick: {remaining}',
    confirmPick: 'Pick bestätigen',
    confirmTitle: '{name} draften?',
    confirmBody: 'Prüf deine Auswahl: Zurücknehmen kann einen Pick nur ein Admin.',
  },
  poolManager: {
    exists: 'Für <b>{season}</b> gibt es schon einen Draft-Pool.',
    create: 'Draft-Pool erstellen',
    setupFor: 'Richte einen Draft für <b>{season}</b> ein',
    orderHeading: '1. Draft-Reihenfolge',
    orders: {
      snake: { name: 'Snake', description: 'Teilnehmer-Reihenfolge, jede Runde umgedreht: 1-2-3, dann 3-2-1.' },
      linear: { name: 'Gleiche Reihenfolge', description: 'Jede Runde die Teilnehmer-Reihenfolge: 1-2-3, dann 1-2-3.' },
      free: { name: 'Freie Reihenfolge', description: 'Keine Züge. Spieler picken jederzeit, Admins tragen Picks für sie ein.' },
    },
    pricingHeading: '2. Preise',
    pricings: {
      none: { name: 'Ohne Punkte', description: 'Picks kosten keine Punkte. Es gelten nur die Tier-Limits.' },
      fixed: { name: 'Feste Preise', description: 'Jedes Pokémon kostet seinen Preis im Pool, bezahlt aus dem Budget des Spielers.' },
      auction: {
        name: 'Auktion',
        description: 'Die Spieler bieten aus ihrem Budget, der Preis im Pool ist das Mindestgebot. Immer freie Reihenfolge.',
      },
    },
    auctionNeedsFree: 'Auktionen laufen mit freier Reihenfolge: Den Pick bekommt das höchste Gebot, nicht wer gerade dran ist.',
    summary: 'Du erstellst: {order}, {pricing}.',
    summaryWithBudget: {
      one: 'Du erstellst: {order}, {pricing}, {count} Punkt pro Spieler.',
      other: 'Du erstellst: {order}, {pricing}, {count} Punkte pro Spieler.',
    },
    pointBudget: 'Punktebudget pro Spieler',
    defaultPrice: 'Standardpreis (optional)',
    defaultPriceHint: 'So viel kosten Pokémon ohne eigenen Preis. Leer lassen für 0.',
    errors: {
      budgetInvalid: 'Gib eine ganze Zahl von 1 bis {max} ein.',
      priceInvalid: 'Gib eine ganze Zahl von 0 bis {max} ein oder lass das Feld leer.',
      priceAboveBudget: 'Der Standardpreis darf nicht höher sein als das Punktebudget ({budget} Pkt.).',
    },
    createFailed: 'Der Draft-Pool konnte nicht erstellt werden.',
  },
  poolFormat: {
    label: '{order} · {pricing}',
    order: { snake: 'Snake', linear: 'Gleiche Reihenfolge', free: 'Freie Reihenfolge' },
    pricing: { none: 'Ohne Punkte', fixed: 'Feste Preise', auction: 'Auktion', pointBuy: 'Point Buy' },
  },
  tierList: {
    tier: '{tier}-Tier',
    availableLimited: '{count} verfügbar · max. {max} pro Spieler',
    availableUnlimited: '{count} verfügbar · unbegrenzt',
    groupCount: '{count} Pokémon',
    groupCountLimited: '{count} Pokémon · max. {max} Picks',
    nextStage: { one: '→ {name} ({count} KO)', other: '→ {name} ({count} KOs)' },
  },
  rosterCard: {
    wild: 'Wild',
    max: 'Max',
    wasBase: 'vorher {name}',
    progressTo: {
      one: 'noch {count} Fortschrittspunkt bis {form}',
      other: 'noch {count} Fortschrittspunkte bis {form}',
    },
  },
  evolutionEvent: {
    evolved: 'Entwickelt!',
    devolved: 'Zurückentwickelt!',
    evolvedInto: '{from} von <b>{player}</b> hat sich zu <b>{to}</b> entwickelt (Fortschritt {total})',
    revertedTo: '{from} von <b>{player}</b> hat sich zu <b>{to}</b> zurückentwickelt (Fortschritt {total})',
  },
});
