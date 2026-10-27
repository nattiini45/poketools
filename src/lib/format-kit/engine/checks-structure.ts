/**
 * Structural checks: duplicate keys, references to stages that do not exist, repeated legacy modules, unknown
 * rulesets (a stored id that does not exist, a rule preset the catalog does not know), and the translation
 * coverage of the document's texts.
 *
 * Every lookup goes through a Map built with `toMap` (first wins), never object indexing, so keys such as
 * `constructor` behave like any other.
 */
import { toMap } from '@/lib/studio-core/keys';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import type { FormatDefinition } from '../types';
import type { LText } from '@/lib/studio-core/ltext';
import { diag, ptr, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import { fixUseSeasonRuleset } from './fixes';

/** Stage key to the index of its first declaration. */
export function stageIndexMap(def: FormatDefinition): Map<string, number> {
  const index = new Map<string, number>();
  def.stages.forEach((stage, i) => {
    if (!index.has(stage.key)) index.set(stage.key, i);
  });
  return index;
}

function duplicates<T>(
  out: Diagnostic[],
  scope: string,
  items: readonly T[],
  keyOf: (item: T) => string,
  pointerOf: (index: number) => string,
): void {
  // `toMap` keeps the first item and reports every later duplicate.
  toMap(items, keyOf, (item, index) => {
    out.push(diag('key_duplicate', pointerOf(index), { scope, key: keyOf(item) }));
  });
}

export function checkStructure(def: FormatDefinition, env: CompileEnv): Diagnostic[] {
  const out: Diagnostic[] = [];

  duplicates(out, 'stages', def.stages, (s) => s.key, (i) => ptr('stages', i, 'key'));
  duplicates(out, 'edges', def.edges, (e) => e.key, (i) => ptr('edges', i, 'key'));
  duplicates(out, 'rules', def.rules, (r) => r.id, (i) => ptr('rules', i, 'id'));
  duplicates(out, 'text_sections', def.text.sections, (s) => s.id, (i) => ptr('text', 'sections', i, 'id'));
  duplicates(out, 'views', def.views, (v) => v.key, (i) => ptr('views', i, 'key'));
  def.modules.forEach((module, m) => {
    duplicates(out, 'facts', module.facts, (f) => f.key, (i) => ptr('modules', m, 'facts', i, 'key'));
  });

  const stages = stageIndexMap(def);

  def.edges.forEach((edge, i) => {
    if (!stages.has(edge.from)) {
      out.push(diag('ref_unknown_stage', ptr('edges', i, 'from'), { key: edge.from, where: 'edge_from' }));
    }
    if (!stages.has(edge.to)) {
      out.push(diag('ref_unknown_stage', ptr('edges', i, 'to'), { key: edge.to, where: 'edge_to' }));
    }
  });
  def.views.forEach((view, i) => {
    view.stages.forEach((key, j) => {
      if (!stages.has(key)) out.push(diag('ref_unknown_stage', ptr('views', i, 'stages', j), { key, where: 'view' }));
    });
  });
  def.rules.forEach((rule, i) => {
    if (rule.scope.kind === 'stage' && !stages.has(rule.scope.stage)) {
      out.push(diag('ref_unknown_stage', ptr('rules', i, 'scope', 'stage'), { key: rule.scope.stage, where: 'rule' }));
    }
  });
  def.text.sections.forEach((section, i) => {
    if (section.stage !== undefined && !stages.has(section.stage)) {
      out.push(diag('ref_unknown_stage', ptr('text', 'sections', i, 'stage'), { key: section.stage, where: 'text' }));
    }
  });

  const adapters = new Set<string>();
  def.modules.forEach((module, i) => {
    if (adapters.has(module.adapter)) {
      out.push(diag('module_duplicate', ptr('modules', i, 'adapter'), { adapter: module.adapter }));
    }
    adapters.add(module.adapter);
  });

  // A rule preset must be one the catalog knows. The schema only checks the shape, so a stored document
  // that names a preset the catalog later dropped still loads, and the editor shows this error instead.
  def.stages.forEach((stage, i) => {
    if (stage.ruleset.kind === 'preset' && !isRulesetPresetId(stage.ruleset.preset)) {
      out.push(
        diag(
          'ruleset_preset_unknown',
          ptr('stages', i, 'ruleset', 'preset'),
          { stage: stage.key, preset: stage.ruleset.preset },
          [fixUseSeasonRuleset(i)],
        ),
      );
    }
  });

  const rulesetIds = env.rulesetIds;
  if (rulesetIds !== undefined) {
    def.stages.forEach((stage, i) => {
      if (stage.ruleset.kind === 'ruleset' && !rulesetIds.has(stage.ruleset.id)) {
        out.push(
          diag(
            'ruleset_not_found',
            ptr('stages', i, 'ruleset', 'id'),
            { stage: stage.key, id: stage.ruleset.id },
            [fixUseSeasonRuleset(i)],
          ),
        );
      }
    });
  }

  return out;
}

/** Every LText of the definition with its pointer, in document order. */
export function collectLTexts(def: FormatDefinition): { pointer: string; text: LText }[] {
  const out: { pointer: string; text: LText }[] = [];
  out.push({ pointer: ptr('identity', 'name'), text: def.identity.name });
  if (def.identity.summary !== undefined) out.push({ pointer: ptr('identity', 'summary'), text: def.identity.summary });
  def.stages.forEach((stage, i) => out.push({ pointer: ptr('stages', i, 'name'), text: stage.name }));
  def.views.forEach((view, i) => out.push({ pointer: ptr('views', i, 'label'), text: view.label }));
  def.rules.forEach((rule, i) => out.push({ pointer: ptr('rules', i, 'text'), text: rule.text }));
  def.text.sections.forEach((section, i) => {
    out.push({ pointer: ptr('text', 'sections', i, 'title'), text: section.title });
    out.push({ pointer: ptr('text', 'sections', i, 'body'), text: section.body });
  });
  def.modules.forEach((module, m) => {
    module.facts.forEach((fact, i) => out.push({ pointer: ptr('modules', m, 'facts', i, 'label'), text: fact.label }));
  });
  return out;
}

/** One info per language that some text lacks, pointing at the first such text. */
export function checkLTextCoverage(def: FormatDefinition): Diagnostic[] {
  const out: Diagnostic[] = [];
  const texts = collectLTexts(def);
  for (const locale of ['en', 'de'] as const) {
    const first = texts.find((t) => t.text[locale] === undefined);
    if (first !== undefined) out.push(diag('ltext_untranslated', first.pointer, { locale }));
  }
  return out;
}
