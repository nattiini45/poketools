'use client';

import { useReducer, useCallback, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { editorReducer, createInitialState } from './state';
import { EditorContext } from './EditorContext';
import { useTeamSave } from '../hooks/useTeamSave';
import { useTeamValidation } from '../hooks/useTeamValidation';
import { ImportDialog, ExportDialog, ShareDialog, PublishDialog } from './EditorDialogs';
import { TeamCardPrimitive } from '../primitives';
import { SetWorkspace } from '../workspace';
import ValidationPanel from '../validation/ValidationPanel';
import AiPanel from '../ai/AiPanel';
import IntelPanel from '../intel/IntelPanel';
import OpponentPanel from '../intel/OpponentPanel';
import FormatPicker from './FormatPicker';
import MobileTabBar from './MobileTabBar';
import SaveStatusChips from './SaveStatusChips';
import { useDraftContext } from '../hooks/useDraftContext';
import type { PokemonSet, TeamImportSource } from '@/types/team';
import { BookUp, Download, MoreHorizontal, Plus, Save, Share2, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { DropdownContent, DropdownMenu, DropdownTrigger } from '@/components/ui/fluid/dropdown';
import { MenuItem } from '@/components/ui/fluid/menu-item';
import { Tabs, TabsItem } from '@/components/ui/fluid/tabs';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

/**
 * TeamsEditor — the unified team editor for v3.
 *
 * Layout: 2-column (CenterPane | RightPanel)
 * - CenterPane: TeamGrid (grid view) ↔ SetWorkspace (inline set editor with
 *   SpeciesPicker for empty slots — no separate browser column)
 * - RightPanel: a segmented control (Intel / Scout in plan mode / Validate / AI) above the panel it selects
 * - Toolbar: format, team name, New, save state chips, then Import / Export / Share / Publish (one overflow menu
 *   below `xl`) and Save as the primary plate. Below `lg` Save sits in the bottom bar (MobileTabBar).
 *
 * Modes: 'teambuilder' | 'plan' | 'library'
 */

interface TeamsEditorProps {
  mode?: 'teambuilder' | 'plan' | 'library';
  format?: string;
  generation?: number;
  tournamentId?: string | null;
  seasonId?: string | null;
  matchId?: string | null;
  initialPokemon?: PokemonSet[];
  teamId?: string | null;
  teamName?: string;
  locked?: boolean;
  rulesetId?: string | null;
  isDraftLeague?: boolean;
  importSource?: TeamImportSource;
  onSaveSuccess?: () => void;
}

export default function TeamsEditor({
  mode = 'teambuilder',
  format = 'gen9ou',
  generation,
  tournamentId,
  seasonId,
  matchId,
  initialPokemon,
  teamId,
  teamName,
  locked = false,
  rulesetId,
  isDraftLeague,
  importSource,
  onSaveSuccess,
}: TeamsEditorProps) {
  const t = useT(teambuilderMessages);
  const initialState = useMemo(
    () =>
      createInitialState({
        mode,
        format,
        generation,
        tournamentId,
        seasonId,
        matchId,
        teamId,
        teamName,
        locked,
        rulesetId,
        isDraftLeague,
        importSource,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hydratedState = useMemo(() => {
    if (!initialPokemon || initialPokemon.length === 0) return initialState;
    return editorReducer(initialState, {
      type: 'LOAD_TEAM',
      pokemon: initialPokemon,
      teamId: teamId ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [state, dispatch] = useReducer(editorReducer, hydratedState);
  const router = useRouter();

  // ── Save, validation & draft ─────────────────────────────────────────
  const { save } = useTeamSave(state, dispatch, onSaveSuccess);
  useTeamValidation(state, dispatch);
  useDraftContext(state, dispatch);

  // ── New team ──────────────────────────────────────────────────────────
  const handleNewTeam = useCallback(() => {
    if (state.dirty && !window.confirm(t('editor.discardConfirm'))) {
      return;
    }
    if (state.tournamentId) {
      // Tournament teams are 1:1 — new personal teams live on /teambuilder
      router.push('/teambuilder');
      return;
    }
    dispatch({ type: 'CLEAR_TEAM' });
    dispatch({ type: 'SET_META', patch: { teamId: null, importSource: 'manual' } });
  }, [state.dirty, state.tournamentId, router, t]);

  // ── Keyboard shortcuts (global, when not in workspace) ───────────────
  useEffect(() => {
    if (state.workspaceView === 'set') return; // workspace handles its own keys
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const num = Number(e.key);
      if (num >= 1 && num <= 6) {
        // Empty slots open the workspace too — it shows the SpeciesPicker
        dispatch({ type: 'SELECT_SLOT', slot: num - 1 });
        dispatch({ type: 'OPEN_SET_WORKSPACE' });
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [state.workspaceView]);

  // ── Slot click handlers ──────────────────────────────────────────────
  const handleSlotClick = useCallback(
    (index: number) => {
      if (state.locked) return;
      dispatch({ type: 'SELECT_SLOT', slot: index });
      dispatch({ type: 'OPEN_SET_WORKSPACE' });
    },
    [state.locked],
  );

  const handleEmptySlotClick = useCallback(
    (index: number) => {
      if (state.locked) return;
      dispatch({ type: 'SELECT_SLOT', slot: index });
      dispatch({ type: 'OPEN_SET_WORKSPACE' });
    },
    [state.locked],
  );

  // ── Dialog state ──────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const saving = state.saveStatus === 'saving';
  const errorCount =
    state.validation && !state.validation.valid ? state.validation.issues.filter((i) => i.severity === 'error').length : 0;
  const panelTabs: (typeof state.rightPanelTab)[] = [
    'intel',
    ...(state.mode === 'plan' && state.matchId ? (['opponent'] as const) : []),
    'validation',
    'ai',
  ];
  const actions = [
    { id: 'import', icon: Upload, open: () => setImportOpen(true) },
    { id: 'export', icon: Download, open: () => setExportOpen(true) },
    { id: 'share', icon: Share2, open: () => setShareOpen(true) },
    { id: 'publish', icon: BookUp, open: () => setPublishOpen(true) },
  ] as const;

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <div className="flex h-full flex-col">
        {/* ── Toolbar ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 rounded-t-xl border border-hairline bg-surface px-3 py-2 sm:gap-x-3 sm:px-4">
          <FormatPicker
            currentFormat={state.format}
            onSelect={(f) => dispatch({ type: 'SET_FORMAT', format: f })}
            disabled={!!state.rulesetId || state.locked}
          />
          {state.mode !== 'plan' && (
            <input
              type="text"
              value={state.teamName}
              onChange={(e) => dispatch({ type: 'SET_TEAM_NAME', name: e.target.value })}
              placeholder={t('editor.teamNamePlaceholder')}
              maxLength={80}
              disabled={state.locked}
              className="order-last h-9 min-w-0 flex-1 basis-full rounded-lg sm:order-none sm:basis-20 border border-hairline bg-elevated px-3 text-body text-fg placeholder:text-fg-muted disabled:opacity-60 sm:max-w-60 pointer-coarse:h-11 pointer-coarse:text-base"
              aria-label={t('editor.teamNameLabel')}
            />
          )}
          {state.mode === 'teambuilder' && !state.locked && (
            <Button
              variant="secondary"
              onClick={handleNewTeam}
              title={t('editor.newTeamTitle')}
              aria-label={t('editor.newTeamTitle')}
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{t('editor.newTeam')}</span>
            </Button>
          )}
          {state.isDraftLeague && state.draft?.budget != null && (
            <span title={t('editor.budgetTitle')}>
              <SkewChip tone={(state.draft.spent ?? 0) > state.draft.budget ? 'loss' : 'neutral'} className="font-mono">
                {t('editor.budget', {
                  remaining: state.draft.budget - (state.draft.spent ?? 0),
                  budget: state.draft.budget,
                })}
              </SkewChip>
            </span>
          )}
          <SaveStatusChips saveStatus={state.saveStatus} dirty={state.dirty} locked={state.locked} />
          {!state.locked && (
            <div className="ml-auto flex items-center gap-1">
              <div className="hidden items-center gap-1 xl:flex">
                {actions.map(({ id, icon: Icon, open }) => (
                  <Button key={id} variant="ghost" onClick={open} aria-label={t(`editor.fab.${id}`)}>
                    <Icon size={16} aria-hidden="true" />
                    {t(`editor.actions.${id}`)}
                  </Button>
                ))}
              </div>
              <div className="xl:hidden">
                <DropdownMenu>
                  <DropdownTrigger
                    render={
                      <Button variant="ghost" aria-label={t('editor.moreActions')} className="pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                        <MoreHorizontal size={18} aria-hidden="true" />
                      </Button>
                    }
                  />
                  <DropdownContent align="end">
                    {actions.map(({ id, icon, open }, i) => (
                      <MenuItem key={id} index={i} icon={icon} label={t(`editor.fab.${id}`)} onSelect={open} />
                    ))}
                  </DropdownContent>
                </DropdownMenu>
              </div>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                aria-label={t('editor.fab.save')}
                className="ml-2 hidden disabled:cursor-not-allowed disabled:opacity-60 lg:inline-flex"
              >
                <SkewPlate variant="button" className="px-4 py-2 text-body">
                  <span className="inline-flex items-center gap-2">
                    <Save size={16} aria-hidden="true" />
                    {t('editor.save')}
                    {errorCount > 0 && (
                      <span className="rounded-full bg-loss-bg px-1.5 font-mono text-caption text-loss" title={t('editor.saveErrors', { count: errorCount })}>
                        {errorCount}
                      </span>
                    )}
                  </span>
                </SkewPlate>
              </button>
            </div>
          )}
        </div>

        {/* ── 2-column layout ─────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden rounded-b-xl border-x border-b border-hairline">
          {/* Center column: TeamGrid ↔ SetWorkspace */}
          <div className="min-w-0 flex-1 overflow-hidden">
            {state.workspaceView === 'set' ? (
              <SetWorkspace />
            ) : (
              <div className="h-full overflow-y-auto p-3 pb-24 sm:p-4 lg:pb-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {state.team.map((set, i) => (
                    <TeamCardPrimitive
                      key={i}
                      set={set}
                      index={i}
                      onClick={() => {
                        if (set) {
                          handleSlotClick(i);
                        } else {
                          handleEmptySlotClick(i);
                        }
                      }}
                      issues={state.validation?.issues.filter((iss) => iss.pokemon_index === i)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column: one segmented control, then the panel it selects */}
          <div className="hidden w-[340px] shrink-0 border-l border-hairline bg-surface lg:flex lg:flex-col">
            <div className="flex shrink-0 border-b border-hairline px-3 py-2">
              <Tabs
                className="rounded-[10px] bg-sunken"
                size="compact"
                selectedIndex={Math.max(0, panelTabs.indexOf(state.rightPanelTab))}
                onSelect={(i) => dispatch({ type: 'SET_RIGHT_PANEL', tab: panelTabs[i] })}
                idPrefix="teambuilder-panel"
                aria-label={t('editor.panelLabel')}
              >
                {panelTabs.map((tab, i) => (
                  <TabsItem key={tab} index={i} label={t(`editor.tabs.${tab}`)} />
                ))}
              </Tabs>
            </div>
            {state.rightPanelTab === 'intel' ? (
              <IntelPanel />
            ) : state.rightPanelTab === 'opponent' ? (
              <div className="flex-1 overflow-y-auto p-3">
                <OpponentPanel />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3">
                {state.rightPanelTab === 'validation' && (
                  <ValidationPanel
                    validation={state.validation}
                    seasonId={state.seasonId}
                    onJumpToIssue={(issueId) => dispatch({ type: 'JUMP_TO_ISSUE', issueId })}
                  />
                )}
                {state.rightPanelTab === 'ai' && <AiPanel />}
              </div>
            )}
          </div>
        </div>

        {/* ── Mobile bar (lg hidden): panel sheets and Save ───────── */}
        <MobileTabBar
          validation={state.validation}
          seasonId={state.seasonId}
          onJumpToIssue={(issueId) => dispatch({ type: 'JUMP_TO_ISSUE', issueId })}
          onSave={state.locked ? undefined : save}
          saving={saving}
          errorCount={errorCount}
        />

        {/* ── Dialogs ─────────────────────────────────────────────── */}
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          rulesetId={state.rulesetId}
          onImport={(pokemon, validation) => {
            dispatch({ type: 'LOAD_TEAM', pokemon });
            if (validation) dispatch({ type: 'SET_VALIDATION', result: validation });
          }}
        />
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} team={state.team} />
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          teamId={state.teamId}
        />
        <PublishDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          teamId={state.teamId}
        />
      </div>
    </EditorContext.Provider>
  );
}
