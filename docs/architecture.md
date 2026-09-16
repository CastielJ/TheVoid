# Void — Technical Architecture

Status: authoritative. See `project-context.md` §28 for document precedence.
This document covers technical design derived from the decisions in
`decisions.md`; it does not introduce new product requirements.

Note: sections marked **[Recommendation]** are proposed implementation
approaches consistent with the confirmed decisions, offered here for
implementation planning — they were not individually put to the user as
discrete interview questions, and should be treated as reasonable defaults
open to refinement during actual implementation planning, not as
independently confirmed decisions.

---

## 1. System Overview

Void is a **modular monolith**: one Node.js/TypeScript backend process
(Fastify + tRPC) serving both HTTP (tRPC procedures) and WebSocket (realtime
canvas sync) traffic, backed by a single PostgreSQL database, with a React +
Vite single-page frontend. No microservices, no separate realtime vendor, no
Kubernetes for MVP — consistent with the "avoid unnecessary infrastructure"
principle established throughout discovery.

```
┌─────────────────────────────┐
│   React + Vite SPA (TS)     │
│  - Canvas (DOM/SVG + virt.) │
│  - tRPC client               │
│  - WebSocket client          │
└───────────┬──────────────────┘
            │ HTTPS (tRPC over HTTP) + WSS
┌───────────▼──────────────────┐
│  Fastify server (TS)         │
│  ┌─────────────────────────┐ │
│  │ tRPC router (domain-    │ │
│  │ scoped sub-routers)     │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ WebSocket handler        │ │
│  │ (session auth + per-Void │ │
│  │  permission re-check)    │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ Authorization engine     │ │
│  │ (capability resolution:  │ │
│  │  Org → Team → Void)      │ │
│  └─────────────────────────┘ │
└───────────┬──────────────────┘
            │
┌───────────▼──────────────────┐
│      PostgreSQL               │
│  (tenant-scoped tables,       │
│   pg_trgm for search)         │
└────────────────────────────────┘
```

## 2. Backend Architecture

**Stack:** TypeScript, Fastify (HTTP/WS server), tRPC (API layer),
PostgreSQL via **Drizzle** as the ORM/query builder (resolved during
implementation planning, 2026-09-16 — see `decisions.md` ID8 — chosen over
Prisma for a lighter runtime footprint, SQL-shaped queries, and no
code-generation step).

**Module boundaries [Recommendation]:** organize by domain, not by technical
layer, to keep the "modular monolith, no giant files" principle concrete:

```
server/
├── domains/
│   ├── auth/            (sessions, password, magic-link, 2FA, recovery)
│   ├── organization/    (Organization, Membership, org roles)
│   ├── team/             (Team, TeamMembership, Team Lead)
│   ├── void/             (Void, VoidAccessGrant)
│   ├── group/            (Group)
│   ├── task/              (Task, TaskAssignee, ChecklistItem, Comment)
│   ├── invitation/        (Invitation)
│   ├── notification/      (Notification)
│   ├── search/            (search queries)
│   └── audit/             (AuditLog)
├── authorization/         (capability-resolution engine — cross-cutting,
│                            consumed by every domain, not owned by one)
├── realtime/               (WebSocket handler, channel subscription logic)
├── email/                   (provider-agnostic email-sending abstraction —
│                              see below, added 2026-09-16)
├── routers/                 (tRPC routers, one per domain, composed into root)
└── db/                       (schema, migrations)
```

**Email delivery abstraction (2026-09-16 addendum):** `auth` (verification,
magic-link, password-reset emails) and `invitation` (invite emails) both
depend on sending transactional email, but neither should be coupled to a
specific email vendor. **[New Decision]** a single `EmailSender` interface,
e.g.:

```ts
interface EmailSender {
  send(
    purpose: "email_verification" | "magic_link" | "password_reset" | "invitation",
    to: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}
```

Domain modules depend only on this interface, never on a concrete provider
SDK. A `ConsoleEmailSender` (logs the email instead of sending it) is the
implementation used in local development and tests; the real provider
(Resend, Postmark, SES, etc. — **[Open]**, intentionally not decided here)
is chosen and wired in at deployment-preparation time, matching how hosting
(§11) is being left open for the same reason: it's an external-vendor choice
with no architectural consequence for the rest of the system as long as it
sits behind this interface.

Each domain module owns its own database access and business logic; the
`authorization` module is the one cross-cutting dependency every domain
consults for permission checks (never re-implemented per-domain).

**Why Fastify + tRPC over NestJS:** see `decisions.md` D47. Module boundaries
are enforced by this folder structure and code review, not a DI framework —
deliberately, per the "avoid framework complexity that doesn't materially
help" instruction.

## 3. Authorization Engine Design

**[Recommendation, following directly from D11–D15]:** a single module
exposes capability-check functions, e.g.:

```ts
canManageOrganization(userId, orgId): boolean       // org settings, members, teams, invitations
canManageTeam(userId, teamId): boolean               // Team Lead or org Admin/Owner, scoped to that Team
canCreateVoidForTeam(userId, teamId): boolean         // Team Lead (own Team) or org Admin/Owner
canAccessVoid(userId, voidId): boolean                // any Void-level role via a VoidAccessGrant
canEditVoid(userId, voidId): boolean                  // Editor or Manager grant
canManageVoidAccess(userId, voidId): boolean          // Manager grant only
getVoidRole(userId, voidId): 'viewer' | 'editor' | 'manager' | null
```

**Correction (2026-09-16 documentation review):** an earlier draft of this
section stated that Organization Owner/Admin automatically receive full
access to every Void. **That was not a confirmed decision and has been
removed.** Org-level roles grant _organization-management_ capabilities
(`canManageOrganization`, `canManageTeam`, invitations, settings) — they do
**not**, by themselves, imply unrestricted access to every Void, including
private/personal Voids and Voids scoped to a Team the Admin isn't a member
of. Void access is _always_ governed by an explicit `VoidAccessGrant` (direct
or via Team membership), per Non-negotiable #4. This preserves the intent of
D14 (private Voids default to creator-only visibility) and D6 (cross-Team
Void access is explicit) — an unrestricted Admin-bypass would have silently
undermined both.

Resolution order for `canAccessVoid` / `getVoidRole`:

1. Does the user have a **direct** `VoidAccessGrant` (`user_id` match) on
   this Void? → use its role.
2. Does the user belong to a Team that has a `VoidAccessGrant` (`team_id`
   match) on this Void? → use the highest role among such grants.
3. Otherwise → no access, **regardless of the user's Organization role.**

`canManageOrganization` / `canManageTeam` are separate checks used for
org/team-management procedures (inviting members, editing Team membership,
renaming the Organization, etc.) — they never substitute for a Void-access
check. If a product requirement later needs "Org Admins can see all Voids for
oversight purposes," that is a **new, explicit decision** to be made (e.g. a
distinct `canAuditAllVoids` capability, deliberately named and scoped) — not
an implicit consequence of holding the Admin role. As of this document, no
such capability exists.

Every tRPC procedure and every WebSocket channel-subscribe handler calls into
this module — no procedure should independently re-implement a role check
inline. This directly satisfies the "capability-based, not scattered
role-name checks" principle (Non-negotiable #8).

## 4. Database Schema (Proposed)

**[Recommendation — table/column names are proposed, not independently
confirmed field-by-field during discovery, but the entities and relationships
themselves follow directly from confirmed decisions.]**

```sql
-- Global identity
User (
  id UUID PK,
  email TEXT UNIQUE NOT NULL,
  email_verified_at TIMESTAMPTZ,
  password_hash TEXT,              -- nullable: magic-link-only users may have none
  totp_secret TEXT,                -- nullable, encrypted at rest
  totp_backup_codes TEXT[],        -- hashed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- never hard-deleted on org removal (D18 / Non-negotiable #12)
)

Session (
  id UUID PK,
  user_id UUID FK -> User,
  device_label TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,  -- inactivity-extended up to a cap; see below
  revoked_at TIMESTAMPTZ            -- null = active
)
-- Session lifetime (approved 2026-09-16 as configurable implementation
-- defaults, `decisions.md` ID7): 12h inactivity cap normally, 30d if
-- "remember me" was set at login. `expires_at` is pushed forward on activity
-- up to whichever cap applies, not fixed from login time. Both numbers live
-- as named constants in `server/src/config/` (§2), not hardcoded inline at
-- each call site, so a future security review can retune them without
-- touching authentication logic itself.

-- Tenant boundary
Organization (
  id UUID PK,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- No owner_user_id column: ownership is derived from Membership (see below).
)

Membership (
  id UUID PK,
  organization_id UUID FK -> Organization NOT NULL,
  user_id UUID FK -> User NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  status TEXT NOT NULL CHECK (status IN ('active','removed')) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  UNIQUE (organization_id, user_id),
  -- Ownership invariant (2026-09-16 review, item 7): exactly one active
  -- 'owner' Membership per Organization, enforced via a partial unique index
  -- rather than a duplicated Organization.owner_user_id column:
  -- CREATE UNIQUE INDEX one_active_owner_per_org ON Membership (organization_id)
  --   WHERE role = 'owner' AND status = 'active';
  -- Ownership transfer is a single transaction: demote the current owner's
  -- Membership to 'admin', then promote the target Membership to 'owner'.
  -- The partial unique index makes an inconsistent intermediate state
  -- (zero or two active owners) impossible to commit.
)

-- Teams (people/access grouping)
Team (
  id UUID PK,
  organization_id UUID FK -> Organization NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

TeamMembership (
  id UUID PK,
  team_id UUID FK -> Team NOT NULL,
  user_id UUID FK -> User NOT NULL,
  is_team_lead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
)

-- Void (workspace/project container)
Void (
  id UUID PK,
  organization_id UUID FK -> Organization NOT NULL,
  team_id UUID FK -> Team,          -- nullable; default-visibility hint only,
                                     -- NOT the access-control mechanism
  name TEXT NOT NULL,
  created_by UUID FK -> User NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ             -- soft-delete; see spec.md open question #1
)

-- Explicit access control (Non-negotiable #4)
VoidAccessGrant (
  id UUID PK,
  void_id UUID FK -> Void NOT NULL,
  team_id UUID FK -> Team,           -- exactly one of team_id / user_id set
  user_id UUID FK -> User,
  role TEXT NOT NULL CHECK (role IN ('viewer','editor','manager')),
  granted_by UUID FK -> User NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (team_id IS NOT NULL AND user_id IS NULL) OR
    (team_id IS NULL AND user_id IS NOT NULL)
  )
)

-- Group (spatial task cluster within a Void)
Group (
  id UUID PK,
  void_id UUID FK -> Void NOT NULL,
  name TEXT NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,  -- server-assigned, incremented on every
                                       -- update; see §6.1 (2026-09-16 addendum)
                                       -- for ordering/resync use
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Task
Task (
  id UUID PK,
  void_id UUID FK -> Void NOT NULL,
  group_id UUID FK -> Group,         -- nullable; explicit membership (Non-negotiable #5)
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('todo','in_progress','done','blocked')) DEFAULT 'todo',
  priority TEXT,                     -- enum values: open question, spec.md §5.2
  due_date DATE,
  x DOUBLE PRECISION NOT NULL,       -- presentational only re: group_id
  y DOUBLE PRECISION NOT NULL,
  tags TEXT[],
  version BIGINT NOT NULL DEFAULT 1,  -- server-assigned, incremented on every
                                       -- update; see §6.1 (2026-09-16 addendum)
  created_by UUID FK -> User NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
)

TaskAssignee (
  task_id UUID FK -> Task NOT NULL,
  user_id UUID FK -> User NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignee_active BOOLEAN NOT NULL DEFAULT true, -- false if member removed (D17)
  PRIMARY KEY (task_id, user_id)
  -- Assignment eligibility invariant (2026-09-16 review, item 8): a new/active
  -- assignment (assignee_active = true) may only be created for a User with
  -- an active Membership in the Task's Void's Organization who is eligible
  -- to participate in that Void (i.e. canAccessVoid(user_id, task.void_id) is
  -- true at assignment time, per the authorization engine in §3). Former
  -- Organization members remain attached only as inactive historical
  -- assignees (assignee_active = false) once their Membership ends (D17) —
  -- this flag flip happens automatically as part of member removal, not as a
  -- separate manual step. This is an application-layer invariant (enforced
  -- in the task.assign procedure), not a DB constraint, since it depends on
  -- cross-table authorization state that changes independently of this row.
)

ChecklistItem (
  id UUID PK,
  task_id UUID FK -> Task NOT NULL,
  label TEXT NOT NULL,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL,          -- ordering
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

Comment (
  id UUID PK,
  task_id UUID FK -> Task NOT NULL,
  author_id UUID FK -> User NOT NULL,   -- always a real User (Non-negotiable #12)
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
)

TaskActivity (
  id UUID PK,
  task_id UUID FK -> Task NOT NULL,
  actor_id UUID FK -> User NOT NULL,
  field TEXT NOT NULL,                -- e.g. 'status','assignees','priority','due_date'
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Authentication tokens (2026-09-16 review, item 4): a single purpose-scoped
-- table backs magic links, email verification, and password reset — all
-- share the same shape (random token, hashed at rest, expiring, single-use).
-- Session (above) and Invitation (below) already have their own purpose-built
-- token handling and are NOT folded into this table.
AuthToken (
  id UUID PK,
  user_id UUID FK -> User NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verification','magic_link','password_reset')),
  token_hash TEXT NOT NULL,            -- SHA-256 (or similar) of the raw token; raw token
                                        -- is only ever emailed, never persisted
  expires_at TIMESTAMPTZ NOT NULL,     -- short-lived: minutes-to-hours, not days
  consumed_at TIMESTAMPTZ,             -- set on first use; single-use enforced by
                                        -- checking IS NULL at verification time
  revoked_at TIMESTAMPTZ,              -- e.g. superseded by a newer request of the
                                        -- same purpose for the same user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- Issuing a new token of the same purpose for the same user should revoke any
-- prior outstanding token of that purpose (prevents multiple simultaneously-
-- valid reset/magic-link tokens). Verification must check token_hash match,
-- consumed_at IS NULL, revoked_at IS NULL, and expires_at > now() together.

-- Invitations
Invitation (
  id UUID PK,
  organization_id UUID FK -> Organization NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')), -- cannot invite as owner
  token_hash TEXT NOT NULL,            -- store hash, not raw token
  invited_by UUID FK -> User NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')) DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Notifications
Notification (
  id UUID PK,
  user_id UUID FK -> User NOT NULL,
  type TEXT NOT NULL,                  -- 'task_assigned' | 'mentioned' | 'invited' | 'role_changed'
  payload JSONB NOT NULL,              -- event-specific data (task_id, org_id, etc.)
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Audit log (append-only, Non-negotiable #12 / project-context.md §15)
-- Transactional guarantee (2026-09-16 addendum): for every security-sensitive
-- operation (role changes, member removal, ownership transfer, Team
-- membership changes, Void access grant/revocation, admin-assisted recovery,
-- and other permission-relevant mutations), the state mutation and its
-- AuditLog row are written in the SAME database transaction, committed or
-- rolled back together. This is a correctness requirement, not a performance
-- optimization: a mutation that succeeds must never silently lack its audit
-- record, and an audit record must never exist for a mutation that didn't
-- actually commit. At MVP scale, writing the audit row synchronously in the
-- same transaction has negligible performance cost — no async/background
-- audit pipeline is needed and one is explicitly NOT introduced for MVP.
AuditLog (
  id UUID PK,
  organization_id UUID FK -> Organization NOT NULL,
  actor_id UUID FK -> User,            -- nullable only for system-initiated events, if any
  event_type TEXT NOT NULL,            -- e.g. 'member.role_changed', 'void.access_granted'
  target_type TEXT,                    -- e.g. 'user','team','void'
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

**Tenant-isolation wording (corrected 2026-09-16):** every tenant-scoped
record must have an unambiguous Organization ownership path, either directly
through `organization_id` (e.g. `Organization`, `Membership`, `Team`, `Void`,
`Invitation`, `AuditLog`) or through a mandatory tenant-owned parent
relationship (e.g. `Group.void_id → Void.organization_id`,
`Task.void_id → Void.organization_id`, `TeamMembership.team_id →
Team.organization_id`). Every query must enforce this ownership boundary —
either by filtering on a direct `organization_id` column, or by joining
through the owning parent and filtering there. This is the tenant-isolation
enforcement point (Non-negotiable #1). No redundant `organization_id` columns
are added to child tables (e.g. `Group`, `Task`) purely for query convenience
unless profiling later shows the join is a real bottleneck — the parent
relationship is already unambiguous and authoritative.

### 4.1 Cross-Tenant & Cross-Parent Integrity (2026-09-16 review, item 3)

The following relationships must never cross an Organization or parent-Void
boundary. Where a plain Postgres foreign key cannot express the invariant on
its own (Postgres has no native "same parent as sibling row" constraint),
enforcement is via a trigger, a denormalized composite foreign key, or —
always, as the baseline layer regardless of DB-level enforcement —
application-level validation in the relevant tRPC procedure before any write:

| Invariant                                                                                                                                                     | Enforcement approach                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Task.group_id`, when non-null, must reference a `Group` belonging to the **same `Void`** as the `Task` (`Task.void_id = Group.void_id`)                      | **[Recommendation]** Trigger (`BEFORE INSERT OR UPDATE ON Task`) validating `NEW.group_id`'s `void_id` matches `NEW.void_id`; enforced additionally at the application layer when a task is moved between Groups.                                                                                                           |
| `Void.team_id`, when non-null, must reference a `Team` belonging to the **same `Organization`** as the `Void` (`Void.organization_id = Team.organization_id`) | **[Recommendation]** Trigger, or a denormalized composite FK `(team_id, organization_id) REFERENCES Team(id, organization_id)` if the ORM supports composite FKs cleanly — otherwise trigger.                                                                                                                               |
| `VoidAccessGrant.team_id` / `VoidAccessGrant.user_id` must belong to the **same Organization** as the granted `Void`                                          | **[Recommendation]** Trigger validating the referenced Team's `organization_id` (or the referenced User's active Membership organization_id) matches `Void.organization_id` at grant-creation time.                                                                                                                         |
| `TeamMembership` users must belong to the **Team's Organization** (i.e. have an active `Membership` in that Organization)                                     | **[Recommendation]** Application-layer check in the `team.addMember` procedure (a User with no Membership in the Org should never be addable to one of its Teams) — a DB trigger is possible but application-layer is likely sufficient here since Team membership changes are a low-frequency, already-gated admin action. |
| Cross-Organization references must never be valid anywhere in the schema                                                                                      | Structural: every entity's Organization is reachable via exactly one path (direct column or single-parent join, per the tenant-isolation wording above) — there is no entity in this schema with two possible, potentially-divergent Organization paths.                                                                    |

**Baseline principle:** database constraints (triggers, composite FKs) are a
defense-in-depth layer for the invariants above, catching bugs that bypass
application logic (e.g. a raw migration script, a future direct-DB access
path). They do not replace application-level authorization checks (§3) — a
procedure must still verify the _acting user_ has the right capability on the
right Void/Team/Organization before a write is attempted at all. Both layers
matter; the DB layer exists so a bug in the application layer can't silently
corrupt tenant isolation.

## 5. API Architecture (tRPC)

**[Recommendation]** Router breakdown, one file per domain, composed under a
single root router:

```ts
appRouter = router({
  auth: authRouter, // signup, login, magic-link, 2FA, sessions, recovery
  organization: organizationRouter, // create, update settings, list members, transfer ownership
  // (transfer = transactional Membership role swap, §4)
  membership: membershipRouter, // role changes, removal
  team: teamRouter, // CRUD, membership, Team Lead assignment
  void: voidRouter, // CRUD, access grants
  group: groupRouter, // CRUD (position/size/name)
  task: taskRouter, // CRUD, assignees, checklist items, comments, activity
  invitation: invitationRouter, // create, revoke, accept
  notification: notificationRouter, // list, mark read
  search: searchRouter, // search query
  myTasks: myTasksRouter, // cross-Void assigned-task list
  audit: auditRouter, // write-side only in MVP (internal, not user-facing list yet)
});
```

Every procedure that touches Org/Team/Void/Task data calls the authorization
module (§3) as middleware or an explicit first step — never trusts client-
supplied role claims.

**Realtime channel structure [Recommendation]:** one WebSocket channel per
Void (`void:{voidId}`), joined only after the server verifies
`canAccessVoid(userId, voidId)`. Broadcast events: `task.created`,
`task.updated`, `task.moved`, `task.deleted`, `group.created`,
`group.updated`, `group.deleted`, `void.deleted` (§6.2). Permission is
re-checked on each subscribe call; a mid-session permission change triggers
**event-driven** eviction (resolved 2026-09-16, see `decisions.md` ID10 —
not polled: a `VoidAccessGrant` mutation publishes an in-process event that
the realtime module uses to immediately re-check and disconnect affected
subscribers), per D34/Non-negotiable #10. See §6.1 for the reconnect/resync
protocol clients follow after any disconnection, including this kind.

## 6. Canvas & Realtime Architecture

Covered in detail in `project-context.md` §9–§10; summarized here for the
technical audience:

- Frontend maintains an in-memory store of the currently-loaded Void's
  objects (Tasks, Groups), hydrated via an initial tRPC query and kept
  current via WebSocket events. The canvas component renders from this store
  — it never independently owns state that isn't derived from it.
- Virtualization: only objects within the current viewport bounds (plus a
  margin) are mounted as DOM/SVG nodes. **[Recommendation]** maintain a
  simple spatial index (grid-bucket keyed by rounded x/y, or a quadtree) on
  the client for fast viewport queries as the camera moves.
- Camera state (x, y, zoom) is local UI state, persisted to the backend
  per-Void-per-User (e.g. on debounce/unmount), not broadcast to other users.
- Drag/resize interactions optimistically update local state immediately,
  then persist via a tRPC mutation; the WebSocket broadcast to _other_ users
  happens server-side after the mutation succeeds (server-authoritative,
  D33). If the mutation fails, the local optimistic change is rolled back.

### 6.1 Server-Side Ordering & Reconnect/Resync (2026-09-16 addendum)

**Ordering (resolves an ambiguity in D33's last-write-wins design):** "last"
must be defined by server order, never client timestamps (client clocks are
unreliable/skewable — trusting them would let a client with a fast clock
silently override a genuinely later write). Every mutable object (`Task`,
`Group`) carries a server-assigned `version` column (see §4), incremented
atomically on every accepted update. The accept/broadcast flow is:

```
client mutation → server authorization check (§3) → server accepts write →
persist new state + version = version + 1 (single transaction) →
broadcast {object, version} to the Void's channel
```

A client's own optimistic local update (architecture.md §6) is reconciled
against the server-confirmed `version` when the corresponding broadcast
arrives — if the broadcast's version is not exactly the client's expected
next version, the client treats its local state as possibly stale (see
resync below) rather than assuming it's already current.

**Reconnect/resync protocol:** a WebSocket connection is not assumed to
guarantee delivery across a gap (network loss, browser sleep/reconnect,
server restart). On every (re)connection to a Void's channel, the client:

1. Re-authenticates (session cookie, same as initial handshake, D34).
2. Server re-checks `canAccessVoid` (§3) — a session that's still valid but
   has since lost Void access is refused the (re)subscription, consistent
   with C1/D34's live-revocation requirement.
3. Client fetches **authoritative current state** for the Void via a normal
   tRPC query (not an event replay/backlog) — i.e., resync is "ask for the
   current truth," not "catch up on missed events." This is simpler and more
   robust than an event-replay log (which MVP does not build) and is cheap
   at the target object-count scale (D59).
4. Client replaces its local store with the fetched state (discarding any
   assumptions from before the gap) and resumes live updates from that point.

This applies uniformly to: temporary network loss, browser reconnect, an
expired/revoked session (reconnect attempt fails at step 1/2 and the client
routes to a re-auth/"access changed" UI state rather than silently retrying
forever), loss of Void access mid-session (handled by the existing
event-driven eviction, §7, which proactively disconnects — this protocol is
the client's _reconnect-side_ complement to that), and server restart (from
the client's perspective, indistinguishable from network loss — same
reconnect/resync path).

### 6.2 Soft-Delete Behavior (2026-09-16 addendum, resolving ID1)

Applies uniformly across modules — **[New Decision]** no module invents its
own deleted-record convention:

- **Query exclusion:** every standard read query (list/get procedures,
  search, My Tasks) filters `WHERE deleted_at IS NULL` by default, enforced
  by a shared query-builder helper in the relevant domain module (not
  repeated ad hoc per query) so it can't be accidentally omitted.
- **Authorization:** a soft-deleted Void is treated as inaccessible for all
  purposes once deleted — `canAccessVoid` and related checks return false
  for a Void with `deleted_at` set, regardless of any existing
  `VoidAccessGrant` (the grant rows are left intact, undeleted, for
  potential future restoration — see below — but are not honored while the
  Void is in a deleted state).
- **Cascade to Groups/Tasks:** Groups and Tasks belonging to a deleted Void
  are **not** individually soft-deleted (no cascading `deleted_at` writes
  across potentially thousands of rows). Instead, they become unreachable
  as a natural consequence of the Void-level query-exclusion and
  authorization rules above — any query for a Group/Task joins through its
  Void, and a deleted Void is excluded from that join. This keeps Void
  deletion an O(1) write regardless of the Void's size.
- **Restoration:** **not built in MVP** — a soft-deleted Void has no
  "undelete" procedure/UI yet. The `deleted_at` column exists specifically
  so restoration _can_ be added later (V1+) without a schema change, not
  because MVP exposes it. This is consistent with D17's "removal is never
  silently destructive" principle applied to data retention, without
  committing to building the restore UX now.
- **Realtime subscribers:** on Void deletion, the mutating procedure
  broadcasts a `void.deleted` event to that Void's channel _before_ the
  event-driven eviction (§7/ID10) disconnects remaining subscribers — this
  gives connected clients a chance to navigate the user away cleanly (e.g.
  "this Void was deleted" UI state) rather than the connection simply
  dropping with no explanation.

## 7. File Storage

Not designed — explicitly deferred (D42/D53). No schema, no provider choice,
no abstraction layer exists yet. To be designed when attachments become an
active V1 requirement.

## 8. Security Architecture

See `project-context.md` §22 for the requirement list. Implementation notes:

- Argon2id via a maintained library (e.g. `@node-rs/argon2` or equivalent);
  tune cost parameters per current OWASP guidance at implementation time.
- Session tokens: cryptographically random, stored server-side hashed (not
  the raw token) — **[Recommendation]** consistent with standard session-
  token handling, not separately specified during discovery.
- Invitation tokens: same treatment — store a hash, email the raw token,
  single-use enforced by marking `status = 'accepted'` atomically.
- Magic-link, email-verification, and password-reset tokens: backed by the
  `AuthToken` table (§4) — cryptographically random, hashed at rest, short
  expiry, single-use via `consumed_at`, and superseded/revoked when a newer
  token of the same purpose is issued for the same user (added 2026-09-16;
  this mechanism was missing from the original schema draft).
- CSRF: **resolved 2026-09-16 (`decisions.md` ID9)** — SameSite=Lax session
  cookies plus a strict Origin-header validation middleware on all
  state-changing requests (reject any request whose `Origin` doesn't match
  the app's known origin). No separate CSRF token system: there's no
  cross-origin form-post surface (tRPC traffic is same-origin fetch/
  WebSocket only), so a token would add issuance/rotation complexity without
  meaningful additional protection in this specific setup.
- Rate limiting: **[Recommendation]** a Fastify rate-limit plugin, keyed by
  IP and by account where applicable, applied to the auth-sensitive routes
  listed in `decisions.md` D29.

## 9. Testing Strategy

See `decisions.md` D60 for the confirmed approach. Recommended tooling
**[Recommendation, tooling choice not separately confirmed]**: Vitest for
unit/integration tests (pairs naturally with a Vite/TS stack), Playwright for
E2E (already available as a skill/tool in this environment).

## 10. Monitoring & Logging

See `decisions.md` D61. Pino for structured logs (integrates directly with
Fastify's built-in logger), Sentry (or equivalent) for error tracking, wired
in from the first deployment — no metrics/observability platform until real
production traffic justifies it.

## 11. Deployment Architecture

**Still not finalized — TBD (confirmed 2026-09-16, explicitly not locked
during implementation planning).** A PaaS (Railway, Render, or Fly.io) for
the Fastify app (supports WebSockets natively, avoids hand-rolled
infrastructure) + a managed Postgres offering (the platform's own, or Neon/
Supabase) remains the shape of the **[Recommendation]** — Railway specifically
was proposed as a leading candidate during implementation planning but was
**not approved as a decision**: it has external vendor/account/billing
implications and doesn't need resolving before the application is built and
tested. Explicitly no Kubernetes, no container-orchestration complexity for
MVP regardless of which specific provider is eventually chosen. **Revisit
during deployment preparation, once actual MVP requirements are known** —
not before.

## 12. Open Architecture Questions

Carried over from `spec.md` §5 where they have infrastructure implications:

- ~~ORM/query-builder choice~~ — resolved 2026-09-16: Drizzle (`decisions.md` ID8).
- ~~Exact CSRF-protection mechanism~~ — resolved 2026-09-16: SameSite cookies
  - Origin-header validation (`decisions.md` ID9).
- ~~WebSocket permission-eviction mechanism~~ — resolved 2026-09-16:
  event-driven (`decisions.md` ID10).
- Hosting provider — explicitly left open (D52).
- Trigger vs. denormalized-composite-FK choice for each cross-parent
  integrity invariant in §4.1 — the invariants themselves are settled; the
  specific Postgres mechanism per-invariant is an implementation detail to
  pick once the ORM (above) is chosen, since ORM composite-FK support varies.
- Hosting provider — remains explicitly TBD (§11); Railway is a candidate,
  not a decision.
- Email provider (Resend/Postmark/SES/etc.) — remains open behind the
  `EmailSender` interface (§2); to be chosen at deployment-preparation time
  alongside hosting.
