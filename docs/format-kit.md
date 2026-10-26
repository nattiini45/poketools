# Format Kit

### Overview

The format kit is a pure TypeScript library in `src/lib/format-kit/` that describes a league or tournament format as **data**: a versioned JSON document (the *format definition*) with stages, edges between them, rank chains, series lengths, scoring, rule cards and bilingual text. The library validates such a document, type-checks its expressions, computes what it implies (how many players reach each stage, how many rounds it plays, how big a bracket is) and reports what is wrong with it as **diagnostics**: a code, a severity, a JSON pointer and flat params, often with a one-click fix expressed as a JSON patch.

It is a library only. **Nothing in the app imports it yet**: there is no database table, no route, no page and no builder UI. A later release adds the builder on top of it; this release ships the core so that the document model, the expression language, the registry and the compiler can be reviewed and tested on their own. The preset definitions it ships compile without errors, but that says the *document* is consistent, not that the tournament engine can already run it (the engine has no round-robin legs, wildcard, threshold or bottom-N selection yet).

What it gives a caller:

- `validateFormatDefinition(input)`: bounded, strict validation with the same result on the server (zod) and in the browser (a hand-written interpreter of plain data, no zod).
- `compile(input, env)`: validation, structure checks, stage graph with cycle detection, participant-flow plan, per-stage and per-edge checks, expression type checks and derived capabilities, memoised by content hash.
- `renderDiagnostic(d, locale, definition?)`: the sentence for a diagnostic, after the cached read.
- A safe expression language for conditions (an edge's *threshold* selection today): a stored JSON AST, a text grammar, a static checker and an interpreter with hard limits.
- A primitive registry (manifest as plain data, server params schemas, per-primitive descriptions in both languages).

### File Structure

```
src/lib/format-kit/
├── keys.ts            key, ref-name, kind, slug and uuid patterns; toMap, hasOwn
├── json.ts            inspectJson (iterative), canonicalizeJson, sha256Hex, contentHash, deepFreeze
├── patch.ts           RFC 6901 pointer helpers and applyPatch (add / replace / remove)
├── limits.ts          document limits (re-exports the expression limits)
├── types.ts           the document types (hand-written, zod-free)
├── issues.ts          SchemaIssue, SchemaNote, ValidationResult, mapZodIssues, finalizeIssues
├── ltext.ts           LText builder, resolveLText, missingLocales, markReviewed, withTranslation
├── expr/              the expression language
│   ├── ast.ts limits.ts measure.ts lexer.ts parser.ts printer.ts normalize.ts
│   ├── typecheck.ts eval.ts rand.ts
│   ├── schema.ts      zod schema (server only)
│   ├── validate-json.ts   the zod-free twin of the schema
│   └── index.ts       client-safe barrel (everything except schema.ts)
├── schema/            zod schemas of the document (server only)
├── registry/          kinds, Spec DSL, manifest, document spec, Spec validator, describe, server registry
├── validate.ts        validateFormatDefinition with zod (server)
├── validate.browser.ts   validateFormatDefinition with the Spec interpreter (client-safe)
├── engine/            the compiler
│   ├── env.ts         CompileEnv, CURRENT_ENV, envKey
│   ├── diagnostics.ts codes, severities, builders, ordering
│   ├── checks-structure.ts  duplicate keys, unknown references, rulesets, translation coverage
│   ├── graph.ts       stage graph, topological order, cycles, reachability
│   ├── plan.ts        participant flow, groups, rounds, brackets
│   ├── checks-stage.ts  groups, series, match-model gate, scoring, rank chain, metrics
│   ├── checks-edge.ts   requests against the source, byes, overlaps, threshold expressions
│   ├── fixes.ts       patch builders for every fix id
│   ├── capabilities.ts  deriveCapabilities
│   ├── render.ts      diagnostic and fix sentences
│   ├── memo.ts        the 32-entry LRU cache
│   └── core.ts        the pipeline, independent of the validator
├── compile.ts         compile and clearCompileCache with the zod validator
├── compile.browser.ts same names with the browser validator
├── presets/           three preset definitions
├── client.ts          client-safe barrel
├── index.ts           server barrel
├── test-utils/        seeded PRNG and expression generators (tests only)
└── __tests__/         see Testing

src/i18n/messages/format-studio/             diagnostics, fixes, metric and reason labels
src/i18n/messages/format-studio/primitives/  labels, summaries and descriptions of the primitives
```

### Document model

A definition is a plain JSON object. The schema is **strict**: an unknown key at any level is an issue. There is no open record anywhere; every collection is an array with a key field, and lookups go through a `Map`, so a key such as `constructor` is ordinary data.

| Section | Content | Limits | Default |
|---|---|---|---|
| `schema_version` | the literal `1` | required | none |
| `identity` | `name` (LText), optional `summary` (LText), optional `based_on` (slug) | | none |
| `stages` | stage objects | 1 to 50 | none |
| `edges` | advancement between stages | 0 to 100 | `[]` |
| `views` | cross-stage standings views | 0 to 8 | `[]` |
| `rules` | rule cards | 0 to 200 | `[]` |
| `text.sections` | titled text blocks | 0 to 32 | `{ sections: [] }` |
| `theme` | `{ world: 'auto' or a key }` | | `{ world: 'auto' }` |
| `modules` | legacy modules | 0 to 3 | `[]` |

A **stage** has a `key`, a `name`, a `participants` selector (`roster` with seeding `rating`, `random`, `manual` or `signup` and an optional `expected_count` of 2 to 4096; or `edges` with seeding `edge_order`, `rating`, `random` or `manual`), optional `groups` (`count` 2 to 26, `method` `serpentine` by default), a `pairing`, a `series`, a `ruleset` (`season_default` by default, or a ruleset uuid), `doubles` (false), `players_per_match` (2 to 8, default 2), `scoring`, `rank` (0 to 12 steps, `[]`) and `columns` (0 to 12 metric keys, `[]`).

| Part | Fields and limits |
|---|---|
| `pairing` | `round_robin` (`legs` 1 to 4, `mirror_legs` true), `swiss` (`rounds` 1 to 32 or `auto`, `avoid_repeats` true), `single_elim` (`third_place` false), `double_elim` (`bracket_reset` false), `manual` |
| `series` | `best_of` 1 to 15 (an even number is representable and rejected by the compiler), `allow_draw` false, `overrides` 0 to 32 of `{ round 1..64, from 'start' or 'end' (start), best_of 1..15 }` |
| `scoring` | `win`, `loss` (0), `bye` (0), optional `draw` and `forfeit`; finite numbers with an absolute value of at most 1000 |
| `rank` step | `metric` (`metric` key and `direction` `desc` or `asc`), `head_to_head` (`pairwise` or `mini_table`), `coin_flip`, `decision_match`, `manual` |
| `edge` | `key`, `from`, `to`, `select` (1 to 4), `seeding` (`rank`, `cross_group`, `random`, `manual`; default `rank`), `gate` (`admin_confirm` or `auto`; default `admin_confirm`) |
| `select` | `top_n` (1 to 1024), `per_group` (1 to 64), `wildcard` (1 to 1024), `bottom_n` (1 to 1024), `manual_list` (optional `count` 1 to 1024), `threshold` (a boolean expression) |
| rule card | `rule.custom` with `id`, `text`, `scope` (`season` or one stage), `verify` (`admin_checklist`, `player_attest`, `none`), `when` (`once`, `per_match`, `per_matchday`), `visible_to_players` (true) |
| legacy module | `module.legacy` with `adapter` (`epb`, `legacy_draft`, `core_liga`) and up to 64 `facts` |

Keys match `^[a-z][a-z0-9_]{0,31}$`. The whole document must fit 262,144 bytes, 150,000 JSON nodes and a nesting depth of 64; this is checked by an iterative walk **before** any recursive parsing, so a hostile body cannot overflow the stack. Strings never contain a NUL character (Postgres `jsonb` cannot store one).

**Reserved names.** Sections and kinds the model will need later are reserved so a document that uses them fails clearly instead of being misread: the top-level `attributes`, `domains`, `relations`, `resources`, `metrics` and `tunables`; the stage fields `constraints`, `acquire`, `calendar`, `end_when` and `foreach_group`; the pairing kinds `bipartite`, `filter` and `challenge`; and the rule kinds `rule.on_event`, `player.action`, `check.assisted` and `adjust.manual`. Any of them, even empty, gives a `not_available_yet` issue at its pointer and nothing else is reported for that subtree.

**Unknown rule kinds degrade.** A rule entry whose `kind` looks like a kind but is neither known nor reserved is kept as a `rule.custom` card (an Honor card): `degraded_from` holds the original kind, `text` is the entry's own text when it is valid and otherwise the kind name, and the validators report a `unknown_primitive` note, which compile turns into a `rule_unknown_primitive` warning. Every other key of such an entry is dropped without being read by name.

### LText and the fallback order

All user-facing text in a document is an `LText`: `{ en?, de?, base }` where each language is `{ v, s }` (`v` 1 to 4000 characters, `s` `human`, `machine` or `reviewed`) and `text[base]` must exist. `resolveLText(text, { viewer?, seasonLanguage? })` returns the first present value in this order: the viewer's language, the season language, the base language, then English, then German; it also says whether it had to fall back. Viewerless callers (exports, notifications) pass no viewer. The order is by language only: a `machine` text in the wanted language still beats a `human` text in another one, and the UI marks machine text. `ltext(base, en, de)`, `missingLocales`, `isTranslated`, `markReviewed` and `withTranslation` never mutate their input.

### Expression language

Conditions are stored as a JSON AST and shown as text. The AST has the node kinds `num`, `bool`, `str`, `ref`, `neg`, `arith`, `fn` (`min`, `max`), `clamp`, `round`, `cmp`, `and`, `or`, `not`, `if`, `in`, `rel`, `rand` and `agg` (`count`, `sum`, `min`, `max`, `any`, `all` over a named collection with optional `of` and `where`). Every `ref` carries its type (`number`, `boolean`, `text`).

Text grammar, lowest to highest precedence:

```
or     := and ('or' and)*
and    := not ('and' not)*
not    := 'not' not | cmp
cmp    := sum (('<' | '<=' | '>' | '>=' | '==' | '!=') sum)? | sum 'in' '[' literal (',' literal)* ']'
sum    := term (('+' | '-') term)*
term   := unary (('*' | '/') unary)*
unary  := '-' unary | primary
primary:= NUMBER | STRING | 'true' | 'false' | REF | '(' or ')' | call | aggregate
call   := ('min' | 'max') '(' or (',' or)+ ')' | 'clamp' '(' or ',' or ',' or ')' | 'round' '(' or [',' INT] ')'
        | 'if' '(' or ',' or ',' or ')' | 'rel' '(' KEY ',' or ',' or ')' | 'seeded_rand' '(' KEY ')'
aggregate := ('count' | 'sum' | 'min' | 'max' | 'any' | 'all') '(' KEY ['of' or] ['where' or] ')'
```

Comparison is non-associative. A reference is a key, or `item.field` inside an aggregate's `of` and `where`. `min(` and `max(` followed by a collection name and `of`, `where` or `)` is an aggregate; anything else is the n-ary call.

**Typing.** A `ref` must carry the type the environment declares. Arithmetic, `neg`, `min`, `max`, `clamp`, `round` and the ordering comparisons take numbers; `==` and `!=` take two values of the same type; `and`, `or`, `not` and the condition of `if` take booleans, and both branches of `if` have one type; `in` needs a homogeneous literal set of the operand's type; `rel` takes a known relation and two texts. `count` takes only `where`; `sum`, `min` and `max` need `of` (a number); `any` and `all` need `where` (a boolean) and forbid `of`. An aggregate inside an aggregate and `item.` outside one are errors.

**Evaluation.**

- `a / b` is `0` when `b` is `0`. Every literal and every intermediate result must be finite and within plus or minus 1e9, otherwise the expression fails with `expr_number_range`.
- `round(x, d)` rounds half away from zero to `d` digits (0 to 6) with integer-safe scaling.
- `clamp(x, lo, hi)` is `max(lo, min(x, hi))`: when `lo > hi`, `lo` wins.
- `min`, `max`, `sum` and `count` over an empty collection are `0`; `any` of an empty collection is `false` and `all` is `true`. Rows are visited in the order the caller gives them.
- Text is compared with `==` and `!=` only, by UTF-16 code units.
- `and` and `or` short-circuit, `if` evaluates one branch, and only the nodes actually evaluated are charged.
- `seeded_rand(key)` is a deterministic value in `[0, 1)` of `(seed, scope, key)` (a 32-bit string hash and one mulberry32 step); the test vectors are pinned, so a change is a deliberate, breaking one. `rel(name, a, b)` asks the environment's relation and is `false` for an absent pair.

**Limits.** Depth 12 (the root is depth 1), 200 nodes (literals in `in` sets and the `round` digits do not count), a step budget of 5,000 (one step per node visited and per aggregate row), numbers within plus or minus 1e9, string literals up to 64 characters, source text up to 2,000 characters, 2 to 8 arguments for `min`, `max`, `and` and `or`, 1 to 32 members in an `in` set, parser nesting 64. The compiler checks them statically (the worst case of an aggregate is its collection size times the cost of its body); `evaluate` re-checks them at run time and never throws. The document schema accepts a little more (256 nodes, depth 32) so zod only ever recurses over a bounded tree; the compiler then reports `expr_depth` or `expr_nodes` for anything above the real limits.

**Deliberately absent:** user-defined functions, lambdas, loops, any way to turn a string into code, clocks, randomness other than `seeded_rand`, I/O and regular expressions built from input.

### Registry contract

The registry is the list of *primitives*, the building blocks a format is made of (a pairing, a series rule, a rank step, an advance rule, a rule card, and so on). A kind is `<family>.<name>`, for example `pairing.swiss` or `advance.top_n`.

- **Manifest** (`registry/manifest.ts`): one plain-data entry per kind with its slot, tag, **level**, availability, phase, catalog keys and, for available kinds, its **Spec**. The Spec DSL (`registry/spec.ts`) describes shapes as data: `bool`, `int`, `num`, `str` (with a named pattern `key`, `slug`, `uuid` or `kind`), `enum`, `ltext`, `expr`, `obj`, `arr`, `union` and `oneof`. `DOCUMENT_SPEC` is built from the manifest, and `validate.browser.ts` interprets it. No pattern string from input is ever compiled.
- **Server entry** (`registry/server.ts`): for each available kind its manifest entry and the zod params schema. The document schema composes its unions from the same exports, so the two cannot diverge.
- **Levels** state the intended enforcement. **Auto**: the engine runs it. **Checked**: the engine computes a result and an admin confirms it. **Honor**: a rule card nobody enforces (`rule.custom`). Nothing executes in this release; the level is metadata for the future builder.
- **27 kinds are available** (`stage.define`, `group.form`, the five pairings, `series.rule`, `team.ruleset`, `score.match`, the five rank kinds, `standings.view`, `advance.rule` and its six selections, `rule.custom`, `text.rules`, `theme.hint`, `module.legacy`) and **27 are reserved**. A reserved kind exists in the manifest only; a document that names it fails with `not_available_yet`.

**Adding a primitive** takes one registry entry (kind and Spec in the manifest), its zod params schema in `schema/primitives.ts`, its describe function in `registry/describe.ts`, its keys in `format-studio/primitives` (label, summary, describe, fields, options) in both languages, and tests: the registry test checks that every available kind has a server entry and that every key exists in both languages.

`describePrimitive(kind, node, locale)` renders a validated node as one sentence. It never throws: an unknown kind, a reserved kind or a node of the wrong shape gives the label of the kind.

### Compile pipeline

`compile(input, env = CURRENT_ENV)` returns `{ ok, hash, definition, diagnostics, capabilities, graph, plan }`:

1. Inspect the input (iterative, bounded) and hash its canonical form. Input that is not JSON, or is too deep, too large or has too many nodes, gives one `schema_type` or `schema_limit` diagnostic and nothing else.
2. Look the result up by `inputHash|envKey`. The same document in another key order is the same input, and a different environment is a different entry. The cache is an LRU of 32 results; `clearCompileCache()` empties it.
3. Validate. An invalid document yields `schema_*` diagnostics only; no later phase runs and `definition` is `null`.
4. Notes become `rule_unknown_primitive` warnings.
5. Structure checks. 6. Stage graph. 7. Plan. 8. Stage checks. 9. Edge checks, including the expression type check of every threshold. 10. Translation coverage. 11. Capabilities.
12. Diagnostics are sorted (error, warning, info; then pointer; then code), the result is deep-frozen and stored. `hash` is the content hash of the **parsed** definition (defaults applied).

Compile is pure: no clock, no randomness, no I/O. The result holds codes and params only, never localized text, so a cached result is locale-free and rendering happens after the read.

**Plan conventions.** A roster stage starts from `env.rosterSize`, else `expected_count`, else it is unknown (and gets one `participant_count_unknown` note). An edge sends `min(n, source)` for `top_n`, `n * groups` for `per_group`, `n` for `wildcard` and `bottom_n`, `count` for `manual_list` (unknown without one) and `0` to the source size for `threshold`; the selections of an edge add up, and so do the edges into a stage (they are assumed to be disjoint). Round robin plays `legs` times the round count of the production helper (`n` rounds for an odd group, `n - 1` for an even one, none below two players); Swiss plays its rounds or `ceil(log2 n)` for `auto`; single elimination `ceil(log2 n)` rounds with the third-place match kept inside the final round; double elimination `2 * ceil(log2 n) - 1`, plus one with the bracket reset. A bracket is the next power of two and the byes are the difference. A count the plan cannot know is `null`, and a check that needs it does not run.

**`CompileEnv`** describes what the product can do today:

```ts
interface CompileEnv {
  matchModel: { draws: boolean; forfeits: boolean; maxPlayersPerMatch: number };
  features: { killStats: boolean; rating: boolean };
  rosterSize?: number;
  rulesetIds?: ReadonlySet<string>;
}
```

`CURRENT_ENV` in `engine/env.ts` says draws are **off**, forfeits are **off** and a match has **two** players, because a match still needs a winner to complete and finalizing writes no draw. That file is the only place those three values live: when the match-model change lands they flip there and the diagnostics `draws_unsupported`, `forfeits_unsupported` and `players_per_match_unsupported` go quiet with them.

### Diagnostics

Severity, pointer and params of every code. Stage-like params (`stage`, `edge`, and so on) hold **keys**; `renderDiagnostic` turns them into names when it is given the definition (an advancement rule has no name, so `edge` reads as "first stage → second stage"; without the definition the key is shown). Sentences that depend on a number are `{one, other}` forms; the renderer passes the deciding param as `count`. A diagnostic's `fixes` list holds `{ id, params, patch }`; applying `patch` with `applyPatch` produces the fixed document, and `fixes.<id>` in the catalog is its label.

| Code | Severity | Pointer | Params | Fixes |
|---|---|---|---|---|
| `schema_required`, `schema_type`, `schema_enum`, `schema_range`, `schema_length`, `schema_pattern`, `schema_unknown_key`, `schema_refine` | error | the issue's | the issue's | |
| `schema_limit` | error | the issue's (a size or an expression limit) | `limit` | |
| `schema_not_available_yet` | error | the reserved name | `what` | |
| `rule_unknown_primitive` | warning | `/rules/i` | `kind` | |
| `key_duplicate` | error | the key field of the later duplicate | `scope`, `key` | |
| `ref_unknown_stage` | error | the referencing field | `key`, `where` | |
| `stage_cycle` | error | the first edge on the cycle | `path` (`a>b>a`) | |
| `stage_unreachable` | error | `/stages/i` | `stage` | |
| `stage_roster_with_incoming` | warning | `/stages/i/participants` | `stage` | `use_edges_source` |
| `stage_too_few_participants` | error | `/stages/i/participants` | `stage`, `count`, `source` | |
| `participant_count_unknown` | info | `/stages/i/participants` | `stage` | |
| `groups_too_many` | error | `/stages/i/groups/count` | `stage`, `groups`, `participants` | `reduce_groups` |
| `groups_uneven` | info | `/stages/i/groups` | `stage`, `groups`, `participants` | |
| `advance_exceeds_source` | error | `/edges/i/select/j` | `edge`, `requested`, `available` | |
| `advance_per_group_without_groups` | error | `/edges/i/select/j` | `edge`, `stage` | |
| `advance_bracket_byes` | warning | `/edges/i`, or `/stages/i/pairing` for a roster-fed bracket | `stage`, `incoming`, `bracket_size`, `byes` (and `edge`) | `add_wildcard` (only when the source has groups and the edge has fewer than 4 selections) |
| `advance_overlap` | warning | the edge where the total first exceeds the source | `stage`, `requested`, `available` | |
| `swiss_rounds_too_many` | warning | `/stages/i/pairing/rounds` | `stage`, `rounds`, `participants` | `set_swiss_rounds_auto` |
| `series_even_best_of` | error | `.../series/best_of` or `.../overrides/j/best_of` | `stage`, `best_of`, `scope` | `use_lower_odd`, `use_higher_odd` |
| `series_override_duplicate` | error | `/stages/i/series/overrides/j` | `stage`, `round` | `remove_override` |
| `series_override_unreachable` | warning | `/stages/i/series/overrides/j` | `stage`, `round`, `rounds` | |
| `draws_unsupported` | error | `.../scoring/draw` or `.../series/allow_draw` | `stage`, `where` | `remove_draw` |
| `forfeits_unsupported` | error | `/stages/i/scoring/forfeit` | `stage` | `remove_forfeit` |
| `players_per_match_unsupported` | error | `/stages/i/players_per_match` | `stage`, `players`, `max` | `set_two_players` |
| `scoring_win_not_better` | warning | `/stages/i/scoring/win` | `stage`, `win`, `loss` | |
| `rank_chain_empty` | error | `/stages/i/rank` | `stage` | `add_points_step` |
| `rank_ignored_for_bracket` | info | `/stages/i/rank` | `stage` | `clear_rank` |
| `metric_unproduced` | error | the metric field of a rank step, a column or a view | `stage` or `view`, `metric`, `reason`, `where` | `remove_rank_step` (rank only, and only when the chain keeps another step or the stage is a bracket) |
| `rank_decision_match_position` | error | the step | `stage` | `move_decision_match_last` |
| `rank_open_ended` | warning | `/stages/i/rank` | `stage` | `add_coin_flip` (only below 12 steps) |
| `rank_step_unreachable` | warning | the step after a terminal step | `stage` | |
| `rank_duplicate_step` | warning | the repeated step | `stage` | |
| `ruleset_not_found` | error | `/stages/i/ruleset/id` | `stage`, `id` | `use_season_ruleset` |
| `module_duplicate` | error | `/modules/i/adapter` | `adapter` | |
| `ltext_untranslated` | info | the first text without the language | `locale` | |
| `expr_*` (16 codes) | error | `/edges/i/select/j/when` plus the expression's own pointer | `edge` plus the expression issue's params | |

The sixteen expression codes are `expr_shape`, `expr_depth`, `expr_nodes`, `expr_steps`, `expr_type_mismatch`, `expr_unknown_ref`, `expr_ref_type`, `expr_unknown_relation`, `expr_unknown_collection`, `expr_unknown_field`, `expr_arity`, `expr_number_range`, `expr_string_length`, `expr_result_type`, `expr_item_scope` and `expr_nested_aggregate`.

`swiss_rounds_too_many` applies only when `avoid_repeats` is on, and compares the rounds with what a round robin of that field plays (`n - 1` for an even field, `n` for an odd one).

`metric_unproduced` uses the production table of the standings engine: `points`, `wins`, `losses`, `games_played` and `seed` always; `kill_differential` needs `features.killStats`; `rating` needs `features.rating`; `buchholz` needs a round-robin or Swiss stage with two players per match; any other key is `unknown_metric`. The reasons are `unknown_metric`, `needs_kill_stats`, `needs_rating` and `needs_opponents`.

The threshold expression on an edge sees the standings of its **source** stage: the references `points`, `wins`, `losses`, `games_played`, `rank`, `group_rank` and `participants` (plus `kill_differential` and `buchholz` when the stage produces them), and the collection `standings` with the same fields, sized by the plan (256 when unknown). Its result must be boolean.

**Fixes** never invent data the user has to choose: a diagnostic that needs a choice carries no fix. A fix is offered only when applying it adds no error: no fix removes the only rank step of a table stage or adds a step or selection beyond the document limits. Patches use `add` for members a stored document may leave to the schema's defaults and `replace` or `remove` only where the diagnostic proves the member exists.

### Client/server split

The browser may import `src/lib/format-kit/client.ts`. Its import closure holds **no zod, no `server-only`, no `@pkmn`, no `next`, no React and no Supabase**; it reaches outside the kit only for the i18n runtime (`core`, `config`, `format`, `define`, `types`), the two kit catalogs, `@/lib/season/format-capabilities` (type imports only) and `@/lib/tournament/round-robin` (pure, imports only its types). `client-boundary.test.ts` walks that closure and fails on anything else, and on any server file of the kit.

Server code imports `index.ts`, which adds the zod schemas (`schema/`, `expr/schema.ts`), the zod validator, the server registry and the zod compile entry. Both validators return the same `ValidationResult` (same issues in the same order, same normalised value, same notes), and a seeded fuzz test holds them together. `validate.browser.ts` is not an alias of the server file: nothing imports a `.browser` alias yet, so `client.ts` imports it by path, and the first release with a client consumer decides whether the bundler needs the alias that `format-pack` uses.

### Capabilities derivation

`deriveCapabilities(definition)` returns the same 15 flags as `getFormatCapabilities` in `src/lib/season/format-capabilities.ts`. A kit document starts with **every flag off**, on purpose different from the legacy baseline (`participantTypeAssignment` and `typeCores` are on there): attributes, cores and drafts do not exist in a kit document. Each `module.legacy` adapter then turns on the flags of the legacy format it stands for, flag by flag (`epb` is `evolution_point_buy`, `legacy_draft` is `draft`, `core_liga` is `singles`).

### i18n

Two namespaces, discovered on disk (no registry to edit): `format-studio` (the sentences for the diagnostic codes, the fix labels, severities and reason labels; a metric in a diagnostic is labelled from the `metric.*` words of the primitives namespace) and `format-studio/primitives` (label, summary and description for each primitive, field names, picker options, level and availability words). German uses real umlauts and neutral sentences; new copy has had no native review yet. The compiler stores codes and params only; `createTranslator(namespace, locale).dynamic(...)` renders after the read. See [i18n](./i18n.md).

### Dependencies

- **External libraries:** `zod` (server side only). Nothing else; the SHA-256 in `json.ts` is pure TypeScript so it runs in the browser and on the server.
- **Internal modules:** `src/i18n` (translator, formatter, locale config), `src/lib/season/format-capabilities.ts`, `src/lib/tournament/round-robin.ts`.

### Testing

- **Test Files:** `src/lib/format-kit/__tests__/` and `src/lib/format-kit/expr/__tests__/`.
- **Key Test Cases:**
  - Expression language: parser and printer tables, a print-parse round trip over generated ASTs, evaluation semantics, a type-check versus run-time agreement fuzz, and the pinned `seeded_rand` vectors. Fuzz tests use a seeded PRNG (`test-utils/prng.ts`) with fixed seeds; they never read a clock or `Math.random`.
  - Validators: schema limits, strictness (including an own `__proto__` key made with `JSON.parse`), and the parity test that feeds the same inputs to the zod validator and the browser one and compares the whole result.
  - Compiler: `compile.test.ts`, `diagnostics.test.ts`, `graph.test.ts`, `plan.test.ts`, `capabilities.test.ts`, `memo.test.ts`, `render.test.ts` and `fixes.test.ts`. `fixtures/negative.ts` holds at least one fixture per diagnostic code, each a small edit of a preset; every fixture must yield its code at its pointer, every fix patch must remove its diagnostic without adding an error, and every code must render in both languages.
  - `preset-parity.test.ts`: presets and fixtures give the same validation and compile result in both entries.
  - `client-boundary.test.ts`: the import closure of `client.ts`.
  - `source-safety.test.ts`: a scan of every kit source file for dynamic code, clocks, random sources, pattern construction from input, network calls, environment reads, `z.record` and `z.any` in schemas, and `any`.
- **Running Tests:** `npx vitest run src/lib/format-kit`.

### Related Modules

- [Format Packs](./format-packs.md): league tuning as data; the kit is a separate, document-level model and does not read packs.
- [i18n](./i18n.md): the translator and catalogs the renderers use.
- [Tournament](./tournament.md): the pairing generators and standings whose behaviour the plan mirrors.

### Not yet covered

- No database tables, routes, builder UI or generated rules page; no consumer in the app. A later release adds them.
- Reading an existing league into a definition (and checking it against live standings) is not part of this release.
- The engine does not yet run everything the document can say: round-robin legs and mirror, wildcard, threshold and bottom-N selection, bye scoring values and cross-stage views are described and validated only.
- Draws and forfeits are representable but refused (see `CURRENT_ENV`).
- Reserved primitives (attributes, relations, resources, event rules, constraints, drafting, time policies, further pairings) fail with `not_available_yet`.
- Inline rulesets (a stage names a ruleset by id or uses the season's) and ruleset lookups beyond an optional `env.rulesetIds`.
- Schedule and standings previews, simulators and machine translation of texts.
- A bundler alias for `validate.browser.ts` and a client bundle-size check wait for the first client consumer.
