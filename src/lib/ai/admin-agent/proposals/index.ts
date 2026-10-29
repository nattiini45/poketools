import 'server-only';
/**
 * Proposals, the loop's side (plan 4.5, spec §18.6): staging of the confirmation protocol. The chat loop imports
 * `stageProposal` for the `propose_*` tools and `newTurnStaging` for its per-turn counters. The approve endpoint and the
 * executor are not here: nothing in this module can dispatch a route or approve a proposal, and nothing the loop imports
 * can read an approval token. The card and token routes import `./serve` instead.
 */
import { liveSource, liveStager } from './live';

export const stageProposal = liveStager.stageProposal;
/** The live facts `planReadiness` needs (`plan_validate` reports them, `propose_build` checks them). */
export const loadPlanFacts = liveSource.loadPlanFacts;

export { MAX_PENDING_PROPOSALS } from './stage';
export { newTurnStaging, checkTurnStaging, recordTurnStaging, MAX_GOLIVE_PER_TURN } from './turn';
export { escalateClass } from './class';
export { proposalCardSchema, CARD_LINE_KINDS, CARD_TEXT_KEYS, CARD_VERSION } from './card';
export type { CardLine, CardLineKind, CardAck, CardEffect, CardStep, CardTarget, ProposalCard } from './card';
export { GOLIVE_STAGEABLE, GOLIVE_NOT_STAGEABLE } from './golive';
export { STAGED_NOTE } from './types';
export type { StageInput, StageResult, StageStaged, StageRefused, StageFinding, TurnStaging, StagingAdmin, StagingConversation } from './types';
