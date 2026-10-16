import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.worldClient;

export default defineDe<typeof en>()({
  nav: {
    sections: 'Abschnitte',
    evoligaSections: 'EvoLiga-Abschnitte',
    menu: 'Seitennavigation',
    worlds: {
      default: { pulse: 'Puls', phases: 'Phasen', reports: 'Berichte', stats: 'Statistiken', rules: 'Regeln' },
      evoliga: { pulse: 'Puls', roster: 'Kaderliste', teams: 'Teams', schedule: 'Spielplan', rules: 'Regelwerk' },
      sakura: { pulse: 'Puls', roster: 'Kaderliste', teams: 'Teams', schedule: 'Spielplan', rules: 'Regelwerk' },
      mountain: { pulse: 'Puls', roster: 'Kaderliste', teams: 'Teams', schedule: 'Spielplan', rules: 'Regelwerk' },
      clouds: { pulse: 'Puls', roster: 'Kaderliste', teams: 'Teams', schedule: 'Spielplan', rules: 'Regelwerk' },
    },
  },
  themeSwitcher: {
    auto: 'Auto',
    title: '3D-Welt: {world}',
    ariaLabel: '3D-Welt wechseln (aktuell: {world})',
  },
  overlay: {
    close: 'Schließen',
  },
  rosterTable: {
    searchPlaceholder: 'Pokémon suchen …',
    searchLabel: 'Entwicklungslinien durchsuchen',
    priceGroupFilter: 'Nach Preisgruppe filtern',
    allPriceGroups: 'Alle Preisgruppen',
    sortLabel: 'Tabelle sortieren',
    sort: {
      line: 'Liniennummer',
      priceAsc: 'Preis aufsteigend',
      priceDesc: 'Preis absteigend',
      kills: 'Kills bis Stufe 2',
    },
    count: '{shown} / {total} Linien',
    columns: {
      pokemon: 'Pokémon',
      price: 'Preis',
      killsStage2: 'Kills S2',
      killsStage3: 'Kills S3',
      early: 'Early',
      mid: 'Mid',
      late: 'Late',
      group: 'Gruppe',
    },
    openLine: 'Details zu Linie {name} öffnen',
    empty: 'Keine Linien passen zur aktuellen Filterung.',
    priceGroup: P.rosterTable.priceGroup,
  },
  rosterList: {
    all: 'Alle',
    filterLabel: 'Nach Preisgruppe filtern',
    leadLines: {
      one: 'Die Kaderliste hat {count} Linie – tippe sie an, um ihre Details zu sehen.',
      other: 'Alle {count} Linien der Kaderliste – tippe eine Linie an, um ihre Details zu sehen.',
    },
    leadTrainers: {
      one: 'Keine Point-Buy-Liste hinterlegt – {count} Trainer mit Ass und Arena-Typ. Tippe ihn an, um sein Team zu sehen.',
      other: 'Keine Point-Buy-Liste hinterlegt – alle {count} Trainer mit Ass und Arena-Typ. Tippe einen an, um sein Team zu sehen.',
    },
    shownLines: '{shown} / {total} Linien',
    shownTrainers: '{shown} / {total} Trainer',
    price: '{price} Pkt',
    empty: 'Die Kaderliste ist noch leer.',
    filteredEmpty: 'Keine Linien in dieser Preisgruppe.',
    openLine: 'Details zu Linie {name} öffnen',
    openTeam: 'Team von {name} öffnen',
  },
  rules: {
    formatRow: 'Format',
    bestOfRow: 'Best-of',
    modeRow: 'Modus',
    noRuleset: 'dieser Liga ist kein Regelwerk zugewiesen.',
    fullRulesWithRuleset: 'Klauseln, Verbote und eigene Regeln dieser Liga stehen in der Liga-Übersicht.',
    fullRulesWithoutRuleset:
      'Dieser Liga ist kein Regelwerk zugewiesen, daher sind keine Klauseln, Verbote oder eigenen Regeln hinterlegt.',
  },
});
