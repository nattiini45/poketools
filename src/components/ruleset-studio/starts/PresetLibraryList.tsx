import type { ReactNode } from 'react';
import Badge from '@/components/ui/Badge';
import LibraryCard from '@/components/studio-shell/library/LibraryCard';
import type { LibraryEntry } from '@/components/studio-shell/library/LibraryList';
import ForkPresetButton from './ForkPresetButton';

interface PresetCard {
  entry: LibraryEntry;
  /** The preset has documented Smogon tour extras: a second start button adds them. */
  tourOverlay: boolean;
}

interface PresetLibraryListProps {
  presets: readonly PresetCard[];
  empty: ReactNode;
}

/**
 * The cards of the catalog rule presets on the gallery page: each card opens the read-only preset page, and a client leaf
 * beside it starts a private ruleset from the preset (and, for the draft presets with tour extras, a second one that adds
 * them). Hook-free, so a server page renders it with text it has already translated.
 */
export default function PresetLibraryList({ presets, empty }: PresetLibraryListProps) {
  if (presets.length === 0) return <>{empty}</>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {presets.map(({ entry, tourOverlay }) => (
        <li key={entry.id} className="min-w-0 space-y-2">
          <LibraryCard
            href={entry.href}
            title={entry.title}
            lines={entry.lines}
            badges={entry.badges.map((badge) => (
              <Badge key={badge.label} variant={badge.variant}>
                {badge.label}
              </Badge>
            ))}
            openLabel={entry.openLabel}
          />
          <div className="flex flex-wrap items-start gap-2">
            <ForkPresetButton presetId={entry.id} hint={false} />
            {tourOverlay && <ForkPresetButton presetId={entry.id} tourOverlay hint={false} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
