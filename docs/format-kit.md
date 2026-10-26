# Format Kit

### Overview

The format kit is a pure TypeScript library in `src/lib/format-kit/` that describes a league or tournament format as **data**: a versioned JSON document (the *format definition*) with stages, edges between them, rank chains, series lengths, scoring, rule cards and bilingual text. The library validates such a document, type-checks its expressions, computes what it implies (how many players reach each stage, how many rounds it plays, how big a bracket is) and reports what is wrong with it as **diagnostics**: a code, a severity, a JSON pointer and flat params, often with a one-click fix expressed as a JSON patch.

The Format Studio builds on the kit. A descriptor turns a live league into a definition (`describeLegacy`), the compiler checks it, and the admin pages (`/admin/formats`, and a Format tab on the league admin page) show a stage outline, the rules text in English and German, diagnostics in plain words and a coverage line. Behind the pages there is a **storage and server layer** (see Database and API): format definitions with drafts and immutable published versions, routes to create, save, publish, fork, share and delete them, and routes that attach a published version to a league of the type **Custom format** and create one phase per format stage. On top of that the Studio has an **editor** (see Editor): admins start a format from a blank document, an example, a league's structure or a `.json` file, edit it in a form with a live Issues, Rules and Schedule preview, save it with a revision check, publish it and share it. A league admin attaches a published version to a custom league in the Format tab, and a **readiness checklist** says what the league still needs before it can start (see Attach and readiness). What is still **not built**: the tournament engine does not run kit definitions (attaching only creates the phases; pairing, standings and advancement of those phases are the legacy engine's), and there is no mock-standings preview, sentence builder, flow canvas or simulator. The public pages are untouched. The preset definitions the kit ships compile without errors, but that says the *document* is consistent, not that the engine can already run it (the engine has no round-robin legs, wildcard, threshold or bottom-N selection yet).

What it gives a caller:

- `validateFormatDefinition(input)`: bounded, strict validation with the same result on the server (zod) and in the browser (a hand-written interpreter of plain data, no zod).
- `compile(input, env)`: validation, structure checks, stage graph with cycle detection, participant-flow plan, per-stage and per-edge checks, expression type checks and derived capabilities, memoised by content hash.
- `renderDiagnostic(d, locale, definition?)`: the sentence for a diagnostic, after the cached read.
- `describeDefinition(def, locale, opts?)`, `describeStage`, `definitionToPlainText`, `computeCoverage` and `describeCoverage`: the whole definition as readable text, with a coverage count (see Rules text renderer).
- `estimateSchedule(result, { players, roundDays })` and `minRosterFor(def)`: a pure schedule estimate (rounds, matches, byes, weeks) from a compile result, and the smallest roster a format needs (see Schedule estimator).
- A safe expression language for conditions (an edge's *threshold* selection today): a stored JSON AST, a text grammar, a static checker and an interpreter with hard limits.
- A primitive registry (manifest as plain data, server params schemas, per-primitive descriptions in both languages).
- Outside the kit, `src/lib/format-studio/` reads a league into a definition (`describeLegacy`) and shapes compile results for the pages (`FormatView`); see Reading a league and Format Studio pages.

### File Structure

```
src/lib/format-kit/
├── (keys, json, patch, ltext)  moved to src/lib/studio-core (shared with the Ruleset Studio): key, ref-name, kind, slug and uuid
│                      patterns; inspectJson, canonicalizeJson, sha256Hex, contentHash, deepFreeze; RFC 6901 helpers and
│                      applyPatch; the LText builder. types.ts and the barrels re-export them; there are no stubs here
├── limits.ts          document limits (re-exports the expression limits)
├── ruleset-presets.ts the kit's view of the rule preset catalog (src/lib/pkmn/format-catalog): isRulesetPresetId,
│                      applyRulesetPreset (what picking a preset pre-fills), withRulesetPreset
├── types.ts           the document types (hand-written, zod-free)
├── issues.ts          SchemaIssue, SchemaNote, ValidationResult, mapZodIssues, finalizeIssues
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
│   ├── describe-definition.ts  whole-definition renderer, coverage, plain text
│   ├── schedule.ts    estimateSchedule, minRosterFor (pure)
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
src/i18n/messages/format-studio/describe/    sentences of the whole-definition renderer
src/i18n/messages/format-studio/legacy/      names and fact labels of the league descriptor
src/i18n/messages/format-studio/admin/       the Studio pages and the league Format tab
src/i18n/messages/format-studio/editor/      the editor: toolbar, outline, inspectors, previews, dialogs, starts, list
src/i18n/messages/format-studio/attach/      the league side: attach panel, phase preview, engine gaps, readiness, status reason

src/lib/format-studio/                       the read-only Studio (not part of the kit)
├── legacy/            types.ts, describe-legacy.ts, overrides.ts, facts.ts
├── view.ts            FormatView, toFormatView, legacyCompileEnv (client-safe)
├── legacy-input.ts    rows of a league to LegacyInput (pure)
├── loader.ts          loadLeagueFormat, loadLeagueFormatSummaries, presetViews (server only)
├── library-types.ts   the stored library's row and answer types (client-safe)
├── errors.ts          FORMAT_ERROR_CODES, FORMAT_ERROR_STATUS, FormatStudioError, mapFormatDbError
├── access.ts          who may view, edit, publish, share, delete and attach a definition (pure)
├── slug.ts            slugFromName, withSlugSuffix (pure)
├── document-guard.ts  assertDocument: the bounded pre-check of a posted document
├── api-body.ts        readBoundedJson, readBoundedJsonOrEmpty, assertEnvelopeDocument
├── api-schemas.ts     the strict zod envelopes of the format routes, validationFailedResponse
├── identity.ts        extractIdentity, hasSummary, skeletonDocument
├── library.ts         create, fork, save a draft, publish, change visibility, delete, detail (server only)
├── materialise.ts     planStages, mapSeriesOverrides: kit stages to phase rows (pure)
├── attach.ts          attachFormatToSeason, detachFormatFromSeason and the readiness and type-change guards (server only)
├── gate.ts            gateFormatDefinition: live access plus the definition row for the edit and detail pages (server only)
├── attach-candidates.ts  loadAttachCandidates: the published formats an admin may attach, names only (server only)
├── readiness-loader.ts   loadLeagueFormatState: attached summary, manual phase count, start signals and readiness (server only)
├── editor/            the client-safe editing core: document.ts (normalise, blank), ops.ts (immutable edits), targets.ts (pointer to field),
│                      state.ts (reducer), api.ts (requests, error classes), preview.ts, catalog.ts, import-file.ts, starts.ts,
│                      readiness.ts, attach-preview.ts
└── __tests__/         fixtures/leagues.ts, describe-legacy, golden (with __snapshots__), view, legacy-input, loader, and the library tests (see Testing)

src/app/api/formats/                         the definitions API (list, create, read, visibility, delete, draft, publish, fork, example fork)
src/app/api/seasons/[id]/format/             attach, read and detach for a league

src/components/format-studio/                the client display components (FormatDetail and its parts)
├── editor/            FormatEditor, toolbar, outline, inspectors, fields, preview tabs, dialogs, unsaved guard
├── starts/            New format dialog and the fork and copy buttons
└── attach/            FormatAttachPanel, ReadinessCard, AttachPreviewList, attach-state.ts (the button rules)
src/app/admin/formats/                       the gallery, the example and league detail routes, the stored-format detail and edit routes
src/app/admin/leagues/[id]/_components/panels/FormatPanel.tsx   the Format tab (a custom league adds the readiness card and the attach panel)
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

A **stage** has a `key`, a `name`, a `participants` selector (`roster` with seeding `rating`, `random`, `manual` or `signup` and an optional `expected_count` of 2 to 4096; or `edges` with seeding `edge_order`, `rating`, `random` or `manual`), optional `groups` (`count` 2 to 26, `method` `serpentine` by default), a `pairing`, a `series`, a `ruleset` (`{ kind: 'season_default' }` by default, `{ kind: 'ruleset', id }` naming a stored ruleset DEFINITION, or `{ kind: 'preset', preset }` naming a catalog rule preset such as `gen9ou`, which only pre-picks the stage's battle settings: doubles, players per match and, for VGC, best of 3; nothing is locked), `doubles` (false), `players_per_match` (2 to 8, default 2), `scoring`, `rank` (0 to 12 steps, `[]`) and `columns` (0 to 12 metric keys, `[]`).

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
| `ruleset_preset_unknown` | error | `/stages/i/ruleset/preset` | `stage`, `preset` | `use_season_ruleset` |
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

Server code imports `index.ts`, which adds the zod schemas (`schema/`, `expr/schema.ts`), the zod validator, the server registry and the zod compile entry. Both validators return the same `ValidationResult` (same issues in the same order, same normalised value, same notes), and a seeded fuzz test holds them together. `validate.browser.ts` is not an alias of the server file: `client.ts` imports it (and `compile.browser.ts`) by relative path.

**Decision: no bundler alias.** Client code imports `@/lib/format-kit/client` and nothing else from the kit. The `format-pack` alias exists because server and browser import the *same* specifier; the kit has two entry files instead, so the entry file is the boundary. The Studio client-boundary test (`src/components/format-studio/__tests__/client-boundary.test.ts`) enforces it: every `use client` file under `src/components/format-studio` and `src/app/admin/formats` must reach no zod, `server-only`, `@pkmn` or Supabase, none of the kit's server files, and must not import the bare `@/lib/format-kit` specifier. The loader and the pages (server) import the server barrel and are never imported by a client module. The editing core under `src/lib/format-studio/editor/` is client code too: `editor-boundary.test.ts` walks its closure and fails on zod, `server-only`, `@pkmn`, Supabase, a kit server file or the loader, and checks that each file reaches the kit through `@/lib/format-kit/client` only. `materialise.ts` (`planStages`, used by the attach preview in the browser) keeps its own `STAGE_NAME_MAX_CHARS` constant instead of importing the zod-based field limits, so it stays inside that closure; a test pins the constant to the field limit.

### Capabilities derivation

`deriveCapabilities(definition)` returns the same 15 flags as `getFormatCapabilities` in `src/lib/season/format-capabilities.ts`. A kit document starts with **every flag off**, on purpose different from the legacy baseline (`participantTypeAssignment` and `typeCores` are on there): attributes, cores and drafts do not exist in a kit document. Each `module.legacy` adapter then turns on the flags of the legacy format it stands for, flag by flag (`epb` is `evolution_point_buy`, `legacy_draft` is `draft`, `core_liga` is `singles`).

### Rules text renderer

`engine/describe-definition.ts` turns a whole definition into readable text. It is pure, client-safe and exported from both barrels. Every function is total: nothing throws, a missing stage key gives `null`, and a malformed node falls back to its key or kind label.

| Function | Result |
|---|---|
| `describeDefinition(def, locale, opts?)` | a `DefinitionDescription`: `title`, `summary`, an `overview` sentence, one `StageDescription` per stage, the `advancement` sentences, `views`, `rules` (one `RuleCardDescription` per rule card), `modules` (label, summary and facts), `sections`, the `coverage` numbers and the `coverageLine` sentence |
| `describeStage(def, stageKey, locale, opts?)` | one `StageDescription` (name, summary, participants, groups, pairing, series, ruleset, scoring, doubles, rank steps and chain, expected counts, incoming and outgoing edge sentences), or `null` for an unknown key |
| `definitionToPlainText(description)` | the description as plain text: title, overview, the stage blocks, advancement, rules, modules (`label: value`), sections and the coverage line, under headings from the catalog; deterministic, no timestamps |
| `computeCoverage(def)` | the locale-free `Coverage` numbers (below) |

`DescribeOptions` has three optional parts. `plan` (the `plan` of a compile result) adds an `expected` sentence to each stage it has an entry for: the participant range, the rounds, and the byes or bracket size; without an entry `expected` is `null`. `order` (the `graph.order` of a compile result) sets the stage order; stages missing from it are appended in declaration order, and without it the declaration order is used. `rulesets` maps a stored ruleset id to its name for the ruleset sentence; an id it does not know reads as the generic "specific ruleset" sentence.

Names resolve with `resolveLText(text, { viewer: locale })`. The sentences for a stage, its pairing and series, a team ruleset, a group form, an advance rule, a rule card, a view and a legacy module come from `describePrimitive`; the rest (overview, participants, plan, edge, rule words, coverage, headings) from the `format-studio/describe` catalog. An advance rule shows stage **names**, never keys. Plural forms are `{one, other}`.

**Coverage.** `computeCoverage` returns `{ auto, checked, honor, legacy, total }`. The units are counted from the definition:

| Bucket | What counts |
|---|---|
| `auto` | per stage one pairing, one series and one scoring; one for the groups when the stage has them; one per rank step; one for a stage ruleset that names a stored ruleset or a rule preset; per edge one for each selection whose gate is `auto`; one per view |
| `checked` | each selection of an edge whose gate is `admin_confirm` (the engine computes the result, an admin confirms it) |
| `honor` | one per rule card (`rule.custom`): nobody enforces it |
| `legacy` | one per `module.legacy` |
| `total` | the sum of the four |

`coverageLine` is a catalog sentence that lists only the non-zero buckets (for example "7 automated, 2 confirmed by an admin, 1 honor rule, 1 legacy module"); a definition without any unit gets the "no rules" sentence. `describeCoverage(coverage, locale)` renders the same sentence from stored numbers (the gallery uses it for the list cards). The numbers say how the *document* is classified, not what the engine runs today.

### Reading a league: describeLegacy

`src/lib/format-studio/legacy/describe-legacy.ts` turns the live rows of one league into a read-only `FormatDefinition`. It is pure: no locale argument, no I/O, it never throws and never mutates its input. Both languages are written into the output texts, so the result is locale-free and can be sent to the browser; rendering happens later with the viewer's language. The output survives a JSON round trip unchanged and validates in strict mode (optional fields are omitted, never `undefined`). Numbers are clamped into the kit ranges but semantics are not corrected: an even best of stays even and the compiler reports it.

**Input** (`LegacyInput`, `legacy/types.ts`):

| Part | Content |
|---|---|
| `season` | id, name, description, `formatType`, `language`, ruleset id and name, `routeTheme`, participant count, core pool size (or `null`), league group count |
| `stages` | per phase: id, name, `bracketType`, `stageOrder`, `bestOfDefault`, `boOverrides`, `isDoubles`, ruleset id and name, `advancementRule`, `enrollmentSource` (type and source phase id only), `bracketResetEnabled`, group count |
| `pack` | the Evolution Point Buy pack values the descriptor needs (`matchPoints`, `tiebreakerChain`, `teraByStage`, `defaults`, `stageLock`, `participationPoints`, `comeback`) |
| `facts` | per-format extras: `typeAssignments` (gym-typed and cored counts) or `null`, `formatRules` or `null`, `draftTierLimits` or `null` |

Pack values enter only through `input.pack`; `describeLegacy` does not import the pack module, so tests inject literals.

**Stages.** Stages are sorted by `stageOrder` (stable by input order) and the first 50 are kept; keys are `stage_1` to `stage_n`. The definition's name is the league name; its summary is the league description when that is not empty. Every name taken from the database (league, phases) becomes an `LText` with the same cleaned string in English and German (NUL removed, trimmed, cut to 4000 characters; an empty phase name falls back to the catalog's "Phase n"), with `base` set to the league language, so no "untranslated" note is raised for proper names. `theme.world` is the league's route theme when it is a valid key, else `auto`. A league without phases gives `stages: []`, which is invalid by design; the loader never compiles it.

| Legacy `bracket_type` | Kit pairing |
|---|---|
| `round_robin` | `round_robin`, `legs` 1, `mirror_legs` true |
| `swiss` | `swiss`, `rounds` `auto`, `avoid_repeats` true |
| `single_elim` | `single_elim`, `third_place` false |
| `double_elim` | `double_elim`, `bracket_reset` = `bracketResetEnabled !== false` |

The series is `best_of` = the phase default with `allow_draw` false. A stage is doubles when the phase flag or the league format says so (`players_per_match` stays 2). The ruleset is `{ kind: 'ruleset', id }` when the phase names a uuid different from the league's ruleset, else `season_default`.

**Groups.** A stage has groups when its own group count is at least 2; a round-robin stage without its own groups inherits the league group count when that is at least 2 (phases mirror the league groups, which may not be generated yet). The count is capped at 26. The method is `manual` when the league has groups (they are placed in the league groups editor), else `serpentine`. Fewer than 2 groups give no `groups` field.

**Participants and edges.** Stage 1 takes `{ from: 'roster', seeding: 'manual' }`. For a later stage *k*:

| Case | Result |
|---|---|
| (a) enrollment source `standings` whose source phase is an earlier kept stage *S* | an edge *S* to *k*; the selection is *S*'s advancement rule, or a `manual_list` when it has none |
| (b) no enrollment source, or one that is not `roster`, and stage *k-1* has an advancement rule with a count of at least 1 | an edge *(k-1)* to *k* with that rule |
| (c) otherwise | `{ from: 'roster', seeding: 'manual' }` and no edge |

A stage with an incoming edge takes `{ from: 'edges', seeding: 'edge_order' }`. An advancement rule becomes `per_group` (`n` clamped 1 to 64) when it is per group, else `top_n` (`n` clamped 1 to 1024); the edge has seeding `rank` and gate `admin_confirm`. Edge keys are `advance_{from}_{to}`. **The rule stored on a phase is read as the edge out of that phase**, as the phase form hint and the phase timeline do. A rule that no edge consumes (the last phase, or a next phase enrolled from the roster) becomes a text section, so nothing is dropped silently.

**Series overrides.** Legacy overrides are keyed by English round names. Names the kit can express become overrides; everything else becomes a bilingual text section `bo_stage_{k}` (one line per entry, bound to the stage).

| Phase type | Name | Kit override |
|---|---|---|
| `single_elim` | `Finals` | round 1 from `end` |
| `single_elim` | `Semifinals` | round 2 from `end` |
| `single_elim` | `Quarterfinals` | round 3 from `end` |
| `round_robin`, `swiss`, `single_elim` | `Round N` (N from 1 to 64) | round N from `start` |
| anything else (double elimination names, unknown names, N out of range) | | text section |

Overrides are sorted by round, then direction; at most 32 are kept; `best_of` is clamped 1 to 15.

**Scoring and rank.** This characterises today's code: the league hub and `computeStandings` for tables, `lib/tournament/byes.ts` for byes.

| Stage | Win | Loss | Bye | Rank |
|---|---|---|---|---|
| round robin (not Evolution Point Buy) | 3 | 0 | 0 | points, KO differential, Buchholz, wins (all descending; the `computeStandings` order) |
| Swiss (not Evolution Point Buy) | 1 | 0 | 1 (a Swiss bye scores as a win) | the same four steps |
| single or double elimination | 1 | 0 | 0 | none |
| table stage of an Evolution Point Buy league (round robin and Swiss) | the pack's match points for a win | 0 | 0 | the league's stored tiebreaker order when it is usable, else the pack's tiebreaker chain, step by step (below) |

The Evolution Point Buy rows use the helpers the standings use (`effectiveMatchPoints` and `effectiveTiebreakerChain` in `src/lib/tournament/standings-rules.ts`), so the description and the tables cannot drift apart. The stored order is `format_rules.tiebreaker_order`, edited on the league's Rules tab; an order the standings cannot use (empty, an unknown or repeated step, a decision match that is not last, or only a decision match) falls back to the pack's chain. A stored order without a decision match leaves ties open, and the compiler says so (`rank_open_ended`, a warning).

`draw` and `forfeit` are never set. The chain steps map as: `match_points` to points descending, `kill_difference` to KO differential descending, `head_to_head` to head to head (pairwise), `decision_match` to the decision match. `evolution_points` has no kit metric and is **omitted from the rank**; its position is kept as an Evolution Point Buy module fact.

**Modules and facts.** A module carries data only (`module.legacy` facts: a label and a string, number or boolean value; at most 64 per module) and never claims that the kit runs it. At most one module per adapter. Fact labels come from the `format-studio/legacy` catalog in both languages.

| Module | Present when | Facts |
|---|---|---|
| `core_liga` | the format is singles, doubles or draft **and** (the core pool is set, or any participant has a core, or any has a gym type) | core pool size, cores assigned and gym types assigned (the last two only when the counts were read), roster size |
| `legacy_draft` | the format is draft | the limit of each tier that has one |
| `epb` | the format is Evolution Point Buy | match points for a win; the 1-based position of each tiebreaker step in the order the standings rank by; Tera by stage 1 to 3; draft budget, picks, token ratio, token maximum and token maximum per line (from the format rules row or, without one, the pack defaults); whether the redraft is open; counts of banned moves and banned items; stage lock (enabled, stage, by matchday, suspended matchdays); participation points per matchday and until which stage; the Comeback earn window |

The capabilities derived from an Evolution Point Buy or draft descriptor equal `getFormatCapabilities` of that format; the `core_liga` descriptor's capabilities are a subset of the singles ones.

**Known approximations.**

- **Evolution points tiebreak.** The step is not in the kit's metric table, so the rendered Evolution Point Buy rank chain lacks it. Its position is in the module facts, and the golden snapshot makes the gap explicit. Registering it as a metric would close the gap.
- **Round-name overrides.** Only `Finals`, `Semifinals`, `Quarterfinals` and `Round N` map to round indexes. Double-elimination overrides are shown as text, not machine-readable.
- **Advancement direction.** The descriptor follows the phase form (the stored rule is the edge out of the phase). The enrollment sync reads the rule from the target phase. The descriptor shows the stored rule either way, and a rule nobody consumes appears as a text section. Auditing the direction is separate work.
- **Scoring split.** Round robin scores 3 per win, Swiss 1 per win with the bye scored as a win, and an Evolution Point Buy round-robin or Swiss table scores the pack's match points for a win with no bye points. The descriptor mirrors that split; a later single scoring specification must not change the golden snapshots silently.
- **Real leagues can compile with errors or warnings** (an even best of, a top N larger than the roster, per-group advancement before phase groups exist). They are shown in plain words, not hidden. `env.rosterSize` and the inherited league groups reduce the noise; only the fixtures must compile without errors.
- **Stored references only.** The ruleset shown is the one stored on the league or phase; the name-match fallback of the effective-ruleset lookup is not applied, so no extra read happens.

### Format Studio pages

The Studio reads leagues, describes them, and lets admins write and publish their own formats. Reading a league never writes data, and public pages, standings, pairing, advancement and the Evolution Point Buy integration behave exactly as before.

| Route | Who | What |
|---|---|---|
| `/admin/formats` | any admin (the **Formats** entry in the competitions group of the admin sidebar) | the **New format** action (see Editor), **Examples** (one card per preset, marked "Example", with a "Use as a starting point" fork), **Your formats** and **Shared with you** (stored formats with a state badge: draft, published version, shared with league admins, in the gallery), and **Your leagues** (one card per league with stage count, pairing words, error and warning badges as text and the coverage line). Site admins see every league (up to 100, with a note when the cap is hit); league admins see their own non-archived leagues. Tournament-only admins can create and edit formats; their leagues list is empty. Standalone tournaments are not listed |
| `/admin/formats/example/[presetId]` | any admin | one preset in full, with a fork button; an unknown id is a 404; no data read |
| `/admin/formats/league/[id]` | site admins and admins of that league | one league in full, with a "Copy as a new format" button that creates a private format from the league's structure; gated by `gateResourceAdmin('season', id)` before any read (a non-uuid is a 404, another league's admin sees the forbidden notice); a league without phases shows an empty state that links to its Phases tab (a custom league's empty state has no link: its phases come from the attached format, and a hand-made phase would block the attach) |
| `/admin/formats/[id]` | the owner, site admins, and any admin the format is shared with | the read-only detail of a stored format: its published version, or the draft for someone who may edit it; actions Edit (when allowed) and Fork. Gated by `gateFormatDefinition(id)` (a non-uuid or unknown id is a 404, an admin who may not see it gets the forbidden notice) |
| `/admin/formats/[id]/edit` | the owner and site admins | the editor; anyone else who may view the format is redirected to the read-only page |

The league admin page shows the same content as a **Format** tab (`?tab=format`, every format, variant `tab`) with a link to the detail page. A **custom** league's tab adds, above the outline, the readiness card and the attach panel (see Attach and readiness); the overview tab of a custom league shows the readiness card too.

**Loader** (`format-studio/loader.ts`, server only). `loadLeagueFormat(league)` runs one wave of at most five reads: the league's stages, the stage group counts, the league group counts, and per format the type-assignment counts (singles, doubles, draft), the format rules (Evolution Point Buy) or the tier limits (draft). The league row comes from the caller. It returns `{ kind: 'no_phases' }` without compiling when there are no stages, otherwise `{ kind: 'ok', view, editorLinks }`; `editorLinks` point to the tab where each module is edited (rules for `epb` and `legacy_draft` when the format has that tab, participants for `core_liga`). `loadLeagueFormatSummaries(leagues)` makes three reads for any number of leagues (stages by season ids, chunked by 50 and paged past 1000 rows; stage group counts; league group counts) and adds the type-assignment counts of each classic league without a core pool, because they decide whether the Core Liga module exists and a module is one unit of the coverage line; the other per-league extras (format rules, tier limits) are not read, and modules add no diagnostics, so the error and warning counts are not affected. `presetViews()` compiles the three presets once per process. Nothing goes through a cache: the data is admin-only, and rendering stays after the read.

**`FormatView`** (`format-studio/view.ts`, client-safe, plain JSON, no locale) is the shape the pages hand to the browser: `ok`, `hash`, `definition`, `diagnostics`, `plan`, `order` (the graph order followed by any stage key missing from it), `capabilities`, `coverage` (`null` without a definition) and the `rulesets` names. `toFormatView(result, extras)` copies a frozen compile result into it; `legacyCompileEnv(participantCount)` is `CURRENT_ENV` with `rosterSize` set only for two or more participants.

**Client component.** `FormatDetail` is the one `use client` entry: title and summary, a counts badge, the stage outline, the rules text with an EN/DE toggle (it starts in the viewer's language; the state is the language key, never translated text; `aria-pressed` on the buttons), the diagnostics in plain words (errors first; no one-click fixes because nothing is editable), the coverage line and the module facts with the editor links. It renders with `describeDefinition` and `renderDiagnostic` in the browser, so both languages of the kit catalogs ship on these admin routes only.

**Golden master.** `src/lib/format-studio/__tests__/golden.test.ts` snapshots, for five generic fixture leagues (`fixtures/leagues.ts`: groups and playoffs, doubles, draft with double elimination, Evolution Point Buy, Core Liga style): the JSON of `describeLegacy`; the server compile result (`ok`, hash, diagnostic codes with severity and pointer, coverage, capabilities); and the plain text of the rules in English and German. Every fixture must compile with `ok` and no error. Later phases must keep these snapshots unchanged. Changed copy (a fact label, a sentence) is updated on purpose: run `npx vitest run src/lib/format-studio -u` and review the diff before committing.

### Editor

The editor is a form over a plain JSON document. Its logic is pure and lives in `src/lib/format-studio/editor/`; the components only compose it. The generic half is shared with the Ruleset Studio: the editor request, state and target helpers sit in `src/lib/studio-core` (`request`, `editor-state`, `targets`), and the frame, toolbar, the five dialogs (publish, share, fork, delete, changed-elsewhere), the unsaved-changes guard, `useDraftEditor` and the library cards are `src/components/studio-shell` (`FormatCard` is `studio-shell/library/LibraryCard`; `useFormatEditor` is `useDraftEditor` plus the format's compile, rows and counts). Format-specific bindings stay in `format-studio` (`access`, `slug`, `api-body`, `document-guard`, `document`: the new-format skeleton).

- **Starts.** A new format begins from a blank document (name and authoring language), a shipped example or a gallery format (a fork), a league's structure, or an imported `.json` file. "Copy a league's structure" is a button on `/admin/formats/league/[id]`; the New format dialog links there. The copy drops the league's module facts and resets named rulesets to the league default, because both carry league tuning values and per-community ids; the name and the rules text are kept.
- **Document model.** A stored draft is any JSON object. `normalizeDraft` fills the schema defaults for missing optional members, keeps unknown members untouched (the Issues tab offers to remove them) and refuses only shapes a form cannot show (a list that is not a list, an item that is not an object): the editor then shows an error panel with a download link and a confirmed "replace with a blank format". The baseline for "unsaved changes" is the canonical JSON of the normalised document, so opening a draft never starts dirty.
- **Operations.** Every edit is an immutable function in `ops.ts` (stages, edges, selections, rank chain, series exceptions, Honor cards, rules text sections, identity, theme): it never mutates its input, never throws for an out-of-range index, never produces a duplicate or malformed key, and stops at the document limits (the add button is disabled with the limit as its reason). Removing or renaming a stage key cleans every reference to it (edges, rule scopes, text sections, views). Reordering uses up and down buttons with a live-region announcement; there is no drag and drop.
- **Layout.** An outline (name and summary, look, stages, advancement, Honor rules, rules text) next to an inspector for the selection, with the preview panel below it (a third column from `xl`). Below `lg` the outline collapses into a disclosure above the inspector. Every control has a visible label; an error at a field is tied to it with `aria-describedby` and `aria-invalid`, in plain words. Draw and forfeit scoring are shown disabled with the reason (a match needs a winner today). A threshold selection is shown read-only as its printed condition and can be removed; editing conditions waits for the later builder.
- **Preview tabs** (an ARIA tablist). **Issues** lists the compiler's diagnostics as sentences with a "Go to field" button and the one-click fixes (and "Remove this field" for unknown or reserved members). **Rules** is the generated rules text. **Schedule** is the estimate below, for a chosen player count and cadence. The editor compiles with the known ruleset ids, so a ruleset that no longer exists is flagged before attach does; the publish route compiles without them, so the editor is at most stricter than publish.
- **Saving.** Explicit only: **Save draft** and Ctrl/Cmd+S (no autosave: the API allows 300 draft saves per 10 minutes). The save sends the revision it started from; on `format_stale_revision` the **changed elsewhere** dialog offers Reload (discarding unsaved edits after a second confirmation), Keep mine (adopts the server revision and saves again) or Cancel. An edit made while a save is running stays unsaved. The unsaved guard asks before a `beforeunload`, before a link click and on the browser's back button: while the editor is dirty it adds one history entry for the same address, and stepping back from it asks (Stay returns to the editor, Leave goes back once more). The entry stays after a save, so the first Back then simply continues. A publish that finds a newer revision opens the same dialog, at the revision the server named. Number fields take a point or, where decimals are allowed, one comma (`0,5`); a whole-number field refuses the comma.
- **Publish, share, fork, delete.** Publish shows the compile result (errors block it, warnings do not), takes an optional English and German changelog, saves first when there are unsaved changes, and creates the next version. Share chooses private, shared with league admins, or the gallery (site admins only); sharing needs a published version. Fork makes a private copy of the last published version. Delete is offered for a draft that was never published and is not attached.
- **Import rules.** The `.json` pre-check applies the API's limits in the browser (1 MiB, depth, node count, no NUL character, an object with a valid name), reports unknown fields and reserved sections by pointer, and offers to strip them. The file is parsed, never evaluated.

### Schedule estimator

`estimateSchedule(result, { players, roundDays })` (`engine/schedule.ts`, exported from the client entry) turns a compile result into a table: per stage the participants, rounds, matches, matches per player, byes and weeks, plus totals. It is pure (no clock, no randomness; `source-safety.test.ts` scans it) and returns `null` for an invalid document.

- **Round robin** with `c` groups and `L` legs: groups of `floor(p/c)` or `ceil(p/c)` players; a group of `g` plays `L*g*(g-1)/2` matches, each player `L*(g-1)`, and an odd group has `L*g` byes. **Swiss** with `R` rounds: `R*floor(n/2)` matches and `R*(n%2)` byes. **Single elimination**: `n-1` matches (one more with a third-place match), `ceil(log2 n)` rounds, `bracketSize - n` first-round byes. **Double elimination**: `2n-2` matches, plus one for a bracket reset (the upper bound). **Manual pairing**: everything is unknown and shown as a dash. A best-of counts as one match.
- Participant counts that are ranges (thresholds) are evaluated for every integer in the range and reported as a minimum and a maximum; elimination per-player counts are bounds, not exact numbers (the `precision` field says which).
- **Weeks** are `ceil(rounds * roundDays / 7)` per stage; the total is computed from the summed rounds, so stage rounding does not accumulate. Stages are counted one after the other, which is an upper bound for stages that could overlap. A cadence outside 1 to 28 days falls back to 7, and the player count is clamped to 2 to 4096 (the UI offers 2 to 256, default 8).
- `minRosterFor(def)` is the smallest roster that lets every roster-fed stage start: the largest of `groups.count * 2` (or 2 without groups) over those stages. The readiness checklist uses it.
- The tests cross-check the counts against the real generators (`generateRoundRobinRound`, the elimination structure builders) for 2 to 33 players.

### Attach and readiness

The Format tab of a **custom** league (`FormatPanel`) shows, in order, the readiness card (`id="format-readiness"`; it is about getting ready to start, so a league that has started does not get it), the attach section (`id="format-attach"`) and, once the league has phases, the read-only outline. Every other league type keeps its tab and makes no new read.

- **Attach panel** (`FormatAttachPanel`, a client component that gets plain props only: no spec, no seed, no player row). States: **started** (the format is locked: a notice, and only the attached summary stays), **attached** (name, version, the first 12 characters of the frozen hash with the full hash in a `title` and a Copy button, the attach time, the number of phases created, a link to the source format or a note that it was deleted, and **Re-attach** and **Detach**), and **unattached or re-attaching** (the picker). The picker is a grouped select of published formats the admin may attach (yours, shared with league admins, the gallery, and for site admins other admins' formats), loaded by `loadAttachCandidates` (at most 100, with a note when capped; names only).
- **Preview.** Choosing a format fetches its published version and runs `previewAttach` in the browser: the same compile and `planStages` the server runs. The list shows the phases that will be created (order, name in the league's language, bracket type, best of, doubles, and the ruleset as "Ruleset: <name> vN", "League ruleset: <name> vN" or, for a rule preset stage, "Creates the ruleset <preset>") and the parts of the format the engine does not run yet, one plain sentence per gap code (a best-of exception with no matching round, round-robin legs, a third-place match, wildcard, threshold and bottom-N selections, groups). A version with errors shows one fixed sentence and a link to the format instead.
- **Stage ruleset field** (stage inspector). Three kinds: the league default, a stored ruleset (a select of `<name> vN` options, the newest published version; the help says attaching pins that version and that later versions never change a running league, with a link "Open the Ruleset Studio"), or a catalog **rule preset** (`RulesetPresetSelect`, the shared picker of `src/components/ruleset`; picking one pre-picks the doubles setting and, for VGC, the series length; the help says the preset becomes a ruleset of the league, published as version 1, which the admin can change in the Ruleset Studio and then update the league to). A ruleset id the editor does not know shows "Unknown ruleset" and the compile reports `ruleset_not_found`.
- **Buttons.** Attach (or Re-attach) is disabled, with a visible reason, when the league has started, a request is running, nothing is chosen, the preview is still loading or invalid, a stage needs the league's default ruleset and the league has none (the league ruleset cannot be changed after creation, so the fix is a format that names a ruleset for every stage), or the league has hand-made phases (the notice links to the Phases tab). The reasons are decided by `attachButtonState` in `attach-state.ts`; the API enforces the same rules. Re-attach and Detach ask first. Failures show the catalog text of the error code (the `blocked` class in a warning style); after a write the page is read again, so the card and the outline follow the server.
- **Readiness checklist** (`computeReadiness`, `ReadinessCard`): four items, each Done, To do, or Waiting for the step above, always as words (the icon is decoration): a format is attached; the phases it defines are created (and none are hand-made); enough players are registered for the format (`minRosterFor`); every stage has a ruleset. An item still to do links to the tab, and for the picker the anchor, where it is fixed. A league that is ready shows one line. The card is shown on the overview tab and the Format tab of a custom league and renders nothing for any other type.
- **What blocks.** Only the first item blocks: while no format is attached the **Active** status button is disabled and the reason is printed under the status control (`LeagueStatusControl` takes an optional `blocked` map; the current status is never blocked). The other unmet items only warn, because the API enforces only the attached format (the database trigger and the generate routes refuse a custom league without one).
- **Create flow.** Creating a league of the type Custom format opens its Format tab (`leagueCreatedHref`), where attaching a format is the first step; every other type opens the league as before.

### Database and API

Three migrations add the storage layer. Apply them in this order, before the code is deployed (the first must commit on its own, because a new enum value cannot be used in the transaction that adds it):

1. `20261024100000_season_format_type_custom.sql`: adds the value `custom` to the enum `season_format_type`. Irreversible.
2. `20261024100100_format_definitions.sql`: `format_definitions`, `format_definition_versions`, the immutability trigger and the function `format_publish_version`.
3. `20261024100200_season_formats_and_stage_columns.sql`: `season_formats`, the two `tournaments` columns, the functions `format_season_started`, `format_attach_season` and `format_detach_season`, and the trigger that keeps a custom league without a format from becoming active.

Every new table has row level security on, no policy, and grants to `service_role` only; every new function revokes execute from `PUBLIC`, `anon` and `authenticated` and grants it to `service_role`. The browser never reads these tables; every access is an API route or a server read.

**Tables**

| Table | Holds |
|---|---|
| `format_definitions` | One row per format: `slug` (unique, `^[a-z0-9][a-z0-9-]{0,62}$`), `name` and `description` (localized text objects; while the format is `private` they follow the draft's `identity` on every save, once it is shared with `league` or `gallery` a draft save leaves them alone, so other admins never see unpublished text, and the only write that changes them then is a publish: `format_publish_version` sets them from the published spec's `identity.name` and `identity.summary` in the same transaction that writes the version, clearing `description` when the spec has no summary), `kind` (`preset` or `custom`; every row the routes create is `custom`), `owner_id` (set null when the owner is deleted), `visibility` (`private`, `league`, `gallery`), `forked_from`, `current_draft` (jsonb, the document being edited, any JSON object up to 262,144 bytes of jsonb text), `draft_rev` (integer, starts at 1, +1 per save) and `current_version_id` |
| `format_definition_versions` | Published versions: `version_no` (1, 2, ... per definition), `schema_version`, `spec` (the PARSED definition, defaults applied), `content_hash` (SHA-256 of the canonical JSON of `spec`), `status`, `changelog` (localized text) and `created_by`. Immutable: a trigger refuses any change of `spec`, `content_hash`, `schema_version`, `version_no`, `definition_id` or `status` of a published row |
| `season_formats` | One row per league with an attached format: `definition_id` (set null if the definition is deleted), `version_no`, a frozen COPY of the `spec`, its `spec_hash`, `tunables` (`{}`), `engine` (`kit`), `seed` (random, 16 bytes as hex, never sent to a client), `frozen_at`, `amendments` (`[]`) |
| `tournaments` (two new columns) | `format_stage_key` (the kit stage a phase was created from, null for hand-made phases) and `stage_spec` (a frozen copy of that stage, `{ v, spec_hash, stage, mapped_bracket_type }`). A partial unique index on `(season_id, format_stage_key)` makes the attach an upsert. The `Tournament` mapper does not read either column, so neither reaches a client or a public cache entry |

Named constraints carry the size and uniqueness rules (`format_definitions_slug_key`, `format_definitions_draft_size`, `format_definition_versions_spec_size`, `season_formats_spec_size`); the error mapper turns a violation into a typed error by the constraint name. The size check measures the jsonb TEXT form, which is a few percent larger than the canonical JSON the kit measures, so a document just under 256 KB can pass the kit and fail the table: that answers 413 `format_document_too_large_to_store`, never a 500.

**Versioning and hash rule.** A draft is any JSON object; publishing compiles it with the kit and stores the parsed definition. `content_hash` is `contentHash(spec)` of that stored JSON. Attach recomputes the hash from the stored `spec`, never by parsing it again, so a later kit change cannot break an old version; a mismatch is a data fault (logged with ids, a generic 500, no detail to the client). Publishing a draft whose hash equals the latest version's is refused (`format_nothing_to_publish`). `format_publish_version` locks the definition row, compares `draft_rev`, numbers the version, sets `current_version_id` and refreshes the listed `name` and `description` from the published spec's identity in one transaction (the publish route then expires the `format-library` shelf, and the answer carries the refreshed row).

**Visibility and authorization.** Site admins can do everything; league and tournament admins (the "owner" tier) only ever see and change their own formats and the ones shared with all admins. The pure rules live in `access.ts`; the routes check them on the LIVE player and the definition row read from the database (`requireFormatViewer`), never on the token.

| | View | Edit draft, delete | Publish a version | Change visibility | Attach to a league |
|---|---|---|---|---|---|
| Site admin | any | any | any | any | any |
| Owner of a `custom` row | own | own | own, unless `gallery` | `private` <-> `league`, never from or to `gallery` | own |
| Another admin | `league` and `gallery` rows (summary and latest published spec only) | no | no | no | `league` and `gallery` rows |
| `preset` row (any non-site admin, owner included) | as shared | no (`format_preset_locked`) | no | no | as shared |

Sharing (`league`, `gallery`) needs a published version. A `gallery` format belongs to the site: its owner cannot publish a new version of it (`format_published_locked`) nor move it. Delete is limited to a format that was never published and is attached nowhere (`format_has_versions`, `format_attached`); an archive state comes later.

**Routes**

| Route | Guard and limit | Body | Success |
|---|---|---|---|
| `GET /api/formats` | any admin tier | query `scope` (`all`, `mine`, `shared`, `gallery`), `visibility`, `kind`, `limit` (default 50, max 100), `offset` | `{ items, total, limit, offset }` (an offset past the last row answers an empty `items` with the real `total`); `scope=gallery` answers `{ items }` from the cached shelf (60 s, tag `format-library`), which holds no owner and no draft |
| `POST /api/formats` | any admin tier, `format-create` 20 per hour | `{ document, slug? }` or `{ name, base_locale, slug? }` (a name holding a NUL character or a lone surrogate is a 400 `validation_failed`) | 201 `{ definition, check }` (a private custom format owned by the caller) |
| `GET /api/formats/[id]` | viewer | none | `{ definition, draft, published, versions, check }`; the draft, the version list (newest 100) and the check are for the owner and site admins |
| `PATCH /api/formats/[id]` | viewer, `format-write` 60 per hour | `{ visibility }` | `{ definition }` |
| `DELETE /api/formats/[id]` | owner or site admin, `format-write` | none | `{ deleted: true }` |
| `PUT /api/formats/[id]/draft` | owner or site admin, `format-draft` 300 per 10 minutes | `{ draft_rev, document }` | `{ draft_rev, updated_at, name, check }`; a compare-and-set, a stale revision is 409 with the current revision in `params.draft_rev` |
| `POST /api/formats/[id]/publish` | owner or site admin, `format-publish` 30 per hour | `{ draft_rev, changelog? }` | 201 `{ version, definition }` |
| `POST /api/formats/[id]/fork` | viewer, `format-create` | `{ slug? }` (optional body) | 201 `{ definition, check }`: a private copy of the latest PUBLISHED spec (the draft for the owner and site admins when nothing is published), `identity.based_on` = source slug, `forked_from` = source id |
| `POST /api/formats/presets/[presetId]/fork` | any admin tier, `format-create` | `{ slug? }` (optional body) | 201 `{ definition, check }`: a copy of a shipped example (a code constant); `based_on` = example id, no `forked_from` |
| `GET /api/seasons/[id]/format` | league admin of that league, or site admin | `?include=spec` | `{ status: 'not_custom' \| 'unattached' \| 'attached', can_start, started, season_format, spec? }` (no seed) |
| `POST /api/seasons/[id]/format` | league admin, `format-attach` 30 per hour | `{ definition_id, version_no? }` | 201 on a first attach, 200 when it replaced one: `{ season_format, stages, warnings }` |
| `DELETE /api/seasons/[id]/format` | league admin, `format-attach` | none | `{ removed_stage_ids }` |

Every write route reads its body in this order: guard, rate limit, bounded body (`readBoundedJson`: a 1 MiB raw cap, the `content-length` header checked before the body is read), the kit's `assertDocument` on the `document` member (plain JSON object, depth 64, 150,000 nodes, 262,144 canonical bytes), the strict zod envelope, and only then the database. The raw cap is above the canonical limit on purpose, so a client may send indented JSON. A draft may be an invalid format (the editor saves half-built ones); only publish and attach need a compile without an error diagnostic. Responses never contain a `players` row: an owner is `{ id, name }`. Every library write calls `expireFormatLibraryReads()`; attach and detach call `expireSeasonReads` with the created, updated and removed phase ids. Audit events (fire-and-forget): `format.create`, `format.fork`, `format.publish`, `format.visibility`, `format.delete`, `season.format.attach`, `season.format.detach`; draft saves are not audited.

**Attach.** `attachFormatToSeason` checks in this order, with bounded reads, and calls no database function when any step refuses: the league exists and is `custom` (`format_season_not_custom`); it has not started (`isSeasonStarted`: status `active` or `completed`, any phase that left `upcoming`, any phase with a round; `format_season_started`); the caller may attach the definition (`format_attach_forbidden`) and the version is published (`format_not_published`); the stored spec still hashes to the stored hash; the spec compiles without an error against the rulesets that exist and WITHOUT a roster size (`format_attach_invalid`, param `first` = the first error code; size-dependent problems belong to the readiness checklist of the editor); every `season_default` stage has a league ruleset (`format_attach_ruleset_required`); the league has no hand-made phase (`format_attach_manual_phases`). Then `format_attach_season` runs in one transaction that locks the league, repeats the started and manual-phase checks, writes `season_formats`, deletes the stages that left the spec (it proved them upcoming and round-free) and upserts the others by `(season_id, format_stage_key)`, so a re-attach keeps the id of every stage it still has. Detach (`format_detach_season`) removes the row and its stages; a team that points at a stage blocks it (`format_detach_blocked`).

**Rule preset stages.** A stage whose ruleset is `{ kind: 'preset', preset }` has no stored ruleset yet. The attach creates one ruleset DEFINITION per distinct preset (`ensurePresetRulesets` in `src/lib/ruleset-studio/materialise.ts`, through the Ruleset Studio library): owned by the league (private, `season_id` set, so the admins of that league manage it), based on the preset with no changes, published as version 1, and the phase pins that version. The effective rules, including a roster or Little Cup allowlist, are computed by the ruleset compile at that publish. `season_formats.preset_rulesets` records preset id to definition id: a re-attach reuses the definition (pinning its current head, so the admin's edits survive), and a re-attach or detach deletes the recorded definitions nothing pins any more, in the same transaction as the stages (`format_delete_unused_preset_rulesets`); a definition held by a league in the trash is skipped. If the attach fails after the definitions were created, the caller discards them, so a failed attach leaves no orphan. Details: [Ruleset Studio](./ruleset-studio.md#interplay-with-the-format-studio-and-the-league-trash), [Ruleset Presets](./ruleset-presets.md).

**Stage materialisation** (`materialise.ts`, pure). One `tournaments` row per kit stage, in the compiled graph order (`stage_order` counts from 1):

| `tournaments` column | From the stage |
|---|---|
| `format_stage_key` | `key` |
| `name` | the stage name resolved in the league language, cut to 200 characters, `Stage <n>` when empty |
| `bracket_type` | the compiled plan's mapped bracket type: round robin and manual to `round_robin`, `swiss`, `single_elim`, `double_elim` |
| `ruleset_id` | the pinned version of the named ruleset (its head at attach time); for a rule preset stage, the version 1 of the ruleset the attach created for that preset (below); else the league's ruleset |
| `best_of_default` | `series.best_of` |
| `bo_overrides` | the series overrides under the English round names the generators write (below) |
| `is_doubles` | `doubles` |
| `bracket_reset_enabled` | the double elimination's `bracket_reset`, else `true` |
| `stage_spec` | the frozen stage snapshot |

Series overrides map to `bo_overrides` names by bracket type: round robin and Swiss count from the start (`Round N`); from the end they need an exact round count. Single elimination names the last three rounds `Finals`, `Semifinals`, `Quarterfinals` (usable without a total) and the others `Round N`. Double elimination names depend on the bracket structure, so nothing maps. When two overrides land on one name the first wins. Overrides that cannot be named are returned as warnings, not dropped silently.

**Engine gaps.** The legacy engine runs the phases, but not everything the kit can say. Attach returns what it does not run as `warnings`, codes with params and no text (the next PR words them): `override_unmapped` (`stage`, `round`, `from`, `best_of`), `rr_legs_not_run` (`legs`), `third_place_not_run`, `edge_select_not_run` (`edge`, `kind`: wildcard, threshold, bottom_n) and `groups_not_created` (`stage`, `count`, `method`). Group creation, enrolment, advancement and pairing from the kit are Phase 2b.

**Readiness.** A custom league without an attached format cannot start. The database trigger `trg_seasons_require_attached_format` refuses a status change to `active` (`format_not_attached`, mapped by `updateSeason`) and is the backstop for every path; `POST /api/generate-round/[tid]` and `POST /api/tournaments/[id]/generate-bracket` check it first, before any round exists, and only for a custom league (the season type is already joined onto the tournament, so every other league type takes no extra read). `PATCH /api/seasons/[id]` refuses a change of `format_type` to or from `custom` while a format is attached or after the league started (`season_format_type_locked`); a change between the legacy types is untouched.

**Error codes.** `format_not_found`, `format_preset_not_found`, `format_stale_revision`, `format_slug_taken`, `format_document_not_json`, `format_document_not_object`, `format_document_too_deep`, `format_document_too_many_nodes`, `format_document_too_large`, `format_document_too_large_to_store`, `format_document_name_required`, `format_publish_invalid`, `format_nothing_to_publish`, `format_not_published`, `format_published_locked`, `format_visibility_forbidden`, `format_preset_locked`, `format_attached`, `format_has_versions`, `format_version_immutable` (catalog `errors/admin`); `format_season_not_custom`, `format_season_started`, `format_attach_forbidden`, `format_attach_invalid`, `format_attach_ruleset_required`, `format_attach_manual_phases`, `format_not_attached`, `format_nothing_attached`, `format_detach_blocked`, `season_format_type_locked` (catalog `errors/seasons`). The status of each code is in `FORMAT_ERROR_STATUS`; the database signals map in `mapFormatDbError`.

**Known limits.** The publish, attach and detach functions are single transactions, but `generate-round` takes no league lock: a round generated in the milliseconds between the attach's started check and its stage delete needs two admins acting at once, and the function only deletes stages it proved upcoming and round-free. Draft autosave is limited to 300 saves per 10 minutes per player.

### i18n

Seven namespaces, discovered on disk (no registry to edit): `format-studio` (the sentences for the diagnostic codes, the fix labels, severities and reason labels; a metric in a diagnostic is labelled from the `metric.*` words of the primitives namespace), `format-studio/primitives` (label, summary and description for each primitive, field names, picker options, level and availability words), `format-studio/describe` (the whole-definition renderer: overview, participants, plan, edge and rule words, coverage line, headings), `format-studio/legacy` (the descriptor's fallback phase name, the fact labels and the override and unused-advancement texts), `format-studio/admin` (the Studio pages and the league Format tab; casual "du" in German), `format-studio/editor` (the editor, the New format dialog and the format lists) and `format-studio/attach` (the attach panel, the phase preview with the engine-gap sentences, the readiness checklist and the status reason). API errors of the library and the attach routes are rendered from their codes with the existing error catalogs. The descriptor reads both languages of `format-studio/legacy` and stores them in the definition, so it needs no locale. German uses real umlauts and neutral sentences; new copy has had no native review yet. The compiler stores codes and params only; `createTranslator(namespace, locale).dynamic(...)` renders after the read. See [i18n](./i18n.md).

### Dependencies

- **External libraries:** `zod` (server side only). Nothing else; the SHA-256 in `src/lib/studio-core/json.ts` is pure TypeScript so it runs in the browser and on the server.
- **Internal modules:** `src/i18n` (translator, formatter, locale config), `src/lib/season/format-capabilities.ts`, `src/lib/tournament/round-robin.ts`.
- **Consumers:** the Format Studio (`src/lib/format-studio`, `src/components/format-studio`, `src/app/admin/formats`, the league admin Format tab). The kit imports nothing from them.

### Testing

- **Test Files:** `src/lib/format-kit/__tests__/` and `src/lib/format-kit/expr/__tests__/`.
- **Key Test Cases:**
  - Expression language: parser and printer tables, a print-parse round trip over generated ASTs, evaluation semantics, a type-check versus run-time agreement fuzz, and the pinned `seeded_rand` vectors. Fuzz tests use a seeded PRNG (`test-utils/prng.ts`) with fixed seeds; they never read a clock or `Math.random`.
  - Validators: schema limits, strictness (including an own `__proto__` key made with `JSON.parse`), and the parity test that feeds the same inputs to the zod validator and the browser one and compares the whole result.
  - Compiler: `compile.test.ts`, `diagnostics.test.ts`, `graph.test.ts`, `plan.test.ts`, `capabilities.test.ts`, `memo.test.ts`, `render.test.ts` and `fixes.test.ts`. `fixtures/negative.ts` holds at least one fixture per diagnostic code, each a small edit of a preset; every fixture must yield its code at its pointer, every fix patch must remove its diagnostic without adding an error, and every code must render in both languages.
  - `preset-parity.test.ts`: presets and fixtures give the same validation and compile result in both entries.
  - `client-boundary.test.ts`: the import closure of `client.ts`.
  - `source-safety.test.ts`: a scan of every kit source file for dynamic code, clocks, random sources, pattern construction from input, network calls, environment reads, `z.record` and `z.any` in schemas, and `any`.
  - `describe-definition.test.ts`: presets and fixtures render in both languages without leftover braces, empty strings or `undefined`, pinned coverage numbers, plan sentences, stage order, malformed input, plural forms and a deterministic plain text.
- **Studio tests:** `src/lib/format-studio/__tests__/` (`describe-legacy`, `golden`, `view`, `legacy-input`, `loader`), `src/components/format-studio/__tests__/` (the display component and the client-boundary test), `src/app/admin/formats/__tests__/` (gallery and detail pages), `src/app/admin/leagues/[id]/__tests__/format-panel.test.tsx` (the Format tab) and `src/lib/supabase/queries/__tests__/format-studio.test.ts`.
- **Library tests:** `src/lib/format-studio/__tests__/` (`api-body`, `api-schemas`, `library`, `materialise`, `attach`, and for the pure helpers `access`, `errors`, `slug`, `document-guard`, `document`; identity extraction is tested in `src/lib/studio-core/__tests__/identity.test.ts`, and the shared `keys`, `json`, `patch` and editor-state helpers in the rest of that folder), `src/app/api/formats/__tests__/` (`list-create`, `item`, `draft`, `publish`, `fork` and the `cross-owner` matrix, which runs the real guards), `src/app/api/seasons/[id]/format/__tests__/route.test.ts`, the guard cases in `src/app/api/seasons/[id]/__tests__/route.test.ts`, `src/app/api/generate-round/[tid]/__tests__/route.test.ts` and `src/app/api/tournaments/[id]/generate-bracket/__tests__/route.test.ts` (a custom league without a format is refused before any write; every legacy type is unchanged), and `src/lib/__tests__/write-route-tags.test.ts`, which walks the `formats` route tree and fails when a write handler does not expire the `format-library` tag. Route tests check, for every route: 401, 403, success, 400 validation, 429 with `Retry-After` and no write, a malformed id, no private player data in the body and the cache expiry.
- **Editor and league-side tests:** `src/lib/format-kit/__tests__/schedule.test.ts` (counts against the real generators), `src/lib/format-studio/__tests__/editor/` (document, ops with a seeded 500-operation fuzz, targets, state, api, preview, import-file, starts, readiness, attach-preview, catalog), `editor-boundary.test.ts`, `gate`, `attach-candidates` and `readiness-loader` tests, `src/components/format-studio/__tests__/editor/` (static-markup tests of the editor components in both languages) and `src/components/format-studio/__tests__/attach/` (`FormatAttachPanel`, `AttachPreviewList`, `ReadinessCard`: states, the button-state table, every engine-gap sentence in both languages), `src/components/league/__tests__/LeagueStatusControl.test.tsx` (the unchanged markup without the prop, a disabled and described Active button with it), `src/lib/league-admin/__tests__/created-href.test.ts` and the updated `format-panel.test.tsx` and `page.test.tsx` (new loaders only for custom leagues; the read counts of every other type unchanged).
- **Running Tests:** `npx vitest run src/lib/format-kit src/lib/format-studio src/components/format-studio src/components/league src/lib/league-admin src/app/admin/formats src/app/admin/leagues src/app/api/formats 'src/app/api/seasons/[id]'`.

### Related Modules

- [Format Packs](./format-packs.md): league tuning as data; the kit is a separate, document-level model and does not read packs.
- [i18n](./i18n.md): the translator and catalogs the renderers use.
- [Tournament](./tournament.md): the pairing generators and standings whose behaviour the plan mirrors.
- [Admin](./admin.md): the Formats pages and the league admin Format tab.
- [Season](./season.md): the league fields and phases that `describeLegacy` reads, and the Custom format league type with its attached format.
- [Supabase](./supabase.md): the three tables of the format library.

### Not yet covered

- The editor is form-based. There is no sentence or chip builder, no editing of threshold conditions (a condition is shown and can be removed), no flow canvas, no simulator and no AI drafting; views (combined standings) and legacy modules are preserved but not editable, and the base language and translation status of a text are not editable. There is no undo and redo, no version compare or restore, no "update available" prompt for leagues whose source format has a newer version, and saves are explicit (no autosave). Browser forward is not guarded while there are unsaved changes (back is). Exporting a format as a `.json` file and searching the list are not built.
- The engine does not run an attached format yet: attaching creates the phases, but pairing, standings, advancement, enrolment and group creation still follow the legacy engine, and attach reports the gap as warnings (see Engine gaps). `season_formats.tunables`, `amendments` and the `legacy` and `shadow` engine values stay at their defaults.
- The shipped examples are code constants, not rows: they can be forked into a stored format, but there are no `kind = 'preset'` rows yet.
- No generated public rules page; public pages are unchanged.
- The descriptor does not check itself against live standings, and standalone tournaments have no descriptor (tournament-only admins see the examples only).
- The engine does not yet run everything the document can say: round-robin legs and mirror, wildcard, threshold and bottom-N selection, bye scoring values and cross-stage views are described and validated only.
- Draws and forfeits are representable but refused (see `CURRENT_ENV`).
- Reserved primitives (attributes, relations, resources, event rules, constraints, drafting, time policies, further pairings) fail with `not_available_yet`.
- Inline rulesets (a stage names a ruleset by id or uses the season's) and ruleset lookups beyond an optional `env.rulesetIds`.
- A mock standings preview (it needs the Phase 2b scoring and standings code), the "try it" panel and machine translation of texts. The schedule preview estimates counts and weeks; it does not simulate a season.
- A bundle-size budget for the Studio client closure. Both languages of the kit catalogs ship on the admin routes that render the rules text; the routes are admin-only and route-split.
