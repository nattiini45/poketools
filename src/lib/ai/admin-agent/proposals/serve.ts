import 'server-only';
/**
 * Proposals, the routes' side: what `GET /api/admin/agent/proposals/[id]` serves (the card and, while the proposal waits,
 * the approval token to its owner) and what the approve route recomputes (the step hashes, the hash formulas and the
 * precondition recheck). Never imported by the chat loop (a module-graph test keeps the token out of its reach).
 */
import { liveStager } from './live';

export const getCard = liveStager.getCard;
export const getApprovalToken = liveStager.getApprovalToken;

export { approvalTokenHash } from './token';
export { liveFingerprints } from './live';
export { BUILD_OP_ROUTES } from './build';
export { storedStepSchema, sealStep, stepHashMatches, argsHashOf, STEP_VERSION } from './steps';
export type { StoredStep, StepDraft, OpRoute } from './steps';
export { READ_NAMES, changedPreconditions, checkedEntries, fingerprintOf, preconditionsHash, ReadUnavailable } from './fingerprints';
export type { FingerprintSource, PreconditionEntry, ReadName, ReadTarget } from './fingerprints';
export { proposalCardSchema } from './card';
export type { ProposalCard } from './card';
export { sanitizeCardText, scanStagedText } from './text';
export type { CardText } from './text';
export type { CardView, StepDetail, StepStatusView } from './stage';
