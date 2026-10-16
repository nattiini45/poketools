# Challonge → PokéTools Mapping

A reference mapping of Challonge's tournament/league model onto the PokéTools codebase,
produced to evaluate replacing (or borrowing from) Challonge. Last updated 2026-08-22
(league phase revamp wave 1+2).

## Purpose

PokéTools and Challonge solve overlapping problems in different ways:

- **Challonge** — generic SaaS bracket engine: tournaments, events, communities,
  ratings, registration. Zero knowledge of Pokémon.
- **PokéTools** — self-hosted Next.js + Supabase app purpose-built for competitive
  Pokémon, with a *generic bracket core* (seasons / phases / rounds / matches) wrapped
  by Pokémon-specific engines (draft, Evolution Point Buy, teambuilder, replay parsing,
  Glicko-2 ratings).

The apples-to-apples surface is the **bracket core**. The Pokémon layer has no Challonge
equivalent and must remain ours.

## Data model quick reference

| Concept | Table / type | Key fields |
|---|---|---|
| League / season | `seasons` | `format_type`, `ruleset_id`, `status`, `core_pool`, `point_buy_list_id` |
| League roster | `season_participants` | `gym_type`, `core_types` — source for phase enrollment |
| Phase / stage | `tournaments` | `season_id`, `stage_order`, `advancement_rule`, `enrollment_source`, `bracket_type`, Bo settings, `status`, `current_round` |
| Phase enrollment | `tournament_participants` | `seed` per phase |
| Groups (two-stage) | `tournament_groups` + members | serpentine assign via phase groups API |
| Round / match | `rounds` + `matches` | `bracket_side`, `bracket_pos` on elimination rounds/matches |

Engine code: `src/lib/tournament/` (pairing, bracket-structure v2, propagation, serpentine) and `src/lib/season/` (format capabilities, substitute).

---

## A. Core model

| Challonge concept | PokéTools equivalent | Status |
|---|---|---|
| Tournament (single bracket) | `tournaments` row, standalone when `season_id = null` | ✓ direct |
| Two-stage tournament | `seasons` → phases (`tournaments` + `stage_order` + `advancement_rule`) | ✓ phase-first admin |
| "League Ready" (RR season → SE playoffs) | season with RR phase + SE phase + `advancement_rule` | ✓ close match |
| Event (group tournaments) | **no direct equivalent** — `season` is the grouping unit | ✗ gap |
| Community (recurring + ratings) | single-community (PLC); Glicko-2 in `src/lib/rating` | ✓ partial |

## B. Creation

| Challonge | PokéTools | Status |
|---|---|---|
| Name / URL / description | `PhaseForm` / `TournamentForm` + description | ✓ (no custom URL) |
| Game / Type / Format | `ruleset_id` + `bracket_type` + `season.format_type` | ✓ equivalent |
| Format presets (SE/DE/RR/Swiss/FFA/Leaderboard/Racing) | `bracket_type`: `single_elim`, `double_elim`, `round_robin`, `swiss` only | ⚠️ 4 of 6 |
| Best-of / sets per match | `best_of_default` + `bo_overrides` | ✓ |
| Doubles toggle | `is_doubles` | ✓ (Pokémon-specific) |
| Team visibility | `team_visibility` | ✓ (Pokémon-specific) |
| Registration fee / Stripe | none | ✗ |
| Start time / check-in / region lock / blocklist | season dates only; no check-in/region/blocklist | ⚠️ partial |
| Custom fields / sign-up page | none (Discord-auth roster) | ✗ |

## C. Participant management

| Challonge | PokéTools | Status |
|---|---|---|
| Add by display name (no account) | ✓ admin guest players (`is_guest`, `POST /api/players`) | ✓ (admin-only) |
| Invite by email / username | n/a — Discord OAuth primary | n/a |
| Bulk add (paste list) | ✓ `LeagueRosterManager` multi-select bulk add | ✓ |
| Edit name | roster-bound names | ✗ |
| Substitute | ✓ `POST /api/seasons/[id]/participants/substitute` + `SubstituteDialog` | ✓ |
| Remove / forfeit | remove participant | ✓ |
| Sign-up page (self-register) | no self-registration | ✗ |
| Check-in | no | ✗ |
| Waiting list / participant cap | no | ✗ |
| Teams / roster mgmt | draft + EPB team systems | partial |
| League extras | gym types, Core Liga cores | Pokémon-only |

## D. Seeding

| Challonge | PokéTools | Status |
|---|---|---|
| Manual seed numbers | ✓ `SeedingTable` seed inputs + save | ✓ |
| Drag-drop reorder | ✓ `SeedingTable` drag handle + keyboard up/down | ✓ |
| Shuffle seeds (random) | ✓ Fisher–Yates shuffle in `SeedingTable` | ✓ |
| Seed by rating | ✓ `POST .../participants/seed-by-rating` | ✓ |
| Auto-enroll from standings | ✓ `sync-standings` + auto on phase create (frozen after manual edit / bracket gen) | ✓ |
| Traditional vs list-order pairing | single-elim uses `bracketOrder` traditional seeding | ⚠️ no toggle |
| Serpentine auto-grouping | ✓ `serpentine.ts` + `PhaseGroupsPanel` | ✓ |

**Algorithmic differences (unchanged):**

- Swiss round 1: PokéTools pairs **1v2, 3v4**; Challonge pairs **first half vs second half**.
- Swiss tiebreak: PokéTools uses **Buchholz**; Challonge uses **Median-Buchholz**.

## E. Bracket management

| Challonge | PokéTools | Status |
|---|---|---|
| Single elim (byes, bronze match) | ✓ Bracket Engine v2; byes yes; **no bronze match** | ✓ / ⚠️ |
| Double elim (full WB/LB/GF upfront) | ✓ `bracket-structure.ts` + propagation on match complete | ✓ |
| Round robin (2x/3x) | ✓ circle method; **single round only** | ✓ / ⚠️ |
| Swiss | ✓ `swiss.ts` (Monrad) | ✓ (diff tiebreak) |
| Free For All / Leaderboard / Racing | none | ✗ |
| Advancement (two-stage) | ✓ `advancement_rule` + `sync-standings` / advance route | ✓ |
| Auto-fill winners/losers | ✓ `bracket-propagation.ts` in `finalizeMatchCompletion` | ✓ |
| Delete / regenerate rounds | ✓ `DELETE /api/admin/rounds/[id]`, `regenerate-bracket` | ✓ |
| Score reporting | self-report + confirmation + dispute + replay import | ✓++ |
| Quick advance (winner only) | always tracks set scores via games | ⚠️ |
| Match attachments | replay import + parse | ✓++ |
| Edit/correct results | reset (cascade), `POST …/repair-bracket`, edit games, un-propagation | ✓ |
| Standings | ✓ `standings.ts`; EPB 5-level chain | ✓++ |
| Tie-breaks (configurable) | hardcoded per format | ⚠️ |
| Match times / stations / queue | match proposals + Discord | partial |
| Printed/embeddable brackets | `src/components/bracket` renderer; no print/embed | partial |

---

## Gap analysis (post-revamp)

**Now at parity or better vs Challonge organizer flows:** phase-first league admin, standings auto-enrollment, drag/shuffle/rating seeding, serpentine groups, guest players, substitute primitive, full-bracket SE/DE generation with auto-fill, round delete + bracket regenerate.

**Still missing vs Challonge:** self-registration/check-in, waiting lists, paid entry, FFA/Leaderboard/racing, bronze match, RR 2x/3x, configurable tiebreaks, printed/embed brackets, Swiss round-1 first-half pairing.

**Still ours exclusively:** EPB, draft leagues, replay pipeline, confirmation flow, teambuilder/ruleset validation.

## Recommendation

Continue adopting Challonge primitives into the existing core (done for seeding, guests, substitute, serpentine, bracket v2). Remaining high-value gaps: optional bronze match, RR multipliers, Swiss round-1 pairing toggle, self-registration only if product requires it. Swapping in Challonge as a backend still offers little gain given format-specific engines.

## Sources

- Challonge KB: [Competition formats](https://kb.challonge.com/en/article/learn-about-challonge-competition-formats-1f8j1cf/), [Participant management](https://kb.challonge.com/en/article/participant-management-1m6ooqe/), [Reporting match scores](https://kb.challonge.com/en/article/reporting-match-scores-17vxuyb/)
- PokéTools: `src/lib/tournament/*`, `src/components/league/*`, `src/components/tournament/SeedingTable.tsx`, `docs/poketools-spec.md` §4–6
