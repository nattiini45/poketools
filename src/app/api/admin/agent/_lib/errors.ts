/**
 * Errors of the assistant's routes. Every refusal is a `UserFacingError` whose `code` is a key of the assistant's error
 * catalog (or `errors/common`) and whose message is that catalog's English text, so `safeErrorResponse` sends the code,
 * the params and the English `error`, and the client renders it in the viewer's language (`useApiErrorText`).
 */
import { createTranslator } from '@/i18n/core';
import { errorsAdminAssistant, errorsCommon, type ApiErrorCode } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

const assistant = createTranslator(errorsAdminAssistant, 'en');
const common = createTranslator(errorsCommon, 'en');

export type AgentRouteErrorParams = Readonly<Record<string, string | number>>;

/** A refusal with a catalogued code. The English text comes from the catalog that owns the code. */
export function agentError(code: ApiErrorCode, status: number, params?: AgentRouteErrorParams): UserFacingError {
  const translator = Object.prototype.hasOwnProperty.call(errorsAdminAssistant.en, code) ? assistant : common;
  const message = translator.dynamic(code, params as Record<string, string | number> | undefined, 'The assistant could not do this.');
  return new UserFacingError(message, { code, params: params as never, status });
}

/** A switched-off assistant, an audience that excludes the viewer, or an invalid configuration: 404, and it never says which. */
export const agentUnavailable = (): UserFacingError => agentError('agent_disabled', 404);

/** Approve and resume exist so the card and the UI are complete, but nothing executes in phase 0. */
export const phaseDisabled = (): UserFacingError => agentError('phase_disabled', 501);

export const conversationNotFound = (): UserFacingError => agentError('conversation_not_found', 404);
export const proposalNotFound = (): UserFacingError => agentError('proposal_not_found', 404);
