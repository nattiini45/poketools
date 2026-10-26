'use client';

import { useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useT } from '@/i18n/client';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { GENERATIONS, PRESET_FAMILIES } from '@/lib/pkmn/format-catalog';
import { filterRulesetPresets, groupRulesetPresets, type PresetFamily, type PresetSource, type RulesetPresetEntry } from '@/lib/format-kit/client';
import { cn } from '@/lib/utils/cn';

interface PresetBrowserProps {
  open: boolean;
  onClose: () => void;
  /** The preset the ruleset uses now, if any (marked "Current"). */
  currentId: string | null;
  /** The viewer chose a preset. */
  onChoose: (presetId: string) => void;
}

type GameFilter = 'all' | 'singles' | 'doubles';

const CHIP = 'inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus sm:min-h-7';

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(CHIP, pressed ? 'border-poke-accent bg-poke-accent-light text-poke-text-primary' : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:bg-poke-muted')}
    >
      {children}
    </button>
  );
}

/**
 * The catalog of rule presets as a dialog: a search over name, id, tier, generation, family and source, facets for the
 * source, the generation, the family and singles or doubles, and the matching presets grouped under source, generation
 * and family. Choosing a preset hands its id to the caller, which shows what the switch would change before anything is
 * applied. Names ("Gen 9 OU") are the catalog's own and stay English.
 */
export default function PresetBrowser({ open, onClose, currentId, onChoose }: PresetBrowserProps) {
  const t = useT(rulesetStudioSectionsMessages);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<PresetSource | 'all'>('all');
  const [gen, setGen] = useState<number | 'all'>('all');
  const [family, setFamily] = useState<PresetFamily | 'all'>('all');
  const [game, setGame] = useState<GameFilter>('all');
  const searchId = useId();

  const matches = useMemo(
    () =>
      filterRulesetPresets(query).filter(
        (entry) =>
          (source === 'all' || entry.source === source) &&
          (gen === 'all' || entry.gen === gen) &&
          (family === 'all' || entry.family === family) &&
          (game === 'all' || (game === 'doubles') === entry.doubles),
      ),
    [query, source, gen, family, game],
  );
  const groups = useMemo(() => groupRulesetPresets(matches), [matches]);
  const familyLabel = (key: PresetFamily): string => t.dynamic(`presets.family_${key.replace(/-/g, '_')}`);
  const familiesOfSource = PRESET_FAMILIES.filter((candidate) => source === 'all' || candidate.source === source);

  const card = (entry: RulesetPresetEntry) => {
    const current = entry.id === currentId;
    return (
      <li key={entry.id}>
        <button
          type="button"
          onClick={() => onChoose(entry.id)}
          disabled={current}
          className={cn(
            'flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-poke-md border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9',
            current ? 'border-poke-accent bg-poke-accent-light' : 'border-poke-border bg-poke-surface hover:border-poke-border-strong hover:bg-poke-muted',
          )}
        >
          <span className="font-heading text-sm font-semibold text-poke-text-primary">{entry.name}</span>
          <span className="text-xs text-poke-text-secondary">
            {entry.genLabel} · {entry.tierLabel}
          </span>
          {entry.source === 'smogon-draft' && <span className="rounded-full border border-poke-blue/30 bg-poke-blue-light px-2 text-[11px] font-semibold text-poke-blue">{t('presets.draftTag')}</span>}
          {current && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-poke-text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('presets.current')}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t('presets.title')} size="lg">
      <div className="space-y-4">
        <div>
          <label htmlFor={searchId} className="mb-1 block text-sm font-semibold text-poke-text-primary">
            {t('presets.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={t('presets.searchPlaceholder')}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-poke-text-secondary">{t('presets.sourceLegend')}</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip pressed={source === 'all'} onClick={() => { setSource('all'); setFamily('all'); }}>{t('presets.sourceAll')}</Chip>
              <Chip pressed={source === 'showdown'} onClick={() => { setSource('showdown'); setFamily('all'); }}>{t('presets.sourceShowdown')}</Chip>
              <Chip pressed={source === 'smogon-draft'} onClick={() => { setSource('smogon-draft'); setFamily('all'); }}>{t('presets.sourceDraft')}</Chip>
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-poke-text-secondary">{t('presets.gameLegend')}</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip pressed={game === 'all'} onClick={() => setGame('all')}>{t('presets.gameAll')}</Chip>
              <Chip pressed={game === 'singles'} onClick={() => setGame('singles')}>{t('base.singles')}</Chip>
              <Chip pressed={game === 'doubles'} onClick={() => setGame('doubles')}>{t('base.doubles')}</Chip>
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-poke-text-secondary">{t('presets.generation')}</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip pressed={gen === 'all'} onClick={() => setGen('all')}>{t('presets.generationAll')}</Chip>
              {[...GENERATIONS].reverse().map((generation) => (
                <Chip key={generation.num} pressed={gen === generation.num} onClick={() => setGen(generation.num)}>
                  {String(generation.num)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-poke-text-secondary">{t('presets.familyLegend')}</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip pressed={family === 'all'} onClick={() => setFamily('all')}>{t('presets.familyAll')}</Chip>
              {familiesOfSource.map((candidate) => (
                <Chip key={candidate.key} pressed={family === candidate.key} onClick={() => setFamily(candidate.key)}>
                  {familyLabel(candidate.key)}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>

        <p role="status" className="text-xs text-poke-text-secondary">
          {t('presets.results', { count: matches.length })}
        </p>

        <div className="max-h-[45vh] space-y-4 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="rounded-poke-md border border-dashed border-poke-border p-4 text-sm text-poke-text-secondary">{t('presets.none')}</p>
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={`${group.genLabel}, ${familyLabel(group.family)}`}>
                <h3 className="mb-1.5 text-xs font-semibold text-poke-text-secondary">
                  {group.genLabel} · {familyLabel(group.family)}
                </h3>
                <ul className="grid gap-1.5 sm:grid-cols-2">{group.presets.map(card)}</ul>
              </section>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={onClose}>
            {t('presets.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
