# Void

Spatial team task-management platform. See `docs/project-context.md` first —
it's the authoritative onboarding document for this project's product model,
architecture, and non-negotiable decisions. `docs/implementation-plan.md`
covers implementation phases and sequencing.

## Local development setup

Requires Node.js 22+, pnpm, and PostgreSQL 17 running locally.

```sh
pnpm install
cp packages/server/.env.example packages/server/.env  # then fill in real values
pnpm dev:server   # Fastify + tRPC on :3000
pnpm dev:web      # Vite + React on :5173
```

## Common commands

```sh
pnpm typecheck   # all packages
pnpm lint
pnpm test        # all packages
pnpm db:generate # generate a Drizzle migration from schema changes
pnpm db:migrate  # apply migrations
```

## Project structure

- `packages/shared` — types/schemas shared by server and web
- `packages/server` — Fastify + tRPC backend
- `packages/web` — React + Vite frontend
- `docs/` — planning and specification package (read `project-context.md` first)
