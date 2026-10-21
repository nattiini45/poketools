import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  list_version_immutable:
    'Diese Version der Point-Buy-Liste ist an eine laufende oder abgeschlossene Saison gebunden und lässt sich nicht mehr ändern. Lege stattdessen eine neue Version an.',
  season_list_binding_locked: 'Nur kommende Saisons lassen sich an eine andere Version der Point-Buy-Liste binden.',
  epb_team_invalid: 'Dieses Team ist nach den Evolution-Point-Buy-Regeln nicht gültig: {issues}',
  suspended_line_in_team: '{species} ist für Spieltag {matchday} gesperrt und darf nicht im finalen Team stehen.',

  draft_season_id_required: 'Die Angabe „season_id“ fehlt.',
  draft_update_empty: 'Es gibt keine gültigen Felder zum Ändern.',

  draft_auction_order_not_free: 'Auktions-Drafts brauchen freie Pick-Reihenfolge: Den Pick bekommt, wer das höchste Gebot abgibt.',
  draft_roster_full: 'Dieser Spieler hat schon alle {max} Picks.',
  draft_groups_need_point_buy:
    'Diese Liga hat Gruppen. Gruppen draften getrennt, und das geht nur in Evolution-Point-Buy-Ligen. Entferne die Gruppen im Tab Teilnehmer, um einen gemeinsamen Draft für alle anzulegen.',
  draft_budget_below_rounds:
    'Ein Budget von {budget} reicht nicht für {rounds} Picks zum Standardpreis von {price} (nötig: {minimum}).',
  draft_pick_strands_roster:
    'Nach diesem Pick blieben nur {remaining_after} Punkte, die restlichen {slots} Picks kosten aber mindestens {min_cost} Punkte.',
  draft_free_order_not_running: 'Nur ein laufender Draft kann auf freie Reihenfolge wechseln.',
  draft_free_order_already_free: 'Dieser Draft nutzt schon die freie Reihenfolge.',

  evolution_tiers_empty: 'Gib mindestens einen Tier-Eintrag an.',
  evolution_tiers_mixed_season: 'Alle Tier-Einträge eines Sammelimports müssen zur selben Saison gehören.',
  evolution_stage2_required: 'Die Angabe „stage2_pokemon“ fehlt.',
  evolution_tier_not_found: 'Tier-Eintrag nicht gefunden.',

  pool_entries_empty: 'Gib mindestens einen Eintrag an.',
  pool_entries_mixed_season: 'Alle Einträge eines Sammelimports müssen zur selben Saison gehören.',
  pool_entry_not_found: 'Pool-Eintrag nicht gefunden.',
  pool_template_not_found: 'Vorlage nicht gefunden.',

  point_buy_list_not_found: 'Point-Buy-Liste nicht gefunden.',
  INVALID_POINT_BUY_LIST_ID: 'Point-Buy-Liste nicht gefunden.',
  point_buy_list_unbound: 'An diese Saison ist keine Point-Buy-Liste gebunden.',

  progress_tracker_not_in_season: 'Diese Linie wurde in dieser Saison nicht gefunden.',
  progress_audit_unreadable:
    'Die Korrektur wurde gespeichert, der Protokolleintrag ließ sich aber nicht zurücklesen.',

  redraft_hinrunde_incomplete: 'Der Redraft lässt sich erst öffnen, wenn die Hinrunde abgeschlossen ist.',
  redraft_state_not_own: 'Du kannst nur deinen eigenen Redraft-Stand ansehen.',

  import_name_required: 'Gib einen Namen an.',
  import_version_invalid: 'Die Version muss eine positive ganze Zahl sein.',
  xlsx_file_missing: 'Es wurde keine Datei hochgeladen.',
  xlsx_extension_invalid: 'Die Datei muss eine .xlsx-Arbeitsmappe sein.',
  xlsx_type_invalid: 'Ungültiger Dateityp – erwartet wird .xlsx.',
  xlsx_file_empty: 'Die hochgeladene Datei ist leer.',
  xlsx_file_too_large: 'Die Datei ist größer als {limit} MB.',
  xlsx_zip_header_missing: 'Die Datei ist keine gültige .xlsx-Arbeitsmappe (ZIP-Header fehlt).',
  INVALID_EVOLUTION_TIER_ID: 'Tier-Eintrag nicht gefunden.',
  INVALID_POOL_ENTRY_ID: 'Pool-Eintrag nicht gefunden.',
  INVALID_POOL_TEMPLATE_ID: 'Vorlage nicht gefunden.',
});
