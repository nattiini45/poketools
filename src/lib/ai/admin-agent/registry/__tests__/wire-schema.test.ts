import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, toWireSchema, WireSchemaError } from '../wire-schema';

describe('toWireSchema', () => {
  it('strips constraints, formats and defaults but keeps types, enums, descriptions and required keys', () => {
    const wire = toWireSchema(
      'sample',
      z.strictObject({
        id: z.string().uuid().describe('League id'),
        count: z.number().int().min(1).max(50).optional(),
        kind: z.enum(['a', 'b']),
        text: z.string().min(1).max(10).regex(/^[a-z]+$/).default('x'),
        when: z.iso.date().optional(),
      }),
    );
    expect(wire).toEqual({
      additionalProperties: false,
      properties: {
        count: { type: 'integer' },
        id: { description: 'League id', type: 'string' },
        kind: { enum: ['a', 'b'], type: 'string' },
        text: { type: 'string' },
        when: { type: 'string' },
      },
      required: ['id', 'kind'],
      type: 'object',
    });
  });

  it('turns a discriminated union into anyOf, closes nested objects and strips array bounds', () => {
    const wire = toWireSchema(
      'sample',
      z.strictObject({
        list: z.array(z.strictObject({ kind: z.enum(['season', 'tournament']), id: z.string() })).min(1).max(50),
        pick: z.discriminatedUnion('t', [z.strictObject({ t: z.literal('x'), a: z.string() }), z.strictObject({ t: z.literal('y'), b: z.boolean() })]),
      }),
    );
    const text = JSON.stringify(wire);
    expect(text).not.toContain('oneOf');
    expect(text).not.toContain('minItems');
    expect(text).not.toContain('maxItems');
    expect((wire.properties as Record<string, { anyOf?: unknown[] }>).pick.anyOf).toHaveLength(2);
    expect(((wire.properties as Record<string, { items: { additionalProperties: unknown } }>).list).items.additionalProperties).toBe(false);
  });

  it('accepts an object with no arguments', () => {
    expect(toWireSchema('empty', z.strictObject({}))).toEqual({ additionalProperties: false, properties: {}, type: 'object' });
  });

  it('refuses what the strict subset cannot express', () => {
    expect(() => toWireSchema('t', z.strictObject({ open: z.record(z.string(), z.number()) }))).toThrow(WireSchemaError);
    expect(() => toWireSchema('t', z.strictObject({ maybe: z.string().nullable() }))).toThrow(/nullable/);
    expect(() => toWireSchema('t', z.strictObject({ pair: z.tuple([z.string(), z.number()]) }))).toThrow(WireSchemaError);
    const node: z.ZodType = z.lazy(() => z.strictObject({ next: node.optional() }));
    expect(() => toWireSchema('t', z.strictObject({ tree: node }))).toThrow(WireSchemaError);
  });

  it('names the tool in every error', () => {
    expect(() => toWireSchema('my_tool', z.strictObject({ open: z.record(z.string(), z.number()) }))).toThrow(/my_tool/);
  });
});

describe('canonicalJson', () => {
  it('is independent of key order and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});
