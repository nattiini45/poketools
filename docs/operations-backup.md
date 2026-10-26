# Backups, Restore and Migration Safety

How to keep a PokéTools database recoverable, how to restore it, and how to write migrations that do not lock a busy table. This page is for whoever operates a deployment. It does not say which Supabase plan any particular deployment uses: check your own project's plan and settings.

## What the app does and does not back up

- **The app keeps no backups.** Everything lives in your Postgres database (Supabase) and your Supabase Storage buckets.
- **The admin data export is not a backup.** `POST /api/admin/export` returns a capped selection of a few resources as JSON or CSV for admins. It leaves out most tables (teams, drafts, ratings, audit log, EPB state) and cannot be restored.
- **Storage is separate.** Database backups hold only the metadata of Storage objects (avatars, social images, world assets), not the files. Keep the source files of anything you upload (world assets are published from local files by the maintainer scripts), or copy the buckets yourself.

## Backups by Supabase plan

From the Supabase documentation ([Database Backups](https://supabase.com/docs/guides/platform/backups) and its [Point-in-Time Recovery section](https://supabase.com/docs/guides/platform/backups#point-in-time-recovery), read 2026-10-18; plans, retention and prices change, so check those pages and [supabase.com/pricing](https://supabase.com/pricing) before relying on this table):

| Plan | Automatic backups |
|---|---|
| Free | No automatic daily backups are documented. Supabase recommends exporting regularly with `supabase db dump` and keeping the copies off-site. |
| Pro | Daily backups, last 7 days |
| Team | Daily backups, last 14 days |
| Enterprise | Daily backups, up to 30 days |

- **Point-in-time recovery (PITR)** is a paid add-on for Pro, Team and Enterprise (it also needs at least the Small compute add-on). It restores to any chosen moment with seconds of granularity. Enabling PITR replaces the daily backups.
- **Restores take the project offline** for a time that grows with the database size, for daily backups and PITR alike. You start them from the Supabase dashboard; Supabase performs them.

Whatever the plan, keep your own logical dump as well (next section): it is the only copy you control, it survives a deleted project, and it is the only option on the Free plan.

## Taking a dump

The Supabase CLI (a dev dependency, `npx supabase`) wraps `pg_dump`. Dump roles, schema and data separately, so each part can be restored on its own:

```bash
npx supabase link --project-ref <your-project-ref>      # once per checkout
npx supabase db dump --linked -f roles.sql --role-only
npx supabase db dump --linked -f schema.sql
npx supabase db dump --linked -f data.sql --data-only --use-copy
```

- `--dry-run` prints the `pg_dump` command without running it; `--db-url <connection string>` dumps any Postgres instead of the linked project; `--schema <list>` limits the dump to named schemas.
- The data dump contains personal data (player names, Discord ids, email addresses through Supabase Auth if you include the `auth` schema, request-limit keys, audit entries). Store it encrypted, restrict who can read it, and delete old copies on a schedule. Do not include the `auth` schema unless you mean to: it holds password hashes.
- Take a dump **before every `supabase db push`** to a populated database, and on a schedule that matches how much play you can afford to lose. The schedule and retention are your call.
- On a Postgres that is not Supabase, use `pg_dump` directly (`pg_dump --format=custom --no-owner --file=poketools.dump <connection string>`), and restore with `pg_restore`.

## Restoring

Restore into a fresh project or a local stack first, never straight over the production database:

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "<target connection string>"
```

`session_replication_role = replica` keeps triggers and foreign-key checks from firing while the data loads. The command follows Supabase's own [backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). On a local stack (Postgres 17) the non-superuser `postgres` role was shown to set it inside a transaction; that proof did not cover a hosted project, so if the `SET` is refused there, restore with your own Supabase guide's current command instead of dropping the setting. Then:

1. **Re-apply the privilege lockdown.** A dump does not carry the revokes that keep the `anon` and `authenticated` API roles out of schema `public`; a restore into a Supabase database gets the target's default grants back. Re-run `supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql` and `supabase/migrations/20261008081443_close_public_api_roles.sql` on the target, then run the checks V1 and V7 of [anon-match-columns](./security/anon-match-columns.md) (section "Dumps and restores do not carry any of these fixes"). AGENTS.md states the same rule.
2. **Check the migration history.** `supabase migration list` on the target must show every file of `supabase/migrations/` as applied; apply what is missing with `supabase db push`.
3. **Check derived data before trusting it.** Aggregates and usage can be rebuilt from games and battle stats (admin data tools). Ratings are not rebuilt blindly: run the season reconcile as a dry run first ([Reconcile](./reconcile.md)); it refuses a rebuild when `rating_history` has a gap it cannot order. Completed matches with `matches.finalized_at IS NULL` are healed by the auto-confirm cron ([Match](./match.md), "Finalize Integrity and Heal").
4. **Point the app at the restored database** only after the checks pass.

### Restore drill

A backup nobody has restored is a hope, not a backup. Restore the latest dump into a throwaway project or a local stack (`npx supabase start`, then the `psql` command above against the local connection string from `npx supabase status`) on a schedule you choose, and run the checks of steps 1 to 3. Record the date, the dump's age and how long the restore took. Who runs the drill and how often is the operator's decision; this repository does not schedule it.

## Writing migrations that do not lock busy tables

Migrations in `supabase/migrations/` are forward-only (no down files): fix a mistake with a new migration, and never edit one that has been applied anywhere (the CLI tracks applied versions by timestamp). Many files wrap their statements in `BEGIN; … COMMIT;`; in those, every lock a statement takes is held until the whole file commits.

What locks what (PostgreSQL):

- `CREATE INDEX` takes a SHARE lock: reads continue, but every write to that table waits until the transaction commits.
- Most `ALTER TABLE` forms (adding a column, `SET NOT NULL`, adding a CHECK constraint, changing a type) take an ACCESS EXCLUSIVE lock: reads wait too. A volatile default or a type change also rewrites the whole table under that lock. Every guarded request re-reads `players`, so a long lock there stalls the whole site.
- Adding a foreign key takes a SHARE ROW EXCLUSIVE lock on both the referencing and the referenced table: reads continue, but writes to either table wait.
- Adding a CHECK or foreign key without `NOT VALID` scans the existing rows while holding that lock.
- `ALTER TABLE … VALIDATE CONSTRAINT` takes only SHARE UPDATE EXCLUSIVE (reads and writes continue; for a foreign key the referenced table gets ROW SHARE).

Rules for a new migration that touches a table which already holds data:

1. **Set a lock timeout** at the top of the transaction, so the migration fails fast instead of queueing every request behind it: `SET LOCAL lock_timeout = '5s';` (inside `BEGIN`). A timed-out migration rolls back; retry it at a quiet time.
2. **Keep the locked part short.** Add a nullable column, backfill it in batches, then add the constraint. Add constraints as `NOT VALID` and validate them in a later migration (the validation takes the weaker lock above).
3. **Index a large, busy table with `CREATE INDEX CONCURRENTLY`.** It does not block writes, but it cannot run inside a transaction block: put it in a migration file of its own, with no `BEGIN`/`COMMIT` and nothing else in it. **One statement per file is a hard rule, not a style:** the CLI sends a file as a single pipeline, so a second statement in the same file, even `SET lock_timeout`, makes `CREATE INDEX CONCURRENTLY` fail with "cannot be executed within a pipeline". The lock timeout therefore cannot live in the file; when applying by hand, run `SET lock_timeout = '5s';` in the same session first. The four index files that follow `supabase/migrations/20261026091000_league_trash.sql` (`20261026091200_league_trash_index_aggregate_jobs.sql` and its three siblings) are the worked examples: each is one `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and a comment. If a CLI version wraps the file anyway, run the statement out of band at a quiet time and record it in a migration that uses `CREATE INDEX IF NOT EXISTS`. A failed concurrent build leaves an INVALID index behind: find it with `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`, drop it and build it again.
4. **Small tables need none of this.** At league scale most tables hold thousands of rows, and a plain `CREATE INDEX` takes milliseconds; the rules above matter for the large tables (`battle_stats`, `aggregates`, `audit_log`, `rating_history`, `draft_action_log`) and for any self-hosted instance with a long history.
5. **Take a dump first** (above), and apply the migration to a local stack or a branch before production.

Every new table still follows the grant rules in AGENTS.md: RLS enabled, privileges granted to `service_role` only.

## The league trash and backups

Deleting a league moves it to the league trash (`league_trash` and `league_trash_tables`, [Season](./season.md#league-recycle-bin)) and does not free its space until the daily purge removes it, 90 days later (`LEAGUE_TRASH_RETENTION_DAYS`). Plan for the extra storage: a league's captured rows are about 0.8 MB per 6,000 `battle_stats` rows (roughly 12 MB for a league with 118,000), kept as JSON next to the live data, and they are part of every dump and backup taken while the league sits in the trash.

- **A purged league is gone from the database for good.** The only way back is a backup or dump taken before the purge, restored into a separate project, from which the league's rows would have to be moved by hand. **Backups outlive the purge**: a daily backup or a dump still holds the league for as long as that backup is kept. If a league must really be gone (a deletion request), its backups have to age out or be handled separately.
- **Restoring a dump does not restore the trash's protections by itself.** The junction tables (`league_trash_players`, `league_trash_rulesets`, `league_trash_point_buy_versions`) travel with the dump, so a restored database keeps refusing to delete a player, ruleset version or list version a trashed league still uses.
- The trash is not a substitute for a dump before a risky operation: it covers a deleted league, not a corrupted table.

## Related

- [Supabase environments](./supabase-environments.md): local and hosted setup.
- [Security patterns](./security-patterns.md): logging and data handling.
- README, "Self-hosting".
