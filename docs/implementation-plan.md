# Void — Implementation Plan

Status: authoritative for _implementation sequencing and structure_. Builds
directly on `project-context.md` (starting context), `decisions.md`,
`spec.md`, and `architecture.md` (detailed source documents) — this document
does not override any Non-negotiable decision or the MVP Explicitly-Deferred
list; it sequences and operationalizes them.

**This is still a planning document. No application code, dependencies,
scaffolding, or migrations have been created as part of producing it.**

Per the request that produced this document, every previously-open
implementation question resolved below is also recorded as a new dated
addendum in `decisions.md` (see "Implementation Planning Addenda
(2026-09-16)"), clearly separated from the original Phase 0 decisions. This
document distinguishes four categories throughout:

- **[Confirmed]** — from Phase 0 discovery (`decisions.md` D1–D62) or the
  post-review corrections (C1–C8). Not revisited here.
- **[New Decision]** — a previously-open implementation question resolved as
  part of this planning pass, also logged in `decisions.md`.
- **[Recommendation]** — a proposed approach with lower confidence or
  external consequence (cost, vendor lock-in), offered for your sign-off
  rather than silently decided.
- **[Open]** — still unresolved; noted with where/when it must be resolved.

---

## 1. Repository & Project Structure

**[New Decision]** A monorepo, since the frontend and backend share types
extensively (tRPC's whole value proposition, per D50) and there is one team
building both:

```
void/
├── docs/                        # this planning package (already exists)
├── packages/
│   ├── shared/                  # types/schemas shared by server & web —
│   │                             # zod schemas for every domain entity,
│   │                             # capability/role enums, event payload types
│   ├── server/                  # Fastify + tRPC backend
│   │   ├── src/
│   │   │   ├── domains/          # per §2 of architecture.md
│   │   │   │   ├── auth/
│   │   │   │   ├── organization/
│   │   │   │   ├── team/
│   │   │   │   ├── void/
│   │   │   │   ├── group/
│   │   │   │   ├── task/
│   │   │   │   ├── invitation/
│   │   │   │   ├── notification/
│   │   │   │   ├── search/
│   │   │   │   └── audit/
│   │   │   ├── authorization/    # capability-resolution engine (cross-cutting)
│   │   │   ├── realtime/         # WebSocket handler + channel/eviction logic
│   │   │   ├── routers/          # tRPC routers, one per domain + root
│   │   │   ├── db/               # schema, migrations, seed scripts
│   │   │   ├── email/            # provider-agnostic EmailSender interface +
│   │   │   │                       ConsoleEmailSender (dev/test); auth and
│   │   │   │                       invitation depend on the interface only
│   │   │   │                       (§5 addendum, ID12)
│   │   │   ├── config/           # env validation, app config
│   │   │   └── app.ts             # Fastify instance wiring
│   │   └── test/                  # unit + integration tests, mirrors src/
│   └── web/                      # React + Vite frontend
│       ├── src/
│       │   ├── canvas/            # viewport, virtualization, spatial index,
│       │   │                        Task/Group render components
│       │   ├── features/          # one folder per domain (mirrors backend):
│       │   │   ├── auth/
│       │   │   ├── organization/
│       │   │   ├── team/
│       │   │   ├── void/
│       │   │   ├── task/
│       │   │   ├── my-tasks/
│       │   │   ├── search/
│       │   │   ├── notifications/
│       │   │   └── admin/
│       │   ├── trpc/              # tRPC client setup
│       │   ├── realtime/          # WebSocket client, store sync
│       │   └── ui/                 # design-system primitives (buttons,
│       │                              modals, inputs — shared visual language)
│       └── test/                   # component tests, Playwright specs
├── package.json                    # workspace root (npm/pnpm workspaces)
└── tsconfig.base.json
```

**[New Decision]** Package manager/workspace tool: **pnpm workspaces**
(faster installs, strict dependency isolation avoids phantom-dependency bugs
that plain npm workspaces allow — a real, if modest, correctness benefit for
a monorepo with a shared-types package every other package depends on).

**[New Decision]** `packages/shared` is the single place domain shapes are
defined (as `zod` schemas, since tRPC uses zod for input validation natively)
— both `server` and `web` import from it. This is what makes "shared TypeScript
data shapes" (the user's stated reason for choosing a TS/TS stack, Round 6)
concrete rather than aspirational: a Task's shape is defined exactly once.

## 2. Implementation Phases

Each phase lists: what's built, why at that stage, DB changes, APIs, and
what must be tested before moving on. Phases are sequential — later phases
depend on earlier ones being functionally complete, not just started.

### Phase 0 — Project Scaffolding & Infrastructure Baseline

_(Not yet started — this plan precedes it.)_

- Monorepo scaffold (§1), TypeScript config, lint/format tooling.
- Fastify app skeleton, tRPC wired end-to-end with a single `ping` procedure
  callable from the React app, to prove the full stack connects before any
  real feature work.
- Postgres connection + ORM setup (§4 resolves the ORM choice).
- Structured logging (Pino) and error tracking (Sentry) wired in from this
  phase, per D61 — "from day one" means literally the first deployable
  skeleton, not retrofitted later.
- CI pipeline: typecheck, lint, unit/integration test run on every push.
- **Milestone:** an empty app deploys to a real (even if temporary/staging)
  environment and responds to one real request. No product features exist
  yet, but the entire pipe is proven.

### Phase 1 — Identity Foundation: User, Auth, Sessions

- DB: `User`, `Session`, `AuthToken` (architecture.md §4).
- Email+password signup/login with verification (`AuthToken` purpose
  `email_verification`), magic-link login (`AuthToken` purpose
  `magic_link`), password reset (`AuthToken` purpose `password_reset`),
  Argon2id hashing, breached-password check at signup/reset.
- Session issuance/revocation, device/session-list UI groundwork
  (backend procedures first; UI can follow in Phase 7 alongside other
  account-settings screens — see note below).
- Rate limiting middleware on all auth-sensitive routes (D29).
- TOTP 2FA enrollment + verification + backup codes (D23).
- **No Organization/Team/Void concepts exist yet in this phase** — a User can
  exist and authenticate with no org membership at all, which is a valid,
  testable state (useful for auth-flow testing in isolation).
- **Tests required before Phase 2:** full unit coverage of password
  hashing/verification, token generation/expiry/single-use/revocation-on-
  reissue (the `AuthToken` invariants from C4), session revocation, rate
  limiter behavior; integration tests for signup→verify→login,
  magic-link login, password reset, 2FA enrollment/challenge.
- **Milestone:** a user can sign up, verify their email, log in (password or
  magic link), enable 2FA, and manage their sessions — with no product
  features around it yet.

### Phase 2 — Organizations, Teams, Membership & Authorization Engine

- DB: `Organization`, `Membership` (with the ownership invariant from C7),
  `Team`, `TeamMembership`.
- Organization creation (creator becomes Owner via a `Membership` row, not a
  denormalized column, per C7), org settings, member list.
- Team CRUD, `TeamMembership` (including `is_team_lead`), enforcing the
  C3 invariant (Team members must belong to the Team's Organization).
- **The authorization/capability engine is built in this phase**
  (architecture.md §3, corrected per C1): `canManageOrganization`,
  `canManageTeam`, `canCreateVoidForTeam` — the Void-scoped capabilities
  (`canAccessVoid`, `canEditVoid`, `canManageVoidAccess`) are stubbed/typed
  here but only fully exercised once `Void`/`VoidAccessGrant` exist in
  Phase 3. Building the engine's shape now, before Void exists, is
  deliberate: it forces the capability functions to be designed against
  their actual signatures from the start rather than retrofitted once Void
  logic is already assuming a particular access pattern.
- Ownership transfer procedure (the C7 transaction: demote current owner's
  Membership, promote target's, atomically).
- Member removal (D17 semantics: Membership ends, Team memberships end,
  nothing else auto-mutates yet — Task-assignment flagging is added in
  Phase 4 once Task exists).
- **Tests required before Phase 3:** unit tests for every capability
  function in the authorization engine (this is the highest-priority test
  surface in the whole project per D60); integration tests for org creation,
  ownership-transfer race safety (concurrent transfer attempts — the partial
  unique index from C7 should make a bad outcome impossible to commit;
  test that it's actually impossible, not just documented as such), Team
  CRUD, Team Lead scoping (a Team Lead cannot manage a Team they don't lead).
- **Milestone:** an Organization can be created, staffed with Members across
  multiple Teams with correct role scoping, and every authorization decision
  in this phase is driven by the capability engine, not inline role checks.

### Phase 3 — Voids, Groups, Access Grants (Non-Canvas)

- DB: `Void`, `VoidAccessGrant`, `Group`.
- Void CRUD (including the C3 invariant: `Void.team_id`, if set, must be in
  the same Org; and the soft-delete semantics from the new decision in §14
  below), default-visibility logic (D14: Team-visible if `team_id` set,
  private otherwise), the two approved assumptions (A1/A2: Team Lead →
  Manager on own-Team Voids, private-Void creator → Manager) implemented as
  the actual default-grant-creation logic at Void-creation time.
- `VoidAccessGrant` CRUD (Manager-only, per D13), enforcing C3's
  same-Organization invariant.
- Group CRUD (flat, per D7), enforcing that a Group's `void_id` is
  immutable after creation (no Void-hopping — not explicitly decided during
  discovery but follows necessarily from "a Group belongs to exactly one
  Void" with no stated reparenting feature).
- **This is where `canAccessVoid`/`getVoidRole`/`canEditVoid`/
  `canManageVoidAccess` become fully real** — direct grant → Team-derived
  grant → no access, with **no** Org-role bypass (C1).
- **Tests required before Phase 4:** the C1 correction is a prime target for
  a dedicated test — an Org Admin/Owner with no `VoidAccessGrant` must be
  denied access to a private Void created by another member; a Team Lead
  must default to Manager only on Voids they create for their own Team, not
  other Teams' Voids; cross-Organization `VoidAccessGrant` creation must be
  rejected (C3). These are the highest-value security tests in the project
  after Phase 2's capability-engine tests.
- **Milestone:** the full Org→Team→Void→Group hierarchy exists and is
  correctly access-controlled, with no canvas or Task yet — this phase
  proves the permission model end-to-end before any UI complexity is added.

### Phase 4 — Tasks (Core Data, No Realtime Yet)

- DB: `Task`, `TaskAssignee`, `ChecklistItem`, `Comment`, `TaskActivity`.
- Task CRUD scoped to a Void, enforcing the C3 invariant
  (`Task.group_id`, if set, must be in the same Void as the Task).
- Multi-assignee support with the C8 eligibility rule (active assignment
  requires active Membership + `canAccessVoid`); the D17/C8 interaction —
  when a member is removed (Phase 2's removal procedure), their active
  `TaskAssignee` rows across all their Org's Tasks flip to
  `assignee_active = false` as part of that same removal transaction.
- Checklist items, Comments (with @mention parsing — feeds Phase 6
  notifications), `TaskActivity` recording for the field list resolved in
  §14 below.
- Fixed status enum (D36), priority enum (resolved in §14 below).
- Task copy/paste duplication logic (same-Void only, D56; exact semantics
  resolved in §14 below).
- **No WebSocket sync, no canvas rendering yet** — this phase is pure
  backend CRUD + authorization, verified via API tests, deliberately before
  frontend/realtime complexity is layered on.
- **Tests required before Phase 5:** Task CRUD permission enforcement
  (Viewer cannot mutate, Editor/Manager can), the C8 assignment-eligibility
  invariant (attempting to actively-assign a User with no Void access must
  fail), the member-removal → assignee-flagging integration test (removes a
  member, verifies their active assignments flip to inactive, verifies Task
  data otherwise untouched per D17), copy/paste field semantics.
- **Milestone:** full Task lifecycle works via the API, fully permission-
  enforced, with no UI yet.

### Phase 5 — Realtime Layer

- WebSocket handler in the same Fastify process (D51), channel-per-Void
  (`void:{voidId}`), session-cookie handshake auth (D34).
- Subscribe-time permission check via the Phase 3 authorization engine;
  **live eviction on permission change** (the WebSocket-eviction mechanism
  resolved as a [New Decision] in §14 below — this was `architecture.md`
  §12's open item).
- Broadcast events for Task/Group create/update/move/delete (D32), triggered
  from the Phase 3/4 mutation procedures (every mutating Void/Group/Task
  procedure, after a successful DB write, publishes to that Void's channel).
- Last-write-wins conflict handling (D33) — no special server logic beyond
  "the last successful write is what gets broadcast," since there's no
  merge logic to build.
- **Tests required before Phase 6:** a permission-revocation-mid-session
  test (subscribe, then have an Admin revoke the `VoidAccessGrant`, assert
  the socket stops receiving further events promptly — this directly
  verifies the D34/C1 interaction: even though this is now backend-only
  without canvas UI, the eviction mechanism must be proven here); concurrent-
  write last-write-wins behavior (two rapid updates to the same Task, assert
  the final persisted+broadcast state is the later one, not corrupted).
- **Milestone:** two backend test clients subscribed to the same Void see
  each other's Task/Group mutations in real time, with correct, prompt
  permission enforcement — still no frontend involved.

### Phase 6 — Canvas Frontend

- Viewport/camera system (pan, zoom, WASD — D54), coordinate transform math.
- Virtualization: spatial index (client-side grid-bucket, per
  architecture.md §6) driving which Task/Group DOM nodes are actually
  mounted.
- Task and Group render components (DOM/SVG per D30) — this is where the
  bulk of "premium, minimal, modern" visual-design work happens (see
  `project-context.md` §2 for the product-feel requirements; no specific
  design-system tokens were decided during discovery, so visual design
  itself — color palette, typography, spacing — is scoped as its own
  design pass at the start of this phase, not assumed).
- tRPC queries hydrate the initial Void state; WebSocket events (Phase 5)
  keep the client store current; camera state persisted per-Void-per-User
  (debounced).
- Drag/resize interactions: optimistic local update → tRPC mutation →
  server-authoritative broadcast to others (architecture.md §6).
- Selection box / multi-select, Delete key, same-Void copy/paste (D56).
- Tablet touch support (pan/pinch-zoom, D57).
- **Tests required before Phase 7:** Playwright critical-path E2E (the
  10-step journey from D60: signup → org → invite → Team → Void → Group →
  Task → assign → authorized access → unauthorized denial) becomes runnable
  end-to-end for the first time in this phase, since it needs real UI.
  Canvas-specific interaction tests are deliberately limited (per D60 — not
  exhaustive brittle E2E coverage) to: create/move/delete Task, create/
  resize Group, multi-select+delete.
- **Milestone:** the core product loop is usable end-to-end through the UI
  by a real person, with live multi-tab sync visible.

### Phase 7 — Invitations, Search, My Tasks, Notifications, Admin, Account UI

_(Grouped because each is a relatively contained slice on top of the now-
complete core; order within this phase is flexible/parallelizable.)_

- Email invitation flow (D16): create/revoke/accept, invite-acceptance UI.
- Search (D43): `pg_trgm` indexes, search procedure + UI, authorization-
  filtered (C1/D-search-principle) results, jump-to-object camera navigation.
- My Tasks view (D44): cross-Void query + sortable/filterable list UI.
- In-app notifications (D39/D40): event generation hooks added to the
  relevant Phase 2/4 mutation procedures (role change, task assignment,
  mention, invitation), notification inbox UI.
- Admin surface (D45): member list/roles, Team management UI, pending-
  invitation management, org settings — this is largely a UI layer over
  procedures that already exist from Phases 2–3, plus the audit-log
  _write-side_ wired into every relevant mutation (D45's "data collection
  starts in MVP" — this phase is where every audited event type actually
  gets its `AuditLog` write call added, even though there's no viewer UI).
- Account/session-management UI (active sessions list, revoke, 2FA
  management) — backend procedures exist from Phase 1; this is the UI layer.
- **Tests required before Phase 8:** integration tests for invitation
  accept/revoke/expiry, search authorization-filtering (a result for an
  inaccessible Void/Task must never appear — direct test of the C1-adjacent
  search principle), notification generation for each MVP event type, audit
  log write-completeness (spot-check that key mutations actually produce an
  `AuditLog` row).
- **Milestone:** every MVP feature area from `project-context.md` §17 is
  implemented and reachable through the UI.

### Phase 8 — Hardening, Accessibility, Performance Validation

- WCAG 2.1 AA audit and fixes on all non-canvas surfaces (D58).
- Performance validation against the ~60fps / 1,000–2,000-object target
  (D59) — this is the first point in the project where that target is
  actually measured against a real implementation rather than assumed (see
  `project-context.md` §25's flagged assumption).
- Security review pass: re-verify every Non-negotiable-decision invariant
  (project-context.md §16, including #17–#19 added in the correction pass)
  has a corresponding test; dependency audit; rate-limit tuning under
  load.
- Full test-suite review against D60's stated priorities (authorization
  coverage weighted highest).
- **Milestone:** MVP is feature-complete, tested, and validated against its
  own stated performance/accessibility/security targets — ready for real
  users.

## 3. Database Migration Order

Migrations should be created in dependency order (a table can't reference a
foreign key that doesn't exist yet). This order also mirrors the phase
sequence in §2, which is intentional — each phase's migrations are a
self-contained, deployable increment:

1. `User`, `Session`, `AuthToken` (Phase 1 — no foreign keys outside this set)
2. `Organization`, `Membership` (Phase 2 — `Membership` FKs to `User` +
   `Organization`; ownership partial-unique-index created here, per C7)
3. `Team`, `TeamMembership` (Phase 2)
4. `Void`, `VoidAccessGrant`, `Group` (Phase 3)
5. `Task`, `TaskAssignee`, `ChecklistItem`, `Comment`, `TaskActivity`
   (Phase 4)
6. `Invitation`, `Notification`, `AuditLog` (Phase 2/7 — `Invitation` could
   technically move earlier since it only depends on `Organization`+`User`,
   but is grouped with Phase 7 since that's when the feature is actually
   built end-to-end; `AuditLog`'s write-call _wiring_ happens across many
   phases per §2 Phase 7, but the table itself can be migrated as early as
   Phase 2 since nothing blocks it — **[Recommendation]** migrate `AuditLog`
   in Phase 2 alongside `Organization`/`Membership` even though write-calls
   are added incrementally, so no phase is ever silently missing audit
   coverage for events it introduces).

Each cross-parent integrity invariant from `architecture.md` §4.1 (C3) is
implemented as part of the migration that creates the referencing table —
e.g., the `Task.group_id` same-Void trigger ships in the Phase 4 migration
that creates `Task`, not retrofitted later.

## 4. Authorization / Capability Architecture

Fully specified in `architecture.md` §3 (as corrected by C1); this section
adds the implementation sequencing:

- Built incrementally across Phases 2–3 (§2), but **designed as one module
  from the start** (`server/src/authorization/`) so no domain module ever
  grows its own parallel permission logic.
- **[New Decision]** Every capability function has the same signature shape
  `(actingUserId, targetId) => boolean` (or `=> Role | null` for the
  role-returning ones), and every tRPC procedure that needs one calls it via
  a small tRPC middleware helper (e.g. `requireCapability('canEditVoid',
ctx => input.voidId)`) rather than importing and calling the function
  inline in each procedure body — this keeps the "never scattered role-name
  checks" principle (Non-negotiable #8) mechanically enforced by a shared
  helper, not just a convention every procedure author has to remember.
- **[Reaffirmed non-regression rule, per 2026-09-16 review]** Capability
  functions query the database directly (no caching layer) for MVP — given
  D25's explicit rejection of adding Redis "purely because sessions exist,"
  the same reasoning applies here. This is treated as a standing constraint,
  not just a starting point: introducing any caching of authorization
  results later is itself a new, security-sensitive architectural decision
  requiring explicit invalidation-correctness design and sign-off — never a
  performance tweak added quietly to a procedure or capability function.

## 5. Authentication / Session / Token Flows

Sequencing for Phase 1, expanding `architecture.md` §8:

- **Signup:** create `User` (unverified) → issue `AuthToken`
  (`email_verification`) → email raw token → user clicks link → verify
  (hash-compare, check `consumed_at`/`expires_at`) → mark `email_verified_at`
  → issue `Session`.
- **Magic-link login:** request → issue `AuthToken` (`magic_link`),
  **revoking any prior outstanding `magic_link` token for that user** (C4's
  stated invariant) → email raw token → verify → issue `Session`. No
  password needed; if the `User` has no `password_hash` yet, this remains a
  fully valid login method (D19: both methods authenticate the same account).
- **Password reset:** request → issue `AuthToken` (`password_reset`),
  revoking any prior outstanding one → email raw token → verify → accept new
  password (breach-checked, Argon2id-hashed) → **[New Decision]** revoke all
  existing `Session`s for that user as part of a successful reset (standard
  practice: a password reset should invalidate any session an attacker may
  have established, not just future logins).
- **2FA:** TOTP secret generated at enrollment, shown once with backup
  codes (hashed at rest); login flow becomes password/magic-link success →
  TOTP challenge → `Session` issuance only after both succeed.
- **Admin-assisted recovery (D28):** a distinct authenticated Admin/Owner
  action, not a token-based flow — the Admin, authenticated in their own
  session, triggers a procedure that (a) requires explicit confirmation,
  (b) writes an `AuditLog` entry **in the same transaction as the recovery
  action** (ID15, §9 below), (c) either forces a password-reset email to the
  target user or resets their 2FA enrollment — **never** returns or sets the
  target's password/session directly (D28's "never allows silent
  impersonation").
- **Email delivery (ID12, 2026-09-16 addendum):** every email-sending step
  above (`email_verification`, `magic_link`, `password_reset`, plus
  `invitation` in Phase 7) goes through the single `EmailSender` interface
  (`architecture.md` §2) — no domain module imports a vendor SDK directly.
  Local dev/tests use `ConsoleEmailSender`; the real provider is chosen at
  deployment-preparation time (open, alongside hosting — see §12).

## 6. tRPC Router Structure

Expands `architecture.md` §5 with the procedure-level breakdown built up
through the phases:

```
authRouter:        signup, verifyEmail, login, requestMagicLink,
                    verifyMagicLink, requestPasswordReset, resetPassword,
                    enable2FA, verify2FA, listSessions, revokeSession,
                    revokeAllOtherSessions, logout
organizationRouter: create, updateSettings, listMembers, updateMemberRole,
                    removeMember, transferOwnership
teamRouter:         create, update, delete, addMember, removeMember,
                    setTeamLead, listMembers
voidRouter:         create, update, delete, list, get, grantAccess,
                    revokeAccess, listAccessGrants
groupRouter:        create, update (position/size/name), delete
taskRouter:         create, update, delete, assign, unassign, move,
                    duplicate, addChecklistItem, toggleChecklistItem,
                    addComment, editComment, deleteComment, listActivity
invitationRouter:   create, revoke, accept, listPending
notificationRouter: list, markRead, markAllRead
searchRouter:       search
myTasksRouter:      list
```

Every mutating procedure in `voidRouter`, `groupRouter`, and `taskRouter`
publishes its realtime event (Phase 5) as its last step, after the DB write
commits — **[New Decision]** this publish step lives in a thin shared
wrapper (not duplicated per-procedure) so the "mutate → broadcast" pattern
can't be accidentally skipped when a new procedure is added later.

## 7. WebSocket / Realtime Architecture

Expands `architecture.md` §6/§6.1/§6.2/§12, resolving the previously-open
eviction mechanism and, per the second review round, defining ordering and
reconnect behavior explicitly rather than leaving them implicit:

**[New Decision] WebSocket permission-eviction mechanism (ID10):**
event-driven, not polled. When `voidRouter.revokeAccess` (or any procedure
that changes a `VoidAccessGrant`) commits, it publishes an internal
`void-access-changed` event (in-process event emitter — no external message
bus needed at MVP scale, consistent with "avoid unnecessary infrastructure").
The realtime module subscribes to this event and, for the affected Void's
channel, re-checks each currently-subscribed connection's `canAccessVoid`
and force-disconnects any that no longer pass. This satisfies D34/C1's
"permission revocation must stop further realtime access... rather than
relying only on permissions checked at initial login" requirement precisely,
with no polling latency window.

**[New Decision] Server-side ordering (ID14):** D33's last-write-wins is
ambiguous without a defined notion of "last" — client timestamps are
explicitly **not** used (unreliable/skewable clocks). Instead, `Task` and
`Group` each carry a server-assigned `version` (architecture.md §4),
incremented atomically in the same transaction as the write, and included in
every broadcast. Flow: `authorize → accept write → persist + increment
version → broadcast {object, version}`. A client reconciles its own
optimistic update against the broadcast's version rather than assuming its
local state is already authoritative.

**[New Decision] Reconnect/resync protocol (ID13):** a WebSocket connection
does not guarantee delivery across a gap. On every (re)connection: (1)
re-authenticate via session cookie, (2) server re-checks live `canAccessVoid`
— a reconnect with a valid session but lost Void access is refused, (3)
client fetches **authoritative current state via a normal tRPC query**
(explicitly not an event-replay/backlog log, which MVP does not build), (4)
client replaces local state and resumes live updates. This single protocol
covers, uniformly: temporary network loss, browser reconnect, an expired/
revoked session, loss of Void access mid-session, and server restart — the
client never needs to distinguish between these cases; it always ends up
re-authenticated, re-authorized, and resynced to authoritative truth. See
`architecture.md` §6.1 for the full specification.

**[New Decision] Void deletion + realtime (part of ID16, §6.2):** deleting a
Void broadcasts a `void.deleted` event to its channel before the eviction
above disconnects remaining subscribers, so the client can show an explicit
"this Void was deleted" state rather than the connection silently dropping.

## 8. Canvas State / Rendering Architecture

Expands `architecture.md` §6 for Phase 6:

- Client-side store (e.g. a small reactive store — Zustand or React context
  - `useSyncExternalStore`; **[Open]** exact state-management library choice
    left to Phase 6 implementation, not decided here — this is a frontend
    implementation detail with no architectural consequence beyond "one store
    per open Void, fed by tRPC hydration + WebSocket events").
- Spatial index: **[New Decision]** a grid-bucket index (objects bucketed by
  `floor(x / bucketSize), floor(y / bucketSize)`), not a quadtree — simpler
  to implement correctly, and sufficient at the ~1,000–2,000-object target
  (D59); a quadtree would be justified at an order of magnitude more
  objects, which is explicitly not the MVP target.
- Optimistic-update rollback: local mutation applied immediately on
  drag/resize/edit; if the corresponding tRPC mutation fails, the store
  reverts to its last server-confirmed state for that object (not a generic
  undo — D56 explicitly excludes undo/redo from MVP; this rollback only
  handles the failure case of a user's own in-flight action, not a general
  history stack).
- Reconnect handling (ID13, §7): the client-side store's response to a
  reconnect is "discard and re-hydrate from a fresh query," not an attempt
  to patch/merge — this keeps the canvas store's reconnect logic identical
  to its very first load, one code path instead of two.

## 8.1 Soft-Delete Behavior (2026-09-16 addendum, ID16)

Fully specified in `architecture.md` §6.2; implemented starting in Phase 3
(Void deletion) since that's the first entity in the data model with a
`deleted_at` column. Summary of the module-wide contract every domain must
follow, so it isn't reinvented per-module: standard reads filter
`deleted_at IS NULL` via a shared query-builder helper; a deleted Void is
authorization-inaccessible outright (existing `VoidAccessGrant` rows are
left intact but not honored); Groups/Tasks under a deleted Void are **not**
individually cascade-soft-deleted — they become unreachable via the
Void-level join, keeping deletion an O(1) write; restoration is **not**
built in MVP; realtime subscribers get a `void.deleted` broadcast (§7) before
eviction.

## 9. Testing Strategy & Critical Security Tests

Expands `decisions.md` D60 with the specific must-exist test list, weighted
per the user's explicit priority (authorization > correctness > breadth):

**Tier 1 (highest priority — a failure here is a potential security
incident, per D60):**

- Every capability function in the authorization engine (§4), unit-tested
  against both positive and negative cases.
- The C1 regression test: Org Admin/Owner denied access to a Void they have
  no grant on.
- The C3 invariants: cross-Void `group_id`, cross-Org `team_id`,
  cross-Org `VoidAccessGrant`, cross-Org `TeamMembership` — each rejected.
- The C7 ownership invariant: concurrent ownership-transfer attempts cannot
  produce zero or two active owners.
- The C8 eligibility invariant: cannot actively-assign a User without Void
  access; removal correctly flips existing assignments to inactive.
- WebSocket eviction on permission revocation (§7).
- Search result authorization-filtering (no inaccessible-object leakage).
- Tenant isolation: a query scoped to one Organization must never return
  another Organization's data, tested at the boundary of every domain
  module (not just spot-checked once).
- **(2026-09-16 additions)** Server-side ordering (ID14): concurrent
  conflicting writes to the same Task/Group resolve to the higher `version`
  winning, never a client-timestamp-based outcome.
- Reconnect/resync (ID13): a client that reconnects after simulated network
  loss ends up with authoritative current state, not stale/partial state —
  and a reconnect attempt with a since-revoked session or since-revoked Void
  access is refused, not silently allowed back in.
- Transactional audit logging (ID15): for each security-sensitive mutation
  type listed in `decisions.md` ID15, assert the state change and the
  `AuditLog` row either both commit or both roll back — inject a failure
  after the state write but before the audit write in a test harness and
  confirm the whole transaction rolls back, not just part of it.
- Soft-delete (ID16): a deleted Void's Groups/Tasks are unreachable via
  normal queries; an Org Admin/Owner with no grant still cannot access a
  deleted Void's data via any code path; a deleted Void's `VoidAccessGrant`
  rows are provably untouched (still present, just not honored) so a future
  restore feature has something to restore.
- Authorization non-caching (reaffirmed, not new): a capability check
  reflects a permission change made immediately beforehand, with no
  observable staleness window — this is a natural consequence of not
  caching, but worth a direct test given how easy an accidental cache
  (e.g. a memoized query hook reused across requests) would be to introduce
  by accident later.

**Tier 2 (integration coverage of core flows):** per-domain CRUD +
permission-boundary tests for every tRPC procedure listed in §6.

**Tier 3 (E2E, Playwright, critical path only per D60):** the 10-step
journey from D60, run against a real deployed-locally instance in CI.

## 10. Observability / Logging / Error Tracking

Expands `decisions.md` D61: Pino structured logging from Phase 0, with
**[New Decision]** a consistent log-context convention — every request-scoped
log line includes `requestId`, `userId` (if authenticated), and
`organizationId` (if resolvable from the request) — so that a production
incident can be traced to a specific tenant without cross-referencing
multiple systems. Sentry (or equivalent) captures unhandled errors from
Phase 0 onward; **[Recommendation]** Sentry's own org/project should be
created before Phase 0's deployment milestone, not after — flagging since it
has an external-account setup step outside this codebase.

## 11. Development Milestones & Dependency Graph

```
Phase 0 (infra) ──► Phase 1 (identity) ──► Phase 2 (org/team/authz) ──► Phase 3 (void/group)
                                                                              │
                                                                              ▼
                                                                        Phase 4 (task)
                                                                              │
                                                                              ▼
                                                                       Phase 5 (realtime)
                                                                              │
                                                                              ▼
                                                                    Phase 6 (canvas frontend)
                                                                              │
                                                                              ▼
                                                      Phase 7 (invites/search/my-tasks/notif/admin)
                                                                              │
                                                                              ▼
                                                                     Phase 8 (hardening)
```

Strictly sequential at the phase level — each phase's milestone is a
precondition for the next (e.g. Phase 6's canvas has nothing to render
without Phase 4's Task data and Phase 5's realtime events). **Within** Phase
7, the five feature slices (invitations, search, My Tasks, notifications,
admin) have no dependencies on each other and can be built in parallel by
different people, or in any order, if that's useful — this is the one phase
without a strict internal sequence.

## 12. Where Remaining Open Questions Must Be Resolved

Cross-referencing `spec.md` §5 and `architecture.md` §12, now that several
have been resolved in §14 below:

| Question                                  | Resolved here?                                        | If not, resolve by                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void deletion semantics                   | **Resolved, §8.1/§14 (ID1/ID16)**                     | —                                                                                                                                                                                              |
| Task priority enum                        | **Resolved, §14 (ID2)**                               | —                                                                                                                                                                                              |
| Comment edit/delete permissions           | **Resolved, §14 (ID3)**                               | —                                                                                                                                                                                              |
| Activity-history field list               | **Resolved, §14 (ID4)**                               | —                                                                                                                                                                                              |
| Copy/paste duplication semantics          | **Resolved, §14 (ID5)**                               | —                                                                                                                                                                                              |
| Multiple Team Leads per Team              | **Resolved, §14 (ID6)**                               | —                                                                                                                                                                                              |
| Session lifetime exact durations          | **Approved as configurable defaults, §14 (ID7)**      | Values centralized in `server/src/config/`; a future security review may retune without architectural change.                                                                                  |
| Availability/uptime SLA                   | **[Open]**                                            | Not an implementation detail — a business/pricing-adjacent commitment. Should be revisited alongside billing/pricing design (V2, per D46), not decided as part of MVP implementation planning. |
| ORM/query-builder choice                  | **Resolved, §14 (ID8)**                               | —                                                                                                                                                                                              |
| CSRF-protection mechanism                 | **Resolved, §14 (ID9)**                               | —                                                                                                                                                                                              |
| WebSocket eviction mechanism              | **Resolved, §7 (ID10)**                               | —                                                                                                                                                                                              |
| Server-side write ordering                | **Resolved, §7 (ID14)**                               | —                                                                                                                                                                                              |
| WebSocket reconnect/resync behavior       | **Resolved, §7 (ID13)**                               | —                                                                                                                                                                                              |
| Transactional audit-log guarantee         | **Resolved, architecture.md AuditLog section (ID15)** | —                                                                                                                                                                                              |
| Soft-delete behavior specification        | **Resolved, §8.1 (ID16)**                             | —                                                                                                                                                                                              |
| Email delivery abstraction                | **Resolved (interface), §5 (ID12)**                   | Concrete provider remains open — see next row.                                                                                                                                                 |
| Hosting provider                          | **[Open — explicitly declined, not a decision]**      | Railway remains a _candidate_, not approved. Revisit during deployment preparation, once actual MVP requirements are known — not before Phase 0, and not silently.                             |
| Email provider (vendor)                   | **[Open]**                                            | Same timing as hosting — deployment-preparation time, behind the `EmailSender` interface so no code changes are needed elsewhere when chosen.                                                  |
| State-management library (frontend)       | **[Open]**                                            | Phase 6 implementation start — no architectural consequence, genuinely fine to decide then.                                                                                                    |
| Trigger vs. composite-FK per C3 invariant | **[Open]**                                            | Phase 3/4 migration authoring, once the ORM (§14) confirms what it supports cleanly.                                                                                                           |

## 13. Explicit Non-Regression Statement

This plan introduces no change to any Non-negotiable decision
(`project-context.md` §16, items 1–19) or the MVP Explicitly-Deferred list
(`project-context.md` §18). Every phase in §2 was checked against both lists
while being written; where a phase's design could have been tempted to
shortcut a Non-negotiable item for implementation convenience (e.g., caching
authorization results, giving Admins a Void-access shortcut "just for the
admin UI"), that temptation is called out explicitly in this document and
rejected, not silently avoided.

## 14. New Decisions Resolved During Implementation Planning (2026-09-16)

Full detail also recorded in `decisions.md` under "Implementation Planning
Addenda (2026-09-16)." Summarized here for convenience:

- **ID1. Void deletion:** soft-delete (`deleted_at`, already in the schema).
  Permission required: Void Manager or Organization Admin/Owner. A
  soft-deleted Void is excluded from listings/search/realtime but not
  immediately purged — consistent with the "removal is never silently
  destructive" principle applied elsewhere (D17). Hard-deletion/purge policy
  (e.g. after N days) is not decided here and is not needed for MVP.
- **ID2. Task priority enum:** four fixed levels — `low`, `medium`, `high`,
  `urgent` — mirroring the fixed-status-set approach (D36) rather than a
  free-form field.
- **ID3. Comment permissions:** the author may edit/delete their own
  comment; a Void Manager may additionally delete (not edit) any comment in
  that Void, for moderation. No comment-edit history is kept in MVP (only
  `updated_at` changes) — full edit-history is not required by any
  discovery decision and would be new scope.
- **ID4. Activity-history field list:** `status`, `priority`, `assignees`,
  `due_date`, `group_id`. Title/description/tags changes are **not**
  tracked in MVP activity history (would be noisy for a free-text field with
  no fixed-value semantics); this can be revisited if real usage shows it's
  wanted.
- **ID5. Copy/paste duplication semantics:** a duplicated Task gets a new
  ID; copies title, description, priority, tags, `group_id`, and checklist
  items (reset to unchecked); does **not** copy assignees (an explicit
  choice — duplicating a task shouldn't silently notify/assign someone to
  work they didn't take on), comments, or activity history; status resets to
  the Void's default (`todo`).
- **ID6. Multiple Team Leads:** allowed, no cap — `TeamMembership.is_team_lead`
  is a boolean per member, not a singular Team-level pointer.
- **ID7. Session lifetime durations — [Approved 2026-09-16 as configurable
  defaults, not an immutable product requirement]:** default (no "remember
  me") session idle-expiry: 12 hours. "Remember me": 30 days. Both are
  inactivity-based (a session's `expires_at` is extended on activity up to
  these caps, not a fixed clock from login). Values are centralized as named
  constants in `server/src/config/` (not hardcoded inline) so they can be
  retuned post-launch without any architectural change.
- **ID8. ORM/query-builder:** **Drizzle** — chosen over Prisma for a lighter
  runtime footprint, SQL-shaped query API (easier to reason about exactly
  what query runs, useful when hand-writing the trigger-based C3 invariants
  alongside it), and no separate code-generation step, consistent with the
  "avoid framework complexity that doesn't materially help" principle
  already applied to the Fastify-over-NestJS choice (D47).
- **ID9. CSRF mechanism:** SameSite=Lax session cookies + a strict
  Origin-header validation middleware on all state-changing requests
  (reject any request whose `Origin` header doesn't match the app's known
  origin) — **not** a separate CSRF token system. This is sufficient given
  there's no cross-origin form-post surface (tRPC calls are same-origin
  `fetch`/WebSocket only), and avoids the added complexity of token
  issuance/rotation for no real additional protection in this specific setup.
- **ID10. WebSocket eviction mechanism:** event-driven (§7), not polled.
- **ID11. Hosting provider — [Explicitly NOT approved; remains TBD, per
  2026-09-16 user review]:** Railway (app + managed Postgres) was proposed
  as a candidate but the user explicitly declined to lock it in — it has
  real vendor/account/billing consequences and doesn't need resolving before
  the application is built and tested. **Status: open**, to be revisited
  during deployment preparation once actual MVP requirements are known, not
  treated as decided anywhere else in this document or `architecture.md`.
- **ID12. Email delivery abstraction:** a provider-agnostic `EmailSender`
  interface (`architecture.md` §2) that `auth` and `invitation` depend on
  exclusively — no domain module imports a vendor SDK directly.
  `ConsoleEmailSender` backs local dev/tests. The concrete provider
  (Resend/Postmark/SES/etc.) **remains open**, same timing as hosting
  (ID11) — a vendor choice with zero architectural blast radius as long as
  it sits behind this interface.
- **ID13. WebSocket reconnect/resync protocol:** on every (re)connection —
  whether after network loss, browser reconnect, an expired/revoked
  session, loss of Void access, or server restart — the client
  re-authenticates, the server re-checks live Void access, and the client
  fetches authoritative current state via a normal query (not an event-
  replay/backlog log). See `architecture.md` §6.1 for full detail.
- **ID14. Server-side ordering for last-write-wins:** a server-assigned
  `version` column on `Task`/`Group` (architecture.md §4), incremented
  atomically with each accepted write, included in every broadcast — never
  client timestamps. Flow: authorize → accept → persist + increment version
  → broadcast. Underpins ID13's resync determinism.
- **ID15. Transactional audit logging:** for security-sensitive mutations
  (role changes, member removal, ownership transfer, Team membership
  changes, Void access grant/revocation, admin-assisted recovery, and
  similar), the state mutation and its `AuditLog` row commit in the same
  database transaction — never independently. No async/background audit
  pipeline in MVP.
- **ID16. Soft-delete behavior specification:** documented once, centrally,
  for all modules to follow (`architecture.md` §6.2) rather than left for
  each to invent independently — query exclusion via a shared helper,
  authorization treats a deleted Void as inaccessible outright, Groups/Tasks
  under a deleted Void become unreachable via the Void-level join rather
  than being individually cascade-soft-deleted, restoration is not built in
  MVP, and realtime subscribers get an explicit `void.deleted` broadcast
  before eviction.
- **Reaffirmed (not newly decided):** authorization remains uncached in MVP
  — every sensitive operation resolves current authorization from
  authoritative state on every call, with no memoization/caching layer.
  Introducing caching later is itself a new security-sensitive architectural
  decision requiring explicit invalidation design (per the user's explicit
  instruction), not a performance tweak to add quietly.

## 15. What This Plan Does Not Do

Per explicit instruction: no dependencies have been installed, no repository
has been scaffolded, no migration files have been created, and no
application code has been written. This document is the plan for doing all
of that, not the doing of it.
