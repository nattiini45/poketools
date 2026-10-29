/**
 * Dispatch layer of the Admin Assistant (plan 3.3): route-faithful in-process calls with typed outcomes.
 * `runAsVerifiedSession` may be imported only from this directory (static test); nothing here re-exports it.
 */
export { bindingInput, checkCall, createBindingRegistry, defineBinding, pathParamNames, validateBinding } from './binding';
export type { BindingRegistry, CallCheck } from './binding';
export { invokeRoute } from './invoke';
export { LOCK_CODE, harnessError, isCatalogCode, isUnknownOutcome, mapRouteResponse, outcomeCode, parseBody } from './outcome';
export type { RouteResponseParts } from './outcome';
export {
  ACTION_CLASSES,
  DEFAULT_ROUTE_TIMEOUT_MS,
  HTTP_METHODS,
  MAX_ROUTE_TIMEOUT_MS,
  MIN_ROUTE_TIMEOUT_MS,
} from './types';
export type {
  ActionClass,
  BindingPhase,
  BindingReversal,
  DispatchContext,
  DispatchInput,
  DispatchQuery,
  HarnessErrorCode,
  HarnessErrorReason,
  HttpMethod,
  Outcome,
  OutcomeError,
  OutcomeKind,
  OutwardEffectGroup,
  QueryValue,
  RouteBinding,
  RouteHandler,
  RouteModule,
  VerifyCall,
  VerifyContext,
  VerifyResult,
} from './types';
