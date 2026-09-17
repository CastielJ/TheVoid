# Contributing to Void

Thanks for taking the time to contribute! This document covers everything
you need to get a change from idea to merged PR.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it.

## Before You Start

- For a bug fix or small improvement, feel free to open a PR directly.
- For anything larger (a new feature, a schema change, a change to the
  authorization model), please open an issue first to discuss the approach.
  Void has a deliberately documented, non-negotiable architecture (see
  [`docs/project-context.md`](docs/project-context.md) and
  [`docs/decisions.md`](docs/decisions.md)) — reading those first will save
  you from a change that has to be reworked.

## Development Setup

Requires **Node.js 22+**, **pnpm**, and **PostgreSQL 17** running locally.

```sh
git clone https://github.com/CastielJ/TheVoid.git void
cd void
pnpm install

cp packages/server/.env.example packages/server/.env
# then edit packages/server/.env with real local values

pnpm db:migrate    # apply migrations to your local Postgres

pnpm dev:server    # Fastify + tRPC on :3000
pnpm dev:web       # Vite + React on :5173, in a second terminal
```

Open `http://localhost:5173` and sign up — the app is fully usable from a
fresh database with no seed data required.

## Making a Change

1. **Fork** the repository and create a branch off `main`:
   ```sh
   git checkout -b your-username/short-description
   ```
2. Make your change. Keep it focused — a bug fix shouldn't carry an
   unrelated refactor along with it.
3. If you touch `packages/server/src/db/schema.ts`, generate a migration for
   just that change (never hand-edit a migration file, and never batch
   multiple unrelated schema changes into one migration):
   ```sh
   pnpm db:generate
   ```
4. Run the full verification suite locally before opening a PR:
   ```sh
   pnpm typecheck
   pnpm lint
   pnpm format:check   # or `pnpm format` to auto-fix
   pnpm test
   pnpm --filter @void/web test:e2e   # requires local Postgres + both dev servers reachable
   ```
   CI runs all of these on every push and PR — a red CI check will block
   review, so it's faster to catch issues locally first.
5. Add or update tests for what you changed. This codebase treats
   authorization-path testing as the highest priority — if your change
   touches who-can-access-what, it needs test coverage for both the
   positive and negative case.

## Commit Messages

Write commit messages that explain **why**, not just what — the diff already
shows what changed. A good commit message here reads like:

```
Fix Group auto-sizing overflow for tasks with checklist badges

The server assumed every compact Task card was a flat 96px tall. Measured
the real rendered height instead — it's 71px or 94px depending on whether
the badges row renders — and made the bounding-box math content-aware.
```

## Pull Requests

- Fill in the PR template — it's short on purpose.
- Link the issue it resolves, if there is one.
- Keep the PR scoped to one logical change. If review reveals it should be
  split, that's fine — better to split it than merge an unfocused PR.
- A maintainer will review, and CI must be green before merge.

## Project Structure

```
packages/
  shared/   types and schemas shared by server and web
  server/   Fastify + tRPC + Drizzle ORM backend
  web/      React + Vite + Zustand frontend
docs/       architecture, product spec, and dated decision log — read
            project-context.md first
```

See [`README.md`](README.md) for the full tech stack and architecture
overview, and [`docs/decisions.md`](docs/decisions.md) for the reasoning
behind non-obvious design choices before proposing to change one.

## Reporting Bugs

Use the **Bug report** issue template. The more precisely you can reproduce
it, the faster it gets fixed — a failing test is the single most useful
thing you can attach.

## Reporting Security Issues

Please **do not** open a public issue for a security vulnerability — see
[`SECURITY.md`](SECURITY.md) for how to report one privately.
