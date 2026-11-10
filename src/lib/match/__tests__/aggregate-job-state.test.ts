import { describe, expect, it } from 'vitest';
import { aggregateJobMachine } from '../aggregate-job-state';
import { allSqlFunctions, lastSqlFunction, sqlList, sqlWriters } from '@/test/sql-functions';

/**
 * Parity of the aggregate queue machine with the SQL functions that own its moves (ADR 0004): each function named as
 * a writer is read from its last CREATE OR REPLACE, and its status guard and target must be the definition's.
 */
const spec = aggregateJobMachine.spec;
const transition = (event: string) => {
  const t = spec.transitions.find((x) => x.event === event);
  if (!t) throw new Error(`no transition ${event}`);
  return t;
};

describe('aggregate job machine', () => {
  it('names each SQL writer at the migration that holds its last definition', () => {
    for (const writer of sqlWriters(spec).keys()) {
      const [file, fn] = writer.split('#');
      expect({ fn, file: lastSqlFunction(fn).file }).toEqual({ fn, file });
    }
  });

  it('claim_aggregate_jobs: pending with attempts left → processing, one attempt added', () => {
    const t = transition('claim');
    const { body } = lastSqlFunction('claim_aggregate_jobs');
    expect(t.from).toEqual(['pending']);
    expect(body).toContain(`WHERE status = '${t.from[0]}' AND attempts < max_attempts`);
    expect(body).toContain('FOR UPDATE SKIP LOCKED');
    expect(body).toMatch(new RegExp(`SET status = '${t.to}', attempts = ag\\.attempts \\+ 1`));
  });

  it('apply_aggregate_job: completes only a processing job, in the counting transaction', () => {
    const t = transition('complete');
    const { body } = lastSqlFunction('apply_aggregate_job');
    expect(body).toContain(`SET status = '${t.to}', processed_at = now(), updated_at = now() WHERE id = p_job_id AND status = '${t.from[0]}'`);
    expect(t.from).toEqual(['processing']);
    expect(body).toContain("RETURN 'job_not_processing'");
  });

  it('reclaim_stale_aggregate_jobs: processing → pending while attempts are left, else failed', () => {
    const retry = transition('retry');
    const fail = transition('fail');
    const { body } = lastSqlFunction('reclaim_stale_aggregate_jobs');
    expect(body).toContain(
      `SET status = CASE WHEN attempts >= max_attempts THEN '${fail.to}' ELSE '${retry.to}' END`,
    );
    expect(retry.from).toEqual(fail.from);
    expect(body).toContain(`WHERE status = '${retry.from[0]}' AND updated_at < now() - INTERVAL '5 minutes'`);
  });

  it('cancel_aggregate_jobs_for_game: pending or processing → cancelled', () => {
    const t = transition('cancel');
    const { body } = lastSqlFunction('cancel_aggregate_jobs_for_game');
    expect(body).toContain(`SET status = '${t.to}', updated_at = now() WHERE game_id = p_game_id AND status IN (${sqlList(t.from)})`);
  });

  it('every SQL function that updates aggregate_jobs is a named writer, and SQL inserts start in an initial state', () => {
    const named = new Set([...sqlWriters(spec).keys()].map((w) => w.split('#')[1]));
    const updaters: string[] = [];
    const inserters: string[] = [];
    for (const [name, { body }] of allSqlFunctions()) {
      if (/UPDATE (?:public\.)?aggregate_jobs\b/i.test(body)) updaters.push(name);
      for (const insert of body.matchAll(/INSERT INTO (?:public\.)?aggregate_jobs \(([^)]*)\)[^;]*?(?:VALUES|SELECT)([^;]*)/gi)) {
        inserters.push(name);
        const status = /'(pending|processing|completed|failed|cancelled)'/.exec(insert[2])?.[1];
        expect({ name, status }).toEqual({ name, status: expect.stringMatching(new RegExp(`^(${spec.initial.join('|')})$`)) });
      }
    }
    expect(updaters.sort()).toEqual([...named].sort());
    expect(inserters).toEqual(['league_trash_restore']);
  });

  it('refuses moves out of the terminal states and a requeue by the worker', () => {
    expect(aggregateJobMachine.can('completed', 'pending', 'queue')).toBe(false);
    expect(aggregateJobMachine.can('cancelled', 'pending', 'admin')).toBe(false);
    expect(aggregateJobMachine.can('failed', 'pending', 'queue')).toBe(false);
    expect(aggregateJobMachine.can('failed', 'pending', 'admin')).toBe(true);
    expect(aggregateJobMachine.sourcesOf('cancelled')).toEqual(['pending', 'processing']);
  });
});
