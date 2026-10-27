import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  agent_disabled: 'Der Assistent ist nicht verfügbar.',
  phase_disabled: 'Diese Aktion ist noch nicht freigeschaltet.',
  agent_golive_disabled: 'Das Live-Schalten über den Assistenten ist ausgeschaltet.',
  agent_config_invalid: 'Der Assistent ist ausgeschaltet, bis seine Konfiguration korrigiert ist.',

  agent_rate_limited: 'Du schickst Nachrichten zu schnell. Versuch es in {seconds} s noch einmal.',
  agent_conversation_busy: 'Der Assistent arbeitet in dieser Unterhaltung noch an der vorherigen Nachricht.',
  agent_admin_busy: 'Der Assistent arbeitet in einer anderen Unterhaltung noch an einer Nachricht.',
  agent_text_too_long: 'Die Nachricht ist zu lang. Erlaubt sind {max} Zeichen.',
  agent_body_too_large: 'Die Anfrage ist zu groß.',
  agent_turn_limit_reached:
    'Der Assistent hat angehalten, weil diese Nachricht die Grenze für Schritte erreicht hat. Bitte ihn, weiterzumachen.',
  agent_budget_exceeded: 'Der Assistent hat sein Ausgabenlimit erreicht.',
  agent_budget_conversation: 'Diese Unterhaltung hat ihr Ausgabenlimit erreicht. Starte eine neue Unterhaltung.',
  agent_budget_admin_day: 'Du hast dein Tageslimit für den Assistenten erreicht. Versuch es morgen wieder.',
  agent_budget_admin_month: 'Du hast dein Monatslimit für den Assistenten erreicht.',
  agent_budget_global_day: 'Der Assistent hat sein Tageslimit für alle Admins erreicht. Versuch es morgen wieder.',
  agent_context_full:
    'Diese Unterhaltung ist zu lang, um fortzufahren. Starte eine neue Unterhaltung; der Plan wird übernommen.',
  agent_cap_reached: 'Diese Unterhaltung hat ihre Grenze von {limit} für diese Art von Änderung erreicht.',
  agent_model_refused: 'Bei dieser Anfrage kann der Assistent nicht helfen.',
  agent_output_truncated: 'Die Antwort wurde abgeschnitten, weil sie zu lang wurde. Bitte um kleinere Schritte.',
  agent_model_unavailable: 'Der Assistent ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
  agent_conversation_outdated: 'Diese Unterhaltung kann nicht mehr fortgesetzt werden. Starte eine neue; der Plan wird übernommen.',
  agent_nothing_to_continue: 'Es gibt nichts, womit es weitergehen könnte.',

  conversation_not_found: 'Unterhaltung nicht gefunden.',
  plan_not_ready: 'Der Plan ist noch nicht bereit zum Bauen.',
  plan_stale: 'Der Plan hat sich seit der Vorbereitung geändert. Prüf ihn noch einmal.',
  nothing_to_build: 'Der Plan enthält noch nichts zum Bauen.',
  build_too_large: 'Dieser Bau ist zu groß ({steps} Schritte, {creating} neu). Teile ihn in kleinere Teile auf.',
  tool_not_available: 'Der Assistent kann das mit deiner Rolle nicht tun.',
  unknown_reference: 'Das bezieht sich auf etwas, das der Assistent in dieser Unterhaltung nicht nachgeschlagen hat.',
  text_not_allowed: 'Dieser Text enthält Zeichen oder Links, die nicht erlaubt sind.',

  proposal_not_found: 'Vorschlag nicht gefunden.',
  proposal_not_pending: 'Dieser Vorschlag wurde schon bearbeitet.',
  proposal_expired: 'Dieser Vorschlag ist abgelaufen. Bitte den Assistenten, ihn neu vorzubereiten.',
  proposal_token_invalid: 'Diese Bestätigung ist nicht mehr gültig. Lade die Karte neu und versuch es noch einmal.',
  proposal_hash_mismatch:
    'Der Vorschlag hat sich geändert, nachdem er angezeigt wurde. Es wurde nichts getan; sieh dir die neue Karte an.',
  proposal_stale:
    'Seit dem Vorschlag hat sich etwas geändert. Es wurde nichts getan; bitte den Assistenten, ihn neu vorzubereiten.',
  proposal_forbidden: 'Deine Rolle erlaubt diesen Vorschlag nicht mehr.',
  proposal_ack_missing: 'Setz zuerst alle Bestätigungshäkchen.',
  proposal_conflict_executing: 'In dieser Unterhaltung läuft noch ein anderer Vorschlag.',
  undo_unavailable: 'Das lässt sich nicht rückgängig machen.',

  step_failed: 'Ein Schritt ist fehlgeschlagen.',
  agent_build_step_failed:
    'Das Bauen wurde bei einem fehlgeschlagenen Schritt angehalten. Frühere Schritte bleiben erhalten.',
  unknown_outcome:
    'Es ist nicht bekannt, ob dieser Schritt durchgegangen ist. Prüf das, bevor du es noch einmal versuchst.',
  ledger_unavailable: 'Es wurde nichts getan, weil der Assistent es nicht aufzeichnen konnte.',
  agent_harness_error: 'Beim Assistenten ist ein interner Fehler aufgetreten. Es wurde nichts wiederholt.',

  participant_already_enrolled: 'Dieser Spieler ist schon in der Liga.',
  player_not_eligible:
    'Dieser Spieler kann nicht hinzugefügt werden: Das Konto ist gebannt, gesperrt oder ein Testkonto.',
  ruleset_unpublished: 'Dieses Regelwerk hat noch keine veröffentlichte Version. Veröffentliche es zuerst.',
  ban_name_unresolved:
    '{name} konnte keinem Pokémon, keiner Attacke, keinem Item und keiner Fähigkeit zugeordnet werden.',
  forme_expansion_needed: '{name} deckt die anderen Formen nicht ab; banne jede Form einzeln.',
  base_format_unknown: 'Unbekanntes Regel-Preset.',
  shared_type_pct_not_integer: 'Der Prozentwert für gemeinsame Typen muss eine ganze Zahl sein.',
  bo_override_key_unknown: '{key} ist keine Runde dieser Phase.',
  pool_entry_duplicate: '{name} steht mehrfach im Pool.',
  tier_label_mismatch:
    'Die Tier-Bezeichnung {label} passt zu keinem Tier der Liste; Groß- und Kleinschreibung zählt.',
  draft_not_supported_for_format: 'Dieses Ligaformat kann keinen Draft ausführen.',
  created_but_unadministrable:
    'Das Turnier wurde erstellt, aber du bist nicht als Admin eingetragen. Wende dich an einen Site-Admin.',
});
