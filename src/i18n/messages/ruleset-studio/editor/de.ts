import { defineDe } from '@/i18n/define';
import type en from './en';

/**
 * German for `ruleset-studio/editor`. Casual du; "Regelwerk" for a ruleset, "Regel-Preset" for a catalog preset (as in
 * the Format Studio). Buttons use the infinitive. The plural objects follow the English ones. New German copy, not yet
 * reviewed by a native speaker (`docs/i18n.md`).
 */
export default defineDe<typeof en>()({
  toolbar: {
    back: 'Zurück zu den Regelwerken',
    readOnly: 'Leseansicht',
    actions: 'Aktionen für das Regelwerk',
    save: 'Entwurf speichern',
    saving: 'Wird gespeichert …',
    saved: 'Alle Änderungen gespeichert',
    savedAt: 'Gespeichert um {time}',
    unsaved: 'Ungespeicherte Änderungen',
    conflict: 'Anderswo geändert',
    publish: 'Veröffentlichen …',
    share: 'Teilen …',
    fork: 'Forken',
    delete: 'Löschen',
    visibility: {
      private: 'Privat',
      league: 'Mit Liga-Admins geteilt',
      gallery: 'In der Galerie',
    },
    version: 'Version {n}',
    draftOnly: 'Noch nicht veröffentlicht',
    noIssues: 'Keine Probleme gefunden',
    issues: {
      errors: { one: '{count} Fehler', other: '{count} Fehler' },
      warnings: { one: '{count} Warnung', other: '{count} Warnungen' },
      notes: { one: '{count} Hinweis', other: '{count} Hinweise' },
    },
  },
  save: {
    conflictTitle: 'Anderswo geändert',
    conflictBody: 'Dieses Regelwerk wurde anderswo geändert (gespeicherte Revision {rev}). Deine ungespeicherten Änderungen sind nicht auf dem Server.',
    reload: 'Neu laden',
    reloadConfirm: 'Beim Neuladen gehen deine ungespeicherten Änderungen verloren.',
    reloadDiscard: 'Neu laden und meine Änderungen verwerfen',
    keepMine: 'Meine behalten',
    cancel: 'Abbrechen',
    failed: 'Speichern fehlgeschlagen.',
    retry: 'Nochmal versuchen',
    guardConfirm: 'Du hast ungespeicherte Änderungen. Die Seite verlassen, ohne zu speichern?',
  },
  publish: {
    title: 'Version {n} veröffentlichen',
    doneTitle: 'Veröffentlicht',
    creates: 'Das erstellt Version {n}. Ligen behalten die Version, die sie nutzen, bis ein Admin sie auf die neue umstellt.',
    blocked: { one: 'Behebe {count} Fehler vor dem Veröffentlichen.', other: 'Behebe {count} Fehler vor dem Veröffentlichen.' },
    nothingNew: 'Seit Version {n} hat sich nichts geändert.',
    changelog: 'Was sich geändert hat (optional)',
    changelogEn: 'Änderungsprotokoll auf Englisch',
    changelogDe: 'Änderungsprotokoll auf Deutsch',
    savesFirst: 'Deine ungespeicherten Änderungen werden zuerst gespeichert.',
    confirm: 'Veröffentlichen',
    done: 'Version {n} veröffentlicht.',
    openReadOnly: 'Leseansicht öffnen',
    shareHint: 'Teile es mit anderen Admins über „Teilen …“.',
    close: 'Schließen',
  },
  share: {
    title: 'Wer darf dieses Regelwerk nutzen?',
    private: 'Privat',
    privateHelp: 'Nur du und Site-Admins können dieses Regelwerk sehen.',
    league: 'Mit Liga-Admins geteilt',
    leagueHelp: 'Andere Admins können die veröffentlichte Version lesen, forken und in ihren Ligen nutzen.',
    gallery: 'In der Galerie',
    galleryHelp: 'Jeder Admin findet die veröffentlichte Version in der Galerie. Das können nur Site-Admins wählen.',
    needPublish: 'Veröffentliche zuerst eine Version.',
    siteAdminOnly: 'Nur Site-Admins können ein Regelwerk in die Galerie stellen oder daraus nehmen.',
    galleryOwned: 'Ein Galerie-Regelwerk gehört der Seite.',
    apply: 'Übernehmen',
  },
  fork: {
    title: 'Dieses Regelwerk forken',
    body: 'Ein Fork erstellt eine private Kopie der zuletzt veröffentlichten Version (oder des gespeicherten Entwurfs, wenn nichts veröffentlicht ist). Ungespeicherte Änderungen sind nicht enthalten.',
    confirm: 'Forken',
  },
  delete: {
    title: 'Dieses Regelwerk löschen?',
    body: 'Das Regelwerk und alle seine Versionen werden endgültig gelöscht, außer eine Liga oder Phase nutzt noch eine davon. Das lässt sich nicht rückgängig machen.',
    confirm: 'Regelwerk löschen',
  },
});
