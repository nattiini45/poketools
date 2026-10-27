/**
 * What a kind-specific preparer (`build.ts`, `golive.ts`) hands the common staging code in `stage.ts`: the steps as data,
 * the state reads that guard them, the acknowledgements they need and a card builder. `stage.ts` then derives the ids,
 * hashes, token and expiry, stores the row and returns the result, the same way for every kind.
 */
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { StagedTool } from '../registry/define';
import type { ProposalCard } from './card';
import type { PreconditionSpec } from './fingerprints';
import type { StepDraft } from './steps';
import type { StageFinding, StageInput, StagerDeps } from './types';

/** An early exit with a catalogued code. Thrown by the preparers, turned into a `StageRefused` by `stageProposal`. */
export class StageRefusal extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly params?: Readonly<Record<string, string | number>>,
    readonly findings?: readonly StageFinding[],
  ) {
    super(`stage refused: ${code}`);
    this.name = 'StageRefusal';
  }
}

export interface PrepareContext {
  readonly deps: StagerDeps;
  readonly input: StageInput;
  readonly tool: StagedTool;
  readonly cfg: ReturnType<StagerDeps['config']>;
  /** Whether every id was written by an `ok` ledger action of this conversation (plan 3.5 rule 5: "created in this chat"). */
  createdInChat(ids: readonly string[]): Promise<boolean>;
}

/** The steps of a proposal before ids and hashes: each with the reads that guard it and the entities it changes. */
export interface PreparedStep {
  step: StepDraft;
  specs: PreconditionSpec[];
  /** Keys of the entities the step creates or changes (`season:<id>`); later steps then skip those fingerprints. */
  touches: string[];
}

export interface Prepared {
  kind: 'build' | 'action';
  class: 'B' | 'G';
  planId: string | null;
  planRevision: number | null;
  steps: PreparedStep[];
  /** The scope key of a precondition spec (`season:<id>`), or `null` when it reads nothing a step changes. */
  scopeOf(spec: PreconditionSpec): string | null;
  /** Acknowledgement ids the approve request must carry. */
  acks: string[];
  /** Tool plus target: staging it again supersedes the older pending proposal. */
  supersedeKey: string;
  ttl: 'build' | 'golive';
  /** The card, once the plan code (the start of the proposal hash) is known. */
  card(planCode: string): ProposalCard;
}
