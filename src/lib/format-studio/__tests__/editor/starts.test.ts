import { describe, expect, it } from 'vitest';
import { PRESETS, compile, validateFormatDefinition, type FormatDefinition } from '@/lib/format-kit/client';
import { ltext } from '@/lib/studio-core/ltext';
import { describeLegacy } from '../../legacy/describe-legacy';
import { legacyCompileEnv } from '../../view';
import { compileDraft } from '../../editor/preview';
import { START_KINDS, leagueStructureDocument } from '../../editor/starts';
import { FIXTURE_LEAGUES } from '../fixtures/leagues';

const NAMES = Object.keys(FIXTURE_LEAGUES);

/** Values the Evolution Point Buy fixtures carry as pack facts or stored rules (league tuning). */
const EPB_VALUES = ['Last Respects', 'Baton Pass', 'Bright Powder', 'Participation point', 'stab_only', 'draft_budget', 'tiebreak_', 'tera_stage', 'banned_moves', 'module.legacy'];

describe('START_KINDS', () => {
  it('lists the four starts in the order the dialog offers them', () => {
    expect([...START_KINDS]).toEqual(['blank', 'example', 'league', 'import']);
  });
});

describe('leagueStructureDocument', () => {
  it('has the fixture leagues to run on', () => {
    expect(NAMES).toHaveLength(6);
  });

  describe.each(NAMES)('%s', (name) => {
    const input = FIXTURE_LEAGUES[name];
    const descriptor = describeLegacy(input);
    const copy = leagueStructureDocument(descriptor, input.season.language === 'de' ? 'de' : 'en');

    it('has no modules, no named ruleset and no based_on', () => {
      expect(copy.modules).toEqual([]);
      expect(copy.stages.every((stage) => stage.ruleset.kind === 'season_default')).toBe(true);
      expect(copy.identity).not.toHaveProperty('based_on');
    });

    it('passes the validator and compiles without an error', () => {
      expect(validateFormatDefinition(copy).ok).toBe(true);
      const result = compileDraft(copy);
      expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it('also compiles against the league\'s roster', () => {
      const result = compile(copy, legacyCompileEnv(input.season.participantCount));
      expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual([]);
    });

    it('keeps the structure: stages, pairings, edges and scoring', () => {
      expect(copy.stages.map((s) => s.key)).toEqual(descriptor.stages.map((s) => s.key));
      expect(copy.stages.map((s) => s.pairing)).toEqual(descriptor.stages.map((s) => s.pairing));
      expect(copy.stages.map((s) => s.scoring)).toEqual(descriptor.stages.map((s) => s.scoring));
      expect(copy.edges).toEqual(descriptor.edges);
      expect(copy.rules).toEqual(descriptor.rules);
    });

    it('does not change the descriptor it copies', () => {
      const snapshot = JSON.stringify(descriptor);
      leagueStructureDocument(descriptor, 'en');
      expect(JSON.stringify(descriptor)).toBe(snapshot);
    });
  });

  it('carries none of an Evolution Point Buy league\'s pack facts or stored rules', () => {
    for (const name of ['epb_two_stage', 'epb_pack_points_differ']) {
      const input = FIXTURE_LEAGUES[name];
      const descriptor = describeLegacy(input);
      // The descriptor itself names them in its module facts: that is what the copy has to drop.
      expect(JSON.stringify(descriptor), name).toContain('draft_budget');
      expect(JSON.stringify(descriptor), name).toContain('stab_only');
      const copy = JSON.stringify(leagueStructureDocument(descriptor, 'en'));
      for (const value of EPB_VALUES) expect(copy, `${name}: ${value}`).not.toContain(value);
    }
  });

  it('drops a named ruleset (an id of one community) and keeps the default', () => {
    const doubles = describeLegacy(FIXTURE_LEAGUES.doubles_round_robin);
    expect(doubles.stages[0].ruleset.kind).toBe('ruleset');
    expect(leagueStructureDocument(doubles, 'en').stages[0].ruleset).toEqual({ kind: 'season_default' });
    expect(JSON.stringify(leagueStructureDocument(doubles, 'en'))).not.toContain('00000000-0000-4000-8000-000000000901');
  });

  it('uses the chosen language as the authoring language when the text has it', () => {
    const descriptor = describeLegacy(FIXTURE_LEAGUES.singles_groups_playoffs);
    const asDe = leagueStructureDocument(descriptor, 'de');
    expect(asDe.identity.name.base).toBe('de');
    expect(asDe.stages[0].name.base).toBe('de');
    const asEn = leagueStructureDocument(descriptor, 'en');
    expect(asEn.identity.name.base).toBe('en');
  });

  it('leaves a text without the chosen language as it is', () => {
    const only: FormatDefinition = { ...structuredClone(PRESETS[0].definition), identity: { name: ltext('en', 'Only English') } };
    expect(leagueStructureDocument(only, 'de').identity.name).toEqual(ltext('en', 'Only English'));
  });

  it('keeps the name and summary text', () => {
    const preset = structuredClone(PRESETS[0].definition);
    const copy = leagueStructureDocument(preset, 'en');
    expect(copy.identity.name).toEqual(preset.identity.name);
    expect(copy.identity.summary).toEqual(preset.identity.summary);
  });

  it('does not add a summary the descriptor does not have', () => {
    const preset = structuredClone(PRESETS[0].definition);
    delete preset.identity.summary;
    expect(leagueStructureDocument(preset, 'en').identity).not.toHaveProperty('summary');
  });
});
