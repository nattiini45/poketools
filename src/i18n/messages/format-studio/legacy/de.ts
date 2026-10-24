import { defineDe } from '@/i18n/define';
import type en from './en';

/**
 * German for `format-studio/legacy`. New copy without a native review: neutral statements, the glossary of
 * `docs/i18n.md` (Phase, Spieltag, Stufe, Kill-Differenz, Redraft); the plural objects follow the English ones.
 */
export default defineDe<typeof en>()({
  stage: {
    fallback: 'Phase {n}',
  },
  season: {
    fallback: 'Liga',
  },
  facts: {
    core_pool_size: 'Cores im Pool',
    cores_assigned: 'Spieler mit zugewiesenem Core',
    gym_types_assigned: 'Spieler mit Arena-Typ',
    roster_size: 'Spieler in der Liga',
    tier_limit_s: 'Pick-Limit für Tier S',
    tier_limit_a: 'Pick-Limit für Tier A',
    tier_limit_b: 'Pick-Limit für Tier B',
    tier_limit_c: 'Pick-Limit für Tier C',
    match_points_win: 'Matchpunkte pro Sieg',
    match_points_win_round_robin: 'Matchpunkte pro Sieg in Rundentabellen (der gespeicherte Wert oben weicht ab)',
    tiebreak_match_points: 'Rang der Matchpunkte im Tiebreak',
    tiebreak_kill_difference: 'Rang der KO-Differenz im Tiebreak',
    tiebreak_evolution_points: 'Rang der Evolutionspunkte im Tiebreak',
    tiebreak_head_to_head: 'Rang des direkten Vergleichs im Tiebreak',
    tiebreak_decision_match: 'Rang des Entscheidungsspiels im Tiebreak',
    tera_stage1: 'Terakristallisieren für Pokémon der Stufe 1',
    tera_stage2: 'Terakristallisieren für Pokémon der Stufe 2',
    tera_stage3: 'Terakristallisieren für Pokémon der Stufe 3',
    draft_budget: 'Draft-Budget',
    draft_picks: 'Draft-Picks',
    draft_token_ratio: 'Draft-Token-Verhältnis',
    draft_token_max: 'Draft-Token pro Spieler (Maximum)',
    draft_token_max_per_line: 'Draft-Token pro Linie (Maximum)',
    redraft_open: 'Redraft-Phase offen',
    banned_moves: 'Gebannte Attacken',
    banned_items: 'Gebannte Items',
    stage_lock_enabled: 'Frühe Sperre der Endstufe',
    stage_lock_stage: 'Stufe, auf die die Sperre wirkt',
    stage_lock_by_matchday: 'Sperre gilt bis zum Spieltag',
    stage_lock_suspend_matchdays: 'Spieltage, die ein gesperrter Spieler aussetzt',
    participation_per_matchday: 'Teilnahmepunkte pro Spieltag',
    participation_until_stage: 'Teilnahmepunkte bis Stufe',
    comeback_earn_window: 'Comeback-Token werden verdient über',
  },
  override: {
    title: 'Spiellängen in {stage}',
    line: '{round} wird im Best-of-{best_of}-Modus gespielt.',
  },
  advancement: {
    unused_title: 'Weiterkommen von {stage}',
    unused: 'Die Weiterkommens-Regel von {stage} lässt {rule} weiterkommen, aber keine spätere Phase übernimmt Spieler daraus.',
    rule_top_n: {
      one: 'den Besten insgesamt',
      other: 'die besten {count} insgesamt',
    },
    rule_per_group: {
      one: 'den Besten jeder Gruppe',
      other: 'die besten {count} jeder Gruppe',
    },
  },
});
