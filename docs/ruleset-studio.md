# Ruleset Studio

> Rulesets as data: a document (a base preset plus per-category changes) that is edited as a draft, published as an immutable numbered version with its effective rules frozen, and pinned by the leagues and phases that enforce it.

## Overview

A ruleset says which Pokémon, moves, items and abilities a team may use, which battle clauses apply, and a few composition rules (team constraints, a shared-type share). Before the Studio a ruleset was one mutable row that every league read live; editing it silently changed running leagues, and "which ruleset does this phase enforce?" was answered by a read-time heuristic. Now:

- A **definition** (`ruleset_definitions`) is the library entry: slug, bilingual name, owner, visibility, the working draft and its revision.
- A **version** (`ruleset_definition_versions`) is an immutable snapshot, numbered per definition: the document (`spec`) and the **resolved rules** (`resolved`), the effective rules as dex ids, computed **once** at publish. Enforcement reads only the resolved rules, so correcting the preset catalog later never changes a published version.
- A league or phase **pins** a version: `seasons.ruleset_id` and `tournaments.ruleset_id` hold a version id. Publishing a new version changes nothing that is running; moving a pin is an explicit, audited act that shows its consequences first.

Spec: [`poketools-spec.md`](./poketools-spec.md) sections 4.7 and 9. The preset catalog the documents start from: [`ruleset-presets.md`](./ruleset-presets.md). Sibling system for formats: [`format-kit.md`](./format-kit.md); both Studios share `src/lib/studio-core` and `src/components/studio-shell`.

## File Structure

```
src/lib/ruleset-kit/              Pure, client-safe ruleset logic (the "kit")
├── types.ts                      RulesetDocument, CategoryRules, ResolvedRules, RULESET_SCHEMA_VERSION
├── validate.ts                   The one structural validator (hand-written; browser and server run the same code)
├── effective.ts                  computeEffective: document + preset rules -> ResolvedRules (also hashes' input)
├── compile.ts                    Structure + semantics + effective rules + hashes; diagnostics with JSON-patch fixes
├── ops.ts / entry-state.ts       Ban, unban, allowlist switch, clause toggles, rebase; every op pure and fuzz-tested
├── changes.ts / describe.ts      Counts against the base ("+3 banned"), the change list, plain-sentence description
├── overlay.ts                    "Add Smogon tour bans": applyTourOverlay
├── resolved.ts / legacy.ts       Strict reader of the stored resolved column; the flat legacy builder shape as a document
└── limits.ts                     3000 ids per list, 64-character ids, 256 KiB document

src/lib/ruleset-studio/           Server orchestration and rules around the library
├── access.ts / guards.ts         Who may do what; the live route guards (requireRulesetViewer / requireRulesetOwner)
├── gate.ts                       Live gate of the /admin/rulesets/[id] pages
├── library.ts / materialise.ts   Create, fork, save draft, publish, visibility, delete; the rulesets behind a format's preset stages
├── pins.ts / pin-change.ts       listUsage, movePins (compare-and-set), the check every ruleset_id change runs
├── pin-impact.server.ts          How many submitted teams a pin move would invalidate
├── pin-info(.server).ts          What a league shows about its pin: the version, a newer one, the change counts
├── staleness.ts                  isCatalogStale: the version was computed from older catalog data than this build has
├── version-changes.server.ts     What each recent version changed against the one before
├── exposure.ts                   Reading a version by an id nobody vouched for (public API, free validator, AI tools)
├── view.ts / names.server.ts     The flat Ruleset read model of a version; English display names of dex ids
├── legacy-bridge.ts              The old flat builder body on top of the library (POST/PATCH/DELETE /api/rulesets)
├── api-schemas.ts / api-body.ts / document-guard.ts / errors.ts / slug.ts    Envelopes, bounded body, error codes
└── editor/                       Browser-side editor logic: state, picker (layout, selection, bulk, history), catalog client, starts

src/lib/studio-core/              Shared by both Studios: access rules, keys, JSON canonicalisation and hashing, patch, bilingual text,
                                  identity extraction, editor state, targets, DB error mapping, bounded API body, slug retry
src/lib/supabase/queries/ruleset-definitions.ts   The library's database module (explicit columns, bounded lists)
src/lib/supabase/queries/rulesets.ts              Reads of the Ruleset read model by version id (getRulesetById, getHeadRuleset, option lists)

src/components/ruleset-studio/    Library views, the editor (editor/, sections/, picker/, summary/), starts/ (new, fork, preset lists)
src/components/ruleset/           What the rest of the app mounts: RulesetSelect, RulesetPinCard, UsagePanel, PinConfirmDialog,
                                  PinImpactNotice, RulesetDetail, RulesetPresetSelect, TeamConstraintsEditor
src/components/studio-shell/       Editor frame, toolbar, dialogs, library cards, useDraftEditor, unsaved guard (shared with the Format Studio)
src/app/admin/rulesets/           Library, read-only page, editor, catalog page
src/app/(public)/ruleset-preview/ Dev-only fixture preview (editor scenarios; /surfaces for the library, detail, pins, dialogs, trash)
```

## The document

```
RulesetDocument
  identity        name (bilingual), optional summary, optional based_on (the catalog id or slug it started from)
  base            { kind: 'preset', preset: 'gen9ou' }  or  { kind: 'blank', gen, doubles, universe }
  clauses         { add: [...], remove: [...] }          relative to the preset's clauses
  pokemon, moves, items, abilities
                  { ban: [...], unban: [...], allow: [...] | null }
  min_shared_type_pct, team_constraints, custom_rules
```

Entries are dex ids (`toID`: `tapukoko`, `stealthrock`), never display names. A category is either in **block** mode (everything is legal except the base's bans plus `ban`, minus `unban`) or in **allowlist** mode (`allow` is non-null: only the listed ids are legal, the base's list is ignored, and `ban`/`unban` must be empty). A preset whose own list is an allowlist (a roster such as Pokémon Champions, Little Cup) keeps that mode; the document can unban into or ban out of it.

`compile` runs the same pure function in the browser (the live summary) and on the server (publish). Diagnostics carry a code, a severity, a JSON pointer and, where a mechanical repair exists, a patch: `error` blocks a publish, `warning` and `info` do not. Codes: `invalid_structure`, `preset_unknown`, `entry_in_ban_and_unban`, `allowlist_with_bans`, `allowlist_empty`, `duplicate_entry`, `unknown_clause`, `clause_in_add_and_remove`, `unknown_entry`, `ban_redundant`, `unban_not_banned`, `clause_informational`. `unknown_entry` is server-authoritative (it needs the dex id sets); a client that has not loaded the catalog yet shows none, the server always does.

**Enforcement is stated honestly.** `validateTeam` enforces the four lists, the Species Clause, the Item Clause, `min_shared_type_pct` and `team_constraints`. Every other clause is *informational*: it is shown on the rules page and the editor marks it "shown, not enforced". The ban-style clauses (OHKO, Evasion, ...) are not expanded into move bans.

## Data Flows

1. **Create.** `POST /api/ruleset-definitions` (a whole document, a blank start, or a catalog preset with an optional tour overlay) or a fork of a stored ruleset or of a preset. The new definition is `private` and owned by the caller.
2. **Edit.** The editor saves the draft with `PUT .../draft`, a compare-and-set on `draft_rev` (409 `ruleset_stale_revision` carries the current revision). A draft may be invalid; saves are not audited and change no league.
3. **Publish.** `POST .../publish` compiles, refuses on any error diagnostic, and the database function `ruleset_publish_version` locks the definition, compares the draft revision, numbers the version, stores the document and the frozen resolved rules with their hashes and the `catalog_version`, and points `current_version_id` at it, all in one transaction.
4. **Share.** `PATCH .../[id]` changes the visibility: an owner moves between `private` and `league` (every admin sees it), a site admin also to `gallery` (the site's own rulesets). Sharing needs a published version.
5. **Pin.** A league, phase or standalone tournament form picks a version through `RulesetSelect`; `PATCH /api/seasons/[id]` etc. check `assertRulesetUsable` (the ruleset exists and the actor may see it) on every change of the value. Once a target has started, the pin cannot be re-pointed through a plain edit.
6. **Move.** The pin card of a league or phase offers "update to version N" when a newer version exists. `POST .../pins/impact` first counts the submitted teams that would stop being valid; `POST .../pins` then moves up to 50 targets (below).
7. **Enforce.** `getRulesetById(pin)` returns the Ruleset read model of the pinned version; `validateTeam` reads `ruleset.rules`. The enforced ruleset of a phase is simply its own pin.

### Pins and their moves

`movePins` (`pins.ts`):

- The caller must administer every target (a site admin, or a resource admin of the league or phase, read live) and may see the ruleset.
- Every target must pin a version of **this** ruleset now. A target that has **started** needs its id in `confirm_started` (409 `ruleset_pin_confirm_required` names the targets and writes nothing). A **completed** target is refused (`ruleset_pin_locked`).
- The check is all-or-nothing up front; the writes then run one by one, each a compare-and-set on the version the caller saw, so a pin that moved meanwhile is a conflict, not an overwrite. A failed compare-and-set stops the run and the answer lists what moved, with the difference between the two versions' frozen rules.
- One audit event `ruleset.pin` per moved target; the route expires the read caches.

**Impact count** (`pin-impact.server.ts`, `POST .../pins/impact`). The question the confirmation dialog of a started target asks: how many already-submitted teams would stop being valid under the target version? It runs the real validator against the frozen rules of both versions, team by team, and counts a team only if it is **valid under the version the target pins now and invalid under the target version** (differential: a team that is invalid anyway is not counted, and rules the move does not touch, such as draft ownership and Evolution Point Buy limits, cancel out). A league target covers the league's own teams (no phase), a phase or tournament its tournament teams; a league's move does not count its phases' teams, because phases pin their own. Teams that can no longer change (locked, or linked to a completed match) are not checked. Player cores are read in one bulk read, and only when either version has team constraints. At most 2000 teams are validated per request over all targets; `truncated` says the bound was reached. The route writes nothing and has its own rate limit (60 per hour). In the dialog, Confirm is disabled while the count is being made; a failed count shows its reason and does **not** block the move, since the server's `confirm_started` still guards it.

### Catalog staleness

A version freezes the `catalog_version` (`PRESET_RULES_VERSION`) it was computed with. `isCatalogStale` (`staleness.ts`) is true when the version's base is a catalog preset (`spec.base.preset`, read as a JSON path, never the whole document) and its `catalog_version` differs from the running app's. A blank base and a converted legacy ruleset (`catalog_version` `legacy`) never go stale. Because there is one version string for the whole catalog, any change of catalog data marks **every** preset-based published version stale, not only those whose preset changed. The library cards and the version list show a "Catalog updated" badge; running leagues keep the frozen rules on purpose, and the owner publishes again to pick up the corrected data.

## Who may do what

The rules are `src/lib/studio-core/access.ts`, bound to rulesets in `ruleset-studio/access.ts`. `isAdmin` is always the **live** site-admin flag from a `require*` guard, never the token's copy.

| Action | Site admin | Owner (any admin tier) | League admin of a league-owned ruleset |
|---|---|---|---|
| View (published versions) | all | own | + that league's ruleset; shared (`league`, `gallery`) rulesets are visible to every admin |
| Edit the draft, delete | all | own custom rulesets | the league's ruleset |
| Publish a version | all | own, except a `gallery` ruleset | the league's ruleset, except `gallery` |
| Change visibility | any change | `private` <-> `league` only | no |
| Use (pin, attach) | needs the right to see it **and** a published version | same | same |

A `kind = 'preset'` row (a site catalog ruleset written by the seed route) is edited by site admins only. A ruleset a format attach created for one league (`season_id` set) is also managed by the admins of that league. Usage: counts per version for everyone who may see the ruleset, the **names** of leagues and phases only for site admins and the admins of a league-owned ruleset (the owner of a shared ruleset learns how many leagues use it, not which). A version id is the capability to read that version, so the public routes serve a version of a **private** ruleset only while a league or phase pins it (`exposure.ts`).

## Pages and components

| Page | What it is |
|---|---|
| `/admin/rulesets` | The library (`RulesetsGalleryView`): **Your rulesets**, **Shared with you**, **League rulesets** (made when a format was attached to a league), the **Site catalog** (the seeded rulesets) and the **Rule presets** (Showdown formats and Smogon draft formats), as cards with state badges (draft or published version, shared, gallery, league, site), a usage line ("Used by 2 leagues, 3 phases"), the owner and the catalog-updated badge. **New ruleset** opens a dialog: blank, from a rule preset (optionally with the Smogon tour extras), from a shared ruleset, from a `.json` file. Open to every admin tier. |
| `/admin/rulesets/[id]` | Read-only page (`RulesetPageView`): the rules of the newest version in plain sentences (`RulesView`), the version list with what each of the newest 10 changed against the one before (from the two frozen rules, so a version that only picked up corrected catalog data is visible), the usage panel and the pin card. An editor of a ruleset with no published version sees the saved draft. |
| `/admin/rulesets/[id]/edit` | The editor. Only those who may edit the draft stay; anyone else who may see the ruleset is sent to the read-only page. |
| `/admin/rulesets/catalog/[presetId]` | One catalog preset in plain sentences, with "Create a ruleset from this preset" and, for a draft preset with documented tour extras, a second start that adds them. |
| `/admin/rulesets/new` | Redirects to the library. |

**Editor.** Built on `studio-shell` (`EditorLayout`, `EditorToolbar`, `useDraftEditor`, the five dialogs, the unsaved guard): an outline of sections (Base, Clauses, Pokémon, Moves, Items, Abilities, Team constraints, Notes), a live summary against the base ("vs Gen 9 OU: +3 banned, 1 unbanned"), an issues list with a one-click fix per diagnostic, an undo history (200 list states, cleared by rebase, tour overlay and fixes), a change list with a revert button per entry, Save draft, Publish and Share.

**Entry picker** (`components/ruleset-studio/picker`). A virtualized list (`@tanstack/react-virtual`) over the catalog of one generation (`GET /api/pkmn/catalog/[kind]`), as cards, a compact list or a table (the density defaults to the plain table under `prefers-reduced-motion` or `prefers-contrast: more`). Search in both languages, facets (state, type, tier, generation, number ranges, item category, forme), sort per kind, "include formes", multi-select with a bulk bar (ban, unban, allow, reset), keyboard navigation (focus stays on the listbox container with `aria-activedescendant`), announcements for screen readers. Row heights are fixed pixel values that assume the app's 18 px root font size (`layout.ts`), so no row is measured; compact rows size by cell width, and the table density is a plain paginated table that is not virtualized. Preferences live in `localStorage` under `ruleset-studio:picker:v1`. Details of the gotchas: [`dependencies.md`](./dependencies.md).

**Consumers (`components/ruleset`).**
- `RulesetSelect` is the version-aware select of the league, phase and tournament forms (`listRulesetOptionsFor`): the head version of each ruleset the actor may use, plus every version the form already holds (`keep`: the pins of the league and its phases) so an older pin is never shown as something else; rulesets a format attach made for **another** league are left out; doubles rulesets sit in their own group.
- `RulesetPinCard` (league, phase) and `UsagePanel` (read-only page): the pinned version, a newer one, the change counts, and the update flow described above (`PinConfirmDialog`, `PinImpactNotice`, `use-pin-impact`, `pin-change-text`).
- The league Settings select is **read-only once the league has started and has a ruleset** (`isRulesetPinLocked`, the same test as the server; a started league without a ruleset stays editable because its first pin is still accepted): the pin card is the way to a newer version. The clone-source box of "Start from" shows the source's pinned ruleset line ("Starts with the same rules as the source: <name>, version N").
- `RulesetDetail` (public rules view): the version, informational clauses marked, allowlists, icon chips.
- `NameListEditor` (`names-adapter`) converts between names and ids for the draft-league banlist editor and keeps unknown entries visible.

## Interplay with the Format Studio and the league trash

- A format stage's ruleset is `{ kind: 'season_default' }`, `{ kind: 'ruleset', id }` (a **definition** id) or `{ kind: 'preset', preset }` (a catalog id; it only pre-picks settings). Attaching a format to a league creates **one ruleset definition per distinct preset**, owned by that league (`private`, `season_id` set), based on the preset with no changes, published as version 1; the phase pins that version. `season_formats.preset_rulesets` maps preset id to definition id, so a re-attach reuses the definition (and pins its current head, keeping what the admin edited) and a detach or re-attach deletes the ones nothing uses any more (`format_delete_unused_preset_rulesets`, in the same transaction as the stages). Admins of that league manage the ruleset in the Studio.
- A league in the recycle bin holds its ruleset versions in the junction table `league_trash_rulesets` (`ON DELETE RESTRICT`), so the database refuses to delete a ruleset a trashed league still uses; the cleanup function above skips it and the API answers its own 409. See [`season.md`](./season.md#league-recycle-bin).

## API

All routes use the `{ success, data } | { success: false, error, code }` envelope and `safeErrorResponse`. The route table is in the spec (section 5); order of checks in a write route: guard, edit rule, rate limit, bounded body, document pre-check, envelope, database.

| Bucket | Limit |
|---|---|
| `ruleset-create` | 20 per hour (create, fork, preset fork) |
| `ruleset-draft` | 300 per 10 minutes |
| `ruleset-publish` | 30 per hour |
| `ruleset-write` | 60 per hour (visibility, delete) |
| `ruleset-pin` | 30 per hour |
| `ruleset-pin-impact` | 60 per hour |

The public `GET /api/rulesets` and `GET /api/rulesets/[id]` keep their URL and flat shape (names in `bans`, `additions`, `clauses`) and add `gen`, `universe`, `allow` and `version`. `id` is a **version** id; a version is immutable, so the answer for an id never changes. `POST /api/rulesets` and `PATCH/DELETE /api/rulesets/[id]` remain for site admins as a bridge for the flat body of the old builder; a ruleset that uses a preset base, an allowlist, an unban of anything but a Pokémon or removed clauses is read-only there (`ruleset_legacy_editor_unsupported`) instead of being flattened. The old builder UI is gone (`RulesetBuilder`, `ClauseToggleGrid`, `BanlistEditor`, `FormatChangeDialog`).

Audit events (`docs/audit.md`): `ruleset.create`, `ruleset.fork`, `ruleset.publish`, `ruleset.visibility`, `ruleset.delete`, `ruleset.pin` (one per moved target, resource type `season` or `tournament`, with the before and after version id) and `ruleset.seed`. Draft saves and the impact check write nothing.

## Upgrading from the single-table model (expand / contract)

Three migrations, applied by a maintainer in this order around the code deploy:

1. `20261026100000_ruleset_definitions.sql` adds the two tables and `ruleset_publish_version()`.
2. **Pre-flight (read-only).** `node scripts/ruleset/report-unknown-ids.mjs rulesets.json --sql-fold folds.json` (the read-only export queries are in its header) lists the legacy entries whose conversion to an id is not the identity of what the old validator did. `foldedOnly` entries (`Mr Mime`, `Tapu-Koko`) become *stricter* after the conversion, because the old exact-name compare never matched them and the id fold does: the maintainer decides per entry. `foldMismatch` must be empty (exit code 2 otherwise): the SQL fold and the application fold have drifted.
3. `20261026100100_ruleset_conversion_and_pins.sql` (**expand**) converts every legacy ruleset into a definition with one published version **whose id is the legacy row's id**, so every pin, URL and golden file keeps its meaning; replays the old resolver once into `tournaments.ruleset_id` and the leagues' defaults (every changed row is logged in `ruleset_pin_backfill_log`; `ruleset_replay_preview()` is the same logic without writes, for a dry run); and adds the pin foreign keys. It is safe for the code that is still deployed. From here until step 5, **pause ruleset creation and editing**: a ruleset created or edited with the old code is not seen by the new code, and a version published after this file cannot be pinned until the contract file removes the old key.
4. Deploy the app and verify a league page, a team validation and a format attach.
5. `20261026100200_ruleset_contract.sql` (**contract**) runs a catch-up conversion, aborts listing any ruleset that was edited after the conversion (publish the edit as a new version or restore the row, then retry), swaps the pin foreign keys to the version table (keeping their names, so error mapping holds), renames `rulesets` to `rulesets_legacy` (closed to every API role, kept for one release as the revert source), and drops the one-time helpers. A cleanup migration after the next release drops `rulesets_legacy` and the backfill log.

The conversion is behaviour-exact: a blank base of the old generation and game type, the standard universe, the old ban arrays as ids, the old added Pokémon (minus banned ones, which won before and still win) as `unban`, the old clauses as clause ids. No preset is guessed from the old base format: the old preset data was an approximation, and re-expressing a stored list against the corrected presets would change what is enforced. `format_key` keeps the old `base_format` verbatim (usage statistics and tiers keep their key); `catalog_version` is `legacy`.

## Testing

- `src/lib/ruleset-kit/__tests__` (ops are fuzzed: never throw, never mutate, never duplicate), `src/lib/ruleset-studio/__tests__`, `src/lib/studio-core/__tests__`, `src/components/ruleset-studio/__tests__`, `src/components/ruleset/__tests__` (static markup plus the pin-impact flow), `src/app/api/ruleset-definitions/**/__tests__`.
- Shared fixtures: `src/test/ruleset-fixtures.ts` (`makeRuleset`, `makeRulesetOption`), `src/test/local-rulesets.ts`; `legacy-oracle.ts` keeps the old resolver and validator as the differential oracle.
- **Local database tests (opt-in, never CI).** `LOCAL_RULESETS=1` for the library; `scripts/ruleset-lab/rehearse.sh [out-dir]` rehearses the three migrations on the local Supabase stack with legacy fixtures and ends with `db reset --local`; then `RULESET_REHEARSAL_DIR=<out-dir> npx vitest run src/lib/ruleset-studio/__tests__/ruleset-conversion.local.test.ts`. Never point these at a hosted project.
- **Visual check.** `/ruleset-preview?scenario=ou-edited` (also `blank`, `allowlist`, `roster`, `gen3`, `issues`, `published`, `unreadable`; `&lang=de`) renders the real editor against an in-memory library; `/ruleset-preview/surfaces` renders the library, the read-only page, the pin and usage panels, the dialogs, the league trash and the Danger tab with an in-memory `fetch` that refuses every `/api` path it does not fake, so no preview reaches a database.

## Related

- [`ruleset-presets.md`](./ruleset-presets.md): the catalog of rule presets, its data, its version and how to refresh it.
- [`format-kit.md`](./format-kit.md): the format side; stage rulesets, attach.
- [`pkmn.md`](./pkmn.md): `validateTeam`, the format catalog, the entry catalog route.
- [`season.md`](./season.md), [`admin.md`](./admin.md), [`i18n.md`](./i18n.md): pins in league settings, the admin pages, the `ruleset-studio` message namespaces.
