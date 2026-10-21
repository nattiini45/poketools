'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import ItemSprite from '@/components/shared/ItemSprite';
import TeamStrip from './TeamStrip';
import SpeciesHeader from './SpeciesHeader';
import SpeciesPicker from './SpeciesPicker';
import ItemPicker from './ItemPicker';
import AbilityPicker from './AbilityPicker';
import NaturePicker from './NaturePicker';
import MoveSection from './MoveSection';
import StatEditor from './StatEditor';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { useEditorContext } from '../editor/EditorContext';
import { useValidationIssueText } from '@/components/teambuilder/LegalityBadge';
import type { PokemonSet, ValidationIssueCode } from '@/types/team';

type JumpSection = 'moves' | 'fields' | 'stats' | 'header';

/** Editor section a validation issue points at, by code (unlisted codes: the species header). */
const SECTION_BY_CODE: Partial<Record<ValidationIssueCode, JumpSection>> = {
  min_moves: 'moves',
  max_moves: 'moves',
  unknown_move: 'moves',
  move_banned: 'moves',
  unknown_item: 'fields',
  item_banned: 'fields',
  eviolite_tier_cap: 'fields',
  unknown_ability: 'fields',
  ability_banned: 'fields',
  ev_total: 'stats',
  ev_stat_cap: 'stats',
};

/** Exported for tests. */
export function jumpSectionFor(code: ValidationIssueCode | undefined): JumpSection {
  return (code && SECTION_BY_CODE[code]) || 'header';
}

const BLANK_SET: Omit<PokemonSet, 'species'> = {
  name: '',
  gender: '',
  item: '',
  ability: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: '',
  level: 100,
  moves: [],
};

/**
 * SetWorkspace — inline Showdown-style set editor.
 *
 * Renders in the center column when workspaceView === 'set'. Empty slots (and
 * "change species") show the full SpeciesPicker with the meta's pick% list.
 * The team strip at the top switches slots without leaving the editor.
 * Keyboard shortcuts: 1–6 select slots, Esc returns to grid view.
 */
export default function SetWorkspace() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();
  const issueText = useValidationIssueText();
  const slot = state.activeSlot;
  const set = slot !== null ? state.team[slot] : null;

  // "Change species" / item-picker toggles — reset when the slot changes (render-time)
  const [changingSpecies, setChangingSpecies] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [trackedSlot, setTrackedSlot] = useState(slot);
  if (slot !== trackedSlot) {
    setTrackedSlot(slot);
    setChangingSpecies(false);
    setItemPickerOpen(false);
  }

  const showPicker = !set?.species || changingSpecies;

  // ── Validation jump: highlight the section the clicked issue refers to ──
  const jumpIssue =
    state.jumpTarget !== null
      ? (state.validation?.issues.find(
          (i) => i.issue_id === state.jumpTarget && i.pokemon_index === slot,
        ) ?? null)
      : null;
  const jumpSection = jumpIssue ? jumpSectionFor(jumpIssue.code) : null;

  const movesRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jumpSection) return;
    const target =
      jumpSection === 'moves'
        ? movesRef.current
        : jumpSection === 'fields'
          ? fieldsRef.current
          : jumpSection === 'stats'
            ? statsRef.current
            : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Auto-clear the highlight after a few seconds (async — lint-safe)
    const timer = setTimeout(() => dispatch({ type: 'CLEAR_JUMP_TARGET' }), 4000);
    return () => clearTimeout(timer);
  }, [jumpSection, state.jumpTarget, dispatch]);

  const flashClass = (section: string) =>
    jumpSection === section
      ? 'ring-2 ring-poke-danger/60 rounded-lg animate-pulse'
      : '';

  // Keyboard: 1-6 to switch slots, Esc to close workspace
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_SET_WORKSPACE' });
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= 6) {
        dispatch({ type: 'SELECT_SLOT', slot: num - 1 });
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [dispatch]);

  const handleSelectSpecies = useCallback(
    (species: string) => {
      if (slot === null || state.locked) return;
      if (set?.species) {
        // Species swap: keep moves/item/spread, clear ability (species-specific)
        dispatch({ type: 'UPDATE_SLOT', slot, patch: { species, ability: '' } });
      } else {
        dispatch({ type: 'SET_SLOT', slot, set: { species, ...BLANK_SET } });
      }
      setChangingSpecies(false);
    },
    [dispatch, slot, set?.species, state.locked],
  );

  if (slot === null) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Team strip — slot switcher */}
      <TeamStrip />

      {showPicker ? (
        <div className="flex-1 overflow-hidden">
          <SpeciesPicker
            onSelect={handleSelectSpecies}
            onCancel={
              set?.species
                ? () => setChangingSpecies(false)
                : () => dispatch({ type: 'CLOSE_SET_WORKSPACE' })
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 max-w-3xl">
            {/* Back to grid */}
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => dispatch({ type: 'CLOSE_SET_WORKSPACE' })}
                className="flex items-center gap-1 text-xs text-poke-text-muted hover:text-poke-text-primary transition-colors"
                aria-label={t('workspace.backToGrid')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15,18 9,12 15,6" />
                </svg>
                {t('workspace.team')}
              </button>
              <span className="text-[10px] text-poke-text-muted/60">
                {t('workspace.slotCrumb', { n: slot + 1 })}
              </span>
            </div>

            {/* Validation-jump issue banner */}
            {jumpIssue && (
              <div
                className={`mb-3 px-3 py-2 rounded-lg border text-xs ${
                  jumpIssue.severity === 'error'
                    ? 'border-poke-danger/50 bg-poke-danger-light/20 text-poke-danger'
                    : 'border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                }`}
                role="alert"
              >
                <span lang={jumpIssue.code ? undefined : 'en'}>{issueText(jumpIssue)}</span>
              </div>
            )}

            {/* Species + types + nickname + level + shiny + tera */}
            <div className={`mb-5 ${flashClass('header')}`}>
              <SpeciesHeader
                slot={slot}
                set={set!}
                onChangeSpecies={() => setChangingSpecies(true)}
              />
            </div>

            {/* Item / Ability / Nature row */}
            <div ref={fieldsRef} className={`grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2 ${flashClass('fields')}`}>
              <div>
                <label className="text-[10px] text-poke-text-muted uppercase tracking-wide mb-1 block">
                  {t('workspace.item')}
                </label>
                <div className="relative">
                  <button
                    onClick={() => {
                      if (!state.locked) setItemPickerOpen((p) => !p);
                    }}
                    disabled={state.locked}
                    className={[
                      'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded border text-left transition-colors pr-6',
                      itemPickerOpen
                        ? 'border-poke-blue/60 bg-poke-blue/10 text-poke-text-primary'
                        : set!.item
                          ? 'bg-poke-surface border-poke-border text-poke-text-primary hover:border-poke-blue/40'
                          : 'border-dashed border-poke-border text-poke-text-muted hover:border-poke-blue/40',
                      state.locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {set!.item ? (
                      <>
                        <ItemSprite item={set!.item} size={18} className="shrink-0" />
                        <span className="truncate">{localizeItem(set!.item, dl)}</span>
                      </>
                    ) : (
                      <span className="opacity-50">{t('workspace.addItem')}</span>
                    )}
                  </button>
                  {set!.item && !state.locked && (
                    <button
                      onClick={() => dispatch({ type: 'UPDATE_SLOT', slot, patch: { item: '' } })}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-poke-text-muted hover:text-poke-danger transition-colors"
                      aria-label={t('workspace.clearItem')}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-poke-text-muted uppercase tracking-wide mb-1 block">
                  {t('workspace.ability')}
                </label>
                <AbilityPicker
                  value={set!.ability ?? ''}
                  species={set!.species}
                  generation={state.generation}
                  onChange={(ability) => dispatch({ type: 'UPDATE_SLOT', slot, patch: { ability } })}
                  disabled={state.locked}
                />
              </div>
              <div>
                <label className="text-[10px] text-poke-text-muted uppercase tracking-wide mb-1 block">
                  {t('workspace.nature')}
                </label>
                <NaturePicker
                  value={set!.nature ?? ''}
                  onChange={(nature) => dispatch({ type: 'UPDATE_SLOT', slot, patch: { nature } })}
                  disabled={state.locked}
                />
              </div>
            </div>

            {/* Item picker panel (full width, like the move picker) */}
            <div className="mb-5">
              {itemPickerOpen && !state.locked && (
                <ItemPicker
                  species={set!.species}
                  currentItem={set!.item ?? ''}
                  onSelect={(item) => {
                    dispatch({ type: 'UPDATE_SLOT', slot, patch: { item } });
                    setItemPickerOpen(false);
                  }}
                  onClose={() => setItemPickerOpen(false)}
                />
              )}
            </div>

            {/* Moves */}
            <div ref={movesRef} className={`mb-5 ${flashClass('moves')}`}>
              <MoveSection slot={slot} set={set!} />
            </div>

            {/* Stats */}
            <div ref={statsRef} className={`mb-5 ${flashClass('stats')}`}>
              <StatEditor slot={slot} set={set!} />
            </div>

            {/* Remove */}
            {!state.locked && (
              <div className="pt-3 border-t border-poke-border">
                <button
                  onClick={() => {
                    dispatch({ type: 'REMOVE_SLOT', slot });
                    dispatch({ type: 'CLOSE_SET_WORKSPACE' });
                  }}
                  className="text-xs text-poke-danger hover:text-poke-danger/80 transition-colors"
                >
                  {t('workspace.removePokemon')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
