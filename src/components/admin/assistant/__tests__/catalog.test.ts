import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { adminAssistantCardsMessages } from '@/i18n/messages/admin-assistant-cards';
import { LOOP_EVENTS } from '@/lib/ai/admin-agent/loop/harness';
import { UNDO_REASONS } from '@/lib/ai/admin-agent/plans/undo';
import { CARD_ACTIONS, CARD_LINE_KINDS, type CardLine } from '@/lib/ai/admin-agent/proposals/card';
import { ALL_TOOLS } from '@/lib/ai/admin-agent/registry';
import { OUTWARD } from '@/lib/ai/admin-agent/registry/outward-effects';
import { lineMessage } from '../ProposalCard';
import { toolGroup } from '../tool-group';

const LOCALES: Locale[] = ['en', 'de'];

/** The entities a verb of the catalog (`steps.<action>`) is written for. */
const cardsTree = (cards: { has(key: string): boolean }, action: string): Record<string, true> =>
  Object.fromEntries(['league', 'roster', 'phase', 'groups', 'draft_pool', 'tournament', 'ruleset'].filter((entity) => cards.has(`steps.${action}.${entity}`)).map((entity) => [entity, true as const]));

/**
 * The cards are structured data; every kind, effect, group and event the server can send has to have a sentence in both
 * languages, or the UI would show a bare key. The server side lists (card line kinds, outward effects, tools) are imported
 * from the modules that own them, so a new entry there fails here until its text is written.
 */
describe.each(LOCALES)('the assistant catalogs (%s)', (locale) => {
  const cards = createTranslator(adminAssistantCardsMessages, locale);
  const chrome = createTranslator(adminAssistantMessages, locale);

  it('has a sentence for every card line kind, in each variant the card can pick', () => {
    const variants: CardLine[] = [
      ...CARD_LINE_KINDS.map((kind): CardLine => ({ kind })),
      { kind: 'pins_ruleset_auto', params: { ruleset: { text: 'pbb', hidden: 0 }, version: 2 } },
      { kind: 'prefilled_from_standings', params: { phase: { text: 'Regular season', hidden: 0 }, count: 4 } },
      { kind: 'prefilled_from_standings', params: { phase: { text: 'Regular season', hidden: 0 }, count: 2, per_group: true } },
      { kind: 'clones_from', params: { copy_roster: true } },
      { kind: 'pin_impact', params: { would_break: 1, checked: 10, truncated: true } },
    ];
    for (const line of variants) {
      const { key } = lineMessage(line);
      expect(cards.has(key), `${line.kind} -> ${key}`).toBe(true);
    }
  });

  it('fills every placeholder of a line from the params the card builders set', () => {
    const text = (value: string) => ({ text: value, hidden: 0 });
    const cases: Array<[CardLine, string[]]> = [
      [{ kind: 'pins_ruleset', params: { ruleset: text('gen9ou'), version: 3 } }, ['gen9ou', '3']],
      [{ kind: 'publishes_ruleset_readable', params: { ruleset: text('gen9ou'), version: 3 } }, ['gen9ou', '3']],
      [{ kind: 'prefilled_from_standings', params: { phase: text('Regular season'), count: 4 } }, ['Regular season', '4']],
      [{ kind: 'pin_impact', params: { would_break: 2, checked: 40, truncated: false } }, ['2', '40']],
      [{ kind: 'pin_started_targets', params: { count: 3 } }, ['3']],
    ];
    for (const [line, expected] of cases) {
      const { key, params } = lineMessage(line);
      const out = cards.dynamic(key, params, '');
      expect(out, key).not.toMatch(/\{\w+\}/);
      for (const part of expected) expect(out, key).toContain(part);
    }
  });

  it('has a sentence for every outward effect the stageable Go-live cards declare', () => {
    for (const op of ['publish_ruleset', 'move_pin', 'start_phase', 'generate_bracket', 'undo']) {
      for (const effect of OUTWARD[op]) expect(cards.has(`effects.keys.${effect.key}`), `${op}/${effect.key}`).toBe(true);
    }
  });

  it('has a verb for every step the Build and Go-live cards can show', () => {
    const steps = [
      ['create', 'league'],
      ['add', 'roster'],
      ['create', 'phase'],
      ['set', 'groups'],
      ['create', 'draft_pool'],
      ['create', 'tournament'],
      ['publish', 'ruleset'],
      ['move_pin', 'ruleset'],
      ['start', 'tournament'],
      ['generate_bracket', 'tournament'],
      // The undo card (slice 5).
      ['archive', 'league'],
      ['archive', 'tournament'],
      ['remove', 'roster'],
      ['restore_draft', 'ruleset'],
      ['delete_draft', 'ruleset'],
    ];
    for (const [action, entity] of steps) expect(cards.has(`steps.${action}.${entity}`), `${action}.${entity}`).toBe(true);
  });

  it('names the reason a card cannot be undone', () => {
    for (const reason of ['immutable_version', 'posted_outward', 'changes_live_rules', 'started', 'compensating']) expect(cards.has(`reversibility.reasons.${reason}`)).toBe(true);
  });

  it('words every reason an undo can give for an entry it does not run, every ledger op it can list, and every card action', () => {
    for (const reason of UNDO_REASONS) expect(cards.has(`undo.reasons.${reason}`), reason).toBe(true);
    for (const op of ['league_create', 'roster_add', 'tournament_create', 'phase_create', 'start_phase', 'generate_bracket', 'move_pin', 'publish_ruleset', 'ruleset_create_draft', 'ruleset_patch_draft']) {
      expect(cards.has(`undo.ops.${op}`), op).toBe(true);
    }
    for (const group of ['leftAlone', 'residue', 'notUndoable']) expect(cards.has(`undo.${group}`), group).toBe(true);
    // Every action a card step can carry has a verb for at least one entity.
    for (const action of CARD_ACTIONS) expect(Object.keys(cardsTree(cards, action)).length, action).toBeGreaterThan(0);
  });

  it('words the result of every final status, the unclear steps, Resume and the links (slice 6)', () => {
    for (const status of ['completed', 'partial', 'failed', 'stale', 'unknown', 'executing']) {
      expect(cards.has(`result.headline.${status}`), `headline ${status}`).toBe(true);
      expect(cards.has(`result.explain.${status}`), `explain ${status}`).toBe(true);
    }
    for (const key of ['result.step.unknown', 'result.step.ambiguous', 'result.step.rosterPartial', 'result.resume.explain', 'result.resume.over', 'result.undoHint', 'result.links.league', 'result.links.tournament', 'result.links.ruleset', 'actions.resume', 'actions.undo']) {
      expect(cards.has(key), key).toBe(true);
    }
    expect(cards('result.step.rosterPartial', { present: 5, count: 12 })).toMatch(/5/);
    expect(cards('result.step.rosterPartial', { present: 5, count: 12 })).toMatch(/12/);
  });

  it('has a status line noun for every group a tool can belong to, and every tool has a group', () => {
    for (const tool of ALL_TOOLS) {
      const group = toolGroup(tool.name);
      expect(chrome.has(`tools.what.${group}`), `${tool.name} -> ${group}`).toBe(true);
    }
    // Only the few tools that belong to no area fall to the plain lookup.
    expect(ALL_TOOLS.filter((tool) => toolGroup(tool.name) === 'lookup').map((tool) => tool.name).sort()).toEqual(['engine_support', 'outward_effects_preview', 'resolve_date', 'whoami']);
  });

  it('words the harness events an admin sees', () => {
    for (const event of Object.values(LOOP_EVENTS).filter((name) => name !== LOOP_EVENTS.stateRefresh)) expect(chrome.has(`events.${event}`), event).toBe(true);
    for (const event of ['proposal_declined', 'proposal_approved', 'proposal_executed', 'undo_requested']) expect(chrome.has(`events.${event}`), event).toBe(true);
  });
});
