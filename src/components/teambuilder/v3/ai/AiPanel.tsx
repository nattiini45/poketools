'use client';

import { useState } from 'react';
import SlotCoachPanel from './SlotCoachPanel';
import TeamCoachPanel from './TeamCoachPanel';
import AiChatPanel from './AiChatPanel';
import { useEditorContext } from '../editor/EditorContext';
import { useEditorCommands } from '../hooks/useEditorCommands';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

/**
 * AiPanel — hosts the linden_teambuilding agent chat (Assistant) alongside the
 * heuristic Slot/Team coaches (Coach).
 *
 * The chat plugs into the editor through the typed EditorCommandApi seam (via
 * useEditorCommands) — `commandApi.execute / executeBatch / snapshot` let the
 * assistant apply Showdown sets to slots without any editor restructuring.
 */
type AiTab = 'assistant' | 'coach';

export default function AiPanel() {
  const t = useT(teambuilderMessages);
  const { state, dispatch } = useEditorContext();
  const commandApi = useEditorCommands(state, dispatch);
  const [tab, setTab] = useState<AiTab>('assistant');

  const activeSet = state.activeSlot !== null ? state.team[state.activeSlot] : null;

  return (
    <div className="space-y-3">
      {/* Tab switcher — keeps the chat and the heuristic coaches one click apart. */}
      <div className="flex gap-1 rounded-poke-md bg-poke-base/40 p-1 border border-poke-border">
        {(['assistant', 'coach'] as const).map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setTab(tabId)}
            className={`flex-1 rounded-poke-sm px-2 py-1 text-xs font-heading font-semibold capitalize transition-colors ${
              tab === tabId
                ? 'bg-poke-surface text-poke-text-primary shadow-poke-sm'
                : 'text-poke-text-muted hover:text-poke-text-primary'
            }`}
          >
            {t(`ai.tabs.${tabId}`)}
          </button>
        ))}
      </div>

      {tab === 'assistant' ? (
        // key per match (or 'global' for the no-match teambuilder) keeps each
        // match prep's chat its own instance — defense-in-depth alongside the
        // per-match remount of TeamsEditor in MatchPrepClient.
        <AiChatPanel
          key={state.matchId ?? 'global'}
          commandApi={commandApi}
          format={state.format}
          teamId={state.teamId}
          rulesetId={state.rulesetId}
          matchId={state.matchId}
        />
      ) : (
        <>
          <SlotCoachPanel
            set={activeSet}
            team={state.team}
            format={state.format}
            generation={state.generation}
          />
          <div className="border-t border-poke-border" />
          <TeamCoachPanel
            team={state.team}
            format={state.format}
            generation={state.generation}
          />
        </>
      )}
    </div>
  );
}
