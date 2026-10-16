import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  stats_view_invalid: 'view muss usage, raw oder moves sein.',
  stats_move_filter_length: 'move muss 1–{max} Zeichen lang sein.',
  stats_scope_invalid: 'scope muss tournament, league oder all_time sein.',
  stats_scope_id_required: 'Für Turnier- und Liga-Statistiken ist scope_id erforderlich.',
  stats_scope_id_invalid: 'scope_id muss eine gültige UUID sein.',

  usage_format_required: 'Der Abfrageparameter format ist erforderlich.',
  usage_no_data: 'Keine Nutzungsdaten für {pokemon}.',

  pokemon_not_found: 'Pokémon „{pokemon}“ nicht gefunden.',

  unknown_species: 'Unbekanntes Pokémon: {pokemon}.',
  evo_chain_unsupported:
    '„{pokemon}“ hat keine eindeutige dreistufige Entwicklungsreihe. Es entwickelt sich vielleicht nur einmal, verzweigt sich oder existiert nicht.',

  proxy_url_missing: 'Der Parameter url fehlt.',
  proxy_url_invalid: 'Ungültige URL.',
  proxy_https_only: 'Nur HTTPS-URLs sind erlaubt.',
  proxy_url_not_allowed: 'Diese Domain oder dieser Pfad ist nicht erlaubt.',
  proxy_upstream_failed: 'Das Bild konnte nicht vom Quellserver geladen werden.',
  proxy_upstream_not_image: 'Der Quellserver hat kein Bild geliefert.',

  replay_url_missing: 'Der Parameter url fehlt.',
  replay_url_invalid: 'Ungültige Replay-URL oder -ID.',

  wiki_ability_not_found: 'Fähigkeit nicht gefunden.',
  wiki_item_not_found: 'Item nicht gefunden.',
  wiki_move_not_found: 'Attacke nicht gefunden.',
  wiki_note_not_found: 'Notiz nicht gefunden.',
  wiki_note_edit_forbidden: 'Du darfst diese Notiz nicht bearbeiten.',
  wiki_note_delete_forbidden: 'Du darfst diese Notiz nicht löschen.',
  wiki_note_approve_reject_conflict: 'Eine Notiz kann nicht gleichzeitig freigegeben und abgelehnt werden.',
  wiki_note_content_required: 'Der Inhalt darf nicht leer sein.',
});
