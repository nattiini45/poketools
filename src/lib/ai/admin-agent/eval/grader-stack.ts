/**
 * The grading of what the local stack held at the end of an `exec` or `e2e` run (plan 7.1 stages 2 and 3, 7.2 "Isolation
 * without truncation"): row-count deltas, field equality on rows found by their case-id name, the Discord / social / cache
 * recorders, the ledger, the proposal rows and the answers of the clicks. All of it is declarative in the case file
 * (`expect.db`, `.recorder`, `.ledger`, `.proposalState`, `.clicks`) and pure: it reads the `StackObservation` the harness
 * collected and calls nothing.
 *
 * `scoreStack` returns checks; `grader.ts` appends them to the run's checks.
 */
import { canonicalJson } from '../plans/hash';
import { SNAPSHOT_TABLES, type Check, type Expect, type RecorderEvent, type StackObservation } from './types';

/** Whether `name` matches a pattern in which `*` stands for any run of characters (cache tags such as `season:*`). */
export function wildcardMatches(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(name);
}

const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

const namesOf = (events: readonly RecorderEvent[], channel: RecorderEvent['channel']): string[] => events.filter((event) => event.channel === channel).map((event) => event.name);

const shown = (value: unknown): string => canonicalJson(value).slice(0, 80);

/** A field of a found row; a dotted key (`resolved.pokemon`) reads into a JSON column. */
function fieldOf(row: Record<string, unknown>, key: string): unknown {
  let node: unknown = row;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function scoreStack(expect: Expect, stack: StackObservation | undefined): Check[] {
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  const wanted = expect.db !== undefined || expect.recorder !== undefined || expect.ledger !== undefined || expect.proposalState !== undefined || expect.clicks !== undefined;
  if (stack === undefined) {
    if (wanted) check('local-stack observation present', false, 'the case ran without the local stack');
    return checks;
  }

  if (expect.db) {
    const counts = expect.db.counts ?? {};
    // Every snapshot table is checked: one that the case does not list must not change (nothing outside the ledger moved).
    for (const table of SNAPSHOT_TABLES) {
      const seen = stack.counts[table];
      const want = counts[table] ?? 0;
      if (seen === undefined) {
        check(`${table} count change is ${want >= 0 ? '+' : ''}${want}`, false, 'no snapshot');
        continue;
      }
      const delta = seen.after - seen.before;
      check(`${table} count change is ${want >= 0 ? '+' : ''}${want}`, delta === want, `got ${delta >= 0 ? '+' : ''}${delta} (${seen.before} to ${seen.after})`);
    }
    (expect.db.rows ?? []).forEach((spec, index) => {
      const label = `${spec.table} ${shown(spec.where)}`;
      const found = stack.rows[index]?.found;
      if (found === undefined) {
        check(`row ${label}`, false, 'the harness did not read it');
        return;
      }
      const wantCount = spec.count ?? (spec.fields === undefined ? undefined : 1);
      if (wantCount !== undefined) check(`${label}: ${wantCount} row(s)`, found.length === wantCount, `got ${found.length}`);
      for (const [column, value] of Object.entries(spec.fields ?? {})) {
        const bad = found.filter((row) => !sameJson(fieldOf(row, column), value));
        check(`${label}: ${column} = ${shown(value)}`, found.length > 0 && bad.length === 0, found.length === 0 ? 'no row' : bad.length === 0 ? undefined : `got ${shown(fieldOf(bad[0], column))}`);
      }
    });
  }

  if (expect.recorder) {
    const { recorder } = stack;
    const outwardBefore = recorder.beforeApprove.filter((event) => event.channel !== 'cache');
    check(`${expect.recorder.beforeApprove ?? 0} outward event(s) before the first approve`, outwardBefore.length === (expect.recorder.beforeApprove ?? 0), outwardBefore.map((e) => `${e.channel}:${e.name}`).join(', ') || undefined);
    if (expect.recorder.events) {
      const got = namesOf(recorder.afterApprove, 'discord');
      check(`discord events after approve: ${expect.recorder.events.join(', ') || 'none'}`, sameJson(got, expect.recorder.events), `got ${got.join(', ') || 'none'}`);
    }
    if (expect.recorder.social) {
      const got = namesOf(recorder.afterApprove, 'social');
      check(`social events after approve: ${expect.recorder.social.join(', ') || 'none'}`, sameJson(got, expect.recorder.social), `got ${got.join(', ') || 'none'}`);
    }
    for (const pattern of expect.recorder.expiredTags ?? []) {
      const tags = namesOf(recorder.afterApprove, 'cache').filter((name) => name.startsWith('tag:')).map((name) => name.slice(4));
      check(`expires cache tag ${pattern}`, tags.some((tag) => wildcardMatches(pattern, tag)), `got ${tags.slice(0, 6).join(', ') || 'none'}`);
    }
  }

  if (expect.ledger) {
    for (const step of expect.ledger.steps ?? []) {
      const matching = stack.ledger.filter((row) => row.op === step.op && row.status === step.status && (step.code === undefined || row.code === step.code));
      const label = `ledger ${step.op} ${step.status}${step.code ? ` ${step.code}` : ''}`;
      if (step.count !== undefined) check(`${label} x${step.count}`, matching.length === step.count, `got ${matching.length}`);
      else check(label, matching.length > 0, `got ${stack.ledger.filter((row) => row.op === step.op).map((row) => row.status).join(', ') || 'no row'}`);
    }
    if (expect.ledger.total !== undefined) check(`ledger holds ${expect.ledger.total} row(s)`, stack.ledger.length === expect.ledger.total, `got ${stack.ledger.length}`);
    for (const op of expect.ledger.none ?? []) check(`ledger has no ${op} row`, !stack.ledger.some((row) => row.op === op), `got ${stack.ledger.filter((row) => row.op === op).length}`);
  }

  for (const want of expect.proposalState ?? []) {
    const row = want.at === 'last' ? stack.proposals[stack.proposals.length - 1] : stack.proposals[want.at];
    const label = `proposal ${want.at}`;
    if (row === undefined) {
      check(`${label} exists`, false, `the run left ${stack.proposals.length}`);
      continue;
    }
    if (want.kind !== undefined) check(`${label} is a ${want.kind}`, row.kind === want.kind, `got ${row.kind}`);
    if (want.class !== undefined) check(`${label} is class ${want.class}`, row.class === want.class, `got ${row.class}`);
    if (want.tool !== undefined) check(`${label} was staged by ${want.tool}`, row.tool === want.tool, `got ${row.tool ?? 'unknown'}`);
    if (want.status !== undefined) check(`${label} is ${want.status}`, row.status === want.status, `got ${row.status}`);
  }

  if (expect.clicks) {
    const unmatched = [...stack.clicks];
    for (const want of expect.clicks) {
      const at = unmatched.findIndex((click) => click.status === want.status && click.code === want.code && (want.result === undefined || click.result === want.result));
      check(`a click answers ${want.status} ${want.code}${want.result ? ` (${want.result})` : ''}`, at !== -1, `got ${stack.clicks.map((c) => `${c.status} ${c.code}${c.result ? ` (${c.result})` : ''}`).join(', ') || 'no click'}`);
      if (at !== -1) unmatched.splice(at, 1);
    }
  }
  return checks;
}
