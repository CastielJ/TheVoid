# Void — Project Context (AI/Human Onboarding Document)

**Read this document first.** It is written to be self-contained: if you are a
new Claude (or human) session with access to _only_ this file, you should be
able to understand what Void is, how it is modeled, what has already been
decided, and what you must not casually change — without needing the original
planning conversation.

This document was produced at the end of a structured, 7-round requirements
discovery interview (2026-09-15), starting from an initial product-vision
brainstorm (`Prompt.md` in the repo root). As of this writing, **no
application code exists yet** — this is a planning/specification package,
not a description of a built system.

---

## 1. What Void Is

Void is a **spatial team task-management SaaS platform**, built primarily for
companies and organized teams. Instead of a traditional list/table
project-management interface, each unit of work (a "Void") exists inside an
**infinite 2D canvas** that users pan, zoom, and interact with — tasks and
groups of tasks are objects positioned in that space.

One-sentence description (from the original brainstorm, still accurate):

> Void is a spatial team task-management platform where companies create
> shared infinite workspaces, organize teams and tasks visually, and manage
> work through a beautiful interactive canvas.

Target experience: **Enter Void → see your workspace → navigate through the
infinite space → discover groups and tasks → open/create/assign work →
collaborate with your team.**

## 2. Core Product Vision

- The spatial canvas is the **defining differentiator** — not a skin on a
  conventional Jira/Trello clone. The spatial model should genuinely change
  how people organize and understand their work, not just look different.
- The UI should feel premium, minimal, modern — smooth pan/zoom, subtle
  background texture (grid/dots/particles), light and dark themes, more like
  navigating a "world" than browsing a website.
- Despite the canvas being central, **the product does not force the canvas
  onto every workflow.** Where a non-spatial view genuinely serves a workflow
  better (e.g., "what do I personally need to do today," which is inherently
  cross-Void), a non-spatial view is added deliberately (see §11 My Tasks).

## 3. What Void Is NOT

- **Not** a Jira/Trello/Asana clone with a decorative background — the spatial
  layout is meant to carry real organizational meaning, not just aesthetics.
- **Not**, at least for MVP, a real-time collaborative _drawing/document_
  tool (unlike Figma/Miro/FigJam) — no freeform drawing, no CRDT-based
  continuous co-editing, no live cursors. It syncs discrete task/group state,
  not continuous strokes.
- **Not**, for MVP, a billing/multi-plan SaaS product — every MVP feature is
  available without tier gating; billing is deliberately out of scope until
  designed separately.
- **Not**, for MVP, a mobile-first or mobile-native product — desktop/laptop
  is the primary target; tablet touch works at a basic level; no dedicated
  phone layout yet.
- **Not** an enterprise-compliance product yet — no SSO/SAML/SCIM, no
  org-wide enforced MFA, no audit-log viewer UI in MVP (though audit _data
  collection_ does start in MVP — see §14).
- **Not** a fully custom/no-code RBAC platform yet — roles are a fixed,
  well-defined set for MVP (see §7), built on a capability-based
  authorization engine so custom roles _can_ be added later without a
  rewrite, but they are not present now.

## 4. Terminology / Glossary

> **Superseded as of the third feature pass** (`decisions.md`'s dated
> "Third Feature Pass" section): Team is no longer a separate entity.
> `Team`/`Team Lead`/`TeamMembership` below, and `Void.team_id`, describe
> the original MVP-lock-in design and are kept for historical context. The
> current model: `Void` is self-referencing (`parentVoidId`); a "Team" is
> just a Void nested under its parent, with its own canvas; "Team Lead"
> collapsed into a `VoidAccessGrant.role = 'manager'` grant on that child
> Void; `VoidAccessGrant` is always a plain per-user grant now (no
> Team-target variant).

| Term                | Meaning                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization**    | The tenant boundary. All data (Teams, Voids, Groups, Tasks, Memberships) is scoped to exactly one Organization. A User can hold independent Memberships in multiple Organizations.                                                                                                                                                                                            |
| **User**            | A global account identity, not scoped to any one Organization. Never hard-deleted when removed from an Organization.                                                                                                                                                                                                                                                          |
| **Membership**      | The join record between a User and an Organization, carrying the User's org-level Role (Owner/Admin/Member) in that Organization. Can be removed (ended) without deleting the User.                                                                                                                                                                                           |
| **Team**            | A user-defined organizational grouping of people within an Organization (e.g. "Red Team," "Blue Team," "Development" — no fixed taxonomy). Represents people/access, not a spatial concept. A User can belong to multiple Teams.                                                                                                                                              |
| **Team Lead**       | A role scoped to a single Team — can manage that Team's membership and create/manage Voids associated with that Team. No org-wide power.                                                                                                                                                                                                                                      |
| **Void**            | A workspace/project **container** — the thing that owns Groups and Tasks. Conceptually similar to a "project" or "board." Optionally associated with a "home" Team (`team_id`, nullable) for organizational display, but access control is independent of that (see VoidAccessGrant). Rendered via the spatial canvas, but the canvas is a _view_, not the Void's definition. |
| **VoidAccessGrant** | An explicit access-control record giving a Team or an individual User a permission level (Viewer/Editor/Manager) on a specific Void. This — not `Void.team_id` — is the actual access-control mechanism.                                                                                                                                                                      |
| **Group**           | A spatial cluster of Tasks _inside a specific Void_ — a resizable, movable, named rectangular area on the canvas. **Not** the same entity as a Team, even though a Group is often named after a Team informally. Flat (no nesting) in MVP.                                                                                                                                    |
| **Task**            | The core unit of work. Belongs to exactly one Void; optionally belongs to one Group (`group_id`, nullable). Has a spatial position (`x`, `y`) on its Void's canvas — but that position is presentational; it does not determine Group membership.                                                                                                                             |
| **Checklist item**  | A lightweight, embedded checkbox item on a Task. **Not** an independent Task entity — no own position, status, assignee, comments, or history. ("Subtasks" as independent Task-like entities are explicitly deferred, distinct from checklist items.)                                                                                                                         |
| **Canvas**          | The infinite pan/zoom spatial viewport used to view and interact with a Void's Groups and Tasks. A _projection_ of persisted data (see §12), not the source of truth.                                                                                                                                                                                                         |
| **Camera**          | A User's personal, per-Void view state (x, y, zoom). Not shared with other users.                                                                                                                                                                                                                                                                                             |
| **Capability**      | A granular permission check (e.g. "can manage this Void," "can invite to this Org") that authorization logic is built against — as opposed to a hardcoded role-name check.                                                                                                                                                                                                    |

## 5. Entity Relationships (Domain Model Summary)

```
Organization (tenant boundary)
├── Membership (User ↔ Organization, carries org Role: Owner/Admin/Member)
├── Team (user-defined; carries TeamMembership, incl. Team Lead flag)
│   └── TeamMembership (User ↔ Team, many-to-many)
└── Void (workspace/project; optional team_id; NOT team-owned for access purposes)
    ├── VoidAccessGrant (Team-or-User ↔ Void, carries Void role: Viewer/Editor/Manager)
    ├── Group (spatial container; x, y, width, height, name)
    └── Task (belongs to exactly one Void; optional group_id; x, y position)
        ├── TaskAssignee (Task ↔ User, many-to-many — multiple assignees supported)
        ├── ChecklistItem (embedded, not an independent entity)
        └── Comment (Task ↔ User, ↔ text; supports @mentions per §13)

Cross-cutting:
├── Invitation (Organization → email, single-use, expiring, revocable)
├── Session (User ↔ device, server-side, revocable)
├── Notification (User-scoped, in-app)
└── AuditLog (append-only, Organization-scoped, references User identity)
```

**Key relationship rules (see also §16 Non-negotiable Decisions):**

- A User's access to any Void is never inferred from Team membership alone —
  it flows through an explicit `VoidAccessGrant`, even though a Void may
  _default_ to Team-visible at creation time (see D14 in `decisions.md`).
- A Task's `group_id` is the sole source of truth for Group membership.
  Spatial/visual overlap with a Group's rectangle on the canvas has zero
  effect on `group_id`.
- Team and Group are unrelated entities. A Group's name may match a Team's
  name by convention, but there is no foreign key between them.

## 6. Authentication Architecture

- **Methods (MVP):** Email + password (with required email verification) and
  passwordless magic-link — both authenticate the same underlying User
  account, not separate account types.
- **Not in MVP:** OAuth (Google/Microsoft/GitHub), Enterprise SSO
  (SAML/OIDC/SCIM), Passkeys/WebAuthn — all deferred to V1/V2. The
  architecture should remain extensible enough to add these later without a
  rewrite.
- **Password policy:** ≥12 char minimum, no forced complexity/rotation rules,
  breached-password check at signup/reset where practical, Argon2id hashing.
  Never store plaintext.
- **Token mechanism:** email verification, magic-link, and password-reset all
  use a purpose-scoped, cryptographically random token, stored server-side
  only as a hash, short-lived, single-use (consumed on first use), and
  revoked/superseded if a newer token of the same purpose is requested. See
  `architecture.md` §4 (`AuthToken`) for the schema — this mechanism was
  identified as missing from the original schema draft and added 2026-09-16.
- **MFA:** Optional, user-enabled TOTP-based 2FA in MVP, with backup/recovery
  codes. No org-wide MFA enforcement in MVP (future org security setting).
- **Sessions:** Server-side sessions — opaque token in a secure httpOnly
  cookie, session record in PostgreSQL (no Redis dependency purely for this in
  MVP). Sessions are immediately revocable. Users can view active
  sessions/devices, revoke individual sessions, and log out everywhere.
  "Remember me" extends session lifetime (short default, ~30–60 days when
  checked).
- **Recovery:** Self-service password reset + 2FA backup codes, plus an
  Org Admin/Owner-initiated recovery action for a member (explicitly
  confirmed, audit-logged, never reveals the password, never allows silent
  impersonation).
- **Rate limiting:** Standard per-IP/per-account protection with backoff/
  lockout on all auth-sensitive endpoints (login, reset, magic-link,
  invite-accept, 2FA, recovery). CAPTCHA/Turnstile introduced reactively on
  detected abuse, not forced by default.

**Standing principle:** Authentication (who is this User?) and authorization
(what can this User do in this Org/Team/Void?) are strictly separate systems.
A User's permissions are always resolved per-Organization, never globally.

## 7. Authorization / RBAC Model

Three layers, each independently scoped, resolved in this order:

1. **Organization role** (fixed 3-tier): **Owner** (full control incl. billing
   & org deletion/transfer) → **Admin** (member/team/settings management, not
   billing/destructive Owner actions) → **Member** (no org-management rights
   by default).
2. **Team-scoped role:** **Team Lead** — manage/view own Team's membership,
   create/manage Voids associated with own Team. No org-wide power.
3. **Void-scoped role** (via `VoidAccessGrant`): **Viewer** (read-only) →
   **Editor** (Viewer + Group/Task CRUD in that Void) → **Manager** (Editor +
   manage that Void's access grants and settings). Scoped to that Void only.

**Implementation requirement:** permission checks are written against
granular **capabilities** ("can user X manage Void Y," "can user X invite
members to Org Z") resolved through this three-layer model — never as
scattered `if (role === 'admin')`-style checks. This is what allows custom
roles to be added later (V1/V2, not in MVP) without redesigning the
authorization system.

**Correction (2026-09-16 documentation review):** the three layers above are
independently scoped, not a strict override hierarchy — holding an
Organization role (even Owner/Admin) does **not** by itself grant access to
every Void. Org-level roles grant organization-_management_ capabilities
(members, teams, settings, invitations); Void access is always governed
separately by an explicit `VoidAccessGrant` (direct or via Team membership),
per Non-negotiable #4. An earlier draft of `architecture.md` incorrectly
described Owner/Admin as automatically having full access to every Void —
that was never a confirmed decision and has been corrected there (see
`architecture.md` §3). If org-wide Void oversight for Admins/Owners is wanted
in the future, it must be added as its own explicit, named capability, not
assumed as a side effect of the org role.

**Task-level permissions:** No per-task ACLs in MVP — a Task's visibility/
editability is entirely inherited from its Void's access grant. An active
Task assignment additionally requires the assignee to have an active
Organization Membership and be eligible to access the Task's Void
(`canAccessVoid`) at assignment time — see `architecture.md`'s `TaskAssignee`
notes. Former members remain attached only as inactive historical assignees
(per D17), never as active ones.

**Default Void visibility:** Team-associated Void → visible to that Team by
default. No Team association → private to creator by default. Either way,
expansion happens only via explicit `VoidAccessGrant`.

**Approved assumptions** (defaults, not separately interviewed — see
`decisions.md` for context): a Team Lead who creates a Void for their own Team
becomes its Manager by default; a user who creates a private/personal Void
becomes its Manager by default.

## 8. Invitations & Membership Lifecycle

- **MVP mechanism:** Email invitations only — unique, single-use, revocable,
  ~7-day expiry. A prospective secondary mechanism (scoped, expiring,
  use-limited, revocable invite links, lowest-privilege-only, never able to
  grant Admin/Owner) is an approved _future_ direction, not built in MVP. The
  originally proposed permanent/unlimited static join code was evaluated and
  **explicitly rejected** as a security risk (unrevocable-per-user, unlimited
  exposure on leak).
- **Removal:** Removing a member is never automatically destructive. Task
  assignments persist but are flagged as having an inactive assignee (for a
  manager to reassign); Voids they created are not deleted; Team memberships
  end; all history/audit data stays intact.
- **Identity preservation:** A User account is never hard-deleted on removal
  from an Organization. `Membership` (org-scoped) is modeled separately from
  `User` (global) — historical references (`created_by`, comments, audit
  entries, past assignments) always continue pointing at the real User
  record, since a User may simultaneously hold Memberships in other
  Organizations.

## 9. Canvas Architecture & Coordinate Model

- **Rendering:** DOM/SVG for Task/Group objects (not Canvas2D/WebGL), because
  Void's objects are rich interactive UI (cards with text, avatars, buttons),
  not simple vector shapes. A custom pan/zoom viewport/transform layer
  handles camera math. **Virtualization** ensures only objects in/near the
  current viewport are actually rendered as DOM nodes.
- **Do not** introduce PixiJS/WebGL/Konva/Fabric.js unless future profiling on
  real usage proves DOM/SVG is a measured bottleneck — this was an explicit,
  deliberate choice, not an oversight.
- **Coordinate system:** each Void has its own independent infinite
  floating-point (x, y) coordinate space. Object positions (Task x/y, Group
  x/y/width/height) are **shared, persisted Void data** — the same for every
  viewer.
- **Camera:** each User has their own persisted per-Void camera state (x, y,
  zoom) — personal view state, never shared or synced between users.
- **Core principle: the canvas is a projection of persisted data, never the
  source of truth.** Task position, Group membership (`group_id`), and Group
  dimensions are all real, persisted, authoritative data. Camera position is
  the one piece of state that's genuinely just "view state." Rendering only
  visualizes the underlying data — this is what keeps the system testable,
  synchronizable, and independently optimizable from the rendering layer.
- **Performance target:** ~60fps pan/zoom/interaction at roughly 1,000–2,000
  active objects per Void, via virtualization + spatial indexing (e.g.
  quadtree/grid-bucket). This is a **performance target, not a hard limit** —
  the data model must support larger Voids; MVP just doesn't promise the same
  frame rate beyond that range. No forced object-count cap or auto-split rule.

## 10. Realtime Architecture

- **MVP scope:** Live WebSocket synchronization of Task/Group
  create/update/move across users viewing the same Void. **No** presence
  indicators, cursor sharing, "who's viewing," or typing indicators in MVP.
- **Transport:** Self-hosted WebSocket layer as part of the same Node/Fastify
  backend — not a managed realtime vendor (Pusher/Ably/Supabase Realtime).
- **Auth:** WebSocket connections authenticate via the same server-side
  session (cookie) used for HTTP. Subscribing to a Void's realtime channel
  **re-checks the subscriber's current Void-level permission at subscribe
  time**, not just at login — a mid-session permission revocation must stop
  further realtime delivery to that Void immediately.
- **Conflict resolution:** Server-authoritative **last-write-wins**. No
  field-level merge, no CRDT. If two users edit/move the same object near-
  simultaneously, the server's last accepted write is what persists and is
  broadcast to everyone.

## 11. Task & Group Behavior

- **Task fields (MVP):** title, description, status, priority, multiple
  assignees, creator, due date, created_at, updated_at, tags, `group_id`,
  comments, basic activity history (who/what/when for key field changes).
  **Deferred:** file attachments, full independent-entity subtasks,
  dependencies, recurring tasks.
- **Status:** fixed set — To Do, In Progress, Done, Blocked. No custom
  statuses/status-management UI in MVP; model stays extensible.
- **Checklists:** embedded checkbox items on a Task, not independent Task
  entities (see Glossary). This is the MVP substitute for "subtasks."
- **Groups:** freeform, manually resizable/movable spatial rectangles with a
  name. Membership is an explicit FK (`Task.group_id`), never inferred from
  geometric containment (see §5 and §16).
- **Non-canvas view:** MVP includes a minimal cross-Void **"My Tasks"** view —
  tasks assigned to the current user across all accessible Voids, sortable/
  filterable by due date, priority, status. Clicking a task navigates to its
  location on its Void's canvas. This is the one place MVP deliberately
  breaks from "canvas-only," because "what do I need to do" is inherently
  cross-Void and the spatial model can't answer it well. No full per-Void
  List View, Calendar, or Dashboard in MVP.
- **Canvas interaction (MVP):** mouse/trackpad drag-to-pan, scroll/pinch-zoom,
  and WASD camera movement (while canvas has focus, disabled while a text
  input/textarea/select has focus) all available simultaneously, no mode
  switching. Click-drag selection box/multi-select, Delete key for selected
  objects, basic same-Void Task copy/paste (new IDs, no carried-over
  comments/history/activity). **No** undo/redo in MVP (explicitly deferred —
  interacts nontrivially with realtime multi-user sync), no minimap (search +
  My Tasks + zoom-to-fit cover MVP's navigation needs instead), no cross-Void
  copy/paste, no nested Groups, no per-task ACLs.

## 12. Search

- **MVP:** database-backed search (PostgreSQL `ILIKE`/trigram via `pg_trgm`,
  no dedicated search engine like Elasticsearch/Algolia) over Task title,
  Task description, and Group name — scoped to Voids the current user is
  authorized to access. Selecting a result moves the camera to that object's
  persisted coordinates.
- **Standing principle:** search passes through the **same authorization
  layer** as direct Void access — results must never reveal the existence,
  title, description, or other metadata of a Task/Void/Group the searching
  user is not authorized to see.

## 13. Notifications

- **MVP events:** task assigned to you, mentioned in a comment, invited to an
  organization, your role/permissions changed.
- **Deferred:** due-soon/overdue reminders (needs a scheduled-job system),
  generic new-comment notifications, task-completed notifications,
  added/removed-from-group notifications.
- **Delivery (MVP):** in-app notification inbox/bell only. Transactional
  email continues to exist for auth/invitations, but no general
  notification-email system is built in MVP. No push notifications.
- The notification/event architecture should stay extensible for adding event
  types later without a redesign.

## 14. Admin Functionality

- **MVP admin surface:** organization member list + roles, Team management,
  pending invitations (view/revoke), basic organization settings.
- **Deferred:** dedicated audit-log viewer UI, usage/storage stats, org-wide
  MFA-enforcement toggle, billing admin.

## 15. Audit Logging

- **Data collection starts in MVP**, even though the viewer UI is deferred to
  V1 — capture is cheap now and losing pre-V1 history would be permanent if
  deferred entirely.
- Append-only, must preserve historical User identity (never references a
  hard-deleted account — see §8).
- Events to capture from day one include (non-exhaustive): authentication/
  security-relevant events, role changes, member additions/removals, Team
  membership changes, Void access-grant changes, important Void/Task
  permission changes, administrator-initiated recovery actions.

## 16. Non-negotiable / Established Decisions

These are architecturally load-bearing decisions confirmed during discovery.
**Do not change these casually** — if a future requirement seems to conflict
with one of these, treat it as a real design question to raise explicitly,
not something to silently work around.

1. **Organization is the multi-tenancy boundary.** All tenant-scoped data is
   scoped to exactly one Organization; a User may hold independent
   Memberships in multiple Organizations with strict data isolation between
   them.
2. **Void is a workspace/project container, not merely a canvas.** The
   spatial canvas is a _view_ over a Void's data.
3. **Team and Group are different entities.** Team = people/access
   organization. Group = spatial task clustering inside a specific Void. No
   structural link between them.
4. **A Void's Team association (`team_id`) does not by itself control
   access.** Access is governed by explicit `VoidAccessGrant` records
   (Team-or-User → Void → role). `team_id` only affects the _default_
   visibility at creation time.
5. **Group membership is an explicit foreign key** (`Task.group_id`), never
   inferred from spatial/geometric containment on the canvas. Canvas position
   is presentational only.
6. **The canvas is a projection of persisted data, never the source of
   truth.** Task/Group position and dimensions, and Group membership, are
   real persisted data; only camera position is per-user view state.
7. **Authentication and authorization are strictly separate systems.**
8. **Authorization uses capability-based checks, evaluated across three
   independently-scoped layers — Organization role, Team-scoped role,
   Void-scoped role — never scattered hardcoded role-name checks.**
   Independently scoped means holding a higher-sounding role in one layer
   (e.g. Organization Admin) does **not** automatically grant access in
   another layer (e.g. to a specific Void) — Void access always requires its
   own explicit `VoidAccessGrant` (see #4). This was clarified during
   documentation review (2026-09-16) after an earlier architecture draft
   incorrectly implied Org Admin/Owner bypass Void-level access control.
9. **The server is authoritative for realtime state; conflict resolution is
   last-write-wins in MVP.** No CRDT, no field-level merge in MVP.
10. **WebSocket subscriptions re-check live Void-level permission at
    subscribe time**, not just at login — permission revocation must cut off
    realtime delivery promptly.
11. **No per-task ACLs in MVP** — task permissions are entirely inherited
    from the parent Void's access grant.
12. **User identity is never hard-deleted on Organization removal.**
    `Membership` and `User` are separate; historical references always point
    at the real User record.
13. **No permanent/unlimited static organization-join code** — this was
    evaluated and explicitly rejected as a security flaw. Invitations are
    single-use, expiring, and revocable.
14. **No attachments, no billing/plan-gating, no OAuth/SSO/passkeys, no
    push notifications, no undo/redo, no minimap, no nested Groups, no
    task-level ACLs, no custom task statuses, no full/independent subtasks,
    no task dependencies, no recurring tasks, and no dedicated search
    infrastructure (Elasticsearch/etc.) in MVP.** (Full list: §17 below.)
15. **Search must pass through the same authorization layer as direct Void
    access** — no metadata leakage of inaccessible objects via search.
16. **MVP must not grow further** beyond what's defined here **unless a
    newly discovered requirement is genuinely necessary for the core product
    to function** — this is a standing scope-discipline constraint on future
    planning, not just a snapshot.
17. **Every tenant-scoped record has exactly one Organization ownership
    path** — either a direct `organization_id` column, or a mandatory
    tenant-owned parent relationship (e.g. `Group`/`Task` via `void_id`).
    Cross-Organization references (e.g. a `Void.team_id` pointing at a Team
    in a different Organization, a `VoidAccessGrant` targeting a Team/User
    outside the Void's Organization) must never be valid — see
    `architecture.md` §4.1 for the specific invariants and enforcement
    approach.
18. **Organization ownership has a single source of truth: the `Membership`
    row with `role = 'owner'`** (exactly one active per Organization, enforced
    via a partial unique index). There is no separate `Organization.owner_id`-
    style column to keep in sync — ownership transfer is a single transaction
    that swaps which Membership holds the `owner` role. (Corrected
    2026-09-16 — an earlier schema draft had both a duplicated
    `Organization.owner_user_id` column and `Membership.role = 'owner'` as
    two independent sources of truth for the same fact.)
19. **An active Task assignment requires the assignee to currently be an
    active Organization member eligible to access the Task's Void.** Former
    members may remain attached only as _inactive_ historical assignees
    (per #12/D17), never as active ones — this is an ongoing invariant
    enforced at assignment time and when membership ends, not just a
    one-time removal behavior.

## 17. MVP Scope (Summary)

The MVP proves this core loop: **create organization → invite/join users →
create Voids (optionally nested into Teams) → create Groups/Tasks → assign
tasks → manage permissions → collaborate in real time through the spatial
canvas.**

**In MVP:**

- Org/Void/Group/Task data model as described in §5 — **Team is no longer a
  separate entity as of the third feature pass** (`decisions.md` Q1): Void
  is now a self-referencing hierarchy (`parentVoidId`), and a "Team" is just
  a Void nested one or more levels under its parent, with its own canvas.
  §5's Team/TeamMembership description below is the original MVP-lock-in
  design and is kept for historical context, but no longer reflects the
  current schema — see `decisions.md`'s third-feature-pass section for the
  current model.
- Email+password + magic-link auth, optional TOTP 2FA, server-side sessions
  with device management.
- Email-only invitations (no static join codes).
- Fixed 3-tier org roles + 3-tier Void roles (Viewer/Editor/Manager),
  capability-based permission checks — "Team Lead" collapsed into a plain
  Manager-role grant on that child Void (third feature pass).
- DOM/SVG virtualized canvas with WASD+mouse navigation, live WebSocket sync,
  last-write-wins conflict resolution, no presence/cursors.
- Fixed task statuses, multi-assignee tasks, checklist items (not full
  subtasks), auto-sized Groups (server-computed bounding box over member
  Tasks — manual resize was removed in the second feature pass, see
  `decisions.md` P2; the per-task height math became content-aware in the
  third feature pass, see `decisions.md` Q4) with explicit FK membership.
- Task editing: description/status/priority/due date/tags are an explicit
  Save/Discard draft on the expanded card (third feature pass, `decisions.md`
  Q5) — not autosave-per-field. Checklist/comments/assignees/title/the
  done-toggle remain immediate.
- In-app notifications only, minimal MVP event set.
- DB-backed search + minimal cross-Void "My Tasks" view.
- Minimal admin surface (members/teams/invites/settings) + audit-log data
  collection from day one (no viewer UI yet).
- Selection box, delete, same-Void copy/paste on canvas.
- Desktop-first, basic tablet-touch-usable canvas.
- WCAG 2.1 AA on non-canvas UI surfaces; best-effort canvas accessibility.
- ~1,000–2,000 objects/Void performance target (not a hard limit).
- Authorization-weighted testing (unit + integration + critical-path E2E via
  Playwright); structured logging (Pino) + error tracking (Sentry or
  equivalent) from day one.
- TypeScript throughout: Fastify + tRPC backend, React + Vite frontend,
  PostgreSQL, self-hosted WebSockets. Hosting: simplest reliable setup, no
  Kubernetes.

## 18. Explicitly Deferred (Do NOT implement as part of MVP)

This list exists specifically so a future implementer (human or AI) does not
accidentally build V1/V2 scope while working on MVP. If you find yourself
about to build any of the following, stop and confirm it's actually in scope
for the current phase of work:

- OAuth providers (Google/Microsoft/GitHub)
- Enterprise SSO / SAML / OIDC / SCIM
- Passkeys / WebAuthn
- Org-wide enforced MFA
- Push notifications (browser or mobile)
- General notification emails (beyond auth/invite transactional email)
- File/attachment support (including any schema footprint for it)
- Billing, subscriptions, plan/feature gating, seat limits, usage-based billing
- Minimap
- Undo/redo
- Cross-Void copy/paste
- Full per-Void List View, Calendar view, Dashboard view
- Custom/configurable task statuses
- Task-level ACLs (permissions finer-grained than the parent Void's grant)
- Nested Groups
- Task dependencies
- Recurring tasks
- Full/independent-entity subtasks (as opposed to embedded checklist items)
- Dedicated mobile-phone-optimized layout
- Full screen-reader spatial canvas navigation
- Presence indicators, cursor sharing, "who's viewing," typing indicators
- CRDT-based / field-level-merge collaborative editing
- Dedicated search infrastructure (Elasticsearch, Algolia, etc.)
- Dedicated audit-log viewer UI (data collection _does_ start in MVP, per §15)
- Custom/user-defined organization roles (capability engine should support
  adding this later without a rewrite, but it is not built in MVP)
- Any Kubernetes/distributed-tracing/complex-metrics infrastructure

## 19. Technology Stack

| Layer                      | Choice                                            | Notes                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend language/framework | TypeScript, Fastify, tRPC                         | Chosen over NestJS — see `decisions.md` D47 for the explicit evaluation. Router structure must stay modular (composed domain routers), not one flat procedure collection. |
| Frontend                   | React + Vite + TypeScript                         | Client-side SPA, not Next.js/SSR — the app has no SEO/public-page need.                                                                                                   |
| Database                   | PostgreSQL                                        | Primary relational source of truth; `pg_trgm` used for MVP search.                                                                                                        |
| Realtime                   | Self-hosted WebSockets                            | Part of the same backend process; not a managed vendor.                                                                                                                   |
| Sessions                   | Server-side, DB-backed                            | httpOnly cookie; no Redis dependency purely for sessions in MVP.                                                                                                          |
| Hosting                    | Open / TBD                                        | Recommend simplest reliable PaaS setup at implementation time; explicitly no Kubernetes for MVP.                                                                          |
| File storage               | Deferred                                          | No decision made; not needed until attachments (V1) are actually built.                                                                                                   |
| Logging                    | Pino (structured)                                 | Pairs naturally with Fastify.                                                                                                                                             |
| Error tracking             | Sentry or equivalent                              | From day one.                                                                                                                                                             |
| Testing                    | Vitest/Jest (unit/integration) + Playwright (E2E) | Weighted toward authorization-logic coverage.                                                                                                                             |

## 20. Database Architecture (Summary)

See `architecture.md` for full schema detail. Core entities: `User`,
`Organization`, `Membership`, `Team`, `TeamMembership`, `Void`,
`VoidAccessGrant`, `Group`, `Task`, `TaskAssignee`, `ChecklistItem`,
`Comment`, `TaskActivity`, `AuthToken`, `Invitation`, `Session`,
`Notification`, `AuditLog`. Every tenant-scoped record has an unambiguous
Organization ownership path — either a direct `organization_id` column, or a
mandatory tenant-owned parent relationship (e.g. `Group`/`Task` reach their
Organization via `void_id → Void.organization_id`) — and every query must
enforce that boundary, whichever form it takes (see Non-negotiable #1 and #17
above, and `architecture.md` §4.1 for cross-parent integrity invariants).
Organization ownership itself is derived from `Membership.role = 'owner'`,
not a separate denormalized column (Non-negotiable #18).

## 21. API Architecture (Summary)

tRPC, composed of domain-scoped routers (e.g. `auth`, `organization`, `team`,
`void`, `group`, `task`, `invitation`, `notification`, `search`) mounted
under one root router. See `architecture.md` for the proposed router
breakdown and procedure list.

## 22. Security Requirements

- Strict Organization-level tenant isolation on every query (Non-negotiable #1).
- Argon2id password hashing; no plaintext storage anywhere.
- Server-side, immediately revocable sessions.
- Rate limiting/backoff on all auth-sensitive endpoints.
- WebSocket subscriptions re-validate Void-level permission live (Non-negotiable #10).
- Search results authorization-filtered, no metadata leakage (Non-negotiable #15).
- Audit-log data collection from day one, append-only, identity-preserving.
- Admin-assisted account recovery is explicit, confirmed, audit-logged, and
  never exposes a password or allows silent impersonation.
- No invitation mechanism grants org access without an expiring, revocable,
  single-use (or explicitly scoped/limited) token — no permanent static codes.

## 23. Performance Requirements

- ~60fps target for canvas pan/zoom/interaction at ~1,000–2,000 active
  objects per Void, via virtualization + spatial indexing — a target, not a
  hard cap (Non-negotiable-adjacent, see §9 and D59).
- Search should feel instant at MVP data scale using DB-level trigram
  indexing; no dedicated search infra needed yet.
- No specific numeric SLA was set for API latency or WebSocket fan-out at
  this stage — treat as an open question if it becomes relevant (§25).

## 24. Important Architectural Principles (Cross-Reference)

- Canvas is a projection of persisted data, never the source of truth (§9).
- Authorization is capability-based, evaluated across three independently-
  scoped layers (Org/Team/Void) — not hardcoded role checks, and not a
  strict override hierarchy where a higher org role implies Void access (§7).
- Authentication and authorization are strictly separate (§6).
- Group membership is an explicit FK, never inferred from geometry (§5, §11).
- Modular monolith preferred; avoid unnecessary microservices/infrastructure
  (implicit throughout — reflected in the Fastify-over-NestJS, self-hosted-
  WebSockets-over-managed-vendor, and no-Kubernetes decisions).

## 25. Known Assumptions

- A1: Team Lead who creates a Void for their own Team becomes its Manager by
  default (approved, not separately interviewed — see `decisions.md`).
- A2: Creator of a private/personal (no-Team) Void becomes its Manager by
  default (approved, not separately interviewed — see `decisions.md`).
- No specific numeric SLA has been set for API response time or WebSocket
  message-delivery latency; only the canvas frame-rate target (§23) has a
  concrete number.
- "Approximately 60 FPS" and "1,000–2,000 objects" (§9, §23) are working
  targets set during planning, not benchmarked against a real implementation
  yet — they should be validated once the canvas is actually built.

## 26. Remaining Unresolved Decisions

**No unresolved decisions were identified that block MVP implementation
planning.** This is not the same as "everything is decided" — see `spec.md`
§5 for the full list of genuinely open implementation details that remain,
including: Void deletion semantics (soft vs. hard delete), exact Task
priority enum values, comment edit/delete permission semantics, exact
activity-history field list, exact Task copy/paste field-duplication
semantics, whether a Team can have multiple simultaneous Team Leads, ORM/
query-builder choice, exact CSRF-protection mechanism, WebSocket permission-
eviction mechanism, hosting provider, exact session-lifetime durations, and
specific uptime/availability SLA (if any). None of these block _starting_
implementation planning, but none should be silently decided when
implementation work reaches them — treat each as a real question to raise
explicitly. If implementation work surfaces a further gap not listed here,
add it to `spec.md` §5 and treat it the same way.

## 27. Potential Future Extension Points (V1/V2 ideas, not commitments)

Noted here for awareness — these are _ideas raised during discovery_, not
committed roadmap items:

- Custom/user-defined organization roles, built on the existing
  capability-based authorization engine (explicitly designed to allow this
  without a rewrite).
- Scoped, expiring, revocable invite links as a secondary invitation
  mechanism alongside email invitations.
- Domain-based auto-join (opt-in per Organization).
- Full presence/cursor-sharing collaboration.
- Field-level merge or CRDT-based conflict resolution, if last-write-wins
  proves insufficient in practice.
- Full independent-entity subtasks, including the open question of whether a
  subtask gets its own canvas position or stays nested in the parent Task's
  detail view.
- Nested Groups.
- Custom/configurable task statuses per Void.
- A general-purpose per-Void List View, Calendar view, and Dashboard/overview.
- Minimap.
- Undo/redo (needs a command-log or snapshot design compatible with realtime
  sync).
- Attachments (storage provider, size/type limits, virus scanning, quotas —
  to be designed as a dedicated effort, not incrementally).
- OAuth, Enterprise SSO/SCIM, Passkeys.
- Org-wide enforced MFA as an org security setting.
- Push notifications, general notification emails, scheduled due-date
  reminders (needs a job-scheduling system).
- Billing/subscriptions/plan-gating, once a pricing model is deliberately
  designed.
- Dedicated audit-log viewer UI (data collection already starts in MVP).
- A public marketing site, likely as a separate small project from the
  authenticated app.
- Moving the canvas rendering to WebGL/PixiJS if DOM/SVG is later proven (via
  profiling) to be a real bottleneck.

## 28. Source of Truth / Change Process

**Authoritative documents, in order of precedence for implementation
questions:**

1. **This document (`project-context.md`)** — the summary/onboarding
   reference. Start here.
2. **`decisions.md`** — the detailed backing record for every decision
   summarized here, with rationale and rejected alternatives. Consult when
   you need the "why," not just the "what."
3. **`spec.md`** — product/functional specification derived from these
   decisions (requirements by feature area, MVP/V1/V2 tables).
4. **`architecture.md`** — technical architecture derived from these
   decisions (schema, API router layout, system design).
5. **`implementation-plan.md`** — implementation sequencing built on top of
   the four documents above (phases, repo structure, migration order,
   milestones); also where several previously-open implementation questions
   were formally resolved (see its §14, and `decisions.md`'s "Implementation
   Planning Addenda"). Consult once implementation actually begins for how
   the work is sequenced — it does not change any Non-negotiable decision or
   the Explicitly Deferred list above.

**`planning-dialogue.md` is historical, not authoritative.** It preserves the
raw interview transcript for reference/color, but if anything in it appears
to conflict with the four documents above, the documents above win — they
represent the reviewed, consistency-checked final state, while the dialogue
is the unfiltered process that produced them.

**For a future Claude session (or developer) picking this project back up:**

1. Read this file in full before doing anything else.
2. Consult `decisions.md`/`spec.md`/`architecture.md` for implementation-level
   detail as needed.
3. Treat §16 (Non-negotiable / Established Decisions) as binding — do not
   silently deviate from these; if a real conflict emerges, raise it
   explicitly as a new decision to be made, don't just pick a resolution.
4. Treat §18 (Explicitly Deferred) as a hard "do not build this yet" list for
   MVP work — if a task seems to require one of these, stop and confirm scope
   before proceeding.
5. Do not re-ask questions already answered in `decisions.md` — check there
   first.
6. If you discover a genuine gap or contradiction not covered by §25/§26,
   document it as a new open question rather than inventing an answer, and
   surface it to the user before proceeding.

**Change process:** any decision listed in §16 or `decisions.md` that needs
to change later should be recorded as a new dated entry (not a silent edit) —
append rather than overwrite, so the reasoning trail stays intact. Update
this summary document (`project-context.md`) to reflect the new state once a
change is confirmed.

**As of this writing, planning is complete but implementation has not
begun.** No application code, dependencies, or scaffolding exist yet.
