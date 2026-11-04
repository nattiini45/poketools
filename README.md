# PokéTools

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Competitive Pokémon league and tournament management platform. Built with Next.js 16 (App Router), TypeScript, Tailwind CSS, and Supabase.

## Features

- **League & Tournament Management** — create leagues, run Swiss / round-robin / single-elimination tournaments with full bracket tracking
- **Draft Leagues** — snake and linear draft engines with timer, pick/ban, and pool management
- **Teambuilder** — import/export Showdown paste, validate sets against rulesets, damage calculator integration
- **Replay Pipeline & Stats** — parse Pokémon Showdown replays, extract battle stats, compute standings and usage aggregates
- **Broadcast & Cast Studio** — real-time overlays for streamers (match, draft, league, player, wiki), BroadcastChannel sync, second-screen tools
- **Creator Hub** — dedicated dashboard for league organizers and casters with quick actions and studio access
- **Wiki / Encyclopaedia** — public, SEO-friendly Pokémon reference pages with community notes
- **Gamification** — achievements, streaks, player signatures, Glicko-2 ratings
- **Avatar Builder** — canvas-based avatar compositing with asset layers and Supabase Storage
- **AI Analysis** — server-side match analysis, tournament reports, and prep scouting (Anthropic SDK)
- **PWA** — installable shell with service worker and offline fallback

## Prerequisites

- Node.js `^22.22.2 || ^24.15.0` (`.nvmrc` pins the version CI runs; `npm install` refuses an unsupported Node)
- npm
- Your own [Supabase](https://supabase.com) project, or the Supabase CLI plus Docker for a local stack
- Optional: your own [Discord application](https://discord.com/developers/applications) for OAuth sign-in. Without one, players sign in with email and password

## Quick start (local development)

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npx supabase start              # local Postgres, Auth, Storage and REST API
npx supabase db reset           # apply supabase/migrations/ to the local stack
npm run dev:seed                # a local admin, the standard rulesets and one demo league (safe to run again)
npm run dev                     # http://localhost:3000
```

This needs no Discord application: leave `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` blank and sign in at `/auth/signin` as the seeded admin (`local-admin@poketools.test`, password `poketools-local-admin`; the seed refuses any Supabase URL that is not the loopback interface). New email/password sign-ups must confirm their address: the local stack catches the mail in Mailpit at http://127.0.0.1:54324.

`npx supabase status -o env` prints the local API URL and keys. The full, current env surface lives in `.env.example`; [docs/supabase-environments.md](docs/supabase-environments.md) covers the local and hosted Supabase options in more detail.

## Self-hosting

PokéTools is self-hosted: every deployment brings its own Supabase project, Discord application and secrets. Nothing in this repository points at a hosted instance.

### 1. Database (Supabase)

- **Local:** `npx supabase start`, then `npx supabase db reset`.
- **Hosted:** create a project, then:

  ```bash
  npx supabase link --project-ref <your-project-ref>
  npx supabase db push
  ```

The migrations in `supabase/migrations/` create the schema, the grants (the `anon` and `authenticated` API roles hold no privilege in `public`; every read and write goes through the app's API routes) and the public Storage buckets `avatars` and `social-images`.

### 2. Discord application (optional)

Discord sign-in is optional. Without it the app signs players in with email and password, which is all a local checkout needs: leave `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` blank, run `npm run dev:seed` against the local stack and sign in as the seeded admin (see [CONTRIBUTING.md](CONTRIBUTING.md#local-development-without-discord)). To turn Discord on, create an application in the Discord developer portal and add this OAuth2 redirect URL:

```
<NEXTAUTH_URL>/api/auth/callback/discord
```

For local development that is `http://localhost:3000/api/auth/callback/discord`. Copy the client ID and secret into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

Email/password sign-in needs extra Supabase Auth configuration on a hosted project: see [docs/auth-email-password.md](docs/auth-email-password.md).

### 3. Environment variables

Required:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://<project-ref>.supabase.co`, or `http://127.0.0.1:54321` locally) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key (Realtime broadcasts and Supabase Auth calls only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server only, never expose to the client |
| `NEXTAUTH_SECRET` | Random string for NextAuth session encryption (e.g. `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | The deployment's origin; `http://localhost:3000` for local dev |
| `CRON_SECRET` | Random string that protects `/api/cron/*` |
| `BOOTSTRAP_SECRET` | Random string for the one-time first-run setup below |

Recommended:

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Your Discord OAuth application. Set both or neither: neither means email/password sign-in only, exactly one fails at startup |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for canonical and Open Graph URLs (and as the share-link fallback). Canonical URLs fall back to `NEXTAUTH_URL`, then Vercel's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then `http://localhost:3000`. Production needs an https origin; a non-https value (other than localhost) is ignored. |
| `BLUESKY_SERVICE_HOST_ALLOWLIST` | Optional. Extra Bluesky server hosts (comma-separated, besides `bsky.social`) that a Bluesky integration's `service_url` may name; unset means `bsky.social` only |
| `SUPERADMIN_DISCORD_ID` / `SUPERADMIN_EMAIL` | Optional, and only for a deployment that uses Discord: the instance operator's Discord user ID, and optionally the email of their linked email login. The Discord account is treated as admin on every request; the email login only while its player is linked to that Discord ID. `SUPERADMIN_EMAIL` alone grants nothing, and neither variable is how you get a first admin (see "First run") |
| `FORMAT_PACK` | Which format pack the build uses: unset (your own pack when present, else the example pack), `example` or `private`. Set `private` in Production, so a build that lost your pack fails instead of shipping the example rules. See "Format packs" below. |
| `CSP_ENFORCE` | Optional. Pages carry a nonce-based Content-Security-Policy from the proxy (`src/proxy.ts`) as report-only by default: violations post to `/api/csp-report`, which logs one capped line and stores nothing. Set it to `1` to enforce the nonce policy instead; unset, empty, `0`, `false`, `off` and `no` keep it report-only. Soak the reports first: `/teambuilder` reports `script-src` eval-policy events after a team fork, because an editor dependency feature-detects `eval`. See [docs/security-patterns.md](docs/security-patterns.md). |

Optional features (AI analysis, avatar generation and moderation, social publishing, the 3D world asset bucket, feature flags) have their own variables, all documented in `.env.example`. Runtime flags are described in [docs/feature-flags.md](docs/feature-flags.md).

**Game assets.** The trainer avatar layers (`public/avatar/`) and the Pokémon GLBs (`public/models/draft-room/`) are third-party art and are not part of this repository (see [NOTICE.md](NOTICE.md)). `npm run dev` and `npm run build` generate simple placeholder avatar layers when the real ones are missing, so the avatar builder works out of the box; existing files are never overwritten. If you hold your own copies, place them at those paths, or keep them in a private GitHub repository and set `PRIVATE_ASSETS_REPO` and `PRIVATE_ASSETS_TOKEN` so `prebuild` fetches them. A Vercel production build without a token stops with an error unless `ALLOW_PLACEHOLDER_ASSETS=1`; see `.env.example`. `ALLOW_PLACEHOLDER_ASSETS=1` only waives the art: without your own format pack such a build also ships the example pack (next paragraph).

**Format packs.** League tuning (point budgets, price tiers, token ratios, match points, tiebreakers, draft-clock settings and the rule text players read) comes from a format pack, not from the code. A fresh checkout runs the public **example pack** (`src/format-packs/example/`), whose numbers and rule text are neutral placeholders, not any real league's rules. That is fine for local development, but those numbers are written into the database when you create a point-buy season, so do not run a real league on them. Copy the example pack to `src/format-packs/private/` and edit it; that folder is gitignored, so deliver it to your build yourself (for example from a private repository through `PRIVATE_ASSETS_REPO` and `PRIVATE_ASSETS_TOKEN`, which fetch it at the same path). Set `FORMAT_PACK=private` in Production. Every build logs which pack it uses (`[format-pack] using example pack`), and a production build that falls back to the example pack without `FORMAT_PACK=example` prints a warning. See [docs/format-packs.md](docs/format-packs.md#writing-your-own-pack).

### 4. First run

1. Start the app and sign in once. Discord is optional: sign up with email and password (confirm the address from the mail; locally it is in Mailpit at http://127.0.0.1:54324), or use Discord when you configured it.
2. Get the first admin in one of two ways. On a local stack, `npm run dev:seed` creates one (`local-admin@poketools.test`) together with the rulesets and a demo league, so you can skip the rest of this step and step 3. Anywhere else, while no admin exists yet, make the signed-in player the first admin by sending `POST /api/bootstrap` with the JSON body `{ "secret": "<BOOTSTRAP_SECRET>" }` (for example with `fetch` from the browser console on your deployment), then sign out and back in. The route promotes your existing player row, whichever sign-in method created it, and turns itself off for good as soon as any admin exists.
3. Seed the site rulesets with `POST /api/seed-rulesets` (one shared ruleset per standard Smogon format, each published as version 1; the Ruleset Studio, [docs/ruleset-studio.md](docs/ruleset-studio.md), is where they are edited afterwards). As an admin, no body is needed. Before any admin exists, set `BOOTSTRAP_MODE_ENABLED=true` and send `{ "secret": "<BOOTSTRAP_SECRET>" }`; set it back to `false` afterwards.

### 5. Scheduled jobs

`vercel.json` declares six crons: `/api/cron/process-aggregates` (every 10 minutes), `/api/cron/auto-confirm` (every 15 minutes), `/api/cron/draft-ticks` (every 10 minutes), `/api/cron/expire-suspensions` (every 15 minutes, lifts timed suspensions whose end has passed), `/api/cron/refresh-usage-stats` (monthly) and `/api/cron/expire-league-trash` (daily; removes the leagues whose 90 days in the league trash ran out, see [docs/season.md](docs/season.md)). Each request must carry `Authorization: Bearer <CRON_SECRET>`; Vercel Cron sends it automatically when `CRON_SECRET` is set. On another host, call the same paths on the same schedule with that header. `auto-confirm`, `process-aggregates` and `draft-ticks` answer with a 5xx status when part of their run failed (for example `auto_confirm_partial_failure`, `aggregate_jobs_stranded` or `cron_draft_ticks_failed`, which lists the failed pool ids), so alert on non-2xx cron responses; [docs/match.md](docs/match.md) has the runbooks. `draft-ticks` ticks only the queue pools with work due (an overdue pick slot, or a Redraft past its submission deadline), logs a pool whose tick failed (`[cron/draft-ticks]`), carries on with the others and then answers 500.

### 6. Deployment notes

The app targets Vercel but runs anywhere Next.js 16 runs. Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `X-Robots-Tag: noindex` on API routes) are set in `next.config.mjs`, and `poweredByHeader` is disabled. Pages get a nonce-based Content-Security-Policy from the proxy (`src/proxy.ts`), report-only until `CSP_ENFORCE` is set; the static policy in `next.config.mjs` covers the routes and assets the proxy skips ([docs/security-patterns.md](docs/security-patterns.md)). On your host, consider enabling firewall or bot protection, keeping build logs and source private, and alerting on function 5xx rates, latency regressions and usage spikes.

Logs are structured: `logger` (`src/lib/logger.ts`) writes one JSON line per event. An error response built by `safeErrorResponse()` carries an `x-request-id` header and logs the same `requestId`; an error return a handler writes by hand may carry neither. An unhandled error page shows a `digest` that the `request` log line repeats. Either value finds the line in the runtime logs, and [docs/operations-logging.md](docs/operations-logging.md) lists the fields and the operator grep recipes.

Upgrading: read the [CHANGELOG](CHANGELOG.md) first. Each release lists its migrations and new environment variables under **Upgrade notes**; apply the migrations before you deploy the new code.

Backups depend on your Supabase plan, and the app's admin export is not a backup. Before you run `supabase db push` against a populated database, take a dump; [docs/operations-backup.md](docs/operations-backup.md) covers the dump recipe, the restore drill and how to write migrations that do not lock busy tables.

## Development

```bash
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Production build (Next.js build + type-check)
npm run lint       # ESLint only
npm test           # Unit tests (vitest); no database
npm run test:db    # Suites that need a real Postgres, against a local stack
npm run test:e2e   # Playwright smoke suite (run `npm run build:e2e` first)
npm run test:watch # Run tests in watch mode
```

Notes:
- `npm run lint` covers `src/` and `scripts/` and is not bundled into `npm run build`. `npm run typecheck` runs `tsc --noEmit`; `npm run typecheck:example` type-checks against the example format pack, as CI does.

### Testing

- `npm test` never reaches a real database: the unit tests mock the Supabase client, and Vitest seeds dummy Supabase env vars when unset, so no secrets are needed.
- `npm run test:db` runs only the suites that need a real Postgres (`*.local.test.ts`, `*.live-db.test.ts`), in a Vitest project (`db`) that no other run loads, against a local stack (`npx supabase start`, then `npx supabase migration up --local`). It takes the URL and keys from `supabase status -o env` when `NEXT_PUBLIC_SUPABASE_URL` is unset (an environment that already sets it is used as it is) and refuses any host that is not the loopback interface, so a hosted project is never reached. See [docs/supabase-environments.md](docs/supabase-environments.md#local-stack-suites-npm-run-testdb).
- `npm run test:e2e` is the Playwright Chromium smoke suite. It serves the production build that `npm run build:e2e` makes against the local stack and starts its own server. A test fails on an uncaught error, any console error, a hydration warning or a request to Supabase; any other request that would leave the machine is intercepted, images answered with a blank PNG and the rest aborted, so the run stays hermetic (see [CONTRIBUTING.md](CONTRIBUTING.md#end-to-end-tests)).
- In CI, `npm run test:coverage` is the required test gate: every Vitest project the checkout loads, plus the coverage floors in `vitest.config.ts`. The `database` and `e2e` jobs are advisory (never required checks, never in the main-protection ruleset): each starts its own ephemeral `supabase start` stack on the runner (loopback only, no Supabase secret, `LOCAL_STACK_CI=1`), the `database` job replays every migration and then runs the `db` project through `npm run test:db`, the `e2e` job builds and runs the Playwright suite, and a red job there is information, not a gate.

## Project Structure

```
src/
  app/            Next.js App Router (pages + API routes)
  components/     React components by domain
  lib/            Business logic, DB queries, @pkmn wrappers
  types/          TypeScript types (domain + database)
supabase/
  migrations/     SQL migration files
  config.toml     Supabase CLI config
```

See [`AGENTS.md`](AGENTS.md) for architecture and security rules, [`docs/poketools-spec.md`](docs/poketools-spec.md) for the full specification, and [`docs/modules-index.md`](docs/modules-index.md) for detailed module documentation.

## Documentation

### Modules Documentation
A comprehensive module documentation system is available in the `docs/` folder:

- `modules-index.md` - Central index of all modules with cross-referencing
- `module-documentation-template.md` - Standard template for module documentation
- Individual module files, for example `ai.md`, `auth.md`, `avatar.md`, `broadcast.md`, `cast-studio.md`, `creator-hub.md`, `design.md`, `discord.md`, `draft.md`, `gamification.md`, `match.md`, `pkmn.md`, `profile.md`, `rating.md`, `smogon.md`, `social.md`, `supabase.md`, `team.md`, `teambuilder-reference.md`, `tournament.md`, `utils.md` and `wiki.md`; `modules-index.md` lists them all

Each module documentation includes:
- Overview and purpose
- File structure
- Core functions/classes
- Data flows
- Dependencies
- API routes (if applicable)
- Usage examples
- Testing information
- Related modules (cross-referenced)

## PWA

PokéTools includes an installable PWA shell with a service worker and offline fallback page.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_PWA_ENABLED` | Enable service worker registration (`true` or `false`). Read in one place, `src/lib/feature-flags.ts` (`ENABLE_PWA`). |

Notes:
- The worker never stores a page. Navigations always go to the network, and when it is unreachable the worker shows `/offline.html`; a signed-in page is never kept for the next person on the device. Only the hashed build files (`/_next/static/`) and the app icons (`/pwa/`) are cached, no API responses, and nothing is written offline.
- The worker is registered as `/sw.js?v=<build id>`. The build id comes from `VERCEL_GIT_COMMIT_SHA` (`dev` locally) in `next.config.mjs`, so each deploy gets its own cache and the worker deletes the previous ones when it activates. Signing out also clears the worker's caches.
- Broadcast overlays (`/broadcast/*`) never register the worker.
- Service worker can be disabled instantly by setting `NEXT_PUBLIC_PWA_ENABLED=false`: the next page load removes the worker and its caches.
- Web Push for draft turn alerts is configured separately (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; see [docs/push.md](docs/push.md)). With push configured the service worker is registered even when `NEXT_PUBLIC_PWA_ENABLED=false`, in a mode that caches and intercepts nothing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, code standards, and how to submit a PR. Release history: [CHANGELOG.md](CHANGELOG.md).

## Security and conduct

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

The source code is licensed under the [MIT licence](LICENSE). Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc.; this is an unofficial fan project with no affiliation. Third-party data, fonts, textures and models keep their own terms, and the MIT licence does not cover them: see [NOTICE.md](NOTICE.md).
