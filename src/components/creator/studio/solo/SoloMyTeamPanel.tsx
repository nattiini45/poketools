'use client';

import { useState, useCallback } from 'react';
import { useCastStudio } from '../CastStudioContext';
import CastTeamStrip from '../CastTeamStrip';
import CastTeamEditor from '../CastTeamEditor';
import TeamPicker from '@/components/teambuilder/TeamPicker';
import TeamImporter from '@/components/teambuilder/TeamImporter';
import type { PokemonSet } from '@/types/team';
import type { TeamValidationResult } from '@/types/team';
import Button from '@/components/ui/Button';
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
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
          {t('solo.loadTeam')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={importerOpen}
          onClick={() => setImporterOpen(!importerOpen)}
          className={importerOpen ? 'bg-tier-1 text-tier-ink' : undefined}
        >
          {t('solo.import')}
        </Button>
        {hasTeam && (
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={editorOpen}
            onClick={() => setEditorOpen(!editorOpen)}
            className={editorOpen ? 'bg-tier-1 text-tier-ink' : undefined}
          >
            {editorOpen ? t('solo.closeEditor') : t('solo.editSets')}
          </Button>
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
        <div className="rounded-poke-lg border border-hairline bg-surface p-4">
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
