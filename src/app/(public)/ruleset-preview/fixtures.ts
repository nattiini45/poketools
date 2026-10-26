/**
 * Deterministic scenarios for the dev-only Ruleset Studio preview (`/ruleset-preview`). Each scenario is a ruleset draft the
 * editor opens on: a preset with a few edits, a blank base, an allowlist, a roster preset, an older generation, a draft that
 * has problems to show in the Issues tab, and a draft the form cannot show. Pure data over the real document type; nothing
 * here reads a database.
 */
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import { ltext } from '@/lib/studio-core/ltext';

export const PREVIEW_DEFINITION_ID = '00000000-0000-4000-8000-0000000000a1';
export const PREVIEW_OWNER = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Preview Admin' };

export const PREVIEW_SCENARIOS = ['ou-edited', 'blank', 'allowlist', 'roster', 'gen3', 'issues', 'published', 'unreadable'] as const;
export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number];
export const DEFAULT_SCENARIO: PreviewScenarioId = 'ou-edited';

export function isPreviewScenario(value: unknown): value is PreviewScenarioId {
  return typeof value === 'string' && (PREVIEW_SCENARIOS as readonly string[]).includes(value);
}

export const PREVIEW_LOCALES = ['en', 'de'] as const;

function named(name: string, preset?: string): RulesetDocument {
  const doc = newRulesetDocument(name, 'en', preset);
  return { ...doc, identity: { ...doc.identity, name: ltext('en', name, undefined) } };
}

function ouEdited(): RulesetDocument {
  const doc = named('Spring OU', 'gen9ou');
  return {
    ...doc,
    clauses: { add: ['ohkoclause', 'evasionclause'], remove: ['sleepclausemod'] },
    pokemon: { ban: ['garchomp', 'gholdengo', 'greattusk', 'kingambit', 'ironvaliant', 'dragapult', 'kyurem', 'ogerpon'], unban: ['koraidon'], allow: null },
    moves: { ban: ['swordsdance', 'spore', 'closecombat'], unban: [], allow: null },
    items: { ban: ['focussash', 'choicescarf'], unban: [], allow: null },
    abilities: { ban: ['intimidate'], unban: [], allow: null },
    min_shared_type_pct: 0,
    custom_rules: 'No Tera Blast in the finals.',
  };
}

function allowlist(): RulesetDocument {
  const doc = named('Berry cup', 'gen9ou');
  return {
    ...doc,
    items: { ban: [], unban: [], allow: ['oranberry', 'sitrusberry', 'lumberry', 'leppaberry', 'chestoberry', 'persimberry'] },
  };
}

function issues(): RulesetDocument {
  const doc = named('Broken cup', 'gen9ou');
  return {
    ...doc,
    clauses: { add: ['ohkoclause', 'notaclause'], remove: ['ohkoclause'] },
    pokemon: { ban: ['garchomp', 'garchomp', 'koraidon', 'tapukoko', 'nosuchmon'], unban: ['garchomp', 'pikachu'], allow: null },
    moves: { ban: ['lastrespects'], unban: ['notbannedmove'], allow: null },
    abilities: { ban: [], unban: [], allow: [] },
  };
}

export interface PreviewScenario {
  document: unknown;
  draftRev: number;
  published: { versionNo: number; contentHash: string; resolvedHash: string } | null;
  visibility: 'private' | 'league' | 'gallery';
}

export function buildScenario(id: PreviewScenarioId): PreviewScenario {
  const base = { draftRev: 4, published: null, visibility: 'private' as const };
  switch (id) {
    case 'ou-edited':
      return { ...base, document: ouEdited() };
    case 'blank':
      return { ...base, document: named('Blank ruleset') };
    case 'allowlist':
      return { ...base, document: allowlist() };
    case 'roster':
      return { ...base, document: named('Champions roster', 'gen9championsdraft') };
    case 'gen3':
      return { ...base, document: { ...named('ADV OU', 'gen3ou'), pokemon: { ban: ['blaziken'], unban: [], allow: null } } };
    case 'issues':
      return { ...base, document: issues() };
    case 'published':
      return { ...base, visibility: 'league', published: { versionNo: 2, contentHash: 'preview-hash', resolvedHash: 'preview-resolved' }, document: ouEdited() };
    case 'unreadable':
      return { ...base, document: { schema_version: 1, identity: 'not an object' } };
  }
}

/** The base preset id of a scenario's draft, for the server-side preset read; null for a blank or unreadable draft. */
export function presetOf(scenario: PreviewScenario): string | null {
  const doc = scenario.document as Partial<RulesetDocument> | null;
  return doc?.base?.kind === 'preset' ? doc.base.preset : null;
}
