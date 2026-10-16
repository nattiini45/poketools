'use client';

import FormatSelector from '@/components/ruleset/FormatSelector';
import type { BaseFormat } from '@/types/ruleset';
import { useCastStudio } from '../CastStudioContext';

/**
 * SoloFormatPicker — wraps FormatSelector for the solo stream layout.
 * Dispatches format changes to the CastStudio context so the session
 * auto-saves and overlays pick up the new format on their next poll.
 */
export default function SoloFormatPicker() {
  const { state, dispatch } = useCastStudio();

  const handleFormatChange = (format: BaseFormat) => {
    const match = format.match(/^gen(\d)/);
    const generation = match ? parseInt(match[1], 10) : 9;
    dispatch({ type: 'set_format', format, generation });
  };

  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-4">
      <FormatSelector value={state.format} onChange={handleFormatChange} />
    </div>
  );
}
