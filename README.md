<div align="center">
  <img src="assets/logo/void-logo.svg" alt="Void" width="360" />

  <p><strong>An infinite spatial canvas for teams who think better visually than in rows and columns.</strong></p>

  <p>
    <a href="https://github.com/CastielJ/TheVoid/actions/workflows/ci.yml"><img src="https://github.com/CastielJ/TheVoid/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6366f1.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/node-%3E%3D22-6366f1.svg" alt="Node >= 22">
    <img src="https://img.shields.io/badge/TypeScript-100%25-6366f1.svg" alt="TypeScript">
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-6366f1.svg" alt="PRs welcome"></a>
  </p>
</div>

---

Void is a **spatial team task-management platform**. Instead of yet another
list or kanban board, work lives on an infinite pan-and-zoom canvas: create
**Groups** as spatial clusters of **Tasks**, drag things around, zoom out to
see the whole picture, zoom in to get precise — with everyone's changes
syncing live, in real time, over WebSockets.

Organizations contain **Voids** — self-contained workspaces, each with their
own canvas. A Void can be nested under another Void to form a **Team** (a
sub-workspace with its own membership and visibility, exactly like a
subdirectory), so a company can model "Engineering" and "Design" as their
own spaces inside a shared "Product Launch" Void, or keep them fully
independent — whatever actually matches how the team is organized.

## Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Common commands](#common-commands)
- [Architecture highlights](#architecture-highlights)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="assets/screenshots/canvas-overview.png" alt="The spatial canvas: auto-sizing Groups clustering Tasks, with status/priority/due-date badges" />
      <p align="center"><em>The canvas — Groups auto-size to fit their Tasks</em></p>
    </td>
    <td width="50%">
      <img src="assets/screenshots/task-expanded.png" alt="A Task card expanded inline, showing description, status, priority, due date, tags, checklist, and comments" />
      <p align="center"><em>Fully inline task editing — no side panel</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/screenshots/canvas-dark-theme.png" alt="The same canvas in dark theme" />
      <p align="center"><em>Real light and dark themes, canvas included</em></p>
    </td>
    <td width="50%">
      <img src="assets/screenshots/left-panel.png" alt="The left navigation panel with theme toggle, recent Voids, and the Voids/Teams tree" />
      <p align="center"><em>Nested Voids/Teams navigation, theme toggle, recents</em></p>
    </td>
  </tr>
</table>

<p align="center">
  <img src="assets/screenshots/org-dashboard.png" alt="Organization dashboard showing Voids, members, invitations, and settings" width="720" />
  <br /><em>Organization dashboard — Voids, members, invitations, settings</em>
</p>

## Features

- **Spatial canvas** — infinite pan/zoom workspace, WASD + mouse navigation,
  box-select, copy/paste, drag-to-reposition, virtualized rendering that
  stays smooth at ~1,500+ objects per Void.
- **Auto-sizing Groups** — a Group is a server-computed tight bounding box
  over its member Tasks, with a live preview while you drag a Task in or out
  — never manually resized.
- **Fully inline task editing** — click a Task to expand it in place:
  description, status, priority, due date, tags, multi-assignee, checklist,
  and threaded comments, all on the card itself. Explicit Save/Discard on
  the core fields, with a guard against accidentally losing unsaved edits.
- **Nested Voids ("Teams")** — a Void can contain child Voids, each with
  independent membership and one of three visibility tiers (public /
  private / invisible), with a real join-request workflow for private
  spaces.
- **Live realtime sync** — every Task/Group mutation broadcasts over
  WebSockets to everyone viewing that Void, with last-write-wins conflict
  resolution.
- **Real light & dark themes** — a genuine second palette for both the UI
  chrome and the canvas workspace itself, synced server-side across devices.
- **Capability-based authorization** — every permission check is a named
  capability function (`canEditVoid`, `canManageVoidAccess`, …), never a
  hardcoded role string; Organization role never silently grants Void
  access.
- **Auth that doesn't cut corners** — email+password or magic-link login,
  optional TOTP 2FA with backup codes, breached-password checking (HIBP
  k-anonymity), server-side sessions with per-device management, login by
  either email or username.
- **In-app notifications, search, and a cross-Void "My Tasks" view.**

## Tech stack

| Layer        | Choice                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Language     | TypeScript, end to end                                                                                                                     |
| Backend      | [Fastify](https://fastify.dev) + [tRPC](https://trpc.io) (fully typed client↔server, no REST/GraphQL schema to hand-maintain)              |
| ORM/Database | [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL                                                                                       |
| Frontend     | React + [Vite](https://vitejs.dev)                                                                                                         |
| Client state | [Zustand](https://github.com/pmndrs/zustand) (canvas/object state) + [TanStack Query](https://tanstack.com/query) (server state, via tRPC) |
| Realtime     | Native WebSockets (`@fastify/websocket`), no external pub/sub required                                                                     |
| Routing      | React Router                                                                                                                               |
| Testing      | [Vitest](https://vitest.dev) (unit/integration) + [Playwright](https://playwright.dev) (critical-path E2E)                                 |
| Monorepo     | pnpm workspaces (`packages/shared`, `packages/server`, `packages/web`)                                                                     |

No Kubernetes, no message broker, no ORM-generated GraphQL schema to fight
with — the stack is chosen to stay boring and debuggable at this project's
actual scale.

## Getting started

**Requirements:** Node.js 22+, pnpm, PostgreSQL 17 running locally.

```sh
git clone https://github.com/CastielJ/TheVoid.git void
cd void
pnpm install

cp packages/server/.env.example packages/server/.env
# edit packages/server/.env — at minimum set DATABASE_URL and SESSION_SECRET

pnpm db:migrate

pnpm dev:server   # Fastify + tRPC on :3000
pnpm dev:web      # Vite + React on :5173, in a second terminal
```

Open `http://localhost:5173` and sign up — the app is fully usable from a
freshly migrated, empty database.

## Project structure

```
void/
├── packages/
│   ├── shared/    types and schemas shared by server and web
│   ├── server/    Fastify + tRPC + Drizzle backend
│   │   └── src/
│   │       ├── domains/       business logic, one folder per concept (void, task, group, auth, …)
│   │       ├── routers/       tRPC procedure definitions — thin, delegate to domains/
│   │       ├── authorization/ capability functions — the single source of truth for "can this user do X"
│   │       ├── realtime/      WebSocket handler + event broadcasting
│   │       └── db/            Drizzle schema + migrations
│   └── web/       React + Vite frontend
│       └── src/
│           ├── canvas/        the spatial canvas itself (viewport, cards, store, spatial index)
│           ├── features/      page-level feature modules (org, void, auth, notifications, …)
│           ├── app/           app shell, left panel, theming, session
│           └── trpc/          typed tRPC client
├── docs/          architecture, product spec, and a dated decision log
├── assets/        logo and README screenshots
└── .github/       CI workflow, issue/PR templates
```

## Common commands

```sh
pnpm typecheck      # every package
pnpm lint
pnpm format         # write; use `format:check` in CI
pnpm test           # every package
pnpm --filter @void/web test:e2e   # Playwright critical-path suite

pnpm db:generate    # generate a Drizzle migration from a schema.ts change
pnpm db:migrate     # apply pending migrations
```

## Architecture highlights

A few decisions worth knowing before you dig into the code:

- **Access is never inferred from role alone.** An Organization Owner/Admin
  does **not** automatically get access to every Void in the org — Void
  access is always an explicit grant. (One narrow, documented exception:
  Void _deletion_ specifically.) This is treated as non-negotiable
  throughout the codebase.
- **Every mutation resolves its own parent IDs server-side.** A procedure
  that acts on a child resource (a Group, a checklist item, a join request)
  never trusts a client-supplied parent Void/Org ID — it looks the real
  parent up from the resource itself.
- **Groups are server-computed, not client-resizable.** A Group's bounds
  are a tight bounding box recomputed over its member Tasks on every
  relevant mutation — this eliminates an entire class of "my drag and your
  drag disagree" bugs.
- **A "Team" is just a Void.** `voids` is a self-referencing table
  (`parentVoidId`) — nesting is unlimited by the schema, and a nested Void
  gets its own independent canvas, membership, and visibility for free,
  with zero special-casing in the canvas rendering code.

The full reasoning behind these (and everything else) lives in
[`docs/decisions.md`](docs/decisions.md), written chronologically as the
project evolved — it's the best place to understand _why_ something is
built the way it is, not just what it does.

## Testing

- **Unit + integration** (Vitest) — the authorization/capability layer has
  the highest-priority coverage in the project: every capability function
  is tested for both the positive and negative case, against a real
  Postgres database (not mocked).
- **Critical-path E2E** (Playwright) — drives the real app through a
  browser: signup → create org → create a Void → create a nested Team →
  add members → create Groups/Tasks → assign work → verify authorized
  access and unauthorized denial → visibility + join-request flow.

```sh
pnpm test                          # unit + integration, all packages
pnpm --filter @void/web test:e2e   # E2E (spins up real Postgres-backed servers)
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
`typecheck` → `lint` → `format:check` → migrations → `test` →
`test:e2e` on every push and pull request.

## Documentation

The `docs/` folder is the authoritative source for anything not obvious from
the code itself:

- [`docs/project-context.md`](docs/project-context.md) — product model,
  entity relationships, MVP scope, and the non-negotiable architectural
  rules. **Start here.**
- [`docs/architecture.md`](docs/architecture.md) — system architecture in
  more depth.
- [`docs/decisions.md`](docs/decisions.md) — a dated, chronological log of
  every non-obvious design decision and why it was made, including later
  reversals of earlier decisions (kept, not silently deleted, so the
  reasoning stays visible).

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
full guide: dev setup, how migrations are generated, verification steps to
run before opening a PR, and commit/PR conventions. Please also read our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md).
Do not open a public issue for a security report.

## License

MIT — see [`LICENSE`](LICENSE).
