/** Example pack messages (German). Checked against the contract by `defineDe` (design spec §E). */
import { defineDe } from '@/i18n/define';
import type { PackMessagesEn } from '@/lib/format-pack/types';

export default defineDe<PackMessagesEn>()({
  worldEvoliga: {
    rules: {
      comebackRule:
        '<b>{token}:</b> Wer ohne einen einzigen KO verliert, während der Gegner vier oder mehr Pokémon behält, bekommt 1 Token. Tokens werden nach dem Redraft eingesetzt und dürfen eine Entwicklung auslösen.',
      cosmoRule:
        '<b>{token}:</b> Die {line}-Linie erhält für jeden Spieltag, an dem sie eingesetzt wird, 1 Token, bis sie ihre letzte Stufe erreicht – Fortschritt zur Entwicklung, aber nie ein Kill.',
      evolutionBody:
        'Linien entwickeln sich über echte Kills sowie Token- und Teilnahme-Fortschritt. Die zweite Killzahl beginnt nach der ersten Entwicklung von vorn. Tera-Regeln pro Stufe:',
    },
  },
  draftTokens: {
    dk: {
      intro:
        'Mach aus {cost} übrigen Draft-Punkten +1 Entwicklungsfortschritt für eine deiner Linien: höchstens {max} pro Spieler, eins pro Linie. Zählt nie als KO.',
    },
    cb: {
      intro:
        'Gibt es für eine Niederlage ohne einen einzigen KO, wenn der Gegner vier oder mehr Pokémon behält: 1 Token. Anders als ein Draft-Kill-Token kann ein Comeback-Token eine Entwicklung auslösen.',
    },
    cosmo: {
      intro: 'Deine Teilnahme-Linie bekommt für jeden Spieltag, an dem sie eingesetzt wird, ein Teilnahme-Token.',
      note: 'Keine echten KOs · die Linie bleibt im Redraft gesperrt',
    },
  },
  draftRedraft: {
    tokenNote: 'Für Draft-Kill-Tokens ausgegebene Punkte werden im Redraft nicht erstattet.',
  },
  glossary: {
    token: {
      draftKill: 'Draft-Kill-Token',
      comeback: 'Comeback-Token',
      cosmo: 'Teilnahme-Token',
    },
    tokenCount: {
      draftKill: { one: '{count} Draft-Kill-Token', other: '{count} Draft-Kill-Tokens' },
      comeback: { one: '{count} Comeback-Token', other: '{count} Comeback-Tokens' },
      cosmo: { one: '{count} Teilnahme-Token', other: '{count} Teilnahme-Tokens' },
    },
  },
  enums: {
    priceGroup: { premium: 'Spitze', hoch: 'Oben', mittel: 'Mitte', guenstig: 'Unten', budget: 'Schnäppchen' },
  },
  paint: {
    gate: {
      label: {
        cosmoPoints: 'Teilnahme',
      },
      value: {
        shutout: 'Niederlage ohne KO, Gegner 4+ übrig → 1 Token',
        participation: 'Eingesetzt → Fortschritt',
      },
    },
    priceBand: {
      premium: 'Spitze',
      hoch: 'Oben',
      mittel: 'Mitte',
      guenstig: 'Unten',
      budget: 'Schnäppchen',
    },
  },
  draftLegacyEvolution: {
    summary: {
      suspendedNext: 'Setzt am nächsten Spieltag aus',
      suspensionDetail: '{name} setzt am nächsten Spieltag aus (letzte Stufe zu früh erreicht)',
    },
    pointBuy: {
      rule: {
        noCocoon: 'Volle Zwischenstufe ({base})',
        cosmog: 'Teilnahme-Tokens, {s2}/{s3} Fortschrittspunkte, im Redraft gesperrt',
      },
      ruleFilter: {
        scatterbug: '{species}: sofort letzte Stufe',
        no_cocoon_rule: 'Volle Zwischenstufe',
      },
    },
  },
  leagueAdminSeasonPage: {
    typeCores: {
      subtitle: 'Stell einen Pool aus Typ-Dreiergruppen zusammen und verteile sie dann von Hand oder per Zufall an alle.',
    },
  },
  draftShared: {
    progress: {
      cosmoChip: '+{n} Teilnahme',
    },
    reasons: {
      COSMOG_REDRAFT_LOCKED: 'Die Teilnahme-Linie kann nicht geredraftet werden.',
    },
  },
  adminCore: {
    actions: {
      dialogs: {
        resetMessage: {
          one: 'Dadurch wird {count} Partie samt Statistiken gelöscht, Match-Prep-, Terminvorschlags- und Broadcast-Daten werden bereinigt, und Tabellen, Pokémon-Statistiken, Ratings sowie (in der Evolution League) Entwicklungsfortschritt, Evolutionspunkte, Teilnahme-Tokens und Kill-Tokens werden aus den übrigen Spielen komplett neu berechnet. Spätere Spiele, die dadurch inkonsistent werden, werden markiert. Das lässt sich nicht rückgängig machen.',
          other: 'Dadurch werden alle {count} Partien samt Statistiken gelöscht, Match-Prep-, Terminvorschlags- und Broadcast-Daten werden bereinigt, und Tabellen, Pokémon-Statistiken, Ratings sowie (in der Evolution League) Entwicklungsfortschritt, Evolutionspunkte, Teilnahme-Tokens und Kill-Tokens werden aus den übrigen Spielen komplett neu berechnet. Spätere Spiele, die dadurch inkonsistent werden, werden markiert. Das lässt sich nicht rückgängig machen.',
        },
      },
    },
  },
  draftAdmin: {
    tokens: {
      col: {
        cosmo: 'Teilnahme',
      },
    },
  },
  draftScreen: {
    info: {
      cosmogLine: 'Teilnahme-Token-Linie',
    },
  },
  worldClient: {
    rosterTable: {
      priceGroup: {
        premium: 'Spitze (20–25)',
        hoch: 'Oben (15–19)',
        mittel: 'Mitte (10–14)',
        guenstig: 'Unten (6–9)',
        budget: 'Schnäppchen (1–5)',
      },
    },
  },
  leagueHub: {
    seasonEvolutionScoring: '3 Punkte pro Sieg, 1 pro Unentschieden · bei Gleichstand Kill-Differenz, dann Evolutionspunkte.',
    evolutionScoring: '3 Punkte pro Sieg, 1 pro Unentschieden · Kill-Differenz, dann Evolutionspunkte, dann direkter Vergleich',
  },
  utility: {
    hazards: 'Hazards',
    hazard_control: 'Hazard-Kontrolle',
    recovery: 'Heilung',
    pivot: 'Pivot',
    priority: 'Priorität',
  },
});
