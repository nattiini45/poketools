/**
 * The wire schema of a tool: the JSON schema the model sees, derived from the same Zod object the server validates
 * with (plan 3.4 "Strict tools", 3.6 naming).
 *
 * Anthropic strict tools accept a small JSON-schema subset: no recursion, no `min` / `max` style constraints, no
 * `pattern` / `format`, objects closed with `additionalProperties: false`. So the wire form is the Zod schema's JSON
 * schema with every constraint stripped (the descriptions carry the limits in prose), `oneOf` written as `anyOf`, and a
 * hard failure for anything the subset cannot express (a `$ref`, a record, a nullable, a tuple). The server still
 * validates the full constraints with the original Zod object before a tool runs, so stripping loses no safety.
 *
 * Open JSON (Format Studio expressions, patch values, a ruleset document) never appears as a nested free object: it is
 * a `*_json` string argument that the tool parses and validates itself.
 *
 * The output is canonical (keys sorted, no insignificant whitespace) so the bytes, and the hash over them, change only
 * when a tool's text or shape really changes.
 */
import { z } from 'zod';
import type { ArgsSchema } from './types';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** Keywords that constrain a value; they are removed from the wire form. */
const STRIPPED = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'default',
  'title',
  'examples',
  'contentEncoding',
  'contentMediaType',
]);

/** Keywords strict tools cannot take at all. Meeting one is a bug in the definition, not something to strip. */
const FORBIDDEN = new Set(['$ref', '$defs', 'definitions', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'propertyNames', 'prefixItems', 'dependentSchemas', 'unevaluatedProperties']);

export class WireSchemaError extends Error {
  constructor(toolName: string, reason: string) {
    super(`[admin-agent] tool ${toolName}: ${reason}`);
    this.name = 'WireSchemaError';
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function convert(node: JsonValue, path: string, tool: string): JsonValue {
  if (Array.isArray(node)) return node.map((item, index) => convert(item, `${path}[${index}]`, tool));
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED.has(key)) continue;
    if (FORBIDDEN.has(key)) throw new WireSchemaError(tool, `${path}: "${key}" is not allowed in a strict tool schema`);
    if (key === 'type' && Array.isArray(value)) throw new WireSchemaError(tool, `${path}: a type list (nullable) is not allowed; use an optional key`);
    if (key === 'additionalProperties') {
      if (value !== false) throw new WireSchemaError(tool, `${path}: an open object (record) is not allowed; pass open JSON as a *_json string`);
      out[key] = false;
      continue;
    }
    if (key === 'oneOf') {
      out.anyOf = convert(value, `${path}.oneOf`, tool);
      continue;
    }
    if (key === 'properties' && isObject(value)) {
      const props: JsonObject = {};
      for (const [name, schema] of Object.entries(value)) props[name] = convert(schema, `${path}.${name}`, tool);
      out[key] = props;
      continue;
    }
    out[key] = convert(value, `${path}.${key}`, tool);
  }
  // Close every object that lists properties.
  if (out.type === 'object' && out.properties !== undefined && out.additionalProperties === undefined) out.additionalProperties = false;
  if (out.type === 'object' && out.properties === undefined) throw new WireSchemaError(tool, `${path}: an object without properties is not allowed`);
  return out;
}

/** Sorts object keys recursively (arrays keep their order) so equal schemas serialise to equal bytes. */
export function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

/** The strict-tool JSON schema of `args`, canonical. Throws `WireSchemaError` for anything outside the subset. */
export function toWireSchema(toolName: string, args: ArgsSchema): JsonObject {
  let raw: unknown;
  try {
    raw = z.toJSONSchema(args, { io: 'input', unrepresentable: 'throw', cycles: 'throw', reused: 'inline' });
  } catch {
    // The Zod message can echo schema internals; the name of the tool is what the developer needs.
    throw new WireSchemaError(toolName, 'the argument schema cannot be expressed as JSON schema (transform, lazy or recursive type?)');
  }
  const converted = convert(raw as JsonValue, '$', toolName);
  if (!isObject(converted)) throw new WireSchemaError(toolName, 'the argument schema is not an object');
  return sortKeys(converted) as JsonObject;
}

/** Canonical JSON text of any value: sorted keys, no whitespace. */
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}
