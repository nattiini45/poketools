/**
 * `DOCUMENT_SPEC`: the shape of a whole `FormatDefinition`, built from the manifest entries so the
 * browser validator and the Studio forms share one data source. The node shapes (stage, edge,
 * rule card, text section, theme, module, view) are the manifest entries' own Spec objects; only
 * the root and the identity block are described here.
 *
 * Zero zod, no server-only import.
 */
import {
  MAX_EDGES,
  MAX_MODULES,
  MAX_RULES,
  MAX_STAGES,
  MAX_TEXT_SECTIONS,
  MAX_VIEWS,
} from '../limits';
import { RESERVED_RULE_KINDS, RESERVED_SECTIONS, manifestForSlot, specOf } from './manifest';
import { NO_MAX, type FieldSpec, type Spec } from './spec';

const LTEXT: Spec = { t: 'ltext' };
const arr = (item: Spec, min: number, max: number): Spec => ({ t: 'arr', item, min, max });
const req = (name: string, spec: Spec): FieldSpec => ({ name, spec });
const opt = (name: string, spec: Spec): FieldSpec => ({ name, spec, optional: true });

/** The open `rules` list: a known kind is validated, an unknown one degrades to a manual rule card. */
const RULES_ITEM: Spec = {
  t: 'union',
  tag: 'kind',
  variants: manifestForSlot('rule').map((entry) => ({ tag: entry.tag as string, spec: entry.spec as Spec })),
  reservedTags: RESERVED_RULE_KINDS,
  unknown: 'degrade_rule',
};

export const DOCUMENT_SPEC: Spec = {
  t: 'obj',
  reserved: RESERVED_SECTIONS,
  fields: [
    req('schema_version', { t: 'enum', values: [1] }),
    req('identity', {
      t: 'obj',
      fields: [
        req('name', LTEXT),
        opt('summary', LTEXT),
        opt('based_on', { t: 'str', min: 0, max: NO_MAX, pattern: 'slug' }),
      ],
    }),
    req('stages', arr(specOf('stage.define'), 1, MAX_STAGES)),
    { name: 'edges', spec: arr(specOf('advance.rule'), 0, MAX_EDGES), default: [] },
    { name: 'views', spec: arr(specOf('standings.view'), 0, MAX_VIEWS), default: [] },
    { name: 'rules', spec: arr(RULES_ITEM, 0, MAX_RULES), default: [] },
    {
      name: 'text',
      spec: {
        t: 'obj',
        fields: [{ name: 'sections', spec: arr(specOf('text.rules'), 0, MAX_TEXT_SECTIONS), default: [] }],
      },
      default: { sections: [] },
    },
    { name: 'theme', spec: specOf('theme.hint'), default: { world: 'auto' } },
    { name: 'modules', spec: arr(specOf('module.legacy'), 0, MAX_MODULES), default: [] },
  ],
};
