'use client';

import StartActionButton from '@/components/studio-shell/library/StartActionButton';
import { useT } from '@/i18n/client';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { forkPresetRequest } from '@/lib/ruleset-studio/editor/api';
import { rulesetEditorHref } from '../hrefs';

interface ForkPresetButtonProps {
  presetId: string;
  /** Start with the preset's documented Smogon tour clauses and bans added (only for a preset that has them). */
  tourOverlay?: boolean;
  /** Show the sentence about what the copy is (off in a long list of cards, where it would repeat). */
  hint?: boolean;
}

/** "Use as a starting point" on a catalog rule preset: a private ruleset based on it, opened in the editor. */
export default function ForkPresetButton({ presetId, tourOverlay = false, hint = true }: ForkPresetButtonProps) {
  const t = useT(rulesetStudioMessages);
  return (
    <StartActionButton
      label={tourOverlay ? t('presets.forkTour') : t('presets.fork')}
      variant={tourOverlay ? 'secondary' : 'primary'}
      hint={tourOverlay || !hint ? undefined : t('presets.forkHint')}
      run={() => forkPresetRequest(presetId, { tourOverlay })}
      editorHref={rulesetEditorHref}
    />
  );
}
