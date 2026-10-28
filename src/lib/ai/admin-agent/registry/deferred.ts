/**
 * Tools the plan lists that are registered by name and phase but not built yet (plan 3.6.3, 8). They are NEVER offered to
 * the model: a tool the harness cannot run would only teach the model to call something that fails. Each row says what it
 * waits for, so the next phase knows where to start; when a row's tool is implemented it moves out of this list into the
 * runnable or staged tools (`__tests__/registry.test.ts` fails if a name is in both).
 */
import type { DeferredTool } from './types';

export const DEFERRED_TOOLS: readonly DeferredTool[] = [
  { name: 'start_preview', class: 'P', phase: 1, blockedBy: 'the tool itself: loadStartupInput (src/lib/tournament/startup-checklist.server.ts) and the checklist state exist, but the model-facing preview is not registered yet' },
  { name: 'group_split_preview', class: 'P', phase: 2, blockedBy: 'PR5: plannedGroups lives under src/app/api/seasons/[id]/groups/_lib and must move under src/lib before a lib module may import it' },
  { name: 'format_check', class: 'P', phase: 3, blockedBy: 'phase 3: Format Studio compile with the live ruleset id set' },
  { name: 'format_apply_patch_preview', class: 'P', phase: 3, blockedBy: 'phase 3: Format Studio patch preview' },
  { name: 'format_auto_fix', class: 'P', phase: 3, blockedBy: 'phase 3: Format Studio diagnostic fixes' },
  { name: 'format_schedule_preview', class: 'P', phase: 3, blockedBy: 'phase 3: estimateSchedule over a draft' },
  { name: 'format_attach_preview', class: 'P', phase: 3, blockedBy: 'PR5: previewAttachServer (named rulesets, canUseDefinitions, engine-gap warnings) and its parity test' },
  { name: 'draft_pool_preview', class: 'P', phase: 4, blockedBy: 'PR6: createQueuePool dry run that takes the group' },
  { name: 'draft_entries_preview', class: 'P', phase: 4, blockedBy: 'phase 4: entry dedupe, tier-label match and budget check' },
  { name: 'draft_rules_merge_preview', class: 'P', phase: 4, blockedBy: 'phase 4: GET-merge-PUT of the format rules' },
  { name: 'smogon_fetch', class: 'R', phase: 4, blockedBy: 'phase 4: net-new fetch of www.smogon.com only, size and time capped, content fenced' },
  { name: 'propose_change', class: 'B', phase: 2, blockedBy: 'phase 2: the typed union per entity for edits of existing leagues, phases, tournaments and rosters' },
  { name: 'audit_recent', class: 'R', phase: 5, blockedBy: 'not in v1: listAuditLogEntries returns ip_address, changes and metadata for every actor' },
];
