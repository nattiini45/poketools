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
  point_buy_list_unbound: 'An diese Saison ist keine Point-Buy-Liste gebunden.',

  progress_tracker_not_in_season: 'Diese Linie wurde in dieser Saison nicht gefunden.',
  progress_audit_unreadable:
    'Die Korrektur wurde gespeichert, der Protokolleintrag ließ sich aber nicht zurücklesen.',

  redraft_hinrunde_incomplete: 'Der Redraft lässt sich erst öffnen, wenn die Hinrunde abgeschlossen ist.',
  redraft_phase_not_open: 'Die Redraft-Phase ist für diese Saison nicht geöffnet.',
  trade_source_trackers_required: 'Für einen Tausch müssen beide abgegebenen Linien angegeben sein.',
  trade_request_not_found: 'Tauschanfrage nicht gefunden.',
  trade_request_wrong_season: 'Diese Tauschanfrage gehört nicht zu dieser Saison.',
  trade_not_participant: 'Du bist an diesem Tausch nicht beteiligt.',
  trade_already_executed: 'Dieser Tausch wurde bereits durchgeführt.',
  trade_already_cancelled: 'Dieser Tausch wurde bereits abgebrochen.',
  trade_no_longer_pending: 'Dieser Tausch ist nicht mehr offen.',
  trade_side_a_invalid: 'Der Tausch scheitert auf der Seite von Spieler A: {reason}',
  trade_side_b_invalid: 'Der Tausch scheitert auf der Seite von Spieler B: {reason}',
  trade_request_not_executable: 'Dieser Tausch kann nicht mehr durchgeführt werden.',
  trade_multiple_draft_pools:
    'Diese Saison hat mehr als einen Draft-Pool, deshalb lässt sich der Tausch nicht prüfen.',
  trade_insufficient_points: 'Ein Spieler hat nicht mehr genug Punkte für diesen Tausch.',
  trade_source_tracker_unavailable: 'Eine getauschte Linie gehört nicht mehr ihrem Spieler.',
  trade_line_already_owned: 'Die Linie {pokemon} gehört bereits einem anderen Spieler.',
  trade_execution_rejected: 'Der Tausch wurde abgelehnt: {reason}',

  trade_source_tracker_not_found: 'Die abgegebene Linie von Spieler {side} wurde nicht gefunden.',
  trade_line_not_owned: 'Die angebotene Linie {side} gehört nicht Spieler {side}.',
  trade_line_not_in_list: 'Die angebotene Linie {side} steht nicht in der gebundenen Point-Buy-Liste.',
  trade_line_untradeable: '{pokemon} kann nicht getauscht werden.',
  trade_line_pending: 'Für eine dieser Linien läuft bereits ein offener Tausch.',
  trade_line_gone: 'Eine ausgewählte Linie ist nicht mehr verfügbar.',
  trade_line_left_list: 'Eine getauschte Linie steht nicht mehr in der gebundenen Point-Buy-Liste.',

  redraft_state_not_own: 'Du kannst nur deinen eigenen Redraft-Stand ansehen.',
  redraft_lines_not_own: 'Du kannst nur deine eigenen Linien redraften.',
  redraft_target_line_not_in_list: 'Die Ziellinie steht nicht in der gebundenen Point-Buy-Liste.',
  trade_admin_only: 'Einen Tausch führt ein Admin für beide Spieler durch.',
  trade_partner_required: 'Für einen Tausch fehlt die Angabe „trade_partner_id“.',
  trade_target_not_partner_line: 'Die Ziellinie gehört nicht dem Tauschpartner.',
  trade_source_tracker_missing: 'Die abgegebene Linie wurde für diesen Spieler nicht gefunden.',
  trade_offered_line_not_in_list: 'Die angebotene Linie steht nicht in der gebundenen Point-Buy-Liste.',

  redraft_line_excluded: '{pokemon} kann nicht per Redraft geholt werden.',
  redraft_source_missing: 'Die abgegebene Linie wurde nicht gefunden.',
  redraft_line_not_owned: 'Diese Linie gehört dir nicht.',
  redraft_line_untradeable: '{pokemon} kann nicht abgegeben werden.',
  redraft_insufficient_points: 'Nicht genug Punkte für das Upgrade: Du brauchst {cost}, hast aber nur {remaining}.',

  import_name_required: 'Gib einen Namen an.',
  import_version_invalid: 'Die Version muss eine positive ganze Zahl sein.',
  xlsx_file_missing: 'Es wurde keine Datei hochgeladen.',
  xlsx_extension_invalid: 'Die Datei muss eine .xlsx-Arbeitsmappe sein.',
  xlsx_type_invalid: 'Ungültiger Dateityp – erwartet wird .xlsx.',
  xlsx_file_empty: 'Die hochgeladene Datei ist leer.',
  xlsx_file_too_large: 'Die Datei ist größer als {limit} MB.',
  xlsx_zip_header_missing: 'Die Datei ist keine gültige .xlsx-Arbeitsmappe (ZIP-Header fehlt).',
});
