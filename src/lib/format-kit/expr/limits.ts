/**
 * Hard limits of the expression language. They are enforced twice: statically (parser, `typeCheck`)
 * and at run time (`evaluate`), so a hand-built AST that skipped validation cannot exceed them.
 * The document-level limits file re-exports these constants.
 */

/** Maximum AST depth; the root has depth 1. */
export const EXPR_MAX_DEPTH = 12;
/** Maximum AST nodes. Literals inside `in.set` and `round.digits` are fields, not nodes. */
export const EXPR_MAX_NODES = 200;
/** Maximum evaluation steps (one per node visited, plus one per aggregate iteration). */
export const EXPR_STEP_BUDGET = 5000;
/** Every number literal and every arithmetic result must satisfy |x| <= this. */
export const EXPR_NUM_LIMIT = 1e9;
/** Maximum length of a string literal, in UTF-16 code units. */
export const EXPR_MAX_STRING = 64;
/** Maximum length of expression source text. */
export const EXPR_MAX_SOURCE_CHARS = 2000;
/** Arity bound of min/max/and/or: 2..EXPR_MAX_ARGS. */
export const EXPR_MAX_ARGS = 8;
/** Size bound of an `in` set: 1..EXPR_MAX_SET. */
export const EXPR_MAX_SET = 32;
/** Document-level parse limit on nodes, so the zod schema recurses over a bounded tree only. */
export const EXPR_SCHEMA_MAX_NODES = 256;
/** Document-level parse limit on depth; compile still enforces EXPR_MAX_DEPTH. */
export const EXPR_SCHEMA_MAX_DEPTH = 32;
/** Collection size assumed when the plan does not know it. */
export const COLLECTION_ASSUMED_MAX = 256;
/** Maximum parser nesting (parentheses, calls, prefix operators); protects the parser's own stack. */
export const EXPR_MAX_PARSE_NESTING = 64;
/** Digits accepted by round(x, digits). */
export const EXPR_MAX_ROUND_DIGITS = 6;
