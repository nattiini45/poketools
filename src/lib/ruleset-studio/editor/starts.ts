/**
 * The four ways to start a new ruleset: blank, from a catalog preset (optionally with the Smogon tour extras), by copying
 * a ruleset another admin shared, or by importing a file. Pure and client-safe: this module only decides what each start
 * posts; the requests are in `./api.ts` and the file check in `./import-file.ts`.
 *
 * A preset start needs no name: the preset's own name is used (a ruleset made to be renamed later), so "Gen 9 OU, ready to
 * tweak" is one click. The Smogon tour toggle exists only for the presets that have documented tour extras.
 */
import { getRulesetPreset } from '@/lib/format-kit/client';
import type { Locale } from '@/lib/studio-core/ltext';
import type { CreateRulesetBody } from './api';

export type StartKind = 'blank' | 'preset' | 'fork' | 'import';

/** The starts in the order the dialog offers them. */
export const START_KINDS: readonly StartKind[] = ['blank', 'preset', 'fork', 'import'];

/** Whether "add Smogon tour bans" is offered for a catalog preset id. */
export function offersTourOverlay(presetId: string): boolean {
  return getRulesetPreset(presetId)?.tourOverlay === true;
}

interface PresetStart {
  preset: string;
  /** What the author typed; blank uses the preset's own name. */
  name: string;
  language: Locale;
  /** Applied only when the preset offers it, so a stale toggle after switching the preset sends nothing. */
  tourOverlay: boolean;
}

/**
 * The create body of a preset start, or `null` for an id the catalog does not know. The name is the typed one, else the
 * preset's catalog name; the tour overlay is sent only for a preset that has one.
 */
export function presetStartBody({ preset, name, language, tourOverlay }: PresetStart): CreateRulesetBody | null {
  const entry = getRulesetPreset(preset);
  if (entry === undefined) return null;
  const typed = name.trim();
  return {
    name: typed === '' ? entry.name : typed,
    base_locale: language,
    preset: entry.id,
    ...(tourOverlay && entry.tourOverlay ? { tour_overlay: true } : {}),
  };
}
