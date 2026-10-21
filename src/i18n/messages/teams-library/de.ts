import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  library: {
    title: 'Team-Bibliothek',
    subtitle: 'Veröffentlichte Teams aus der ganzen Liga – suchen, stöbern, forken.',
    searchPlaceholder: 'Teams suchen …',
    shinySort: '★ Shiny-Sortierung: {mode}',
    sortModes: {
      latest: 'Neueste zuerst',
      nameAsc: 'Name A→Z',
      nameDesc: 'Name Z→A',
    },
    loading: 'Wird geladen …',
    empty: 'Noch keine Teams veröffentlicht.',
    previous: 'Zurück',
    next: 'Weiter',
    range: '{from}–{to} von {total}',
    untitled: 'Unbenanntes Team',
    published: 'Veröffentlicht am {date}',
  },
  entry: {
    loading: 'Wird geladen …',
    notFound: 'Team nicht gefunden',
    loadFailed: 'Team nicht gefunden',
    unpublished: 'Dieses Team ist möglicherweise nicht mehr veröffentlicht.',
    fork: 'Team forken',
    forking: 'Wird geforkt …',
  },
  shared: {
    loading: 'Team wird geladen …',
    notFound: 'Team nicht gefunden',
    loadFailed: 'Team konnte nicht geladen werden',
    disabled: 'Dieser Team-Link wurde möglicherweise deaktiviert oder ist abgelaufen.',
    defaultTitle: 'Geteiltes Team',
    tournament: 'Turnier',
    showdownPaste: 'Showdown-Paste',
    copyPaste: 'Paste kopieren',
  },
  set: {
    slot: 'Slot {n}',
    item: '@ {item}',
    ability: 'Fähigkeit: <value>{ability}</value>',
    tera: 'Tera:',
    nature: 'Wesen: {nature}',
    ivs: 'IVs: {spread}',
  },
});
