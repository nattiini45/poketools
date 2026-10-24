import { describe, expect, it } from 'vitest';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { DOCUMENT_SPEC } from '../registry/document-spec';
import {
  AVAILABLE_KINDS,
  PRIMITIVE_KINDS,
  RESERVED_KINDS,
  kindKey,
} from '../registry/kinds';
import {
  MANIFEST,
  RESERVED_KIND_OWNERS,
  RESERVED_PAIRING_TAGS,
  RESERVED_RULE_KINDS,
  RESERVED_SECTIONS,
  RESERVED_STAGE_FIELDS,
  manifestEntry,
  manifestForSlot,
  specOf,
} from '../registry/manifest';
import { serverRegistry } from '../registry/server';
import type { Spec } from '../registry/spec';
import { createSpecOut, prepareDocument, validateSpec } from '../registry/validate-spec';
import { advanceSelectSchema, pairingSchema, rankStepSchema } from '../schema/primitives';
import { minimalDoc, sampleNodes } from './fixtures/docs';
import { setAt } from './fixtures/invalid';

const catalogs = { en: formatStudioPrimitivesMessages.en as unknown, de: formatStudioPrimitivesMessages.de as unknown };

function lookup(tree: unknown, dotted: string): unknown {
  let node = tree;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
const hasKey = (locale: 'en' | 'de', key: string) => lookup(catalogs[locale], key) !== undefined;

/** Every node of a spec tree (a spec shared by identity is visited each time it is reached). */
function walk(spec: Spec, visit: (spec: Spec, fieldName: string | null, inOneof: boolean) => void, fieldName: string | null = null, inOneof = false): void {
  visit(spec, fieldName, inOneof);
  switch (spec.t) {
    case 'obj':
      for (const field of spec.fields) walk(field.spec, visit, field.name, false);
      break;
    case 'arr':
      walk(spec.item, visit, fieldName, false);
      break;
    case 'union':
      for (const variant of spec.variants) walk(variant.spec, visit, fieldName, false);
      break;
    case 'oneof':
      for (const option of spec.options) walk(option, visit, fieldName, true);
      break;
    default:
  }
}

describe('kinds and manifest', () => {
  it('lists 27 available and 27 reserved kinds without duplicates', () => {
    expect(AVAILABLE_KINDS).toHaveLength(27);
    expect(RESERVED_KINDS).toHaveLength(27);
    expect(PRIMITIVE_KINDS).toHaveLength(54);
    expect(new Set(PRIMITIVE_KINDS).size).toBe(54);
    for (const kind of PRIMITIVE_KINDS) expect(kind).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('every kind has exactly one manifest entry, in kind order', () => {
    expect(MANIFEST.map((e) => e.kind)).toEqual([...PRIMITIVE_KINDS]);
    for (const kind of PRIMITIVE_KINDS) expect(manifestEntry(kind)?.kind).toBe(kind);
    expect(manifestEntry('nope.nothing')).toBeUndefined();
    expect(manifestEntry('constructor')).toBeUndefined();
    expect(manifestEntry('__proto__')).toBeUndefined();
  });

  it('keys follow the kind', () => {
    expect(kindKey('pairing.round_robin')).toBe('pairing_round_robin');
    for (const entry of MANIFEST) {
      expect(entry.labelKey).toBe(`label.${kindKey(entry.kind)}`);
      if (entry.availability === 'available') {
        expect(entry.summaryKey).toBe(`summary.${kindKey(entry.kind)}`);
        expect(entry.describeKey).toBe(`describe.${kindKey(entry.kind)}`);
        expect(entry.spec).not.toBeNull();
      } else {
        expect(entry.summaryKey).toBeNull();
        expect(entry.describeKey).toBeNull();
        expect(entry.spec).toBeNull();
      }
    }
  });

  it('slot and tag are consistent with the kind', () => {
    for (const entry of MANIFEST) {
      if (entry.slot === 'pairing' || entry.slot === 'rank') {
        expect(entry.tag, entry.kind).not.toBeNull();
        expect(entry.kind).toBe(`${entry.slot}.${entry.tag}`);
      } else if (entry.slot === 'advance') {
        if (entry.tag !== null) expect(entry.kind).toBe(`advance.${entry.tag}`);
        else expect(entry.kind).toBe('advance.rule');
      } else if (entry.slot === 'rule') {
        expect(entry.tag).toBe(entry.kind);
      } else {
        expect(entry.tag, entry.kind).toBeNull();
      }
    }
    expect(manifestEntry('pairing.swiss')).toMatchObject({ slot: 'pairing', tag: 'swiss' });
    expect(manifestForSlot('pairing').map((e) => e.tag)).toEqual(['round_robin', 'swiss', 'single_elim', 'double_elim', 'manual']);
    expect(manifestForSlot('rank')).toHaveLength(5);
    expect(manifestForSlot('advance')).toHaveLength(7);
    expect(manifestForSlot('reserved')).toHaveLength(27);
  });

  it('levels: only rule.custom is honor among the available kinds; reserved kinds are honor and reserved', () => {
    for (const entry of MANIFEST) {
      if (entry.availability === 'reserved') {
        expect(entry.level).toBe('honor');
        expect(entry.slot).toBe('reserved');
        expect(entry.phase).toBeGreaterThanOrEqual(3);
      } else {
        expect(entry.level).toBe(entry.kind === 'rule.custom' ? 'honor' : 'auto');
        expect(entry.phase).toBeGreaterThanOrEqual(1);
        expect(entry.phase).toBeLessThanOrEqual(2);
      }
    }
  });

  it('the manifest is frozen', () => {
    expect(Object.isFrozen(MANIFEST)).toBe(true);
    expect(Object.isFrozen(MANIFEST[0])).toBe(true);
    expect(() => specOf('reserved.kind' as never)).toThrow();
  });
});

describe('catalog coverage (both languages)', () => {
  it('label, summary and describe keys resolve', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const entry of MANIFEST) {
        expect(hasKey(locale, entry.labelKey), `${locale} ${entry.labelKey}`).toBe(true);
        if (entry.summaryKey) expect(hasKey(locale, entry.summaryKey), `${locale} ${entry.summaryKey}`).toBe(true);
        if (entry.describeKey) expect(hasKey(locale, entry.describeKey), `${locale} ${entry.describeKey}`).toBe(true);
      }
      for (const level of ['auto', 'checked', 'honor']) expect(hasKey(locale, `level.${level}`)).toBe(true);
      expect(hasKey(locale, 'availability.reserved')).toBe(true);
    }
  });

  it('every field name used by a manifest spec has field.<name>', () => {
    const names = new Set<string>();
    for (const entry of MANIFEST) {
      if (!entry.spec) continue;
      walk(entry.spec, (spec) => {
        if (spec.t === 'obj') for (const field of spec.fields) names.add(field.name);
        if (spec.t === 'union') names.add(spec.tag);
      });
    }
    walk(DOCUMENT_SPEC, (spec) => {
      if (spec.t === 'obj') for (const field of spec.fields) names.add(field.name);
    });
    expect(names.size).toBeGreaterThan(50);
    for (const locale of ['en', 'de'] as const) {
      for (const name of names) expect(hasKey(locale, `field.${name}`), `${locale} field.${name}`).toBe(true);
    }
  });

  it('every picker value has option.<enumName>_<value>', () => {
    const slotVariantSpecs = new Set<Spec>(
      MANIFEST.filter((e) => e.tag !== null && e.slot !== 'rule' && e.spec).map((e) => e.spec as Spec),
    );
    const required = new Set<string>();
    for (const entry of MANIFEST) {
      if (!entry.spec) continue;
      walk(entry.spec, (spec, fieldName, inOneof) => {
        if (spec.t === 'enum' && fieldName && (spec.values.length > 1 || inOneof)) {
          for (const value of spec.values) required.add(`${fieldName}_${String(value)}`);
        }
        if (spec.t === 'union') {
          for (const variant of spec.variants) {
            if (!slotVariantSpecs.has(variant.spec)) required.add(`${spec.tag}_${variant.tag}`);
          }
        }
      });
    }
    expect(required.size).toBeGreaterThan(30);
    for (const locale of ['en', 'de'] as const) {
      for (const key of required) expect(hasKey(locale, `option.${key}`), `${locale} option.${key}`).toBe(true);
    }
  });
});

describe('server registry', () => {
  it('has an entry for every available kind and none for a reserved one', () => {
    expect([...serverRegistry.keys()].sort()).toEqual([...AVAILABLE_KINDS].sort());
    for (const kind of AVAILABLE_KINDS) {
      const entry = serverRegistry.get(kind);
      expect(entry?.manifest).toBe(manifestEntry(kind));
      expect(typeof entry?.paramsSchema.safeParse).toBe('function');
    }
    for (const kind of RESERVED_KINDS) expect(serverRegistry.has(kind), kind).toBe(false);
  });

  it('the document unions are composed from the registry schemas', () => {
    const optionsOf = (union: unknown) => (union as { options: unknown[] }).options;
    for (const entry of manifestForSlot('pairing')) expect(optionsOf(pairingSchema)).toContain(serverRegistry.get(entry.kind)?.paramsSchema);
    for (const entry of manifestForSlot('rank')) expect(optionsOf(rankStepSchema)).toContain(serverRegistry.get(entry.kind)?.paramsSchema);
    for (const entry of manifestForSlot('advance').filter((e) => e.tag !== null)) {
      expect(optionsOf(advanceSelectSchema)).toContain(serverRegistry.get(entry.kind)?.paramsSchema);
    }
  });

  it('a sample node of every kind is accepted by the params schema and by the Spec with the same value', () => {
    const samples = sampleNodes();
    expect(Object.keys(samples).sort()).toEqual([...AVAILABLE_KINDS].sort());
    for (const kind of AVAILABLE_KINDS) {
      const sample = JSON.parse(JSON.stringify(samples[kind])) as unknown;
      const zod = serverRegistry.get(kind)?.paramsSchema.safeParse(sample);
      const out = createSpecOut();
      const viaSpec = validateSpec(specOf(kind), sample, '', out);
      expect(zod?.success, `${kind} zod`).toBe(true);
      expect(out.issues, `${kind} spec`).toEqual([]);
      expect(JSON.stringify(viaSpec), kind).toBe(JSON.stringify(zod?.success ? zod.data : null));
    }
  });
});

describe('document spec', () => {
  it('contains the spec of every available kind exactly once', () => {
    const counts = new Map<Spec, number>();
    walk(DOCUMENT_SPEC, (spec) => counts.set(spec, (counts.get(spec) ?? 0) + 1));
    for (const kind of AVAILABLE_KINDS) {
      expect(counts.get(specOf(kind)), kind).toBe(1);
    }
  });

  it('lists the reserved names of the pre-pass', () => {
    expect(DOCUMENT_SPEC).toMatchObject({ t: 'obj', reserved: RESERVED_SECTIONS });
    const stage = specOf('stage.define');
    expect(stage).toMatchObject({ t: 'obj', reserved: RESERVED_STAGE_FIELDS });
    const pairing = (stage as Extract<Spec, { t: 'obj' }>).fields.find((f) => f.name === 'pairing')?.spec;
    expect(pairing).toMatchObject({ t: 'union', reservedTags: RESERVED_PAIRING_TAGS });
    const rules = (DOCUMENT_SPEC as Extract<Spec, { t: 'obj' }>).fields.find((f) => f.name === 'rules')?.spec as Extract<Spec, { t: 'arr' }>;
    expect(rules.item).toMatchObject({ t: 'union', reservedTags: RESERVED_RULE_KINDS, unknown: 'degrade_rule' });
  });
});

describe('reserved kinds are one list', () => {
  it('every reserved kind is reachable through exactly one reserved name', () => {
    for (const kind of RESERVED_KINDS) {
      const asPairing = RESERVED_PAIRING_TAGS.some((tag) => `pairing.${tag}` === kind);
      const asRule = (RESERVED_RULE_KINDS as readonly string[]).includes(kind);
      const owner = RESERVED_KIND_OWNERS.get(kind);
      expect([asPairing, asRule, owner !== undefined].filter(Boolean), kind).toHaveLength(1);
      if (owner !== undefined) {
        const known = (RESERVED_SECTIONS as readonly string[]).includes(owner) || (RESERVED_STAGE_FIELDS as readonly string[]).includes(owner) || (RESERVED_RULE_KINDS as readonly string[]).includes(owner);
        expect(known, `${kind} -> ${owner}`).toBe(true);
      }
    }
  });

  it('every reserved pairing tag and rule kind is a reserved primitive', () => {
    for (const tag of RESERVED_PAIRING_TAGS) expect(manifestEntry(`pairing.${tag}`)?.availability).toBe('reserved');
    for (const kind of RESERVED_RULE_KINDS) expect(manifestEntry(kind)?.availability).toBe('reserved');
    for (const kind of RESERVED_KIND_OWNERS.keys()) expect(manifestEntry(kind)?.availability).toBe('reserved');
  });

  it('the pre-pass reports every name of the lists and nothing else', () => {
    for (const name of RESERVED_SECTIONS) {
      expect(prepareDocument({ ...minimalDoc(), [name]: 1 }).issues).toEqual([
        { code: 'not_available_yet', pointer: `/${name}`, params: { what: name } },
      ]);
    }
    for (const name of RESERVED_STAGE_FIELDS) {
      expect(prepareDocument(setAt(minimalDoc(), ['stages', 0, name], 1)).issues).toHaveLength(1);
    }
    for (const tag of RESERVED_PAIRING_TAGS) {
      expect(prepareDocument(setAt(minimalDoc(), ['stages', 0, 'pairing'], { kind: tag })).issues).toHaveLength(1);
    }
    for (const kind of RESERVED_RULE_KINDS) {
      expect(prepareDocument(setAt(minimalDoc(), ['rules'], [{ kind }])).issues).toHaveLength(1);
    }
    expect(prepareDocument(minimalDoc()).issues).toEqual([]);
  });
});
