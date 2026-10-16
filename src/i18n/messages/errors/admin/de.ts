import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  not_a_test_account: 'Dieser Spieler ist kein Testkonto.',
  login_already_minted:
    'Für dieses Testkonto werden gerade schon Zugangsdaten erstellt; lade die Seite neu und versuche es noch einmal.',
  test_player_action_invalid: 'action muss einer dieser Werte sein: {actions}',

  admin_param_required: '{name} fehlt.',

  aggregate_action_invalid: 'action muss „drain“ oder „rebuild“ sein.',
  aggregate_scope_type_invalid: 'scope_type muss „tournament“, „league“ oder „all_time“ sein.',
  aggregate_scope_id_required: 'Für die Bereiche Turnier und Liga ist eine scope_id nötig.',

  reconcile_body_not_object: 'Der Request-Body muss ein JSON-Objekt sein.',
  reconcile_repair_not_boolean: 'repair muss true oder false sein.',
  reconcile_scope_invalid: 'scope muss „season“ oder „all“ sein.',
  reconcile_season_id_required: 'Für den Bereich „season“ ist eine season_id nötig.',

  game_edit_empty: 'Gib winner_id und/oder battle_stats an, damit sich etwas ändert.',
  round_delete_not_allowed: 'Löschen kannst du nur die neueste Runde oder Runden ohne gespielte Partien.',
  replay_import_winner_not_participant: 'Der Sieger muss einer der beiden Spieler dieses Spiels sein.',

  player_import_duplicate_discord_id: 'Diese discord_id kommt im Import mehrfach vor.',
  player_import_discord_id_exists: 'Es gibt schon einen Spieler mit dieser discord_id.',

  admin_export_rate_limited: 'Export-Limit erreicht. Versuche es nach {resetAt} noch einmal.',
});
