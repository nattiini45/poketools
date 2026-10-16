import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  tierEditor: {
    loading: 'Evolutions-Tiers werden geladen …',
    title: 'Evolutions-Tier-Liste',
    cancel: 'Abbrechen',
    addPokemon: '+ Pokémon hinzufügen',
    empty: 'Noch keine Evolutions-Tiers festgelegt. Füge Pokémon hinzu, um den Draft der Evo-Liga freizuschalten.',
    kos: 'KOs',
    remove: 'Entfernen',
    addTitle: 'Pokémon zur Tier-Liste hinzufügen',
    searchBase: 'Basis-Pokémon suchen',
    searchBasePlaceholder: 'Gib einen Pokémon-Namen ein (z. B. {example}) …',
    threeStageOnly: 'Es werden nur dreistufige Entwicklungslinien angezeigt.',
    searching: 'Suche läuft …',
    change: 'Ändern',
    kosForStage2: 'KOs für Stufe 2',
    kosForStage3: 'KOs für Stufe 3',
    powerTier: 'Power-Tier',
    addToTierList: 'Zur Tier-Liste hinzufügen',
    wildcardTitle: 'Wildcard-Zuteilungen',
    wildcardIntro:
      'Bonus-Pokémon für bestimmte Spieler (z. B. Entwicklungen von {example}). Sie kosten keinen Draft-Pick.',
    assignWildcardCta: '+ Wildcard zuteilen',
    unknownPlayer: 'Unbekannt',
    kosCount: '({count} KOs)',
    noWildcards: 'Noch keine Wildcards zugeteilt.',
    assignWildcard: 'Wildcard zuteilen',
    player: 'Spieler',
    selectPlayer: 'Spieler auswählen …',
    searchPokemon: 'Pokémon suchen',
    searchPokemonPlaceholder: 'Gib einen Pokémon-Namen ein …',
    summaryLines: {
      one: '<b>{count}</b> Entwicklungslinie in der Tier-Liste',
      other: '<b>{count}</b> Entwicklungslinien in der Tier-Liste',
    },
    summaryTier: '<b>{count}</b> im {tier}-Tier',
    summaryWildcards: {
      one: '<b>{count}</b> Wildcard zugeteilt',
      other: '<b>{count}</b> Wildcards zugeteilt',
    },
    errors: {
      load: 'Die Evolutions-Tiers konnten nicht geladen werden',
      addTier: 'Das Tier konnte nicht hinzugefügt werden',
      addWildcard: 'Die Wildcard konnte nicht zugeteilt werden',
      removeTier: 'Das Tier konnte nicht entfernt werden',
    },
  },
  recalc: {
    cta: 'Evolutionspunkte neu berechnen',
    recalculating: 'Wird neu berechnet …',
    done: '{points} für {players} neu berechnet.',
    points: { one: '{count} Evolutionspunkt', other: '{count} Evolutionspunkte' },
    players: { one: '{count} Spieler', other: '{count} Spieler' },
    failed: 'Neuberechnung fehlgeschlagen',
  },
});
