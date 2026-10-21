import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  team_not_found: 'Team nicht gefunden.',
  INVALID_TEAM_ID: 'Team nicht gefunden.',
  team_list_forbidden: 'Du kannst die Teams anderer Spieler nicht ansehen.',
  team_list_tournament_id_invalid: 'tournament_id muss eine gültige UUID sein.',
  team_list_player_id_invalid: 'player_id muss eine gültige UUID sein.',
  team_submission_closed: 'Das Turnier ist abgeschlossen – Teams können nicht mehr eingereicht werden.',
  team_not_tournament_participant: 'Du nimmst an diesem Turnier nicht teil.',
  team_already_submitted: 'Du hast für dieses Turnier schon ein Team.',
  team_not_owner: 'Das ist nicht dein Team.',
  team_locked: 'Das Team ist gesperrt.',
  team_match_completed: 'Dieses Team gehört zu einem abgeschlossenen Spiel und kann nicht mehr geändert werden.',

  team_library_entry_not_found: 'Team nicht gefunden oder nicht veröffentlicht.',
  team_fork_source_not_found: 'Das Ausgangsteam wurde nicht gefunden.',
  team_fork_source_private: 'Das Ausgangsteam ist nicht öffentlich zugänglich.',
  team_fork_share_token_invalid: 'Der Teilen-Link passt nicht zu diesem Team oder ist deaktiviert.',

  team_share_site_url_missing: 'Serverfehler: Die Website-URL ist nicht konfiguriert.',
  team_share_token_invalid: 'Ungültiger Link.',
  team_shared_not_found: 'Team nicht gefunden oder der Link ist abgelaufen.',

  team_import_pokepaste_url_invalid: 'Ungültige pokepast.es-URL.',
  team_import_pokepaste_fetch_failed: 'pokepast.es konnte nicht abgerufen werden.',
  team_import_no_pokemon: 'Im Text wurde kein Pokémon erkannt.',

  sample_sets_pokemon_required: 'Der Parameter pokemon fehlt.',

  match_prep_not_participant: 'Du bist an diesem Spiel nicht beteiligt.',
  match_prep_target_not_participant: 'Der gewählte Spieler ist an diesem Spiel nicht beteiligt.',
  match_prep_match_completed: 'Dieses Spiel ist abgeschlossen. Das gemeldete Team kann nicht mehr geändert werden.',
});
