/**
 * The model-facing entries of D, B and G tools (plan 3.6.4 to 3.6.7): name, description, arguments and the facts the
 * registry invariants check. None has an `execute`.
 *
 *  - D (private reversible write): the Plan tools write the assistant's own tables, the format and ruleset draft tools
 *    dispatch the draft routes. The loop binds them; this file only declares them.
 *  - B (`propose_build`): stages the Build proposal of a ready Plan. The steps are derived by code (`deriveSteps`), never
 *    by the model, and only the approve route runs them.
 *  - G (`propose_*`): stages ONE exact call as a card. The card text is written by server code from the arguments; the
 *    model's description of the action is never shown as the card. Nothing happens until the admin approves.
 *
 * A staged tool's `routes` are the routes its operation dispatches. The route-manifest bindings
 * (`scripts/data/route-manifest-bindings.json`) must agree with them on class (`__tests__/registry.test.ts`).
 */
import { z } from 'zod';
import { rulesetPinImpactSchema, rulesetPublishSchema } from '@/lib/ruleset-studio/api-schemas';
import { PLAN_SLOT_NAMES } from '../plans/schema';
import { defineStaged, type StagedTool } from './define';
import { intArg, textArg, uuidArg } from './atoms';
import { OUTWARD } from './outward-effects';
import { PLAN_PATCH_DESCRIPTION, PLAN_SET_DESCRIPTION } from './plan-shapes';
import type { RouteRef } from './types';

const route = (method: RouteRef['method'], path: string): RouteRef => ({ method, path });

const NOTE_STAGED =
  'This stages a card for the admin to approve; nothing happens until they do. The card text is written by the server from these arguments.';

// ─── D: the Plan (own tables) ────────────────────────────────────────────────

/** The slots of the Plan document, from the one schema that owns them (`plans/schema.ts`). */
export const PLAN_SLOTS = PLAN_SLOT_NAMES;

const planCreate = defineStaged({
  name: 'plan_create',
  class: 'D',
  description:
    'Start the Plan of this conversation: call it as soon as there is something to set up, then fill the slots with plan_set. mode "create" is a new setup; "amend" seeds the Plan from an existing league or tournament (pass entity_kind and entity_id), may answer not available in this version, and never edits that league: changing an existing league needs propose_change, which is not offered before phase 2. title is a working label for the Plan, not the league name (that goes in the league slot). The Plan is a draft the admin can see and edit; it changes no public data.',
  args: z.strictObject({
    mode: z.enum(['create', 'amend']),
    title: textArg('Short title of what is being set up', 120),
    entity_kind: z.enum(['league', 'tournament']).optional(),
    entity_id: uuidArg('Existing league or tournament id').optional(),
  }),
  phase: 0,
  reversal: 'plan_revert',
});

const planSet = defineStaged({
  name: 'plan_set',
  class: 'D',
  description:
    PLAN_SET_DESCRIPTION,
  args: z.strictObject({
    slot: z.enum(PLAN_SLOTS),
    value_json: z.string().min(2).max(20_000).describe('JSON text of the slot value, up to 20,000 characters'),
  }),
  phase: 0,
  reversal: 'plan_revert',
});

const planPatch = defineStaged({
  name: 'plan_patch',
  class: 'D',
  description:
    PLAN_PATCH_DESCRIPTION,
  args: z.strictObject({ ops_json: z.string().min(2).max(20_000).describe('JSON array of patch operations, up to 20,000 characters') }),
  phase: 0,
  reversal: 'plan_revert',
});

const planRevert = defineStaged({
  name: 'plan_revert',
  class: 'D',
  description: 'Restore the previous revision of the Plan (the admin can do the same in the panel). Use it when an edit turned out wrong.',
  args: z.strictObject({}),
  phase: 0,
  reversal: 'plan_revert',
});

const requestClarification = defineStaged({
  name: 'request_clarification',
  class: 'D',
  description:
    'Ask the admin a structured question instead of guessing: a choice, several choices, free text, a date, a player pick or a number. The answer returns as this tool\'s result, so free text cannot pose as an approval. Ask when two readings are possible (for example "next Monday" said on a Monday) or when something needed was not given, even if the admin said not to ask: a missing value is not yours to pick. For choice and multi always pass options, with your likely default as one of them.',
  args: z.strictObject({
    question: textArg('The question', 300),
    kind: z.enum(['choice', 'multi', 'text', 'date', 'player_pick', 'number']),
    options: z
      .array(z.strictObject({ value: textArg('Machine value', 60), label: textArg('Text shown to the admin', 80) }))
      .max(12)
      .optional()
      .describe('For choice and multi: up to 12 options'),
  }),
  phase: 0,
  reversal: 'none',
});

// ─── B: Build ────────────────────────────────────────────────────────────────

/** The live-row routes a Build dispatches (class B in the route-manifest bindings). */
export const BUILD_ROUTES: readonly RouteRef[] = [
  route('POST', '/api/seasons'),
  route('POST', '/api/seasons/[id]/participants'),
  route('DELETE', '/api/seasons/[id]/participants'),
  route('POST', '/api/seasons/[id]/phases'),
  route('POST', '/api/tournaments'),
  route('PATCH', '/api/tournaments/[id]'),
  route('POST', '/api/tournaments/[id]/participants'),
  route('DELETE', '/api/tournaments/[id]/participants'),
  route('PATCH', '/api/tournaments/[id]/participants'),
];

const proposeBuild = defineStaged({
  name: 'propose_build',
  class: 'B',
  description: `Stage the Build for a Plan that is ready: the league or tournament, its roster and its phases, created in a fixed order by the server from the Plan (you do not write the steps). Call plan_validate first. Ready means well-formed, not chosen by the admin: do not call this while the ruleset, bracket, best-of or participants are values only you picked. A league or tournament is public the moment it exists, and the card says so. Build never publishes a ruleset, attaches a format or starts anything: those are separate cards. ${NOTE_STAGED}`,
  args: z.strictObject({ plan_revision: intArg('Revision of the Plan this Build is for', 1, 1_000_000) }),
  phase: 0,
  routes: BUILD_ROUTES,
  reversal: 'Archive the league or tournament created in this conversation and remove the roster rows it added; nothing is hard-deleted',
  verify: 'build_read_back',
});

// ─── D: ruleset drafts (P1) ──────────────────────────────────────────────────

const rulesetCreateDraft = defineStaged({
  name: 'ruleset_create_draft',
  class: 'D',
  description:
    'Create a PRIVATE ruleset draft owned by the admin; it cannot be pinned until it is published. mode "new" needs a name and base_locale (the language the name is written in) and may start from a catalog base_preset, with tour_overlay for the Smogon tour extras; "fork_preset" copies a catalog preset (preset_id); "fork_ruleset" copies a ruleset (source_id). Returns the draft id and its draft_rev. Entries in rulesets are dex ids. The admin owns at most 200 rulesets, and creating shares an hourly limit with the admin pages.',
  args: z
    .strictObject({
      mode: z.enum(['new', 'fork_preset', 'fork_ruleset']),
      name: textArg('Name of the new ruleset (mode new)', 80).optional(),
      base_locale: z.enum(['en', 'de']).optional().describe('Language the name is written in (mode new)'),
      base_preset: textArg('Catalog preset id to start from (mode new)', 60).optional(),
      preset_id: textArg('Catalog preset id to copy (mode fork_preset)', 60).optional(),
      source_id: uuidArg('Ruleset definition id to copy (mode fork_ruleset)').optional(),
      tour_overlay: z.boolean().optional().describe('Add the preset\'s Smogon tour clauses and bans'),
      slug: textArg('Optional slug, lowercase letters, digits and hyphens', 60).optional(),
    })
    .refine((a) => (a.mode === 'new' ? a.name !== undefined && a.base_locale !== undefined : true), { message: 'mode new needs name and base_locale', path: ['name'] })
    .refine((a) => (a.mode === 'fork_preset' ? a.preset_id !== undefined : true), { message: 'mode fork_preset needs preset_id', path: ['preset_id'] })
    .refine((a) => (a.mode === 'fork_ruleset' ? a.source_id !== undefined : true), { message: 'mode fork_ruleset needs source_id', path: ['source_id'] }),
  phase: 1,
  routes: [
    route('POST', '/api/ruleset-definitions'),
    route('POST', '/api/ruleset-definitions/presets/[presetId]/fork'),
    route('POST', '/api/ruleset-definitions/[id]/fork'),
  ],
  reversal: 'Delete the draft while nothing pins it (DELETE /api/ruleset-definitions/[id])',
});

const rulesetPatchDraft = defineStaged({
  name: 'ruleset_patch_draft',
  class: 'D',
  description:
    'Change a ruleset draft with RFC 6901 operations (add, replace, remove) on its document, given as JSON text in ops_json. draft_rev is the revision you last read; a stale revision is refused and you must read again. The previous document is kept so the change can be undone. Entries are dex ids from dex_lookup. Check the result with ruleset_build_preview or ruleset_publish_preview.',
  args: z.strictObject({
    ruleset_id: uuidArg('Ruleset definition id'),
    draft_rev: intArg('Draft revision you read', 1, 2_147_483_646),
    ops_json: z.string().min(2).max(20_000).describe('JSON array of patch operations, up to 20,000 characters'),
  }),
  phase: 1,
  routes: [route('PUT', '/api/ruleset-definitions/[id]/draft')],
  reversal: 'Restore the previous document saved before the change',
});

// ─── G: ruleset publish and pin moves (P1) ───────────────────────────────────

const proposePublishRuleset = defineStaged({
  name: 'propose_publish_ruleset',
  class: 'G',
  description: `Stage publishing a ruleset draft as a new immutable version. It can never be edited or removed from a league that pins it, and a shared ruleset becomes selectable by other admins. An error diagnostic blocks it (run ruleset_publish_preview first). A league can pin only a published version, so publish before a Build that uses it. ${NOTE_STAGED}`,
  args: rulesetPublishSchema.omit({ changelog: true }).extend({
    ruleset_id: uuidArg('Ruleset definition id'),
    changelog_text: textArg('Optional note on what changed', 300).optional(),
  }),
  phase: 1,
  routes: [route('POST', '/api/ruleset-definitions/[id]/publish')],
  outwardEffects: OUTWARD.publish_ruleset,
  verify: 'ruleset_version_exists',
});

const proposeMovePin = defineStaged({
  name: 'propose_move_pin',
  class: 'G',
  description: `Stage moving the ruleset pin of up to 50 leagues and phases to another published version of this ruleset. This is the only way the live rules of a started league change. The card shows how many already-submitted teams would become invalid (read ruleset_pin_impact_preview first) and asks to confirm started targets. A finished target is refused. ${NOTE_STAGED}`,
  args: rulesetPinImpactSchema.extend({ ruleset_id: uuidArg('Ruleset definition id') }),
  phase: 1,
  routes: [route('POST', '/api/ruleset-definitions/[id]/pins')],
  outwardEffects: OUTWARD.move_pin,
  verify: 'pin_moved',
});

// ─── G: Go-live (P1 and later) ───────────────────────────────────────────────

const roundOptions = z.boolean().optional().describe('Also start the round once it is generated (best effort)');

const proposeStartPhase = defineStaged({
  name: 'propose_start_phase',
  class: 'G',
  description: `Stage generating the FIRST round of a phase, which starts it: the league becomes active and the pairings are posted to Discord and social with player names. The admin types the league name to confirm. A custom-format league needs an attached format first. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Phase or tournament id'), start_round: roundOptions }),
  phase: 1,
  routes: [route('POST', '/api/generate-round/[tid]')],
  outwardEffects: OUTWARD.start_phase,
  verify: 'round_generated',
  typedName: 'league',
});

const proposeGenerateBracket = defineStaged({
  name: 'propose_generate_bracket',
  class: 'G',
  description: `Stage generating the full bracket of an elimination tournament: the bracket is posted to Discord and social, the league becomes active and phase enrollment freezes. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Tournament or phase id') }),
  phase: 1,
  routes: [route('POST', '/api/tournaments/[id]/generate-bracket')],
  outwardEffects: OUTWARD.generate_bracket,
  verify: 'bracket_generated',
});

const proposeUndo = defineStaged({
  name: 'propose_undo',
  class: 'G',
  description: `Stage undoing what this conversation built or changed: compensating changes only, each with its own precondition (archive instead of delete, remove roster rows, move a pin back); the server works out what can be undone. Pass proposal_id for an executed proposal, or ruleset_id for a ruleset draft written here (with draft_rev from a save: restore the draft as before it; without: delete a never-published draft created here). ${NOTE_STAGED}`,
  args: z
    .strictObject({
      proposal_id: uuidArg('Executed proposal to undo').optional(),
      ruleset_id: uuidArg('Ruleset draft written here').optional(),
      draft_rev: intArg('Revision a save returned', 1, 2_147_483_646).optional(),
    })
    .refine((a) => (a.proposal_id !== undefined) !== (a.ruleset_id !== undefined), { message: 'name either proposal_id or ruleset_id', path: ['proposal_id'] })
    .refine((a) => a.draft_rev === undefined || a.ruleset_id !== undefined, { message: 'draft_rev goes with ruleset_id', path: ['draft_rev'] }),
  phase: 1,
  // The one delete an undo makes: a ruleset draft created in this conversation and never published (the other undo calls are Build routes).
  routes: [route('DELETE', '/api/ruleset-definitions/[id]')],
  outwardEffects: OUTWARD.undo,
  verify: 'undo_read_back',
});

const proposeGenerateRound = defineStaged({
  name: 'propose_generate_round',
  class: 'G',
  description: `Stage generating the next round of a phase that has started; the pairings are posted to Discord and social with player names. A round that already exists is refused. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Phase or tournament id'), start_round: roundOptions }),
  phase: 2,
  routes: [route('POST', '/api/generate-round/[tid]')],
  outwardEffects: OUTWARD.generate_round,
  verify: 'round_generated',
});

const proposeLeagueStatus = defineStaged({
  name: 'propose_league_status',
  class: 'G',
  description: `Stage changing the status of a league (upcoming, active or completed). A league with the custom format needs an attached format before it can be active. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id'), status: z.enum(['upcoming', 'active', 'completed']) }),
  phase: 2,
  routes: [route('PATCH', '/api/seasons/[id]')],
  outwardEffects: OUTWARD.league_status,
  verify: 'league_status_equals',
});

const proposeAdvancePhase = defineStaged({
  name: 'propose_advance_phase',
  class: 'G',
  description: `Stage advancing a league from its current phase to the next: the next phase enrollment is replaced from the standings and the move is posted to Discord and social. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 2,
  routes: [route('POST', '/api/seasons/[id]/advance')],
  outwardEffects: OUTWARD.advance_phase,
  verify: 'phase_advanced',
});

const proposeStartRound = defineStaged({
  name: 'propose_start_round',
  class: 'G',
  description: `Stage opening a generated round of a phase to play. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Phase or tournament id'), round_id: uuidArg('Round id') }),
  phase: 2,
  routes: [route('PATCH', '/api/tournaments/[id]/rounds/[rid]')],
  outwardEffects: OUTWARD.start_round,
  verify: 'round_state',
});

const proposeCompleteRound = defineStaged({
  name: 'propose_complete_round',
  class: 'G',
  description: `Stage completing a round: the round recap is posted to Discord and social, with an AI recap when that is enabled. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Phase or tournament id'), round_id: uuidArg('Round id') }),
  phase: 2,
  routes: [route('PATCH', '/api/tournaments/[id]/rounds/[rid]')],
  outwardEffects: OUTWARD.complete_round,
  verify: 'round_state',
});

const proposeCompleteTournament = defineStaged({
  name: 'propose_complete_tournament',
  class: 'G',
  description: `Stage completing a tournament or phase: the final result is posted to Discord and social, and again on every re-completion. ${NOTE_STAGED}`,
  args: z.strictObject({ tournament_id: uuidArg('Tournament or phase id') }),
  phase: 2,
  routes: [route('PATCH', '/api/tournaments/[id]')],
  outwardEffects: OUTWARD.complete_tournament,
  verify: 'tournament_completed',
});

const proposeLeagueTrash = defineStaged({
  name: 'propose_league_trash',
  class: 'G',
  description: `Site admins only. Stage moving a league to the recycle bin: it leaves every list for 90 days and only a superadmin can restore it, which the card says. The admin types the league name to confirm. It never restores, rebuilds or purges. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 2,
  audience: 'site',
  routes: [route('DELETE', '/api/seasons/[id]')],
  outwardEffects: OUTWARD.league_trash,
  verify: 'league_in_trash',
  typedName: 'league',
});

// ─── D and G: Format Studio (P3) ─────────────────────────────────────────────

const formatCreate = defineStaged({
  name: 'format_create',
  class: 'D',
  description:
    'Create a PRIVATE format draft from a name. Returns the draft id and its draft_rev. Sharing and publishing are separate cards. The hourly create limit is shared with the admin pages.',
  args: z.strictObject({
    name: textArg('Name of the format', 80),
    base_locale: z.enum(['en', 'de']),
    slug: textArg('Optional slug, lowercase letters, digits and hyphens', 60).optional(),
  }),
  phase: 3,
  routes: [route('POST', '/api/formats')],
  reversal: 'Delete the private, unpublished, unattached draft created in this conversation',
});

const formatForkPreset = defineStaged({
  name: 'format_fork_preset',
  class: 'D',
  description:
    'Copy one of the shipped example formats (classic-league, cup, swiss-top-cut) into a PRIVATE draft, optionally pre-picking a catalog rule preset on every stage (ruleset_preset, an id from format_catalog). Returns the draft id and draft_rev.',
  args: z.strictObject({
    preset_id: textArg('Example format id', 60),
    ruleset_preset: textArg('Catalog rule preset id', 60).optional(),
    slug: textArg('Optional slug', 60).optional(),
  }),
  phase: 3,
  routes: [route('POST', '/api/formats/presets/[presetId]/fork')],
  reversal: 'Delete the private, unpublished, unattached draft created in this conversation',
});

const formatFork = defineStaged({
  name: 'format_fork',
  class: 'D',
  description: 'Copy a format the admin may see into a new PRIVATE draft. Returns the draft id and draft_rev.',
  args: z.strictObject({ format_id: uuidArg('Format definition id'), slug: textArg('Optional slug', 60).optional() }),
  phase: 3,
  routes: [route('POST', '/api/formats/[id]/fork')],
  reversal: 'Delete the private, unpublished, unattached draft created in this conversation',
});

const formatSaveDraft = defineStaged({
  name: 'format_save_draft',
  class: 'D',
  description:
    'Change a format draft with RFC 6901 operations in ops_json. draft_rev is the revision you last read; a stale revision is refused and you must read again. The previous document is kept so the change can be undone. Check the result with format_check before proposing a publish.',
  args: z.strictObject({
    format_id: uuidArg('Format definition id'),
    draft_rev: intArg('Draft revision you read', 1, 2_147_483_646),
    ops_json: z.string().min(2).max(20_000).describe('JSON array of patch operations, up to 20,000 characters'),
  }),
  phase: 3,
  routes: [route('PUT', '/api/formats/[id]/draft')],
  reversal: 'Restore the previous document saved before the change',
});

const proposePublishFormat = defineStaged({
  name: 'propose_publish_format',
  class: 'G',
  description: `Stage publishing a format draft as a new immutable version; the format can then never be deleted. The admin types the format name to confirm. ${NOTE_STAGED}`,
  args: z.strictObject({
    format_id: uuidArg('Format definition id'),
    draft_rev: intArg('Draft revision to publish', 1, 2_147_483_646),
    changelog_text: textArg('Optional note on what changed', 300).optional(),
  }),
  phase: 3,
  routes: [route('POST', '/api/formats/[id]/publish')],
  outwardEffects: OUTWARD.publish_format,
  verify: 'format_version_exists',
  typedName: 'format',
});

const proposeSetFormatVisibility = defineStaged({
  name: 'propose_set_format_visibility',
  class: 'G',
  description: `Stage changing who can see a published format: private or league (all admin tiers). The gallery is not offered. ${NOTE_STAGED}`,
  args: z.strictObject({ format_id: uuidArg('Format definition id'), visibility: z.enum(['private', 'league']) }),
  phase: 3,
  routes: [route('PATCH', '/api/formats/[id]')],
  outwardEffects: OUTWARD.set_format_visibility,
  verify: 'format_visibility_equals',
});

const proposeAttachFormat = defineStaged({
  name: 'propose_attach_format',
  class: 'G',
  description: `Stage attaching a published format to a league: it creates the league phases and one league-owned, private, published ruleset per distinct rule-preset stage. Attaching to a league that already has a format REPLACES it and deletes stages that left the spec. It is reversible only before the league starts. The card lists the parts of the format the engine does not run. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id'), format_id: uuidArg('Format definition id'), version_no: intArg('Version to attach; omit for the latest', 1, 100_000).optional() }),
  phase: 3,
  routes: [route('POST', '/api/seasons/[id]/format')],
  outwardEffects: OUTWARD.attach_format,
  verify: 'format_attached',
});

const proposeDetachFormat = defineStaged({
  name: 'propose_detach_format',
  class: 'G',
  description: `Stage detaching the format from a league: it deletes the phases the attach created and the unused league-owned rulesets. Refused after the league has started. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 3,
  routes: [route('DELETE', '/api/seasons/[id]/format')],
  outwardEffects: OUTWARD.detach_format,
  verify: 'format_detached',
});

// ─── G: drafts (P4) ──────────────────────────────────────────────────────────

const proposeDraftStart = defineStaged({
  name: 'propose_draft_start',
  class: 'G',
  description: `Stage starting a queue-engine draft: seat 1 is pinged on Discord and the live pick clock starts. ${NOTE_STAGED}`,
  args: z.strictObject({ draft_id: uuidArg('Draft pool id') }),
  phase: 4,
  routes: [route('POST', '/api/drafts/[id]/start')],
  outwardEffects: OUTWARD.draft_start,
  verify: 'draft_started',
});

const proposeDraftActivateLegacyPool = defineStaged({
  name: 'propose_draft_activate_legacy_pool',
  class: 'G',
  description: `Stage opening a legacy-engine draft pool to picks: players can pick and every pick posts to Discord. ${NOTE_STAGED}`,
  args: z.strictObject({ draft_id: uuidArg('Draft pool id') }),
  phase: 4,
  routes: [route('PATCH', '/api/drafts/[id]')],
  outwardEffects: OUTWARD.draft_activate_legacy_pool,
  verify: 'draft_status_equals',
});

const proposeRedraftCreate = defineStaged({
  name: 'propose_redraft_create',
  class: 'G',
  description: `Stage opening a redraft for a league (or one group of it): players can then submit secret drops. ${NOTE_STAGED}`,
  args: z.strictObject({ league_id: uuidArg('League id'), group_id: uuidArg('League group id when the league has groups').optional() }),
  phase: 4,
  routes: [route('POST', '/api/drafts')],
  outwardEffects: OUTWARD.redraft_create,
  verify: 'redraft_pool_exists',
});

const proposeRedraftPublish = defineStaged({
  name: 'propose_redraft_publish',
  class: 'G',
  description: `Stage publishing the redraft: the drops are revealed and posted. ${NOTE_STAGED}`,
  args: z.strictObject({ draft_id: uuidArg('Redraft pool id') }),
  phase: 4,
  routes: [route('POST', '/api/drafts/[id]/redraft/publish')],
  outwardEffects: OUTWARD.redraft_publish,
  verify: 'redraft_published',
});

export const STAGED_TOOLS: readonly StagedTool[] = [
  planCreate,
  planSet,
  planPatch,
  planRevert,
  requestClarification,
  proposeBuild,
  rulesetCreateDraft,
  rulesetPatchDraft,
  proposePublishRuleset,
  proposeMovePin,
  proposeStartPhase,
  proposeGenerateBracket,
  proposeUndo,
  proposeGenerateRound,
  proposeLeagueStatus,
  proposeAdvancePhase,
  proposeStartRound,
  proposeCompleteRound,
  proposeCompleteTournament,
  proposeLeagueTrash,
  formatCreate,
  formatForkPreset,
  formatFork,
  formatSaveDraft,
  proposePublishFormat,
  proposeSetFormatVisibility,
  proposeAttachFormat,
  proposeDetachFormat,
  proposeDraftStart,
  proposeDraftActivateLegacyPool,
  proposeRedraftCreate,
  proposeRedraftPublish,
];
