import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { uid } from '../../plans/__tests__/fixtures';
import { proposalCardSchema } from '../card';
import { storedStepSchema } from '../steps';
import { ADMIN, CONVERSATION_ID, DEFINITION_ID, SEASON_ID, TOURNAMENT_ID, forbidden, ledgerAction, makeHarness } from './helpers';
import type { StartupChecklist } from '@/lib/tournament/startup-checklist';
import type { StageRefused, StageStaged } from '../types';

const staged = (result: unknown): StageStaged => {
  expect(result).toMatchObject({ status: 'staged' });
  return result as StageStaged;
};
const refused = (result: unknown): StageRefused => {
  expect(result).toMatchObject({ status: 'refused' });
  return result as StageRefused;
};

const lastRow = (h: ReturnType<typeof makeHarness>) => {
  const row = h.store.proposals[h.store.proposals.length - 1];
  return { row, step: storedStepSchema.array().parse(row.steps)[0], card: proposalCardSchema.parse(row.preview) };
};

describe('Go-live cards: one exact call each, derived from live state', () => {
  describe('propose_publish_ruleset', () => {
    const args = { ruleset_id: DEFINITION_ID, draft_rev: 3 };

    it('stages the publish with its body, fingerprints, acknowledgements and an irreversible card', async () => {
      const h = makeHarness();
      h.store.see(CONVERSATION_ID, DEFINITION_ID);
      const result = staged(await h.stage('propose_publish_ruleset', args));
      expect(result.kind).toBe('action');
      expect(result.class).toBe('G');

      const { row, step, card } = lastRow(h);
      expect(row).toMatchObject({ kind: 'action', class: 'G', plan_id: null, supersede_key: `propose_publish_ruleset:${DEFINITION_ID}` });
      // 15 minutes, the Go-live TTL.
      expect(new Date(row.expires_at).getTime() - new Date('2026-10-27T12:00:00.000Z').getTime()).toBe(15 * 60_000);
      expect(step).toMatchObject({
        op: 'publish_ruleset',
        class: 'G',
        method: 'POST',
        route_template: '/api/ruleset-definitions/[id]/publish',
        path_params: { id: DEFINITION_ID },
        body_template: { draft_rev: 3 },
        verify: 'ruleset_version_exists',
      });
      expect(step.preconditions.map((p) => [p.read, p.fingerprint !== null])).toEqual([['ruleset_draft', true]]);
      // A private ruleset: only the immutable-version group; a shared one would also list "selectable by other admins".
      expect(row.acks_required).toEqual(['immutable_version']);
      expect(card.acks).toEqual([{ id: 'immutable_version', kind: 'checkbox', effect: 'immutable_version' }]);
      expect(card.outwardEffects).toEqual([{ key: 'immutable_version', channels: { kind: 'none' } }]);
      expect(card.reversibility).toEqual({ kind: 'irreversible', reason: 'immutable_version' });
      expect(card).toMatchObject({ kind: 'go_live', class: 'G', tool: 'propose_publish_ruleset', plan: null, existingEntity: true });
    });

    it('lists the shared-ruleset effect only when the ruleset is shared, and keeps the changelog as storable text', async () => {
      const h = makeHarness({ conversation: { ui_locale: 'de' }, source: { draft: { visibility: 'league' } } });
      h.store.see(CONVERSATION_ID, DEFINITION_ID);
      staged(await h.stage('propose_publish_ruleset', { ...args, changelog_text: 'Kingambit gebannt' }));
      const { row, step } = lastRow(h);
      expect(row.acks_required).toEqual(['immutable_version', 'shared_selectable']);
      expect(step.body_template).toEqual({ draft_rev: 3, changelog: { base: 'de', de: { v: 'Kingambit gebannt', s: 'human' } } });
    });

    it('refuses a stale draft revision, error diagnostics and a draft that does not exist', async () => {
      const stale = makeHarness({ source: { draft: { draftRev: 5 } } });
      stale.store.see(CONVERSATION_ID, DEFINITION_ID);
      expect(refused(await stale.stage('propose_publish_ruleset', args))).toMatchObject({ code: 'ruleset_stale_revision', params: { revision: 5 } });

      const invalid = makeHarness({ source: { draft: { errorDiagnostics: 2 } } });
      invalid.store.see(CONVERSATION_ID, DEFINITION_ID);
      expect(refused(await invalid.stage('propose_publish_ruleset', args))).toMatchObject({ code: 'ruleset_document_invalid', params: { count: 2 } });

      const none = makeHarness({ source: { draft: null } });
      none.store.see(CONVERSATION_ID, DEFINITION_ID);
      expect(refused(await none.stage('propose_publish_ruleset', args)).code).toBe('ruleset_not_found');
      expect(stale.store.proposals.length + invalid.store.proposals.length + none.store.proposals.length).toBe(0);
    });

    it('checks provenance BEFORE any guard, so a guard cannot be used to probe ids', async () => {
      const h = makeHarness();
      const result = refused(await h.stage('propose_publish_ruleset', args));
      expect(result).toMatchObject({ code: 'unknown_reference', params: { count: 1, id: DEFINITION_ID } });
      expect(h.guards).toEqual([]);
    });

    it('runs the real guard (owner or league admin of the ruleset) and passes its refusal through', async () => {
      const h = makeHarness({ refuseGuard: { rulesetOwner: forbidden('forbidden') } });
      h.store.see(CONVERSATION_ID, DEFINITION_ID);
      expect(refused(await h.stage('propose_publish_ruleset', args)).code).toBe('forbidden');
      expect(h.guards).toEqual([{ kind: 'rulesetOwner', id: DEFINITION_ID, versionId: undefined }]);
    });

    it('refuses model-authored hidden characters, links and markdown in the changelog (text_not_allowed)', async () => {
      for (const changelog_text of ['fixed ‮it', 'see https://evil.example/x', '[docs](https://evil.example)', 'bad \u0007 bell']) {
        const h = makeHarness();
        h.store.see(CONVERSATION_ID, DEFINITION_ID);
        const result = refused(await h.stage('propose_publish_ruleset', { ...args, changelog_text }));
        expect(result).toMatchObject({ code: 'text_not_allowed', params: { path: '/changelog_text' } });
        expect(h.store.proposals).toHaveLength(0);
      }
    });

    it('says whether the ruleset was created in this chat from the ledger', async () => {
      const h = makeHarness();
      h.store.see(CONVERSATION_ID, DEFINITION_ID);
      h.store.actions.push(ledgerAction({ entity_id: DEFINITION_ID, entity_type: 'ruleset', tool_name: 'ruleset_create_draft' }));
      staged(await h.stage('propose_publish_ruleset', args));
      expect(lastRow(h).card.existingEntity).toBe(false);
    });
  });

  describe('propose_move_pin', () => {
    const targets = [
      { kind: 'season' as const, id: SEASON_ID },
      { kind: 'tournament' as const, id: TOURNAMENT_ID },
    ];
    const args = { ruleset_id: DEFINITION_ID, to_version_no: 3, targets };
    const seeAll = (h: ReturnType<typeof makeHarness>) => h.store.see(CONVERSATION_ID, DEFINITION_ID, SEASON_ID, TOURNAMENT_ID);

    it('guards every target, reads the impact and puts the started targets into confirm_started', async () => {
      const h = makeHarness({
        source: {
          targets: (list) =>
            list.map((t) => ({ kind: t.kind, id: t.id, name: t.kind === 'season' ? 'Gen 9 OU League' : 'Regular season', started: t.kind === 'season', completed: false, pinnedVersionId: uid(9100), pinnedDefinitionId: DEFINITION_ID })),
          impact: { checked: 40, wouldBreak: 7, truncated: false },
        },
      });
      seeAll(h);
      staged(await h.stage('propose_move_pin', args));
      expect(h.guards.map((g) => [g.kind, g.id])).toEqual([
        ['rulesetViewer', DEFINITION_ID],
        ['season', SEASON_ID],
        ['tournament', TOURNAMENT_ID],
      ]);
      const { row, step, card } = lastRow(h);
      expect(step.body_template).toEqual({ to_version_no: 3, targets, confirm_started: [SEASON_ID] });
      expect(step.route_template).toBe('/api/ruleset-definitions/[id]/pins');
      expect(step.preconditions[0].read).toBe('pin_state');
      expect(row.acks_required).toEqual(['live_rules_change']);
      expect(card.steps[0].lines.map((l) => l.kind)).toEqual(['ruleset_changes_live_rules', 'pin_impact', 'pin_started_targets']);
      expect(card.steps[0].lines[1].params).toEqual({ would_break: 7, checked: 40, truncated: false });
      expect(card.steps[0].items.map((i) => [i.entity, i.name?.text])).toEqual([
        ['league', 'Gen 9 OU League'],
        ['phase', 'Regular season'],
      ]);
      expect(card.reversibility).toEqual({ kind: 'irreversible', reason: 'changes_live_rules' });
    });

    it('does not send confirm_started when no target has started', async () => {
      const h = makeHarness();
      seeAll(h);
      staged(await h.stage('propose_move_pin', args));
      expect(lastRow(h).step.body_template).toEqual({ to_version_no: 3, targets });
    });

    it('refuses a finished target, a target that pins another ruleset and a version that does not exist', async () => {
      const done = makeHarness({ source: { targets: (l) => l.map((t) => ({ kind: t.kind, id: t.id, name: 'x', started: true, completed: true, pinnedVersionId: null, pinnedDefinitionId: DEFINITION_ID })) } });
      seeAll(done);
      expect(refused(await done.stage('propose_move_pin', args)).code).toBe('ruleset_pin_locked');

      const other = makeHarness({ source: { targets: (l) => l.map((t) => ({ kind: t.kind, id: t.id, name: 'x', started: false, completed: false, pinnedVersionId: null, pinnedDefinitionId: uid(9999) })) } });
      seeAll(other);
      expect(refused(await other.stage('propose_move_pin', args)).code).toBe('ruleset_pin_mismatch');

      const missing = makeHarness({ source: { versionExists: false } });
      seeAll(missing);
      expect(refused(await missing.stage('propose_move_pin', args)).code).toBe('ruleset_not_found');
    });

    it('answers the shared pin-impact rate limit as rate_limited', async () => {
      const h = makeHarness();
      seeAll(h);
      h.deps.source.pinImpact = async () => {
        throw forbidden('rate_limited', 429);
      };
      expect(refused(await h.stage('propose_move_pin', args)).code).toBe('rate_limited');
    });

    it('refuses a target the admin has never seen, and one the admin does not administer', async () => {
      const unseen = makeHarness();
      unseen.store.see(CONVERSATION_ID, DEFINITION_ID, SEASON_ID);
      expect(refused(await unseen.stage('propose_move_pin', args)).code).toBe('unknown_reference');
      const nope = makeHarness({ refuseGuard: { tournament: forbidden('forbidden') } });
      seeAll(nope);
      expect(refused(await nope.stage('propose_move_pin', args)).code).toBe('forbidden');
    });
  });

  describe('propose_start_phase and propose_generate_bracket', () => {
    const args = { tournament_id: TOURNAMENT_ID };
    const seeIt = (h: ReturnType<typeof makeHarness>) => h.store.see(CONVERSATION_ID, TOURNAMENT_ID);

    it('stages the first round with one acknowledgement per effect group and the typed league name', async () => {
      const h = makeHarness();
      seeIt(h);
      staged(await h.stage('propose_start_phase', { ...args, start_round: true }));
      const { row, step, card } = lastRow(h);
      expect(step).toMatchObject({ op: 'start_phase', route_template: '/api/generate-round/[tid]', path_params: { tid: TOURNAMENT_ID }, body_template: { start_round: true } });
      expect(step.preconditions.map((p) => p.read)).toEqual(['phase_start_state', 'startup_checklist', 'channel_set']);
      expect(row.acks_required).toEqual(['round_generated', 'tournament_started', 'league_active', 'ai_forecast', 'typed_name']);
      expect(card.acks.at(-1)).toEqual({ id: 'typed_name', kind: 'typed_name', of: 'league', expected: { text: 'Gen 9 OU League', hidden: 0 } });
      // A non-recipient-aware source: the posting groups say the app cannot tell which channels.
      expect(card.outwardEffects.map((e) => [e.key, e.channels.kind])).toEqual([
        ['round_generated', 'unknown'],
        ['tournament_started', 'unknown'],
        ['league_active', 'none'],
        ['ai_forecast', 'none'],
      ]);
      expect(card.steps[0].lines.map((l) => l.kind)).toEqual(['locks_after_start']);
      expect(card.reversibility).toEqual({ kind: 'irreversible', reason: 'started' });
      expect(card.existingEntity).toBe(true);
    });

    it('does not send start_round unless asked, and counts matching channels for a site admin only', async () => {
      const recipients = async () => ({ discord: { count: 2, names: ['#league-news'] }, social: { count: 1, names: ['@league'] } });
      const site = makeHarness({ source: { recipients } });
      seeIt(site);
      staged(await site.stage('propose_start_phase', args));
      expect(lastRow(site).step.body_template).toEqual({});
      expect(lastRow(site).card.outwardEffects[0].channels).toEqual({
        kind: 'counted',
        discord: 2,
        social: 1,
        names: [
          { text: '#league-news', hidden: 0 },
          { text: '@league', hidden: 0 },
        ],
      });

      // A league admin sees no channel names, even when the matchers could answer.
      const scoped = makeHarness({ admin: { isSiteAdmin: false }, conversation: { tool_set: 'scoped' }, source: { recipients } });
      seeIt(scoped);
      staged(await scoped.stage('propose_start_phase', args));
      expect(lastRow(scoped).card.outwardEffects[0].channels).toEqual({ kind: 'unknown' });
    });

    it('compares the typed name with the stored name minus hidden characters, so it can always be typed', async () => {
      const h = makeHarness({ source: { phase: { seasonName: 'Spring‮ Cup​' } } });
      seeIt(h);
      staged(await h.stage('propose_start_phase', args));
      expect(lastRow(h).card.acks.at(-1)?.expected).toEqual({ text: 'Spring Cup', hidden: 2 });
    });

    it('refuses what the routes would: a round that exists, a custom league without a format', async () => {
      const written = makeHarness({ source: { phase: { roundCount: 1 } } });
      seeIt(written);
      expect(refused(await written.stage('propose_start_phase', args))).toMatchObject({ code: 'rounds_round_already_written' });

      const custom = makeHarness({ source: { phase: { seasonFormatType: 'custom', formatAttached: false, bracketType: 'single_elim' } } });
      seeIt(custom);
      expect(refused(await custom.stage('propose_generate_bracket', args)).code).toBe('format_not_attached');

      const attached = makeHarness({ source: { phase: { seasonFormatType: 'custom', formatAttached: true, bracketType: 'single_elim' } } });
      seeIt(attached);
      staged(await attached.stage('propose_generate_bracket', args));

      // The full bracket exists only for elimination formats.
      const robin = makeHarness();
      seeIt(robin);
      expect(refused(await robin.stage('propose_generate_bracket', args)).code).toBe('bracket_generate_elim_only');
      expect(robin.store.proposals).toHaveLength(0);
    });

    it('fails closed when the app cannot fingerprint the startup checklist or the channel set', async () => {
      for (const read of ['startup_checklist', 'channel_set']) {
        const h = makeHarness();
        seeIt(h);
        h.world.unavailable.add(read);
        expect(refused(await h.stage('propose_start_phase', args)).code).toBe('tool_not_available');
        expect(h.store.proposals).toHaveLength(0);
      }
    });

    it('fingerprints the channels of the card\'s own posting events: a start names two, a bracket one', async () => {
      const start = makeHarness();
      seeIt(start);
      staged(await start.stage('propose_start_phase', args));
      const bracket = makeHarness({ source: { phase: { bracketType: 'single_elim' } } });
      seeIt(bracket);
      staged(await bracket.stage('propose_generate_bracket', args));
      const channelTarget = (h: ReturnType<typeof makeHarness>) => lastRow(h).step.preconditions.find((p) => p.read === 'channel_set')?.target;
      expect(channelTarget(start)).toEqual({ kind: 'params', params: { tournament_id: TOURNAMENT_ID, events: ['round_generated', 'tournament_started'] } });
      expect(channelTarget(bracket)).toEqual({ kind: 'params', params: { tournament_id: TOURNAMENT_ID, events: ['round_generated'] } });
      expect(lastRow(start).step.preconditions.find((p) => p.read === 'startup_checklist')?.target).toEqual({ kind: 'id', id: TOURNAMENT_ID });
    });

    it('refuses a start the checklist blocks, with every blocked item as a finding, and writes nothing', async () => {
      const blocked: StartupChecklist = {
        blocked: true,
        roundRobin: null,
        items: [
          { id: 'participants', state: 'blocked', params: { count: 1, min: 2 } },
          { id: 'ruleset', state: 'done', params: {} },
          { id: 'groups', state: 'blocked', params: { count: 3 } },
        ],
      };
      for (const tool of ['propose_start_phase', 'propose_generate_bracket']) {
        const h = makeHarness({ source: { startup: blocked, phase: { bracketType: 'single_elim' } } });
        seeIt(h);
        const result = refused(await h.stage(tool, args));
        expect(result).toMatchObject({ code: 'startup_not_ready', params: { blocked: 2 } });
        expect(result.findings).toEqual([
          { code: 'tournament_participants_too_few', section: 'participants', params: { count: 1, min: 2 } },
          { code: 'startup_groups_unplaced', section: 'groups', params: { count: 3 } },
        ]);
        expect(h.store.proposals).toHaveLength(0);
      }
    });

    it('lists an unseeded roster on the card as a warning without blocking', async () => {
      const attention = { blocked: false, roundRobin: null, items: [{ id: 'seeding' as const, state: 'attention' as const, params: { unseeded: 5, count: 8 } }] };
      const h = makeHarness({ source: { startup: attention, phase: { bracketType: 'single_elim' } } });
      seeIt(h);
      staged(await h.stage('propose_generate_bracket', args));
      expect(lastRow(h).card.warnings).toEqual([{ kind: 'startup_unseeded', params: { unseeded: 5, count: 8 } }]);
      const none = makeHarness({ source: { phase: { bracketType: 'single_elim' } } });
      seeIt(none);
      staged(await none.stage('propose_generate_bracket', args));
      expect(lastRow(none).card.warnings).toEqual([]);
    });

    it('checks the rounds and the format before the checklist, and a phase that vanished is forbidden', async () => {
      const blocked = { blocked: true, roundRobin: null, items: [{ id: 'participants' as const, state: 'blocked' as const, params: { count: 0, min: 2 } }] };
      const written = makeHarness({ source: { phase: { roundCount: 1 }, startup: blocked } });
      seeIt(written);
      expect(refused(await written.stage('propose_start_phase', args)).code).toBe('rounds_round_already_written');
      const gone = makeHarness({ source: { startup: null } });
      seeIt(gone);
      expect(refused(await gone.stage('propose_start_phase', args)).code).toBe('forbidden');
    });

    it('stages the bracket with its own route and no typed name', async () => {
      const h = makeHarness({ source: { phase: { bracketType: 'single_elim' } } });
      seeIt(h);
      staged(await h.stage('propose_generate_bracket', args));
      const { row, step } = lastRow(h);
      expect(step).toMatchObject({ op: 'generate_bracket', route_template: '/api/tournaments/[id]/generate-bracket', path_params: { id: TOURNAMENT_ID }, body_template: {} });
      expect(row.acks_required).toEqual(['round_generated', 'enrollment_frozen']);
    });
  });

  describe('one Go-live card per assistant turn', () => {
    it('refuses a second Go-live proposal in the same turn, and allows it in the next', async () => {
      const h = makeHarness({ source: { phase: { bracketType: 'single_elim' } } });
      h.store.see(CONVERSATION_ID, TOURNAMENT_ID, DEFINITION_ID);
      staged(await h.stage('propose_generate_bracket', { tournament_id: TOURNAMENT_ID }));
      const second = refused(await h.stage('propose_publish_ruleset', { ruleset_id: DEFINITION_ID, draft_rev: 3 }));
      expect(second).toMatchObject({ code: 'agent_cap_reached', params: { limit: 1 } });
      h.turn.goLive = 0;
      h.turn.stagings = 0;
      staged(await h.stage('propose_publish_ruleset', { ruleset_id: DEFINITION_ID, draft_rev: 3 }));
    });

    it('answers phase_disabled for the Go-live tools this module does not stage yet', async () => {
      const h = makeHarness();
      h.store.see(CONVERSATION_ID, TOURNAMENT_ID);
      for (const [tool, args] of [
        ['propose_generate_round', { tournament_id: TOURNAMENT_ID }],
        ['propose_advance_phase', { league_id: SEASON_ID }],
      ] as const) {
        expect(refused(await h.stage(tool, args)).code).toBe('phase_disabled');
      }
      expect(ADMIN).toBeTruthy();
    });
  });
});
