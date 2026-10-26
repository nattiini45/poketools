/**
 * The four ways to start a new format: blank, from an example, by copying a league's structure, or by importing a
 * file. The first three build a document here; the import is checked in `import-file.ts`.
 *
 * Copying a league's structure keeps what the format itself says (stages, groups, pairing, series, scoring,
 * ranking, advancement, rule cards, text) and drops what belongs to that league: legacy modules (their facts can
 * hold league tuning values) and named rulesets (a ruleset id exists in one community, so it would dangle in a
 * shared format). Pure and client-safe.
 */
import type { FormatDefinition, LText, Locale } from '@/lib/format-kit/client';
import type { DraftDocument } from './document';

export type StartKind = 'blank' | 'example' | 'league' | 'import';

/** The starts in the order the dialog offers them. */
export const START_KINDS: readonly StartKind[] = ['blank', 'example', 'league', 'import'];

/** The text with `base` as its authoring language when that language has text; otherwise unchanged. */
function rebase(text: LText, base: Locale): LText {
  const entry = text[base];
  return text.base !== base && entry !== undefined && entry.v !== '' ? { ...text, base } : text;
}

/**
 * A new document from a league's descriptor: its structure without the league's own data. `base` is the language
 * the new format is authored in; texts that have it use it as their base language.
 */
export function leagueStructureDocument(def: FormatDefinition, base: Locale): DraftDocument {
  const copy = structuredClone(def);
  const { based_on: _basedOn, ...identity } = copy.identity;
  const named = (text: LText): LText => rebase(text, base);
  return {
    ...copy,
    identity: {
      ...identity,
      name: named(identity.name),
      ...(identity.summary === undefined ? {} : { summary: named(identity.summary) }),
    },
    stages: copy.stages.map((stage) => ({
      ...stage,
      name: named(stage.name),
      ruleset: stage.ruleset?.kind === 'ruleset' ? { kind: 'season_default' } : stage.ruleset,
    })),
    views: copy.views.map((view) => ({ ...view, label: named(view.label) })),
    rules: copy.rules.map((rule) => ({ ...rule, text: named(rule.text) })),
    text: {
      ...copy.text,
      sections: copy.text.sections.map((section) => ({ ...section, title: named(section.title), body: named(section.body) })),
    },
    modules: [],
  };
}
