import { describe, expect, it } from 'vitest';
import { allSqlFunctions, lastSqlFunction, sqlWriters } from '@/test/sql-functions';
import { phaseGameAggregateMarkerMachine } from '../phase-aggregate-job-state';
import { phaseGameEditLeaseMachine, phaseGameEvolutionCreditMachine } from '../phase-game-marker-state';

const machines = [phaseGameAggregateMarkerMachine.spec, phaseGameEvolutionCreditMachine.spec, phaseGameEditLeaseMachine.spec];

describe('native phase marker SQL writers', () => {
  it.each(machines.map((spec) => [spec.id, spec] as const))('%s names the latest SQL definitions', (_id, spec) => {
    for (const writer of sqlWriters(spec).keys()) {
      const [file, name] = writer.split('#');
      expect(lastSqlFunction(name).file).toBe(file);
    }
  });

  it.each([
    ['aggregate_applied_at', phaseGameAggregateMarkerMachine.spec],
    ['evolution_applied_at', phaseGameEvolutionCreditMachine.spec],
    ['edit_lease_token', phaseGameEditLeaseMachine.spec],
  ] as const)('classifies every phase_games.%s SQL writer', (column, spec) => {
    const named = [...sqlWriters(spec).keys()].map((writer) => writer.split('#')[1]);
    const writes = [...allSqlFunctions()].filter(([, { body }]) =>
      new RegExp(`UPDATE (?:public\\.)?phase_games(?: [a-z]+)?\\s+SET [^;]*\\b${column}\\s*=`, 'i').test(body)
    ).map(([name]) => name);
    expect([...new Set(named)].sort()).toEqual(writes.sort());
  });
});
