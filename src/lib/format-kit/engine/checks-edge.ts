/**
 * Edge checks: how many players an edge asks for against what its source can give, bracket byes, overlapping
 * requests, and the type check of threshold expressions.
 *
 * Count-dependent checks run only when the plan knows the count of the stage involved.
 */
import { COLLECTION_ASSUMED_MAX } from '../expr/limits';
import { typeCheck, type CollectionType, type ExprType, type TypeEnv } from '../expr';
import { MAX_SELECTS } from '../limits';
import type { FormatDefinition, Stage } from '../types';
import { diag, isDiagnosticCode, ptr, type DiagnosticCode, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import { fixAddWildcard } from './fixes';
import { metricProblem } from './checks-stage';
import type { GraphBuild } from './graph';
import { fixedRequest, isElimination, type PlanBuild } from './plan';

/** The code for an expression issue the catalog has no sentence of its own for (parse-only codes). */
const UNKNOWN_EXPR_CODE: DiagnosticCode = 'expr_shape';

const BASE_FIELDS: readonly string[] = ['points', 'wins', 'losses', 'games_played', 'rank', 'group_rank'];
const OPTIONAL_FIELDS: readonly string[] = ['kill_differential', 'buchholz'];

/** The names a threshold expression on an edge may read: the standings of the SOURCE stage. */
export function thresholdTypeEnv(source: Stage, env: CompileEnv, sourceMax: number | null): TypeEnv {
  const fields = new Map<string, ExprType>();
  for (const name of BASE_FIELDS) fields.set(name, 'number');
  for (const name of OPTIONAL_FIELDS) {
    if (metricProblem(name, source, env) === null) fields.set(name, 'number');
  }
  const refs = new Map<string, ExprType>(fields);
  refs.set('participants', 'number');
  const standings: CollectionType = { fields, maxSize: sourceMax ?? COLLECTION_ASSUMED_MAX };
  return { refs, collections: new Map([['standings', standings]]), relations: new Set<string>() };
}

export function checkEdges(def: FormatDefinition, env: CompileEnv, graphBuild: GraphBuild, plan: PlanBuild): Diagnostic[] {
  const out: Diagnostic[] = [];
  const stages = new Map<string, { stage: Stage; index: number }>();
  def.stages.forEach((stage, index) => {
    if (!stages.has(stage.key)) stages.set(stage.key, { stage, index });
  });

  // Selection requests against the source.
  const exceeded = new Set<string>();
  for (const resolved of graphBuild.edges) {
    const edge = def.edges[resolved.index];
    const source = stages.get(resolved.from)?.stage;
    if (!source) continue;
    const count = plan.byKey.get(resolved.from)?.participants ?? null;
    const available = count?.max ?? null;

    edge.select.forEach((select, j) => {
      const requested = fixedRequest(select, source);
      if (requested !== null && available !== null && requested > available) {
        exceeded.add(resolved.from);
        out.push(
          diag('advance_exceeds_source', ptr('edges', resolved.index, 'select', j), {
            edge: edge.key,
            requested,
            available,
          }),
        );
      }
      if (select.kind === 'threshold') {
        const result = typeCheck(select.when, thresholdTypeEnv(source, env, available), 'boolean');
        if (!result.ok) {
          for (const issue of result.issues) {
            const code: DiagnosticCode = isDiagnosticCode(issue.code) ? issue.code : UNKNOWN_EXPR_CODE;
            out.push(
              diag(code, `${ptr('edges', resolved.index, 'select', j, 'when')}${issue.pointer}`, {
                ...issue.params,
                edge: edge.key,
              }),
            );
          }
        }
      }
    });
  }

  // Requests that add up to more than the source holds.
  for (const [key, { stage }] of stages) {
    if (exceeded.has(key)) continue;
    const available = plan.byKey.get(key)?.participants?.max ?? null;
    if (available === null) continue;
    let total = 0;
    let firstOver: number | null = null;
    for (const resolved of graphBuild.edges) {
      if (resolved.from !== key) continue;
      for (const select of def.edges[resolved.index].select) {
        const requested = fixedRequest(select, stage);
        if (requested === null) continue;
        total += requested;
        if (total > available && firstOver === null) firstOver = resolved.index;
      }
    }
    if (firstOver !== null) {
      out.push(diag('advance_overlap', ptr('edges', firstOver), { stage: key, requested: total, available }));
    }
  }

  // Elimination brackets that need byes.
  for (const [key, { stage, index }] of stages) {
    if (!isElimination(stage)) continue;
    const stagePlan = plan.byKey.get(key);
    const incoming = stagePlan?.participants;
    if (!stagePlan || !incoming || stagePlan.bracketSize === null || stagePlan.byes === null || stagePlan.byes <= 0) continue;
    const params = { stage: key, incoming: incoming.min, bracket_size: stagePlan.bracketSize, byes: stagePlan.byes };
    if (stage.participants.from === 'roster') {
      out.push(diag('advance_bracket_byes', ptr('stages', index, 'pairing'), params));
      continue;
    }
    const feeding = graphBuild.edges.filter((e) => e.to === key);
    const last = feeding[feeding.length - 1];
    if (!last) continue;
    const edge = def.edges[last.index];
    const source = stages.get(last.from)?.stage;
    const sourceMax = plan.byKey.get(last.from)?.participants?.max ?? null;
    const outflowMax = plan.outflow.get(last.index)?.max ?? 0;
    const room = sourceMax === null ? Infinity : sourceMax - outflowMax;
    const fixable =
      source?.groups !== undefined && stagePlan.byes <= 1024 && stagePlan.byes <= room && edge.select.length < MAX_SELECTS;
    out.push(
      diag(
        'advance_bracket_byes',
        ptr('edges', last.index),
        { ...params, edge: edge.key },
        fixable ? [fixAddWildcard(last.index, stagePlan.byes)] : [],
      ),
    );
  }

  return out;
}
