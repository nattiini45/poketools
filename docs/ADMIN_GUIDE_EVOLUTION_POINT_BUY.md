# ADMIN_GUIDE — Evolution Point Buy

The numbers a league plays with (budget, picks, token ratio and caps, the Comeback table, the stage lock, Participation Tokens, per-line rulings) come from the active [format pack](./format-packs.md). This guide describes the admin steps; where it quotes a value, it is the public example pack's.

## Setup a new EPB season

1. Create the season with format `evolution_point_buy`.
2. Import / bind a point-buy list (admin league page → EPB Import panel, or CLI). Creating the season auto-binds the active list version when one exists.
3. Confirm `format_rules` exist. They are initialized on create from the pack's `epb.defaults` (`initializeEpbFormatRules`); edit them on the league admin page's Rules tab (Format Rules: budget, picks, Draft Kill Token ratio and limits, bans, tiebreaker order). The tiebreaker order decides the standings (first step first); changing it re-ranks the tables at once, completed leagues included. Tera rules come from the format pack and are shown read-only.
4. Create the draft pool — EPB uses the bound list as the pool source.

## Import data

### Admin UI

On `/admin/leagues/[id]?tab=rules` (the **Rules** tab), use **EpbImportPanel** (the **Data Import** section):

The league's workbooks are not in the repository; the league organiser supplies them privately. Their layout is described by the pack's `epb.workbook` ([Point-Buy Workbook Format](./point-buy-format.md)).

- Point-buy: upload the point-buy workbook, dry-run preview, then import + optional bind.
- Team roles: upload the team-roles workbook, dry-run, then import.

### CLI

```bash
npx tsx scripts/import-point-buy.ts --xlsx=<point-buy workbook> --season-id=<uuid> [--dry-run]
npx tsx scripts/import-team-roles.ts --xlsx=<team-roles workbook> [--dry-run]
```

Both scripts require `--xlsx` and exit with an error if the file is not there. `import-point-buy.ts` names the list after the active pack's `epb.workbook.pointBuy.defaultListName` unless `--name` is given.

Loads env from `.env.local` or `.env`.

Bound list versions on non-upcoming seasons are immutable — bump `--version` to create a new snapshot.

## Draft & tokens

- Trainers draft branched lines as separate options (e.g. Samurott vs Samurott-Hisui).
- The server rejects picks that exceed the season's `format_rules.draft_budget` or `draft_picks`.
- After draft completion, trainers buy Draft Kill Tokens from their remaining points: one token per `draft_token_ratio` points, at most `draft_token_max` per player and `draft_token_max_per_line` per line (example pack: 5 points per token, max 1).

## Redraft (between the first and second half)

1. Open the redraft phase only after the first half is complete (`/api/seasons/[id]/redraft/phase`).
2. Redraft is a secret drop: dropped slots are re-picked with their real kills transferred. Trades between players are retired; lines change hands only through the redraft.
3. Open Comeback Token spending when it is due (`format_rules.comeback_spend_open`, or automatically once the redraft is complete). Comeback Tokens are earned from shutout losses as the pack's `epb.comeback.table` defines, only in the matches inside the pack's `epb.comeback.earnWindow` (the whole season, or only the first half).
4. Close the phase when done.

## Matchday ops

- A line that reaches the pack's `epb.stageLock.stage` by matchday `byMatchday` is suspended for the next `suspendMatchdays` matchdays and cannot be submitted (example pack: stage 3 by matchday 2, one matchday).
- Real kills count for evolution only once a result is confirmed (opponent confirm, auto-confirm, or your dispute resolution); a submitted result waiting for confirmation, or under dispute, moves no line. Editing a game of a confirmed match takes its kills back until the match is confirmed again.
- Evolution points: max 1 per player per matchday. Use **Recalculate evolution points** if a dispute re-confirm drifted counters.
- Match reset clears `match_evolution_snapshots`.

## Line rulings

- Per-line rulings come from the pack's `epb.lineRules`, and threshold overrides from `epb.lineOverrides`; both apply on import and on every read.
- Participation lines (`participationPoints`) earn Participation Tokens only on matchdays they were brought, until `epb.participationPoints.untilStage`.
- Redraft-locked lines (`redraftLocked`) are excluded from the redraft.
