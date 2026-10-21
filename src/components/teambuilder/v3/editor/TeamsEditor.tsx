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
import { useDraftContext } from '../hooks/useDraftContext';
import type { PokemonSet, TeamImportSource } from '@/types/team';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

/**
 * TeamsEditor — the unified team editor for v3.
 *
 * Layout: 2-column (CenterPane | RightPanel)
 * - CenterPane: TeamGrid (grid view) ↔ SetWorkspace (inline set editor with
 *   SpeciesPicker for empty slots — no separate browser column)
 * - RightPanel: Intel / Validation / AI coaching tabs (+ Scout in plan mode)
 * - Top bar: format/meta picker, New team, save state badges
 * - FAB: Save / Import / Export / Share / Publish
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

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <div className="flex flex-col h-full">
        {/* ── Sticky top bar ──────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-poke-border bg-poke-surface sticky top-0 z-10 shrink-0">
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
              className="w-32 sm:w-44 px-2 py-1 text-xs bg-poke-elevated border border-poke-border rounded-lg text-poke-text-primary placeholder:text-poke-text-muted disabled:opacity-50 focus:border-poke-focus/60 outline-none"
              aria-label={t('editor.teamNameLabel')}
            />
          )}
          {state.mode === 'teambuilder' && !state.locked && (
            <button
              onClick={handleNewTeam}
              className="flex items-center gap-1 px-2 py-1 text-xs text-poke-text-muted hover:text-poke-text-primary border border-poke-border rounded-lg hover:border-poke-blue/40 transition-colors"
              title={t('editor.newTeamTitle')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('editor.newTeam')}
            </button>
          )}
          {state.isDraftLeague && state.draft?.budget != null && (
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono ${
                (state.draft.spent ?? 0) > state.draft.budget
                  ? 'text-red-400 bg-red-400/10'
                  : 'text-poke-text-secondary bg-poke-elevated'
              }`}
              title={t('editor.budgetTitle')}
            >
              {t('editor.budget', {
                remaining: state.draft.budget - (state.draft.spent ?? 0),
                budget: state.draft.budget,
              })}
            </span>
          )}
          {state.locked && (
            <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
              {t('editor.status.locked')}
            </span>
          )}
          {state.saveStatus === 'saving' && (
            <span className="text-xs text-poke-text-muted bg-poke-surface px-2 py-0.5 rounded">
              {t('editor.status.saving')}
            </span>
          )}
          {state.saveStatus === 'saved' && !state.dirty && (
            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
              {t('editor.status.saved')}
            </span>
          )}
          {state.saveStatus === 'error' && (
            <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded">
              {t('editor.status.saveFailed')}
            </span>
          )}
          {state.dirty && !state.locked && state.saveStatus !== 'saving' && (
            <span className="text-xs text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
              {t('editor.status.unsaved')}
            </span>
          )}
          <div className="flex-1" />
          {/* Right panel tabs */}
          <div className="hidden lg:flex gap-1">
            {(
              [
                'intel',
                ...(state.mode === 'plan' && state.matchId ? ['opponent' as const] : []),
                'validation',
                'ai',
              ] as const
            ).map((tab) => (
              <button
                key={tab}
                onClick={() => dispatch({ type: 'SET_RIGHT_PANEL', tab })}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  state.rightPanelTab === tab
                    ? 'bg-poke-blue/20 text-poke-blue'
                    : 'text-poke-text-muted hover:text-poke-text-secondary'
                }`}
              >
                {t(`editor.tabs.${tab}`)}
              </button>
            ))}
          </div>
        </div>

        {/* ── 2-column layout ─────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Center column: TeamGrid ↔ SetWorkspace */}
          <div className="flex-1 overflow-hidden min-w-0">
            {state.workspaceView === 'set' ? (
              <SetWorkspace />
            ) : (
              <div className="overflow-y-auto h-full p-4 pb-20 lg:pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
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

          {/* Right column: Intel / Scout / Validation / AI */}
          <div className="w-[320px] border-l border-poke-border flex-shrink-0 hidden lg:flex lg:flex-col">
            {state.rightPanelTab === 'intel' ? (
              <IntelPanel />
            ) : state.rightPanelTab === 'opponent' ? (
              <div className="overflow-y-auto flex-1 p-3">
                <OpponentPanel />
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 p-3">
                {state.rightPanelTab === 'validation' && (
                  <ValidationPanel
                    validation={state.validation}
                    onJumpToIssue={(issueId) => dispatch({ type: 'JUMP_TO_ISSUE', issueId })}
                  />
                )}
                {state.rightPanelTab === 'ai' && <AiPanel />}
              </div>
            )}
          </div>
        </div>

        {/* ── FAB ─────────────────────────────────────────────────── */}
        {!state.locked && (
          <div className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 flex flex-col gap-2 z-20">
            <button
              onClick={() => setPublishOpen(true)}
              className="w-10 h-10 rounded-full bg-poke-surface border border-poke-border text-poke-text-muted shadow hover:text-poke-text-primary hover:bg-poke-muted transition-colors flex items-center justify-center"
              title={t('editor.fab.publish')}
              aria-label={t('editor.fab.publish')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="w-10 h-10 rounded-full bg-poke-surface border border-poke-border text-poke-text-muted shadow hover:text-poke-text-primary hover:bg-poke-muted transition-colors flex items-center justify-center"
              title={t('editor.fab.share')}
              aria-label={t('editor.fab.share')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <button
              onClick={() => setExportOpen(true)}
              className="w-10 h-10 rounded-full bg-poke-surface border border-poke-border text-poke-text-muted shadow hover:text-poke-text-primary hover:bg-poke-muted transition-colors flex items-center justify-center"
              title={t('editor.fab.export')}
              aria-label={t('editor.fab.export')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="w-10 h-10 rounded-full bg-poke-surface border border-poke-border text-poke-text-muted shadow hover:text-poke-text-primary hover:bg-poke-muted transition-colors flex items-center justify-center"
              title={t('editor.fab.import')}
              aria-label={t('editor.fab.import')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17,8 12,3 7,8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
            <button
              onClick={save}
              disabled={state.saveStatus === 'saving'}
              className="w-12 h-12 rounded-full bg-poke-blue text-poke-on-blue shadow-lg hover:bg-poke-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center relative"
              title={t('editor.fab.save')}
              aria-label={t('editor.fab.save')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17,21 17,13 7,13 7,21" />
                <polyline points="7,3 7,8 15,8" />
              </svg>
              {state.validation && !state.validation.valid && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {state.validation.issues.filter((i) => i.severity === 'error').length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* ── Mobile tab bar (lg hidden) ──────────────────────────── */}
        <MobileTabBar />

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
