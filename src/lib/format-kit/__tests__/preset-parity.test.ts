import { describe, expect, it } from 'vitest';
import { compile as compileServer } from '../compile';
import { compile as compileBrowser } from '../compile.browser';
import { CURRENT_ENV } from '../engine/env';
import { PRESETS } from '../presets';
import { validateFormatDefinition as validateServer } from '../validate';
import { validateFormatDefinition as validateBrowser } from '../validate.browser';
import { NEGATIVE_FIXTURES, rosterEnv } from './fixtures/negative';

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('server and browser validators agree', () => {
  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('on the %s preset', (_id, definition) => {
    const server = validateServer(definition);
    const browser = validateBrowser(definition);
    expect(server.ok).toBe(true);
    expect(roundTrip(browser)).toEqual(roundTrip(server));
    if (server.ok) expect(server.value).toEqual(definition);
  });

  it.each(NEGATIVE_FIXTURES.map((f) => [f.id, f] as const))('on the %s fixture', (_id, fixture) => {
    expect(roundTrip(validateBrowser(fixture.input))).toEqual(roundTrip(validateServer(fixture.input)));
  });
});

describe('server and browser compile identically', () => {
  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('the %s preset', (_id, definition) => {
    for (const env of [CURRENT_ENV, rosterEnv(8), rosterEnv(16), rosterEnv(32)]) {
      expect(roundTrip(compileBrowser(definition, env))).toEqual(roundTrip(compileServer(definition, env)));
    }
  });

  it.each(NEGATIVE_FIXTURES.filter((f) => !f.engineOnly).map((f) => [f.id, f] as const))('the %s fixture', (_id, fixture) => {
    const env = fixture.env ?? CURRENT_ENV;
    expect(roundTrip(compileBrowser(fixture.input, env))).toEqual(roundTrip(compileServer(fixture.input, env)));
  });

  it('on hostile input', () => {
    for (const input of [undefined, null, 'x', 5, [], {}, { schema_version: 1 }, JSON.parse('{"__proto__":{"a":1}}')]) {
      expect(roundTrip(compileBrowser(input))).toEqual(roundTrip(compileServer(input)));
    }
  });
});
