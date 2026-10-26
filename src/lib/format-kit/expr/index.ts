/**
 * Client-safe barrel of the expression language: everything except `schema.ts`, which imports zod
 * and stays server-only. The browser validates expression JSON with `validateExprJson` instead.
 */
export * from './ast';
export * from './limits';
export { measureExpr, exceededLimit, type Measure, type MeasureLimits } from './measure';
export { typeCheck, MAX_TYPECHECK_ISSUES, type TypeCheckResult } from './typecheck';
export { evaluate, roundHalfAwayFromZero, type EvalResult } from './eval';
export { parseExpr, type ParseResult } from './parser';
export { printExpr, formatNumber, formatString, PRECEDENCE } from './printer';
export { normalizeExpr } from './normalize';
export { seededRand } from './rand';
export { validateExprJson, type ExprJsonIssue, type ExprJsonIssueCode } from './validate-json';
