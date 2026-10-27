import { defineDe } from '@/i18n/define';
import type en from './en';

/** German for `ruleset-studio/diagnostics`. Casual du. New German copy, not yet reviewed by a native speaker (`docs/i18n.md`). */
export default defineDe<typeof en>()({
  category: {
    pokemon: 'Pokémon',
    moves: 'Attacken',
    items: 'Items',
    abilities: 'Fähigkeiten',
    clauses: 'Klauseln',
  },
  code: {
    invalid_structure: 'Das Dokument hat ein Strukturproblem: {issue}.',
    preset_unknown: 'Das Basis-Preset {preset} gibt es im Katalog nicht.',
    entry_in_ban_and_unban: '{name} ist in {category} sowohl gebannt als auch entbannt.',
    allowlist_with_bans: 'Die Erlaubnisliste für {category} ist an, aber es gibt auch Bans oder Entbannungen. Die Erlaubnisliste ersetzt sie.',
    allowlist_empty: 'Die Erlaubnisliste für {category} ist leer, also wäre nichts erlaubt.',
    duplicate_entry: '{name} steht in {category} doppelt.',
    unknown_clause: 'Die Klausel {clause} ist nicht bekannt.',
    clause_in_add_and_remove: 'Die Klausel {clause} wird sowohl hinzugefügt als auch entfernt.',
    unknown_entry: '{name} ist kein bekannter Eintrag dieser Generation und dieses Umfangs.',
    ban_redundant: '{name} ist vom Preset schon gebannt, ein weiterer Ban ändert nichts.',
    unban_not_banned: '{name} ist vom Preset nicht gebannt, ein Entbannen ändert nichts.',
    clause_informational: 'Die Klausel {clause} steht auf der Regelseite, aber der Team-Validator prüft sie nicht.',
  },
  structure: {
    not_object: 'ein Wert, der ein Objekt sein muss, ist keins',
    unknown_key: 'ein Feld, das es nicht gibt',
    bad_schema_version: 'eine nicht unterstützte Schema-Version',
    bad_text: 'ein Text, der kein gültiger zweisprachiger Text ist',
    bad_based_on: 'eine ungültige „basiert auf“-Id',
    bad_base: 'eine ungültige Basis',
    bad_list: 'eine Liste, die keine Liste von Ids ist',
    list_too_long: 'eine Liste, die zu lang ist',
    bad_id: 'eine Id mit nicht erlaubten Zeichen',
    bad_percent: 'ein Prozentwert außerhalb von 0 bis 100',
    bad_team_constraints: 'ungültige Team-Bedingungen',
    bad_custom_rules: 'ungültige Notizen',
  },
  fix: {
    remove: 'Eintrag entfernen',
    clear: 'Bans und Entbannungen löschen',
    blank: 'Zu einer leeren Basis wechseln',
  },
});
