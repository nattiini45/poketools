import { describe, expect, it } from 'vitest';
import { compile, computeCoverage, describeDefinition, definitionToPlainText } from '@/lib/format-kit';
import { describeLegacy } from '../legacy/describe-legacy';
import { legacyCompileEnv } from '../view';
import { FIXTURE_LEAGUES } from './fixtures/leagues';

/**
 * Golden master of the legacy descriptor. For every fixture league it pins (1) the descriptor as JSON, (2) what the
 * server compile makes of it (verdict, hash, diagnostics, coverage, capabilities) and (3) the rules text in English
 * and German. Later phases must keep these snapshots unchanged: a change to the descriptor, to scoring or to the
 * rank chain shows up here first. Changed copy (fact labels, rules text) is updated with
 * `npx vitest run src/lib/format-studio -u` after reviewing the diff.
 */

const names = Object.keys(FIXTURE_LEAGUES);

describe.each(names)('golden: %s', (name) => {
  const input = FIXTURE_LEAGUES[name];
  const definition = describeLegacy(input);
  const result = compile(definition, legacyCompileEnv(input.season.participantCount));

  it('compiles without errors', () => {
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('descriptor', () => {
    expect(JSON.stringify(definition, null, 2)).toMatchSnapshot();
  });

  it('compile verdict', () => {
    expect({
      ok: result.ok,
      hash: result.hash,
      diagnostics: result.diagnostics.map((d) => ({ code: d.code, severity: d.severity, pointer: d.json_pointer })),
      coverage: computeCoverage(definition),
      capabilities: result.capabilities,
    }).toMatchSnapshot();
  });

  it.each(['en', 'de'] as const)('rules text (%s)', (locale) => {
    const text = definitionToPlainText(
      describeDefinition(result.definition ?? definition, locale, {
        plan: result.plan ?? undefined,
        order: result.graph?.order,
      }),
    );
    expect(text).toMatchSnapshot();
  });
});
