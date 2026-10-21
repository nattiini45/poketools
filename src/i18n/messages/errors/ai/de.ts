import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  ai_not_registered_player: 'Du bist nicht als Spieler registriert.',
  ai_analysis_participants_only: 'Nur die Teilnehmer des Spiels oder Admins können die Analyse starten.',
  ai_scouting_participants_only: 'Nur die Teilnehmer des Spiels können das Scouting starten.',

  ai_match_status_invalid:
    'Eine Analyse gibt es nur für abgeschlossene Spiele oder solche, deren Ergebnis noch bestätigt werden muss (aktueller Status: {status}).',
  ai_analysis_completed_only: 'Die Spielanalyse gibt es nur für abgeschlossene Spiele (aktueller Status: {status}).',
  ai_scouting_scheduled_only: 'Scouting gibt es nur für angesetzte Spiele (aktueller Status: {status}).',

  ai_analysis_failed: 'Die Analyse ist fehlgeschlagen – versuch es später noch einmal.',
  ai_report_failed: 'Der Bericht konnte nicht erstellt werden – versuch es später noch einmal.',
  ai_analysis_cache_read_failed:
    'Die gespeicherte Analyse konnte nicht geladen werden – versuch es später noch einmal.',

  ai_model_ids_unknown: 'Unbekannte Modell-ID(s): {ids}',

  ai_coach_format_invalid: 'Ungültiges Format.',
  ai_coach_generation_invalid: 'Ungültige Generation.',
  ai_coach_species_required: 'Das Set braucht ein Pokémon.',
  ai_coach_team_empty: 'Dein Team braucht mindestens ein Pokémon.',
});
