'use client';

import { useState, useCallback } from 'react';
import { useCastStudio } from '../CastStudioContext';
import CastTeamStrip from '../CastTeamStrip';
import CastTeamEditor from '../CastTeamEditor';
import TeamPicker from '@/components/teambuilder/TeamPicker';
import TeamImporter from '@/components/teambuilder/TeamImporter';
import type { PokemonSet } from '@/types/team';
import type { TeamValidationResult } from '@/types/team';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';

/**
 * SoloMyTeamPanel — team loading, display, and inline editing for the
 * streamer's own team. Composes TeamPicker (saved teams), TeamImporter
 * (Showdown paste / pokepast.es), CastTeamStrip (display), and
 * CastTeamEditor (per-slot editing).
 */
export default function SoloMyTeamPanel() {
  const { state, setPlayer1Team } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const handlePickTeam = useCallback((pokemon: PokemonSet[]) => {
    setPlayer1Team(pokemon);
    setPickerOpen(false);
  }, [setPlayer1Team]);

  const handleImport = useCallback((pokemon: PokemonSet[], _validation: TeamValidationResult | null) => {
    setPlayer1Team(pokemon);
    setImporterOpen(false);
  }, [setPlayer1Team]);

  const hasTeam = state.player1Team.some((s) => s.species);
  /** The stored English placeholder 'Me' reads as the localized "My Team"; real names pass through. */
  const player1Name = state.tracker.current_game.player1.player_name;

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPickerOpen(true)}
          className="rounded-poke-md bg-poke-muted px-3 py-1.5 text-xs font-heading font-bold text-poke-text-secondary hover:bg-poke-accent/20 transition-colors"
        >
          {t('solo.loadTeam')}
        </button>
        <button
          onClick={() => setImporterOpen(!importerOpen)}
          className={`rounded-poke-md px-3 py-1.5 text-xs font-heading font-bold transition-colors ${
            importerOpen
              ? 'bg-poke-accent/20 text-poke-accent'
              : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-accent/20'
          }`}
        >
          {t('solo.import')}
        </button>
        {hasTeam && (
          <button
            onClick={() => setEditorOpen(!editorOpen)}
            className={`rounded-poke-md px-3 py-1.5 text-xs font-heading font-bold transition-colors ${
              editorOpen
                ? 'bg-poke-accent/20 text-poke-accent'
                : 'bg-poke-muted text-poke-text-secondary hover:bg-poke-accent/20'
            }`}
          >
            {editorOpen ? t('solo.closeEditor') : t('solo.editSets')}
          </button>
        )}
      </div>

      {/* Team strip */}
      <CastTeamStrip
        team={state.player1Team}
        activeSlot={null}
        facingSlot={null}
        onSlotClick={() => {
          if (hasTeam) setEditorOpen(true);
        }}
        label={!player1Name || soloPlaceholderOf(player1Name) === 'me' ? t('team.myTeam') : player1Name}
      />

      {/* Inline importer (collapsible) */}
      {importerOpen && (
        <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-4">
          <TeamImporter onImport={handleImport} />
        </div>
      )}

      {/* Inline team editor (collapsible) */}
      {editorOpen && hasTeam && <CastTeamEditor player={1} />}

      {/* Team picker modal */}
      <TeamPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickTeam}
      />
    </div>
  );
}
