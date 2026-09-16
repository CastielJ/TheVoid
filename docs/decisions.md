# Void — Decision Log

Status: **Authoritative backing record.** This is the detailed, ADR-style log of
every decision made during the Phase 0 discovery interview (2026-09-15). It is
one of four authoritative documents (with `project-context.md`, `spec.md`,
`architecture.md`) — see each document's "Source of Truth" note for how they
relate. `planning-dialogue.md` is the raw transcript this log was distilled
from; it is historical, not authoritative.

Each entry: the decision, the options that were weighed, why the chosen option
won, and status. All entries below are **Confirmed** unless marked otherwise.

---

## Round 1 — Core Hierarchy & Multi-Tenancy

### D1. Definition of "Void"

**Decision:** A Void is a workspace/project **container** — a bounded unit that
owns Groups and Tasks. The spatial canvas is a _view_ over a Void's data, not
the Void's definition. Alternate views (list, calendar, etc.) of the same
Void's data are architecturally possible later without restructuring data.
**Rejected:** Void as "the one ever-expanding canvas per team" (doesn't scope
down / becomes unmanageable); Void as a decoupled view/session-state object
(over-engineered, no clear ownership semantics).

### D2. Hierarchy shape

**Decision:** `Organization → (optional Team association) → Void → Group →
Task`. Team is a real entity but is **not** a mandatory parent/owner of a Void.
A Void may optionally have a "home" Team (`Void.team_id`, nullable) for
organizational/display purposes, but **actual access control is via explicit
grants**, independent of that association (see D6).
**Rejected:** Team as a mandatory strict parent of every Void (too rigid — no
cross-team Voids without ownership transfer); Team reduced to a lightweight tag
with no real entity status (user explicitly wants Team to be a first-class
organizational/access entity, not just a label).

### D3. Team vs. Group

**Decision:** Team (organizational grouping of people + access) and Group
(spatial clustering of Tasks inside a specific Void) are **completely separate
entities**. A Group may be named after a Team (e.g. a Group literally titled
"Red Team" inside a Void) but there is no structural link between the two.

### D4. Multi-tenancy boundary

**Decision:** **Organization is the tenant boundary.** All tenant-scoped data
(Teams, Voids, Groups, Tasks, Memberships, etc.) is scoped under exactly one
Organization; queries must always filter by `organization_id`. A User account
is global and may hold independent Memberships in multiple Organizations, with
strict data isolation between them.

### D5. Personal/private Voids

**Decision:** Personal/private Voids reuse the **same** Void/permission model
as any other Void — no separate personal-workspace architecture. A private Void
is simply a Void with no Team association, defaulting to private visibility
(see D14). Low MVP priority; only worth doing because it's "free" given the
shared model, not a dedicated build.

### D6. Cross-Team Void access

**Decision:** A Void can be made accessible to multiple Teams and/or individual
Users within the same Organization via **explicit access grants**
(`VoidAccessGrant`, targeting either a Team or a User), independent of the
Void's optional `team_id`. This is what makes D2's "optional Team association"
non-restrictive.

### D7. Group nesting

**Decision:** **No nested Groups in MVP.** Groups are a flat single layer of
containers inside a Void. Revisit nesting later only if real usage demonstrates
need.

### D8. Multi-organization membership

**Decision:** A User can belong to multiple Organizations (multiple
Memberships), matching D4.

### D9. Multi-team membership

**Decision:** A User can belong to multiple Teams within one Organization
(many-to-many User↔Team).

### D10. Custom/user-defined Teams

**Decision:** Teams are fully user-defined — no hardcoded taxonomy, no
hardcoded role/team names anywhere in application code.

### Working conceptual model (as stated by user, Round 1)

```
Organization
├── Members
├── Teams (e.g. Red Team, Blue Team, Development — fully user-defined)
└── Voids
    ├── Void A
    │   ├── Groups
    │   └── Tasks
    └── Void B
        ├── Groups
        └── Tasks
```

A Void may optionally associate with a Team, but access is ultimately governed
by explicit grants, enabling cross-Team collaboration on a single Void.

---

## Round 2 — Membership, Invitations & RBAC

### D11. Organization-level roles

**Decision:** Fixed 3-tier for MVP: **Owner, Admin, Member.**

- Owner: full org control including billing and org deletion/transfer.
- Admin: member/team/settings management; not billing/destructive Owner-only actions.
- Member: no org-management permissions by default; access comes from scoped grants.

**Standing implementation principle:** permission checks are implemented
against **granular capabilities**, never hardcoded role-name checks, so custom
roles can be added later (deferred, see D-future) without redesigning
authorization.

### D12. Team-level roles

**Decision:** Teams have a **Team Lead** role, strictly scoped to their own
Team only (manage own Team's membership, view own Team's membership,
create/manage Voids associated with own Team). Team Lead gains **no**
org-wide administrative power.
**Assumption (approved, not separately interviewed):** a Team Lead who creates
a Void associated with their own Team becomes that Void's Manager (see D13) by
default.

### D13. Void-level roles

**Decision:** Three levels per Void access grant: **Viewer** (view Void/Groups/
Tasks), **Editor** (Viewer + create/edit/delete Groups and Tasks), **Manager**
(Editor + manage the Void's access grants and Void-level settings). Void
Manager is scoped to that Void only — no org-wide power.

### D14. Default Void visibility

**Decision:** If a Void is created with a Team association, it is visible to
that Team by default. If created with no Team association, it is **private** to
the creator by default. Either way, visibility expands only through the same
explicit access-grant system (D6) — no special-cased logic.
**Assumption (approved, not separately interviewed):** the creator of a
Team-less (private/personal) Void is that Void's Manager by default.

### D15. Task-level permissions

**Decision:** **No per-task ACLs in MVP.** Tasks inherit permission entirely
from their Void — if you can access the Void, you can see all its tasks; your
edit/assign ability follows your Void-level role (D13).

### D16. Invitation/join mechanism

**Decision:** **Email invitations only for MVP** — unique, single-use,
revocable, ~7-day expiry. The originally proposed permanent/unlimited static
org-join code (e.g. `ABC-XYZ-123`) was identified as a security flaw (leaked
code = unlimited unauthorized org joins with no clean per-invite revocation)
and is explicitly **rejected**. Architecture must leave room for a future
secondary invite-link mechanism (expiring, use-limited, revocable,
lowest-privilege-only, never able to grant Admin/Owner) — not built in MVP.
Domain-based auto-join is not built in MVP either.

### D17. Member removal behavior

**Decision:** Removing a member is **never destructive/automatic** beyond
ending their access. Task assignments remain associated with the former member
but are flagged as having an inactive assignee, for a manager to later
reassign. Voids they created are not deleted (ownership persists, doesn't
follow the user out). Team memberships end. All other data/history stays
intact.

### D18. Historical identity preservation

**Decision:** A User account is **never hard-deleted** merely because an
Organization Membership ends. `Membership` (org-scoped, can be removed) is
modeled separately from `User` (global identity). Historical references
(`created_by`, comments, audit log entries, task history, past assignments)
always continue pointing at the real User record — important because one User
can hold Memberships in multiple Organizations simultaneously (D8).

### Standing architecture principle (Round 2)

Authorization resolves as **Organization role → Team-scoped permissions →
Void-scoped permissions**, exposed as capability questions ("can this user
manage this Org/Team/Void?", "what's this user's permission level on this
Void?") — never scattered role-name checks throughout application code.

---

## Round 3 — Authentication & Session Security

### D19. Primary sign-in methods

**Decision:** Both **email+password** (with required email verification) and
**passwordless magic-link**, authenticating the same underlying User account —
not separate account types.

### D20. OAuth providers

**Decision:** **None in MVP.** Google/Microsoft/GitHub OAuth deferred to V1.

### D21. Enterprise SSO

**Decision:** **Deferred to V1/V2.** No SAML/OIDC/SCIM in MVP.

### D22. Password security baseline

**Decision:** ≥12 character minimum length; no forced complexity rules or
periodic rotation requirements; breached-password check (e.g. HIBP k-anonymity
API) at signup/reset where practical; **Argon2id** hashing; never store
plaintext. (Standard current best practice, per NIST 800-63B — not a
discretionary product choice.)

### D23. MFA / 2FA

**Decision:** **Optional TOTP-based 2FA in MVP**, user-enabled voluntarily,
with secure backup/recovery codes issued at enrollment. **No** org-wide
enforced MFA in MVP (deferred as a future org security setting).

### D24. Passkeys

**Decision:** **Deferred to V1** (WebAuthn). Auth architecture must remain
extensible enough to add later.

### D25. Session model

**Decision:** **Server-side sessions** — opaque session token in a secure
httpOnly cookie, session record in the database. Immediately revocable.
Explicitly **not** stateless JWT (revocation is inherently weak with JWT unless
you reintroduce server-side state anyway) and explicitly **not** Redis-backed
purely because sessions exist — a DB-backed session store is sufficient for
MVP; Redis may be introduced later only if measured performance/scaling
requirements justify it.

### D26. Device/session management

**Decision:** **In MVP:** users can view active sessions/devices, revoke an
individual session, and "log out everywhere." Track device/browser, created
time, last-active time, and approximate location only where privacy-safe.

### D27. Session lifetime / "remember me"

**Decision:** Explicit lifetime policy rather than an ambiguous permanent
login: shorter default inactivity lifetime; "Remember Me" extends it to
roughly 30–60 days. Exact durations finalized at implementation/security-review
time.

### D28. Account recovery

**Decision:** Standard email-based password reset; lost-2FA recovery via
backup codes as the primary self-service path; **additionally**, an authorized
Org Admin/Owner may initiate a controlled recovery/reset for a member,
provided the action is explicitly confirmed, creates an audit-log entry, never
reveals the user's password, and never allows silent impersonation. No
complex identity-verification/support-ticket recovery system in MVP.

### D29. Rate limiting / brute-force protection

**Decision:** Standard rate limiting and abuse protection (per-IP and
per-account) on all auth-sensitive endpoints — login, password reset,
magic-link request, invitation acceptance, 2FA verification, account recovery
— with exponential backoff/temporary lockout on repeated failures.
CAPTCHA/Turnstile-style challenge introduced reactively on detected abuse, not
forced on every legitimate user by default.

### Standing architecture principle (Round 3)

**Authentication and authorization are strictly separate.** Authentication
answers "who is this User?"; authorization answers "what can this User do in
this Organization/Team/Void?" A single User account belongs to multiple
Organizations and receives permissions independently in each.

---

## Round 4 — Spatial Canvas, Realtime Collaboration & Task/Group Model

### D30. Canvas rendering technology

**Decision:** **DOM/SVG** for rich interactive objects (Tasks, Groups) +
a custom pan/zoom viewport/transform layer + **virtualization** (only render
objects in/near the viewport). Explicitly **not** WebGL/PixiJS/Konva/Fabric.js
for MVP — those remain an option only if future profiling proves DOM/SVG is a
genuine, measured bottleneck. Rationale: Void's objects are rich interactive UI
(cards with text, avatars, buttons), not simple vector shapes — a meaningfully
different rendering problem than what diagramming-oriented libraries (React
Flow, Konva, Fabric) are optimized for.

### D31. Coordinate system & camera persistence

**Decision:** Each Void has its own independent infinite coordinate space
(floating-point x/y per object, no fixed bounds). Each User has their own
persisted **per-Void, per-User** camera state (x, y, zoom) — personal, never
shared between users. Object positions (x/y, and for Groups also width/height)
are shared Void data, visible identically to everyone.

### D32. Realtime collaboration scope

**Decision:** **Live WebSocket sync in MVP** for Task/Group create, update, and
move — changes appear to other connected users without a page refresh.
Explicitly **no** presence indicators, cursor sharing, "who is viewing," or
typing indicators in MVP (deferred).

### D33. Conflict resolution

**Decision:** **Server-authoritative last-write-wins.** The server is the
single source of truth; broadcasts the resolved state. No field-level merge, no
CRDT infrastructure in MVP. Revisit only if real usage demonstrates it's
actually needed.

### D34. WebSocket authorization

**Decision:** WebSocket connections authenticate via the **same server-side
session** (D25) at handshake (session cookie) — no separate token scheme.
Subscribing to a Void's live-update channel **re-checks the current Void-level
permission at subscribe time**, not just at login, so a mid-session permission
revocation stops further realtime delivery immediately.

### D35. MVP Task fields

**Decision:** title, description, status, priority, **multiple assignees**,
creator, due date, created_at, updated_at, tags, `group_id`, comments, basic
activity history. **Deferred:** file attachments, full subtasks, dependencies,
recurring tasks.

### D36. Task status model

**Decision:** Fixed MVP status set: **To Do, In Progress, Done, Blocked.** No
custom-status management UI in MVP; underlying model stays extensible for
custom statuses later.

### D37. Subtasks / checklists

**Decision:** **Lightweight checklist items only** in MVP — embedded checkbox
items on a Task, **not** independent Task entities (no own canvas position,
status, assignee, comments, or history). Full hierarchical subtasks (own
`parent_task_id`, potentially own canvas presence) deferred, pending a future
canvas-UX decision about whether a subtask gets its own object on the Void.

### D38. Group behavior & membership model

**Decision:** Groups are real spatial objects with their own x/y position,
width, height, and name — **freeform, manually resizable/movable** by users.
**Group membership is an explicit foreign key** (`Task.group_id → Group.id`),
**never** inferred from spatial/geometric containment. A task's visual position
relative to a Group's rectangle is purely presentational; moving a task
visually "into" or "out of" a Group's boundary does not, by itself, change
`group_id`.

### Standing architecture principle (Round 4)

**The canvas is a projection of persisted Void data, never the source of
truth.** Task position, Group membership, and Group dimensions are persisted
data. Camera position is user-specific view state (D31). Rendering merely
visualizes these values — this keeps the system reasoned-about, testable,
synchronizable, and later optimizable independent of rendering technology.

---

## Round 5 — Notifications, Files, Search, Admin & Billing

### D39. Notification events (MVP)

**Decision:** MVP events: task assigned to you, mentioned in a comment, invited
to an organization, your role/permissions changed. **Deferred:** due-soon/
overdue reminders (needs a scheduled-job system), generic new-comment
notifications, task-completed notifications, added/removed-from-group
notifications. Event/notification architecture stays extensible for future
event types.

### D40. Notification delivery channel

**Decision:** **In-app notification inbox/bell only** for MVP. Transactional
email continues to exist for auth (verification, magic-link) and invitations,
but no general notification-email system is built for MVP.

### D41. Push notifications

**Decision:** **Deferred**, not in MVP (no mobile app currently planned; no
browser push).

### D42. Attachments — schema footprint

**Decision:** **No attachment tables or fields anywhere in the MVP schema** —
not even placeholder/nullable fields. Storage provider, size/type limits, and
scanning requirements to be decided deliberately when attachments are actually
built as a dedicated V1 feature.

### D43. Global search

**Decision:** **In MVP.** Database-backed search (PostgreSQL `ILIKE`/trigram
via `pg_trgm`, no dedicated search engine) over Task title, Task description,
and Group name, scoped to Voids the current user is authorized to access.
Selecting a result moves the camera to that object's persisted coordinates.
Explicitly included in MVP (not deferred) because the infinite-canvas
navigability problem is inherent to the product's core concept.

### D44. Non-canvas views

**Decision:** Canvas remains the primary Void interface. MVP additionally
includes a minimal **cross-Void "My Tasks" view** — tasks assigned to the
current user across all accessible Voids, sortable/filterable by due date,
priority, and status; clicking a task navigates to its canvas location.
**No** full per-Void List View, Calendar view, or Dashboard view in MVP
(deferred to V1).

### D45. Admin dashboard scope (MVP)

**Decision:** MVP admin surface: organization member list + roles, Team
management, pending invitations (view + revoke), basic org settings.
**Audit-log data collection begins in MVP** (append-only, identity-preserving —
see D18) even though the dedicated searchable/filterable audit-log **viewer**
UI is deferred to V1. Deferred: usage/storage stats, org-wide MFA-enforcement
toggle, billing admin.

### D46. Billing

**Decision:** **Fully deferred from MVP** — no Stripe/payment integration, no
subscription plans, no plan/feature gating, no seat-limit enforcement, no
usage-based billing logic anywhere in MVP. All MVP functionality is available
without artificial tier gating. Pricing model to be designed deliberately
before implementation, not retrofitted.

### Standing architecture principle (Round 5)

**Search passes through the same authorization layer as direct Void access.**
Search results must never reveal the existence, title, description, or other
metadata of a Task/Void/Group the searching user is not authorized to access.

---

## Round 6 — Technology Stack, Database, API & Deployment

### D47. Backend language/framework

**Decision:** **TypeScript + Fastify + tRPC.** Fastify chosen over NestJS after
explicit evaluation: NestJS's DI/module/decorator structure is valuable mainly
for large teams that need enforced conventions, but integrates less naturally
with tRPC (which is designed to sit directly on a lightweight HTTP server) and
adds a layer of abstraction between the WebSocket upgrade/auth handshake (D34,
D51) and application code. Fastify + tRPC keeps module boundaries enforced via
folder/router structure and code review rather than a framework's DI system,
matching the "avoid framework complexity that doesn't materially help"
instruction.

### D48. Frontend framework

**Decision:** **React + Vite + TypeScript**, as a client-side SPA — explicitly
**not** Next.js/SSR for the core authenticated canvas app, since it has none of
the characteristics (public/SEO-relevant pages, need for server rendering) that
Next.js's main value props address. A future public marketing site, if built,
is a separate concern (potentially its own small static/Next.js site,
decoupled from the app).

### D49. Database

**Decision:** **PostgreSQL**, confirmed as the primary relational source of
truth (relational integrity for multi-tenant FKs/RBAC joins, `pg_trgm` search
per D43, standard safe default for this application shape).

### D50. API architecture

**Decision:** **tRPC**, end-to-end type-safe procedure calls between the React
frontend and Fastify backend (both TypeScript, per D47/D48) — zero
code-generation step, zero schema-drift risk. Chosen over REST (no current need
for a public/third-party API that would justify REST's external-consumer
advantages) and over GraphQL (operational overhead — schema, resolvers,
dataloaders — not justified without a stated nested-query/public-API need).
**Requirement:** the tRPC router structure must stay modular (composed
domain-scoped routers, e.g. one router per `org`/`team`/`void`/`task`/`group`/
`auth`), not one giant flat collection of procedures.

### D51. Realtime transport

**Decision:** **Self-hosted WebSocket layer**, part of the same Node/Fastify
backend — not a managed realtime vendor (Pusher/Ably/Supabase Realtime).
Preserves full control over the custom auth model already decided (D34):
session-cookie handshake, per-channel Void-permission re-check on subscribe,
server-authoritative last-write-wins (D33), no presence/cursors/CRDT in MVP
(D32/D33).

### D52. Hosting/infrastructure

**Decision:** **Left open**, no existing cloud-provider constraint. At
implementation-planning time, recommend the simplest reliable production setup
for this stack (e.g. a PaaS such as Railway/Render/Fly.io + managed Postgres) —
explicitly **no Kubernetes or unnecessary infrastructure** for MVP.

### D53. File/object storage

**Decision:** **Fully deferred**, consistent with D42 — no storage
infrastructure or attachment abstractions introduced speculatively. Decided
properly when attachments become an active V1 requirement.

---

## Round 7 — Canvas Interaction, Performance, Testing, Final MVP Lock-In

### D54. WASD + mouse navigation

**Decision:** Both always available simultaneously, no mode-switching.
Mouse/trackpad drag-to-pan and scroll/pinch-to-zoom as the primary interaction;
WASD moves the camera at a fixed speed while the canvas has focus. WASD must
not interfere with text inputs, textareas, selects, or other interactive
controls (i.e., disabled while a form control has focus).

### D55. Minimap

**Decision:** **Deferred to V1.** MVP instead relies on search (D43), the My
Tasks view (D44), and a "zoom-to-fit/all-objects" capability where practical
(compute bounding box of all objects, animate camera to fit).

### D56. Multi-select, copy/paste, undo/redo

**Decision — MVP:** click-drag selection box / multi-select; Delete key
removes selected objects; basic copy/paste of Tasks **within the same Void**
(duplicated Task receives a new ID; duplication must **not** carry over
historical activity, comments, or audit history from the original — exact
duplication semantics to be pinned down at implementation time).
**Decision — deferred to V1+:** undo/redo (explicitly **not** an MVP
requirement — interacts nontrivially with realtime multi-user sync and would
need either a command-log or snapshot system, not a small add-on), cross-Void
copy/paste, a broader customizable keyboard-shortcut system.

### D57. Mobile/touch scope

**Decision:** Desktop/laptop (mouse + trackpad) is the primary MVP experience.
Tablet gets basic usable touch support (pan, pinch-to-zoom, canvas
interaction) since it's low-cost given the DOM/SVG rendering choice (D30). No
dedicated phone-optimized layout in MVP — deferred to V1.

### D58. Accessibility bar

**Decision:** **WCAG 2.1 AA target for all non-canvas UI surfaces** in MVP —
authentication, forms, dialogs/modals, task detail UI, org/team admin, My
Tasks, general navigation, contrast in both themes, keyboard navigation,
semantic HTML/ARIA. For the **spatial canvas itself**, full screen-reader
spatial navigation is explicitly **not** an MVP requirement, but the canvas
must not be made needlessly inaccessible — sensible keyboard/focus behavior and
accessible labels should be used where practical given the DOM/SVG
architecture, and the My Tasks / task-detail UI (which are WCAG AA targets)
serve as the accessible, non-spatial way to reach and act on task information.

### D59. Performance target

**Decision:** Target ~60fps during normal pan/zoom/interaction with
**roughly 1,000–2,000 rendered/active objects in a single Void**, achieved via
virtualization (D30) plus spatial indexing (e.g. quadtree or grid-bucket) for
fast viewport queries. **Explicitly a performance target, not a product or
database limit** — the data model must support larger Voids; MVP simply does
not guarantee the same frame rate beyond that range, and no artificial
object-count cap or forced-split rule is implemented. Rendering-architecture
changes (e.g. WebGL) are considered only if future profiling on real data
proves DOM/SVG is the actual bottleneck.

### D60. Testing strategy

**Decision:** Test investment weighted toward authorization/security
correctness over broad UI coverage.

- **Unit tests:** authorization/capability resolution, org/team/Void
  permission-boundary logic, access-grant evaluation, other security-sensitive
  business logic.
- **Integration tests:** tRPC procedures covering auth flows, org creation,
  invitations, membership, Void access, task/group CRUD, permission
  enforcement, realtime authorization behavior where practical.
- **E2E (Playwright):** critical-path journeys only — signup/login → create
  org → invite member → create Team → create Void → create Group → create Task
  → assign Task → authorized user can access/edit it → unauthorized user
  cannot. Explicitly **not** exhaustive canvas-interaction E2E coverage (too
  brittle/expensive for the value).

### D61. Monitoring/logging (MVP baseline)

**Decision:** Structured application logging (e.g. Pino, pairs with Fastify)
and production error tracking (e.g. Sentry or equivalent) from day one. Full
observability/metrics-dashboard infrastructure deferred until real production
traffic justifies it. Explicitly **no** Kubernetes, distributed tracing, or
complex metrics systems for the sake of having them.

### D62. Final MVP scope lock-in

**Decision:** The consolidated MVP scope (cross-referencing D1–D61) is locked.
See `project-context.md` → "MVP Scope" and "Explicitly Deferred" for the full
enumerated lists. **The MVP must not grow further unless a newly discovered
requirement is genuinely necessary for the core product to function** — this
is an explicit standing constraint on future planning/implementation work, not
just a snapshot of current scope.

---

## Post-Discovery Documentation Review Corrections (2026-09-16)

After the initial `docs/` package was produced, the user reviewed
`decisions.md`, `project-context.md`, `spec.md`, and `architecture.md` and
found implementation/security consistency issues in how the confirmed
decisions above had been translated into `architecture.md`'s technical
design — not new product decisions, but corrections to documentation that had
drifted from, or under-specified, what was actually decided in Rounds 1–7.
Recorded here for traceability; the corrected documents are the ones that
govern going forward.

### C1. Org Admin/Owner do not automatically bypass Void access control

**Issue:** `architecture.md`'s original authorization-resolution order stated
Organization Owner and Admin both get "full access" to every Void. **This was
never confirmed during discovery** — D11 established Owner/Admin as
organization-_management_ roles; D13/D14/D6 established that Void access is
always explicit (via `VoidAccessGrant`), specifically so private Voids (D14)
and Team-scoped cross-collaboration (D6) work as designed. An automatic
Admin-bypass would have silently undermined both.
**Correction:** `architecture.md` §3 now lists `canAccessVoid`/`getVoidRole`
resolution as: direct `VoidAccessGrant` → Team-membership-derived
`VoidAccessGrant` → no access, full stop, regardless of Organization role.
Org-management capabilities (`canManageOrganization`, `canManageTeam`) remain
separate checks, never substituting for a Void-access check. If org-wide
Void oversight is wanted later, it must be a new, explicitly named capability
— not an implicit consequence of holding Admin/Owner.

### C2. Tenant-isolation wording corrected to match the actual schema

**Issue:** `project-context.md` stated every tenant-scoped table carries
`organization_id`, but the proposed schema (correctly) uses parent
relationships for `Group`/`Task` (via `void_id`) rather than a duplicated
`organization_id` column on every table.
**Correction:** wording in `project-context.md` §16 (Non-negotiable #17),
§20, and §24, and `architecture.md` §4, now reads: every tenant-scoped
record must have an unambiguous Organization ownership path, either directly
via `organization_id` or through a mandatory tenant-owned parent
relationship — every query must enforce that boundary either way. No
redundant `organization_id` columns were added merely to make the old
sentence literally true.

### C3. Cross-tenant / cross-parent integrity invariants made explicit

**Issue:** the schema had no explicit statement of same-Void/same-Organization
integrity requirements for relationships that must never cross a boundary
(e.g. a Task's `group_id` pointing at a Group in a _different_ Void).
**Correction:** `architecture.md` §4.1 now documents each invariant
(`Task.group_id` same-Void as Task; `Void.team_id` same-Org as Void;
`VoidAccessGrant` targets same-Org as the Void; `TeamMembership` users
belong to the Team's Org; no cross-Org references anywhere) with a proposed
enforcement approach (DB trigger or composite FK as defense-in-depth,
application-layer authorization checks as the primary/always-present layer).

### C4. Authentication token storage added to the schema

**Issue:** MVP requires magic links, email verification, and password reset
(D19, D28), but the original schema had no token mechanism for any of them.
**Correction:** `architecture.md` §4 now includes an `AuthToken` table —
purpose-scoped (`email_verification` | `magic_link` | `password_reset`),
cryptographically random token hashed at rest, short expiry, single-use via
`consumed_at`, revoked/superseded when a newer token of the same purpose is
issued. `Session` and `Invitation` retain their own existing token handling
and are not folded into this table.

### C5. "No unresolved decisions" wording corrected

**Issue:** `project-context.md` §26 stated no unresolved decisions existed,
while `spec.md` §5 correctly listed 8 genuinely open product/implementation
details (Void deletion semantics, priority enum, comment permissions,
activity-history field list, copy/paste semantics, multi-Team-Lead question,
SLA, session durations), and `architecture.md` §12 separately listed 4 more
infrastructure-specific open items (ORM choice, CSRF mechanism, WebSocket
eviction mechanism, hosting provider).
**Correction:** `project-context.md` §26 now reads "No unresolved decisions
were identified **that block MVP implementation planning**," explicitly
enumerates items from both lists rather than implying none exist, and points
to `spec.md` §5 (product/implementation) and `architecture.md` §12
(infrastructure) as the live lists.

### C6. GitHub OAuth restored to V1 scope in `spec.md`

**Issue:** D20 deferred Google/Microsoft/GitHub OAuth as a set; `spec.md`'s
V1 list had drifted to only Google/Microsoft.
**Correction:** `spec.md` §4 V1 list now includes GitHub, matching D20.

### C7. Organization ownership: single source of truth

**Issue:** the original schema had both `Organization.owner_user_id` and
`Membership.role = 'owner'` as two independent, potentially-divergent
representations of the same fact (who owns the Organization) — never
explicitly decided to coexist.
**Correction (user's stated preference: avoid duplicated state):**
`Organization.owner_user_id` was **removed**. Ownership is derived solely
from the `Membership` row with `role = 'owner'`, with a partial unique index
enforcing exactly one active owner per Organization at the database level.
Ownership transfer is a single transaction (demote current owner's Membership
to `admin`, promote the target Membership to `owner`) — the unique index
makes an inconsistent intermediate state (zero or two owners) impossible to
commit. See `architecture.md` §4 (`Membership`) for the schema comment.

### C8. Task assignment eligibility rule made explicit

**Issue:** D17 defined what happens to a _removed_ member's existing
assignments (they persist, flagged inactive), but the schema didn't state the
positive rule for when a _new/active_ assignment is allowed.
**Correction:** `architecture.md`'s `TaskAssignee` table now documents the
invariant: an active assignment (`assignee_active = true`) may only be
created for a User with an active Organization Membership who is eligible to
access the Task's Void (`canAccessVoid`) at assignment time. This is an
application-layer invariant (enforced in the assignment procedure, since it
depends on cross-table authorization state), consistent with — not a
replacement for — the existing Organization/Void security model. Also
reflected in `project-context.md` Non-negotiable #19.

---

## Implementation Planning Addenda (2026-09-16)

Recorded while producing `implementation-plan.md`, per the user's explicit
instruction that any previously-open implementation question resolved during
implementation planning be logged here as a new dated decision, distinct
from both the original Phase 0 decisions (D1–D62) and the documentation
corrections (C1–C8). These resolve items from `spec.md` §5 and
`architecture.md` §12 (as of the correction pass). Full rationale for each is
in `implementation-plan.md` §14; summarized here for the log:

- **ID1.** Void deletion is soft-delete (`deleted_at`); permission required:
  Void Manager or Org Admin/Owner.
- **ID2.** Task priority is a fixed 4-level enum: `low`, `medium`, `high`,
  `urgent`.
- **ID3.** Comment author may edit/delete their own comment; Void Manager
  may additionally delete (not edit) any comment for moderation. No
  edit-history tracking in MVP.
- **ID4.** Task activity history tracks `status`, `priority`, `assignees`,
  `due_date`, `group_id` only — not title/description/tags.
- **ID5.** Task copy/paste: new ID; copies title/description/priority/tags/
  group_id/checklist-items(reset unchecked); does not copy assignees,
  comments, or activity history; status resets to default.
- **ID6.** A Team may have multiple simultaneous Team Leads (no cap).
- **ID7. [Approved 2026-09-16 as configurable implementation defaults, not
  an immutable product requirement]** Session idle-expiry defaults: 12 hours
  normal, 30 days with "remember me," both inactivity-extended. Values must
  live as named constants in `server/src/config/`, not hardcoded inline, so
  a future security review can retune them without touching auth logic.
- **ID8.** ORM: Drizzle (over Prisma) — see `implementation-plan.md` §14 for
  rationale (lighter runtime, SQL-shaped queries, no codegen step).
- **ID9.** CSRF protection: SameSite=Lax cookies + strict Origin-header
  validation middleware, not a separate CSRF token system.
- **ID10.** WebSocket permission-eviction: event-driven (in-process event on
  `VoidAccessGrant` change → immediate re-check + disconnect of affected
  subscribers), not polled.
- **ID11. [Explicitly NOT approved — remains TBD, per 2026-09-16 user
  review]** Hosting: Railway was proposed as a candidate during
  implementation planning but the user explicitly declined to lock it in,
  since it carries real vendor/account/billing consequences outside this
  codebase and doesn't need resolving before the application is built and
  tested. **Status: open, to be revisited during deployment preparation**,
  not treated as decided anywhere in `architecture.md`/`implementation-plan.md`.

## Implementation Planning Addenda, Round 2 (2026-09-16)

Recorded after the user reviewed the first implementation-plan summary and
requested additional implementation details be specified before coding
begins. Full detail in `implementation-plan.md` and the corresponding
`architecture.md` additions (§2, §4, §6.1, §6.2, AuditLog section); summarized
here:

- **ID12.** Email delivery uses a provider-agnostic `EmailSender` interface
  (`server/src/email/`) — `auth` and `invitation` domain modules depend only
  on this interface, never a concrete vendor SDK. A `ConsoleEmailSender`
  backs local dev/tests. The actual provider (Resend/Postmark/SES/etc.)
  **remains open**, chosen at deployment-preparation time — same rationale
  as hosting (ID11): a vendor choice with no architectural consequence as
  long as it sits behind the interface.
- **ID13.** WebSocket reconnect/resync protocol defined explicitly
  (`architecture.md` §6.1): on every (re)connection, the client
  re-authenticates, the server re-checks live Void access, and the client
  fetches **authoritative current state via a normal query** (not an event
  backlog/replay log) rather than assuming it's caught up — applied
  uniformly across network loss, browser reconnect, expired/revoked
  session, loss of Void access, and server restart.
- **ID14.** Last-write-wins (D33) ordering is defined by a **server-assigned
  `version` column** on `Task` and `Group` (`architecture.md` §4), not
  client timestamps. Flow: authorization check → accept write → persist +
  increment version (one transaction) → broadcast `{object, version}`. This
  also underpins ID13's resync determinism.
- **ID15.** Security-sensitive mutations (role changes, member removal,
  ownership transfer, Team membership changes, Void access grant/
  revocation, admin-assisted recovery, and similar) write their `AuditLog`
  row in the **same database transaction** as the state mutation — commit
  or rollback together, no async/background audit pipeline in MVP. A
  mutation must never commit without its audit record, and vice versa.
- **ID16.** Soft-delete behavior specified uniformly (`architecture.md`
  §6.2) rather than left for each module to invent independently: standard
  queries filter `deleted_at IS NULL` via a shared helper; a deleted Void is
  authorization-inaccessible even with existing grants; Groups/Tasks under a
  deleted Void are **not** individually cascade-soft-deleted — they become
  unreachable via the Void-level join/authorization exclusion instead (an
  O(1) delete regardless of Void size); restoration is **not** built in MVP
  (schema supports it later); realtime subscribers receive a `void.deleted`
  broadcast before eviction, so the client can show a clear "deleted" state
  rather than the connection just dropping.
- **Reaffirmed, not new:** authorization remains uncached in MVP (every
  sensitive operation resolves current authorization from authoritative
  state on every call) — this was already the implicit design (§4 of
  `implementation-plan.md`), now made an explicit non-regression point per
  the user's request: introducing caching later is a new security-sensitive
  architectural decision requiring explicit invalidation design, not a
  performance tweak to slip in quietly.

**Left explicitly open, not resolved here:** availability/uptime SLA (a
business/pricing-adjacent commitment, not an implementation detail — revisit
alongside billing/pricing design, not as part of MVP implementation
planning); frontend state-management library choice (no architectural
consequence, fine to decide at Phase 6 start); trigger-vs-composite-FK choice
per C3 invariant (depends on ORM behavior, decided at migration-authoring
time in Phase 3/4); hosting provider (ID11, explicitly TBD); email provider
(ID12, explicitly TBD). See `implementation-plan.md` §12 for the full
open-question disposition table.

---

## Phase 0 Execution Notes (2026-09-16)

Recorded while actually building Phase 0 (docs/implementation-plan.md §2),
per the user's instruction that a genuine conflict with an established
decision be surfaced explicitly and any newly resolved implementation detail
be logged here. None of the below conflicts with an established decision —
these are environment-setup facts and one cross-platform bug fix, recorded
for traceability since a future session picking this repo up should know
why the local environment looks the way it does.

- **Local toolchain installed:** Node.js 24 (LTS), pnpm 12, and PostgreSQL 17
  were not present on the development machine and were installed as part of
  Phase 0 (with explicit user approval before each — Node/pnpm first, then
  PostgreSQL as a separate confirmation given it's a persistent service, not
  a CLI tool). A dedicated non-superuser `void_app` Postgres role and
  `void_dev`/`void_test` databases were created; the app never connects as
  the `postgres` superuser.
- **pnpm supply-chain `minimumReleaseAge` set to 0** (`pnpm-workspace.yaml`)
  for local development, since several transitive dependencies of
  well-established packages had same-day releases that pnpm 12's default
  ~24h policy blocked. Documented in `pnpm-workspace.yaml` as a deliberate
  development-velocity tradeoff, explicitly flagged for reconsideration
  (a real minimum-release-age window, provenance/audit tooling) as part of
  Phase 8 hardening — not treated as a permanent security posture.
- **Server process entrypoint split into two files** (`app.ts` builds the
  Fastify app and is what tests import via `app.inject()`; `server.ts` is
  the actual process entrypoint that calls `.listen()`), replacing an
  initial single-file design that used an `import.meta.url ===
file://${process.argv[1]}` check to decide whether to auto-start. That
  check silently evaluates false on Windows (URL vs. native path separator
  mismatch), so the server never actually started when run directly — caught
  during Phase 0's own verification step (the plan's "run required tests and
  verify invariants before proceeding" rule), not shipped unverified. The
  two-file split is strictly better architecture regardless of platform (a
  build/run separation, not a workaround bolted onto the original design),
  so it's kept going forward rather than treated as a temporary patch.
- **Sentry/error-tracking:** implemented as a provider-agnostic
  `ErrorReporter` interface (`server/src/errorReporting.ts`) that currently
  only logs, mirroring the `EmailSender` pattern (ID12) — no Sentry account
  exists yet, consistent with hosting/email provider remaining open per the
  prior review round. Swapping in a real Sentry adapter later requires no
  change to any code that calls `errorReporter.captureException(...)`.

**Phase 0 milestone verification:** confirmed via automated integration test
(`packages/server/test/integration/app.test.ts`, exercising `/health` against
the live local database and the `ping` tRPC procedure) and manually — the
real server process was booted and hit over HTTP directly, and again through
the Vite dev server's proxy, confirming the full React-client → tRPC →
Fastify → Postgres path works end-to-end, not just via test injection.

## Phase 1 Execution Notes (2026-09-16)

Recorded while building Phase 1 — Identity Foundation (User, Auth, Sessions),
per the same "surface conflicts explicitly, log new implementation-stage
resolutions" instruction as the Phase 0 notes above. No conflicts with any
established decision were found; the items below are implementation
specifics that a future session should know about.

- **2FA login-challenge handshake is in-memory, not a 4th `AuthToken`
  purpose.** `architecture.md` §4 scopes `AuthToken` to exactly
  `email_verification` / `magic_link` / `password_reset`. The "password
  verified, awaiting TOTP code" handshake between `auth.login` and
  `auth.verify2FA` is instead a short-lived (~5 min), unpersisted, in-process
  token map (`domains/auth/twoFactorChallenge.ts`) — consistent with keeping
  the documented `AuthToken` purposes exactly as specified, and consistent
  with the already-approved precedent of keeping the rate limiter
  (`domains/auth/rateLimit.ts`) in-memory/single-process rather than
  reaching for shared storage pre-emptively.
- **Rate limiting (D29) implemented as per-procedure tRPC middleware, not
  Fastify-route-level limiting.** tRPC's batched `/trpc` endpoint can carry
  multiple different procedure calls in one HTTP request, so a single
  route-level limiter can't distinguish "10 login attempts" from "10
  harmless `listSessions` calls" in the same window. Implemented as an
  in-memory fixed-window limiter keyed by `(IP, procedure[, email])`,
  applied explicitly to the procedures D29 names (login, signup, magic-link
  request, 2FA verify, password reset request). Same in-memory/single-process
  scoping rationale as above.
- **CSRF Origin validation (ID9) applies to all non-GET/HEAD/OPTIONS
  requests globally**, via one Fastify `onRequest` hook
  (`src/csrf.ts`), rather than per-router configuration — simpler to audit
  (one place to see the whole policy) and impossible for a new mutating
  procedure to accidentally bypass.
- **Admin-assisted account recovery (D28) is not implemented in Phase 1.**
  D28 requires an _Organization Admin/Owner_ as the acting party, but
  Organization/Membership/roles don't exist until Phase 2 — this is a
  sequencing dependency, not a dropped decision. Self-service recovery
  (password reset via token, 2FA backup codes) — the other half of D28 — is
  fully implemented now; the admin-initiated half is deferred to Phase 2's
  membership/role work and should be built there, not forgotten.
- **Password reset revokes all of the user's sessions** as part of the same
  operation (per ID13's stated requirement), implemented via
  `revokeAllSessionsForUser` called from `auth.resetPassword` — verified by
  an integration test that logs in, resets the password, and confirms the
  prior session's cookie no longer authenticates.
- **Real TypeScript project references were required**, not optional
  polish: `@void/web`'s type-only `import type { AppRouter } from
"@void/server"` transitively pulled in `@fastify/cookie`'s ambient type
  augmentation of `FastifyRequest`/`FastifyReply`, which failed to resolve
  when `web` type-checked `server`'s raw source without `server` actually
  being built first. Fixed by making `shared` and `server` `composite`
  TypeScript projects with proper `references`, and switching `typecheck`/
  `build` scripts to `tsc -b` throughout — this is the correct, permanent
  structure for a tRPC monorepo, not a one-off patch for this bug.
- **Integration tests run with `fileParallelism: false`** (`vitest.config.ts`)
  — the auth integration tests share one physical `void_test` Postgres
  database and use `TRUNCATE` for per-test isolation; parallel test _files_
  would let one file's truncate race another file's in-flight assertions.
  Acceptable at this suite size; revisit (e.g. per-file schemas) only if
  suite runtime becomes a real problem.
- **Test verification approach:** rather than hand-constructing tRPC's HTTP
  wire format for integration tests, `test/helpers/client.ts` runs a real
  `@trpc/client` through `app.inject()` (a custom `fetch` bridge) — this
  exercises the actual client/server wire protocol, cookie handling, and
  CSRF Origin-check path, not a guessed approximation of them. 34 tests
  (unit: password/TOTP/rate-limiting logic; integration: full signup→verify
  →login, magic-link, password-reset-revokes-sessions, 2FA
  enrollment+challenge+backup-codes, multi-session management, CSRF
  rejection) all pass against a live local Postgres instance. Also manually
  verified over real HTTP (not just `app.inject`): a live server process
  correctly rejected a cross-origin POST (403) and correctly completed a
  real signup, logging the verification token via `ConsoleEmailSender`.

## Phase 2 Execution Notes (2026-09-16)

Phase 2 (Organizations, Teams, Membership & the Authorization Engine —
`implementation-plan.md` §2) is complete: `Organization`/`Membership`/`Team`/
`TeamMembership`/`AuditLog` migrated; the capability-based authorization
engine (`server/src/authorization/capabilities.ts`) built; `organizationRouter`
and `teamRouter` wired through a new shared `requireCapability` tRPC
middleware (`trpc.ts`) so no procedure inlines a role check. As with Phase 1,
a few implementation-stage specifics were resolved along the way and are
recorded here rather than silently decided:

- **New capability: `canTransferOwnership` (Owner-only).** `architecture.md`
  §3's capability list was illustrative ("e.g."), not exhaustive. Ownership
  transfer needed its own capability distinct from `canManageOrganization`
  (Owner **or** Admin) because D11 already states "Owner: full org control
  including billing and org deletion/transfer; Admin: ... not billing/
  destructive Owner-only actions" — an Admin being able to transfer
  ownership away from the Owner would contradict that, not just be an
  unspecified detail. `canTransferOwnership` returns true only for the
  active `owner` Membership; `organizationRouter.transferOwnership` is
  gated by it instead of `canManageOrganization`. Covered by
  `organizationRouter.test.ts` (Admin attempt → `FORBIDDEN`, Owner attempt →
  succeeds).
- **`listMembers`/`listMembers`(team)/`get`(team) are gated by the same
  management capability as mutations (`canManageOrganization`/
  `canManageTeam`), not a separate "view" capability.** No discovery
  decision specifies whether a plain Member can see the org/Team member
  list; rather than inventing a new capability not sanctioned by
  `architecture.md` §3, the conservative default (read access requires the
  same capability as management) was applied, consistent with §3's own
  instruction that a new access pattern like "Org Admins can see all Voids
  for oversight" must be an explicit, deliberately-named capability, never
  an implicit consequence. **This is flagged as an assumption open to
  revisit**, not a settled product decision — if plain Members should be
  able to see their own org/Team roster, that's a small, explicit follow-up
  (a new `canViewOrganization`/`canViewTeam` capability), not a silent
  widening of `canManageOrganization`.
- **Team creation is gated by `canManageOrganization`, not `canManageTeam`**
  — mechanically necessary (no Team row exists yet to check `canManageTeam`
  against), and consistent with Team creation being an org-management action
  in `implementation-plan.md` §6's router table.
  `team.update`/`team.delete`/`team.addMember`/`team.removeMember`/
  `team.setTeamLead` are all gated by `canManageTeam` (Team Lead of that
  specific Team, or org Owner/Admin) uniformly, including `delete` — a Team
  Lead may delete/rename their own Team, consistent with the Team Lead
  authority already established by A1 (Team Lead → Void Manager by default).
- **C3's TeamMembership invariant ("Team members must belong to the Team's
  Organization") is enforced at the application layer**
  (`domains/team/teamMemberships.ts`'s `addTeamMember`, inside the same
  transaction as the insert), per `architecture.md` §4.1's own recommendation
  for this specific invariant ("a DB trigger is possible but application-
  layer is likely sufficient here since Team membership changes are a
  low-frequency, already-gated admin action") — implemented exactly as
  recommended, not a deviation.
- **`AuditLog` migrated in Phase 2** alongside `Organization`/`Membership`,
  per `implementation-plan.md` §3's recommendation, even though most write
  call-sites for later domains (Void, Task, ...) won't exist until those
  phases are built. `domains/audit/auditLog.ts`'s `writeAuditLog(tx, entry)`
  takes the caller's own transaction handle so the audit row commits or
  rolls back atomically with the state mutation (ID15) — every Phase 2
  mutation (member role change, member removal, ownership transfer, Team
  create/update/delete, Team member add/remove, Team Lead change) writes one.
- **`transferOwnership` demotes "whoever currently holds ownership," not a
  caller-pinned expected-current-owner (no compare-and-swap semantics).**
  Two rapid transfer requests can both legitimately succeed in sequence
  (the second demoting the first request's new owner) rather than the
  second being rejected as "stale" — consistent with D33's last-write-wins
  being this app's general conflict-resolution philosophy, and no decision
  anywhere requires CAS semantics specifically for this operation. What C7
  actually requires — and what is tested directly, including a DB-level
  test that bypasses the application transaction entirely — is that the
  partial unique index makes a zero-or-two-active-owner state impossible to
  commit, which holds regardless of how many transfer requests race.
- **Tests:** capability-engine unit/integration coverage (positive and
  negative cases for every function, including the "Team Lead has no
  cross-Team authority" case and the "authorization reflects a change
  immediately, no staleness" case); the C7 ownership-transfer invariant
  tested both through concurrent application-level calls and via a direct
  DB-level attempt to create a second active owner (rejected by the partial
  unique index itself); the C3 TeamMembership invariant; D17 member-removal
  behavior (Membership ends, Team memberships end); and `requireCapability`
  wiring exercised through the real tRPC wire protocol for both routers
  (FORBIDDEN for insufficient privilege, success for sufficient privilege).
  64 tests total in the server package, all passing; typecheck/lint/format
  clean across the workspace.

## Phase 3 Execution Notes (2026-09-16)

Phase 3 (Voids, Groups, Access Grants — `implementation-plan.md` §2) is
complete: `Void`/`VoidAccessGrant`/`Group` migrated; `canAccessVoid`/
`getVoidRole`/`canEditVoid`/`canManageVoidAccess` are now fully real (no
longer Phase-2 stubs); `voidRouter` and `groupRouter` wired through
`requireCapability`. Implementation-stage specifics resolved along the way:

- **A1/A2 generalized: the creator of any Void always receives a direct
  Manager grant, not only when they happen to be the Team Lead (A1) or
  creating a Team-less Void (A2).** Both approved assumptions describe the
  same underlying behavior in their respective cases; neither says a
  non-Team-Lead Org Admin/Owner who creates a Team Void (a case
  `canCreateVoidForTeam` explicitly allows) should be left _unable_ to
  manage the Void they just created. Generalizing to "the creator always
  gets Manager" is a strict superset of both approved assumptions, not a
  narrowing or contradiction of either — flagged here rather than silently
  assumed, since it extends past what A1/A2's literal wording covered.
- **New implementation decision: D14's "visible to that Team by default" is
  realized as an actual `viewer`-or-higher grant, specifically Editor.**
  Void access has no mechanism other than `VoidAccessGrant` (C1/Non-
  negotiable #4), so "default visibility" had to become a real grant with
  _some_ role — D14/A1/A2 never specified which. Editor was chosen because
  Viewer-only would make a Team's "own" Void collaboratively useless (the
  stated product vision is shared task management), and Manager for the
  whole Team would make the creator's own Manager grant meaningless and let
  any Team member reassign the Void's access grants. **Flagged as an
  assumption open to revisit**, same status as Phase 2's member-list-
  visibility note — not a silently-settled product decision.
- **ID1 implemented as a real, narrow exception to C1:** `canDeleteVoid`
  composes `canManageOrganization(userId, void.organizationId) OR
canManageVoidAccess(userId, voidId)`, per `decisions.md` ID1's explicit
  "Void Manager or Org Admin/Owner" wording. This is the **only** capability
  where an Organization role satisfies a Void-scoped action without a
  direct or Team-derived grant — verified by a test that the same Org Owner
  is still denied `canAccessVoid`/content access on that same Void, so the
  exception doesn't leak into general access.
- **Child-resource capability wrappers resolve their parent Void server-
  side, never from client-supplied input.** `group.update`/`group.delete`
  take only `groupId` (no `voidId` field exists in that input at all) and
  `void.revokeAccess` takes only `grantId` — `canEditVoidForGroup`/
  `canManageVoidAccessForGrant` look up the Group/grant's actual `voidId`
  themselves before checking access. This was a deliberate design choice,
  not an oversight caught later: accepting a client-supplied `voidId`
  alongside `groupId`/`grantId` and checking access against _that_ would let
  a caller with Editor access to Void A edit a Group that actually belongs
  to Void B, simply by lying about which Void it's in. Verified by
  `voidRouter.test.ts`'s cross-Void Group-edit test.
- **`grantVoidAccess` is an upsert** (re-granting an existing Team/User
  target updates its role) since `implementation-plan.md` §6's router table
  has no separate "update grant role" procedure — `grantAccess` fills both
  roles. Enforced via a real Postgres `ON CONFLICT` against the
  `(void_id, team_id)`/`(void_id, user_id)` unique indexes, not a
  check-then-write race.
- **`VoidAccessGrant`'s "exactly one of team_id/user_id" invariant is a real
  database `CHECK` constraint** (`db/schema.ts`), not just TS-level
  validation — matching `architecture.md` §4's schema draft, which shows
  this specific invariant as a `CHECK`. (Note: the `role`/`status`/`purpose`
  text-enum columns from Phases 1–2 remain TS-level-only, not retrofitted
  with DB `CHECK`s as part of this phase — that's a pre-existing minor gap
  from architecture.md's schema draft, out of scope for a "continue to the
  next phase" instruction; worth a small cleanup pass at Phase 8 hardening.)
- **Test infrastructure fix:** the in-memory auth rate limiter
  (`domains/auth/rateLimit.ts`) is correct, intentional process-lifetime
  state for production, but every test request shares one fake IP via
  `app.inject()` — so it was silently accumulating across test _files_
  within one `vitest run` process, and Phase 3's larger suite was the first
  to actually exceed the signup limit mid-run (a false-negative test
  failure, not a real bug). Fixed by exporting `resetRateLimitState()` and
  calling it from `resetAuthTables()` (`test/helpers/db.ts`), so every
  test's rate-limit window is independent of run order and suite size.
- **Tests:** the C1 regression (Org Owner denied content access to another
  member's private Void) and its complement, the ID1 exception (that same
  Owner can still delete it); `getVoidRole`'s resolution order (direct grant
  overrides Team grant; highest role wins among multiple Team grants); the
  A1/A2-generalized default-grant logic at creation time; Team-Lead-scoped
  Void creation (own Team only); the deleted-Void-is-inaccessible invariant,
  including confirming the grant row itself survives undeleted (ID16); the
  C3 invariants for `Void.team_id`, `VoidAccessGrant.team_id`, and
  `VoidAccessGrant.user_id`; the cross-Void Group-edit denial; and
  `requireCapability` wiring for both routers over the real tRPC wire
  protocol. 89 tests total in the server package, all passing; typecheck/
  lint/format clean across the workspace.

## Phase 4 Execution Notes (2026-09-16)

Phase 4 (Tasks — Core Data, No Realtime Yet — `implementation-plan.md` §2) is
complete: `Task`/`TaskAssignee`/`ChecklistItem`/`Comment`/`TaskActivity`
migrated; `taskRouter` wired through `requireCapability`, including
child-resource wrappers for checklist items and comments that resolve their
parent Task/Void server-side, same pattern as Phase 3's Group wrappers.

- **A real authorization gap found and fixed, not just a new feature:**
  building C8's assignment-eligibility check surfaced that `getVoidRole`
  (Phase 3) never verified the acting/target User still has an **active
  Organization Membership** — it only ever checked `VoidAccessGrant` rows.
  D17's member-removal procedure explicitly ends `Membership` and
  `TeamMembership`, but says nothing about `VoidAccessGrant` rows, and
  never touched them. Consequence: a removed Organization member who once
  held a **direct** `VoidAccessGrant` (not Team-derived, so nothing about
  ending Team membership would affect it) would have silently kept full
  access to that Void forever, despite no longer being part of the
  Organization at all. **Fixed** by adding an active-Membership check to
  `getVoidRole` itself, so every downstream capability (`canAccessVoid`,
  `canEditVoid`, `canManageVoidAccess`, and by extension C8's eligibility
  check) inherits the fix in one place. This is called out explicitly
  because it's a correction to already-implemented, already-tested Phase 3
  behavior, not new Phase 4 scope — the Phase 3 tests were all still
  correct, they just hadn't exercised this specific case (no removed member
  with a stale direct grant existed in any Phase 3 test setup). Verified by
  a new dedicated test (`taskAssignment.test.ts`). The `VoidAccessGrant` row
  itself is still never deleted on member removal — D17 doesn't call for
  that, and it's now moot for access purposes since the Membership check
  denies access regardless; the stale row simply becomes inert rather than
  being cleaned up, consistent with D17's general "never destructive beyond
  ending access" pattern.
- **C8 implemented as specified — a single check, not two:** since the fix
  above means `canAccessVoid` now already implies an active Organization
  Membership, C8's "active Membership + `canAccessVoid`" eligibility rule
  collapses to just calling `canAccessVoid(targetUserId, task.voidId)` in
  `assignTask` — not two separate checks that could drift out of sync.
- **`update` vs. `move` split, matching the router table
  (`implementation-plan.md` §6):** `task.update` covers content fields
  (title/description/status/priority/dueDate/tags); `task.move` covers
  position and Group membership (x/y/groupId), including the C3 check (a
  Task's `group_id` must belong to the same Void). This anticipates Phase
  5's realtime broadcast granularity (`task.updated` vs. `task.moved` are
  documented as distinct event types, architecture.md §5) — splitting the
  procedures now means Phase 5 doesn't need to retrofit the split later.
- **Manual `task.unassign` deletes the `TaskAssignee` row; D17's removal
  path only ever flips `assignee_active` to false, never deletes.** These
  are deliberately different operations even though they touch the same
  table: a manual unassign means "this person isn't working on this,"
  nothing worth preserving; D17's flip means "this person can't act here
  anymore, but a manager should still see they once did," which is exactly
  what the `assignee_active` flag exists for per its schema comment.
  Re-assigning a User whose row was flipped inactive (by either path)
  reactivates the same row via `ON CONFLICT`, per D17's "for a manager to
  later reassign."
- **Comment permissions (ID3) implemented literally, not re-derived from
  current Void role:** the comment author may edit/delete their own comment
  regardless of their _current_ Void-level role (ID3 doesn't condition it on
  current role, only authorship) — still gated by `canAccessVoid` so someone
  who has lost all Void access entirely cannot act through this path either.
  A Void Manager may additionally delete (not edit) any comment. **Flagged
  as an assumption**, same status as Phase 2/3's similar notes.
- **New assumption: adding a comment requires Editor+ (`canEditVoid`), not
  just Viewer.** D13/D15 never carve out commenting as a separate,
  lower-privilege action from "editing a Task," so the literal tier
  definitions were applied as-is. **Flagged as an assumption open to
  revisit** — plenty of real tools let Viewers/commenters participate
  without edit rights; if that's the intended product behavior here, it's a
  small, explicit follow-up (a `canCommentOnVoid` capability), not a silent
  widening of `canEditVoid`.
- **@mention parsing deferred to Phase 7, not half-built now.** The
  implementation plan mentions comment `@mention` parsing "feeds
  notifications," but Notifications don't exist until Phase 7, and — more
  fundamentally — `User` has no `@handle`/username field at all (only
  email), so there is no defined mention syntax to parse against yet.
  Building a parser with no consumer and no settled syntax would be
  speculative complexity; `Comment.body` is plain text for now, and mention
  parsing is deferred to whichever point in Phase 7 actually builds
  Notifications and settles that syntax.
- **Tests:** C8's eligibility invariant (both the rejection and the success
  path, with the resulting `assignees` activity entry); the D17/C8
  interaction end-to-end (removing a member flips assignments to inactive
  across every Task in the Organization, never deletes them, leaves other
  Task data untouched); the authorization-gap fix above, tested directly;
  the C3 invariant for `Task.group_id` on both `create` and `move`; ID4's
  exact tracked-field set (confirmed `title`/`description`/`tags` changes
  do _not_ produce activity rows); ID5's full duplicate-semantics list,
  including confirming activity history is _not_ copied; ID3's comment
  permission matrix (author, non-author, Manager); and `requireCapability`
  wiring for `taskRouter` over the real tRPC wire protocol, including the
  cross-Void checklist-item isolation case. 107 tests total in the server
  package, all passing; typecheck/lint/format clean across the workspace.

## Phase 5 Execution Notes (2026-09-16)

Phase 5 (Realtime Layer — `implementation-plan.md` §2/§7) is complete: a
self-hosted WebSocket layer (`@fastify/websocket`, D51) at `/ws`,
channel-per-Void, session-cookie handshake auth (D34), event-driven
permission eviction (ID10), and the "mutate → broadcast" wrapper
(`realtime/broadcast.ts`) called from every mutating `voidRouter`/
`groupRouter`/`taskRouter` procedure. No canvas/frontend yet — this is
backend-only, verified via simulated WebSocket connections
(`@fastify/websocket`'s `injectWS`, the WS equivalent of `app.inject()`).

- **New capability/event: `emitUserAccessChanged`, broader than ID10's
  literal `VoidAccessGrant`-only wording.** ID10 describes eviction as
  triggered by "any procedure that changes a `VoidAccessGrant`." But Phase
  4 already changed `getVoidRole` to also depend on the acting User's
  Organization Membership status (the authorization-gap fix from Phase 4's
  notes above) — meaning member removal (D17) can _also_ revoke a User's
  access to any number of Voids at once, purely by ending their Membership,
  with no `VoidAccessGrant` row touched at all. Restricting eviction
  triggers to literal grant changes would leave that path silently
  un-evicted, reintroducing the same class of bug Phase 4 just fixed for
  the non-realtime case. `organizationRouter.removeMember` now calls
  `emitUserAccessChanged(userId)`, which re-checks every live subscription
  that User currently holds (scanning connections rather than trying to
  enumerate affected Voids ahead of time) — verified by a dedicated test.
- **ID1's deletion exception is intentionally excluded from the
  authorization-engine's non-caching principle here — not a new decision,
  a clarification.** `void.delete` broadcasts `void.deleted` and then
  triggers the same `emitVoidAccessChanged` eviction path (§6.2) as a grant
  revocation would; the eviction re-check itself (`canAccessVoid`) is
  unaffected by ID1 (an Org Admin/Owner still can't _access_ a deleted
  Void's content, they just retain the separate `canDeleteVoid` authority
  that let them delete it in the first place).
- **Broadcast payloads are the full Task/Group row after a mutation** (not
  a diff or just an ID) — simplest correct approach at MVP client-count/
  object-count scale (D59); a client can always just replace its local copy
  of that object. `task.assign`/`task.unassign` — which D32 doesn't list as
  their own broadcast event — are treated as `task.updated` (re-fetching
  and broadcasting the Task row), since an assignee-list change is a change
  to the Task, and inventing a new event type not in D32's list wasn't
  necessary.
- **Two real bugs found and fixed while building this phase's tests, both
  now permanent fixes, not workarounds:**
  1. **A message-listener race in the WebSocket handler itself.** The
     handler originally did the session/auth check (a real DB round-trip)
     _before_ registering the `message` event listener. A client message
     sent immediately after connecting could arrive and fire before that
     listener existed, and — since Node's `EventEmitter` never buffers
     events for listeners that don't exist yet — would be silently dropped
     forever with no error on either side. Fixed by registering `message`/
     `close`/`error` listeners synchronously, before any `await`, and
     queuing messages that arrive before the async auth check resolves,
     flushing the queue once it does.
  2. **The same class of race, one level up, in the test suite itself
     (`test/helpers/ws.ts`), not application code.** A broadcast is sent
     synchronously _inside_ a mutation's request handler, well before that
     mutation's HTTP response round-trips back to the caller — so a test
     that does `await someMutation.mutate(...)` and only afterward calls
     `waitForMessage(ws)` can lose the message the same way: it already
     fired on a socket with no listener attached at that moment. Fixed by
     having the test helper buffer every message (and the close event) from
     the moment a connection is opened, so `waitForMessage`/`waitForClose`
     can never miss something that already arrived — replacing a fragile
     single-shot `.once()` wait with a small per-connection queue, entirely
     inside the test helper (no test file needed to change).
     Both were caught by directly instrumenting the eviction path with error
     logging and cross-referencing server-side logs (which showed the
     eviction succeeding) against the client-side test (which reported a
     timeout) — the discrepancy was the tell.
- **`app.ready()` must be awaited before using `injectWS` in tests.**
  `injectWS` dispatches its simulated upgrade directly against the
  underlying HTTP server, bypassing the readiness handling `app.inject()`
  performs internally for ordinary HTTP requests — without an explicit
  `await app.ready()`, the very first WebSocket connection in a test file
  can race plugin/route registration. Not needed for the tRPC-only test
  files, since `app.inject()` already handles this itself.
- **WS-specific security additions, not explicitly called for by any single
  decision but directly required by principles already established:**
  Origin-header validation on the `/ws` upgrade (extracted from `csrf.ts`
  into a shared `isAllowedOrigin` helper) — the existing CSRF hook
  intentionally skips GET requests, and a WS upgrade _is_ a GET, so without
  this the WS route would have had no Origin check at all, undermining the
  "no cross-origin surface" reasoning ID9 relies on. Close codes in the
  4000-4999 application-defined range distinguish origin-rejected (4003)
  from unauthenticated (4001) for any future client-side handling.
- **Tests:** the D32 milestone (two independently-subscribed clients see
  each other's Task/Group mutations live); D33 last-write-wins ordering
  under concurrent writes, confirmed via the broadcast `version` field and
  the final persisted state agreeing; the ID10 eviction mechanism from all
  three trigger paths (grant revocation, Void deletion, member removal);
  §6.2's void.deleted-then-evict ordering; WS auth/Origin rejection; and
  subscribe-time authorization (`FORBIDDEN` for a Void the caller can't
  access, verified to not actually subscribe them). 116 tests total in the
  server package, all passing; typecheck/lint/format clean across the
  workspace.

## Phase 6 Kickoff Notes (2026-09-16)

**Conflict surfaced and resolved before implementation started:** Phase 6's
exit criteria (`implementation-plan.md` §2) call for the Playwright
critical-path E2E test to cover D60's full 10-step journey — including
"invite member" — and state that this journey "becomes runnable end-to-end
for the first time in this phase, since it needs real UI." But D16 restricts
MVP org-joining to **email invitations only**, and the email-invitation
flow (create/revoke/accept, acceptance UI) is explicitly Phase 7 scope.
There is no `organization.addMember`-style procedure at all yet — the only
way a second user joins an Organization today is a direct `db.insert` in
backend test helpers. Phase 6 as written could not satisfy its own stated
test requirement without pulling forward Phase-7 backend/UI scope.

**Resolution (user decision):** the Phase 6 Playwright test seeds the second
member's `Membership` directly via a backend test helper (the same pattern
already used in the Phase 5 realtime integration tests), and drives every
other step of the journey — signup, org creation, Team creation, Void
creation, Group creation, Task creation, assignment, authorized access,
unauthorized denial — through real UI. The "invite" step will be re-driven
through real UI once Phase 7 ships the invitation flow, replacing the seed
step at that time; this is tracked as a follow-up, not closed out. No
backend scope is pulled forward from Phase 7, and D16 is not weakened by
inventing an interim non-invitation join mechanism.

**Implementation choices made at Phase 6 start (frontend has no prior
precedent to follow, per `implementation-plan.md` §12's "[Open] — Phase 6
implementation start" note on state-management library):**

- **State management:** **Zustand** — matches the plan's own suggested
  shape ("a small reactive store... one store per open Void, fed by tRPC
  hydration + WebSocket events") with less boilerplate than raw
  `useSyncExternalStore`, no React Context re-render fan-out concerns for a
  store that updates at pan/drag frequency.
- **Routing:** `react-router-dom` — the de facto standard, no project-
  specific reason to hand-rolled one.
- **Spatial index:** grid-bucket (per D59/architecture.md §6's own
  recommendation over a quadtree at MVP's ~1,000–2,000-object target),
  bucket size 512 world-units, keyed by `floor(x/512),floor(y/512)`;
  re-bucketed on every position write, queried by the camera's visible
  bucket range plus a 1-bucket margin on every frame the viewport moves.
- **Camera persistence (D31):** a new minimal `void_cameras` table
  (`voidId`, `userId`, `x`, `y`, `zoom`, `updatedAt`, composite PK
  `(voidId, userId)`) plus `void.getCamera`/`void.saveCamera` procedures.
  This is a narrow, planned backend addition — `implementation-plan.md` §2
  lists "camera state persisted per-Void-per-User (debounced)" as a literal
  Phase 6 deliverable, not a pulled-forward feature — distinct in kind from
  the invitation-flow conflict above.
- **Visual design pass:** per the plan's explicit call-out that no
  design-system tokens were decided during discovery, a minimal token set
  (light UI chrome for auth/org/team screens, dark canvas workspace — the
  common convention for spatial/whiteboard tools, chosen for contrast and
  focus on content over chrome) is defined as CSS custom properties rather
  than adopting a component library, consistent with "avoid framework
  complexity that doesn't materially help" (D47's rationale, applied here).

## Phase 6 Execution Notes (2026-09-16)

**Built:** the full React frontend — auth (signup/login/2FA), an app shell
with Organization/Team/Void CRUD screens, and the canvas itself: a
pan/zoom/WASD viewport (D54), a client-side grid-bucket spatial index
driving virtualization (D59), Task/Group render components with drag and
(for Groups) corner-handle resize, click/shift-click/shift-drag selection,
Delete-key removal, same-Void Task copy/paste (D56), tablet pinch-zoom
(D57), a WebSocket-backed store implementing the reconnect/resync protocol
(architecture.md §6.1 — hydration only ever happens in response to a
"subscribed" ack, whether that's the first connection or a reconnect, so
there is exactly one hydration code path), and a Task detail side panel
(status/priority/due date/tags/assignees/checklist/comments). State
management: **Zustand**. Routing: **react-router-dom**. Full rationale for
both, plus the camera-persistence schema addition and the visual-design
approach, recorded in "Phase 6 Kickoff Notes" above.

**Backend gaps found and filled while wiring the frontend to the existing
API surface** (each narrow, each necessary for basic screens to function at
all, none pulled-forward Phase 7 scope):

- No procedure existed for "which Organizations do I belong to" —
  `organization.listMine` added (`listOrganizationsForUser` in
  `memberships.ts`), ungated, scoped to the caller by construction (same
  reasoning as the existing `void.list`).
- No procedure existed for "list Teams in this Organization" despite the
  domain function (`listTeamsForOrganization`) already existing since
  Phase 2 — `team.list` added, gated to any active Organization member
  (narrower than `canManageTeam`, which governs mutating a specific Team).
- **A real correctness bug, not just a missing query:** the Task-assignment
  UI's eligible-assignee resolution initially only considered _direct_
  `VoidAccessGrant` rows. But D14 means a Void's access is very commonly
  granted to a _Team_ rather than to individual Users — the exact case
  exercised by creating a Void "for" a Team. Under the original logic, a
  Manager could never assign a Task to anyone whose access came solely
  through Team membership, which is the common path. Fixed by additionally
  resolving each Team-grant's members via `team.listMembers` and unioning
  their `userId`s into the eligible set (`TaskDetailPanel.tsx`) — this also
  incidentally supplied the only source of email addresses available to
  that panel, used to show human-readable names instead of raw UUIDs
  wherever resolvable.
- **D31's per-Void-per-User camera persistence had no backend at all** — a
  new `void_cameras` table (composite PK `(void_id, user_id)`) plus
  `void.getCamera`/`void.saveCamera` procedures, gated by mere `canAccessVoid`
  (reading/writing your own viewport position isn't a Void-content
  mutation). This was an explicitly planned Phase 6 deliverable
  (`implementation-plan.md` §2), not a discovered gap, but is listed here
  for completeness of what shipped.

**Known limitation, tracked, not fixed this phase:** there is still no way
for a second real person to join an Organization outside of a direct DB
insert — email invitations are Phase 7. The Members panel and the
"invite" step of the critical-path E2E test both work against the real
procedures already, so no rework is needed once Phase 7 ships; see "Phase 6
Kickoff Notes" above for the full resolution. Relatedly, adding someone to
a Team currently requires the actor to also be able to call
`organization.listMembers` (Owner/Admin-gated) to populate the picker — a
Team Lead who isn't an Org Admin sees an explicit message instead of a
silently-empty dropdown, rather than a fabricated workaround.

**Testing:**

- Two new backend integration tests (`voidRouter.test.ts`'s camera-isolation
  test, `organizationRouter.test.ts`'s and `teamRouter.test.ts`'s `listMine`/
  `list` coverage) — 119 server tests total, all passing.
- The D60 critical-path Playwright E2E test
  (`packages/web/e2e/critical-path.spec.ts`) — signup → org → Team → Void
  (Team-associated, exercising D14's default grant) → Group → Task →
  assign → authorized access (a second real browser session, second real
  account, editing the Task live and having that edit observed by the first
  session over the WebSocket) → unauthorized denial (a third account with
  no Organization membership at all, rejected at WebSocket-subscribe time
  with the FORBIDDEN path). Runs against the real Fastify server and Vite
  dev server via Playwright's `webServer` config. The "invite" step is
  seeded through the same backend-test-helper pattern the vitest suite
  already uses (`db`/`pool`/`resetOrgTables`/`resetAuthTables`, deep-imported
  from `@void/server`'s source with an explicit `dotenv` load since the test
  runner's own process cwd isn't `packages/server`) — documented inline in
  the spec file, not just here.
- Manual verification in a real browser (Playwright, headed) beyond the
  automated E2E test: drag-to-move persisting across a page reload (proving
  both the mutation and the camera-debounce/task-position round-trip work,
  not just that the UI updates optimistically), two simultaneous browser
  tabs on the same Void observing each other's Group/Task creation live,
  and shift-drag multi-select + Delete-key removal.
- Full workspace `typecheck`/`lint`/`format:check` clean; 119/119 server
  tests and 1/1 E2E test passing at time of writing.

## Phase 7 Execution Notes (2026-09-16)

**Built:** all five Phase 7 slices (`implementation-plan.md` §2) — email
invitations (D16: create/revoke/accept, invite-acceptance UI at
`/invite/accept?token=`, login/signup redirect-back so an unauthenticated
visitor doesn't lose the token), global search (D43: `pg_trgm`-backed,
authorization-scoped, jump-to-object camera navigation), My Tasks (D44:
cross-Void, sortable/filterable, click-to-navigate), in-app notifications
(D39/D40: task-assigned, mentioned, invited, role-changed, polled bell +
inbox), the admin surface (member list/roles and Team management already
existed from Phase 6; this phase added pending-invitation management and an
Organization rename form), and account/session-management UI (session list,
revoke, revoke-all-others, 2FA enroll/disable — `auth.disable2FA` is new,
password-reconfirmed since disabling 2FA is a security downgrade, not an
ordinary settings change).

**@mention syntax, settled (resolves the Phase 4 deferral):** `docs/decisions.md`'s
Phase 4 notes explicitly deferred `@mention` parsing because `User` has no
`@handle`, only email, and there was no settled syntax to parse against. Now
that Notifications exist to consume it, the syntax is: `@` immediately
followed by the mentioned person's full email address
(`domains/task/comments.ts`'s `parseMentionedEmails`). A mention only
produces a notification for a User who both has an account and currently
has access to the Task's Void — mirrors C8's assignment-eligibility
principle, so a comment can't be used to probe for or notify unrelated
accounts. Known UX limitation, not fixed this phase: typing a full email
inline is clunky compared to an `@`-triggered picker with autocomplete;
flagged as a V1 improvement, not built speculatively now.

**A real bug found and fixed during manual verification, not just a
missing feature:** the notification bell is rendered globally (in
`AppShell`, outside any `:orgId` route), so a `task_assigned`/`mentioned`
notification's target Void's Organization wasn't available from the URL at
click time. The first implementation tried to scrape `orgId` out of
`window.location.pathname`, which silently did nothing (no navigation, no
error) whenever the bell was opened from a page with no `:orgId` segment —
reproduced live via Playwright (clicking a notification from `/orgs` did
nothing). Fixed at the source instead of patching the symptom:
`assignTask` and `addComment`'s mention path now resolve the Task's Void
or fetch it via `findVoidById` and include `organizationId` directly in the
notification payload, so the bell can always build a correct link. The
URL-scraping fallback was deleted entirely rather than kept as a fallback.

**A pre-existing minor over-exposure fixed while touching this exact code
path:** `listActiveSessions` (`domains/auth/sessions.ts`, Phase 1) used
`db.select()` with no column list, so `auth.listSessions` was returning
every session row — including `token_hash` — directly to the client. Not
practically exploitable (SHA-256 of a 256-bit random value), but there is
no reason a hash of a live session credential should ever leave the server,
and this phase is what first builds a UI that actually renders this data.
Fixed to select only the columns the client needs.

**Testing:** 19 new integration tests across five new test files
(`invitation.test.ts`, `invitationRouter.test.ts`, `notification.test.ts`,
`search.test.ts`, plus a `listMine` case added to `taskRouter.test.ts`) —
invitation create/re-invite-supersedes/already-member-rejection/accept
(matching-account success, mismatched-account rejection, expired,
already-consumed, revoked)/revoke-cross-org-isolation; notification
generation for all three mutation-triggered event types plus
markRead/markAllRead ownership checks; search's authorization-scoping (a
result from an inaccessible Void must never appear — direct test, not just
"matching results are found") and blank-query safety; My Tasks losing Void
access removing a Task from the list even though the assignment row itself
is untouched. 138 server tests total, all passing. Manual verification in a
real browser (Playwright, headed) beyond the automated suite: the full
invite → accept → Team-derived Void access → assign → notification-click →
My Tasks chain end-to-end across two real browser contexts/accounts, plus
the account page's session list and 2FA-enrollment UI rendering. The
existing Phase 6 critical-path E2E test was re-run and still passes
unmodified. Full workspace `typecheck`/`lint`/`format:check` clean.

## Phase 8 Execution Notes (2026-09-16)

**Security review pass (weighted highest per D60):**

- **Cross-referenced all 19 Non-negotiable decisions (`project-context.md`
  §16) against existing test coverage.** Most were already covered by
  Phases 2–7 (C1 Org-Admin-bypass regression, C3 cross-Organization
  invariants, C7 concurrent-ownership-transfer, C8 assignment-eligibility,
  D33 last-write-wins ordering, ID10 WebSocket live-permission re-check,
  ID16 soft-delete, D15/§14's search-authorization principle). Found and
  closed three real gaps rather than just re-confirming what already
  existed:
  - **Tenant isolation (#1/#17) had no direct regression test** for two of
    the three cross-Void listing paths — `listAccessibleVoids` and
    `team.list` were correct in implementation (each query is already
    parameterized by `organization_id`) but had no test proving a User
    who belongs to two Organizations, with access to a Void/Team in each,
    never sees the other Organization's data when querying one
    specifically. Added to `void.test.ts` and `teamRouter.test.ts`. (My
    Tasks and search inherit this same correctness from
    `listAccessibleVoids` internally, so fixing/testing it there covers
    both.)
  - **ID13's reconnect-with-a-since-revoked-session case was untested.**
    `realtime.test.ts` had "no session at all" (close 4001) but not "had a
    valid session, it was revoked (e.g. logout), a stale cookie is then
    used to reconnect" — the exact wording of ID13's requirement. The
    underlying mechanism (`validateSession` checks `revoked_at`) was
    already correct; added the missing regression test.
  - **`invitation.create` had no rate limit**, unlike every other
    email-sending procedure (`signup`, `requestMagicLink`,
    `requestPasswordReset` — routers/auth.ts). An Org Admin/Owner account
    could otherwise mass-email arbitrary addresses with no bound. Added
    `checkRateLimit`, keyed by actor (authenticated, unlike the public
    auth endpoints keyed by IP), 30/hour — generous for real onboarding,
    bounded against abuse. `invitation.accept`'s token itself is
    unchanged/unlimited by design, consistent with `resetPassword`/
    `verifyMagicLink`'s existing precedent: a 256-bit random token isn't
    brute-forceable regardless of rate limiting, so only the
    email-sending "request" endpoints need the limit, not the high-entropy
    "consume" endpoints.
- **Dependency audit (`pnpm audit`):** 8 advisories found. **Fixed:**
  `drizzle-orm` (0.36.4 → 0.45.2+, high severity — SQL injection via
  improperly escaped SQL identifiers). This is a direct production
  runtime dependency, unlike the other 7 advisories. Audited our own usage
  first: every `sql\`...\``call site in the codebase references static
schema column objects or literals, never a user-controlled string used
as a table/column identifier, so the specific vulnerable pattern wasn't
actually reachable — upgraded anyway since it's cheap insurance and a
direct dependency. Verified with the full test suite (142/142 passing
after the upgrade) and`drizzle-kit generate`reporting "No schema
changes" (confirms no migration drift from the version bump). **Deferred,
documented, not silently ignored:** the remaining 7 advisories (1
critical — Vitest's UI-server arbitrary-file-read; the rest
moderate/high in`vite`/`esbuild`/`@vitest/mocker`, all reached only
through `vitest`'s or `drizzle-kit`'s own transitive dependency trees)
are **dev-tooling-only** — never bundled into the deployed server or
client — and the Vitest UI-server vulnerability specifically requires
the `--ui` flag, which nothing in this project's scripts uses. Fixing
  them requires a 2-major-version Vitest bump (2.1 → 4.x) with real
  breaking-change risk to the entire test suite/config for a
  vulnerability class with no actual exposure here; treated as a tracked
  V1/pre-deployment follow-up rather than an MVP-blocking fix, not a
  silent skip.

**WCAG 2.1 AA audit (non-canvas surfaces + task-detail UI, per D58) —
computed actual contrast ratios (WCAG's relative-luminance formula) rather
than eyeballing the palette, and found three real token-level failures:**

- `--color-accent` (#6366f1) as white-button-fill text was 4.47:1 (needs
  4.5:1) and as link/text-on-light-background was ~4.3:1 — both fixed by
  routing text/button-fill usage through the already-existing (previously
  half-unused) `--color-accent-hover` token instead, which clears both
  comfortably (6.29:1 and 6.02:1 respectively). `--color-accent` itself is
  now documented as decorative/UI-boundary-only (focus rings, canvas
  selection), not for text.
- `--color-border-strong` (input/select borders — a UI-component boundary
  WCAG 1.4.11 holds to a 3:1 threshold) was 1.42:1. Darkened to `#8b8b93`
  (3.24–3.38:1).
- Confirmed the dark canvas-surface palette (used by the Task-detail
  panel, itself an explicit AA target per D58 even though it's rendered
  as a canvas overlay) independently passes: 14.06:1/6.32:1 for
  text/muted-text — no change needed there.
- **A real interaction-accessibility bug, not just contrast:** every
  clickable list row across the app (`Card` with an `onClick` — org list,
  Void list, My Tasks list) was a plain `<div onClick>`, invisible to
  keyboard and screen-reader users (WCAG 2.1.1/4.1.2). Fixed at the
  component level — `Card` now adds `role="button"`, `tabIndex`, and
  Enter/Space activation automatically whenever it's given an `onClick`,
  so every current and future call site is covered without each one
  having to remember to do it individually.
- Added missing accessible names (`aria-label`) to icon/placeholder-only
  controls that relied on visual-only cues: the Task-detail panel's
  title/description/due-date/tags/priority fields, checklist add-item and
  delete-item controls, the comment input, and the org member
  role-`<select>`. Placeholder text was the only "label" several of these
  had — not a reliable accessible name per WCAG 4.1.2, since it disappears
  on input and isn't announced consistently across assistive tech.
- Added `role="alert"` to every form's error-message paragraph (8 sites
  across 6 files, all following the same pattern) so validation/mutation
  failures are actually announced to screen-reader users, and
  `role="status"`/`aria-live="polite"` to the shared full-page loading
  indicator.

**Performance validation against D59's ~1,000–2,000-object target — the
first point in the project this was measured against a real
implementation rather than assumed:** seeded 1,500 Tasks scattered across
a 20,000-world-unit-wide Void (bypassing HTTP, directly through the domain
layer, in 619ms) and drove a real browser against it. Results: initial
hydration-to-first-render in 849ms; only 20 of 1,500 `task-card` DOM nodes
actually mounted at the initial camera position (confirming the
grid-bucket spatial index is doing its job — render cost tracks
_visible area_, not total object count); node count grew proportionally
and boundedly through 2 seconds of continuous WASD panning (24 nodes) and
a 15-tick zoom-out (448 nodes, still well under the full 1,500 even at a
much wider visible area); a 20-step drag gesture completed in 387ms
(~19ms/step, no multi-second stalls). This is a practical validation of
"virtualization keeps render cost bounded," not a precise frame-by-frame
FPS instrument — Playwright doesn't expose one directly, and building a
dedicated performance-measurement harness wasn't judged worth the
investment for an MVP-scale target already this comfortably cleared.

**Test-suite review against D60's stated priorities:** 142 server tests
(6 new: 3 targeted tenant-isolation/session-reconnect regression tests
plus a rate-limit test), 1 Playwright E2E critical-path test — re-run
and confirmed still passing after every change in this phase, including
the `drizzle-orm` upgrade and every UI edit. Coverage remains weighted
authorization-first per D60, consistent with every prior phase. Full
workspace `typecheck`/`lint`/`format:check` clean.

**Milestone reached:** MVP is feature-complete (`project-context.md` §17
is fully implemented and reachable through the UI, Phases 0–8 complete),
tested, and validated against its own stated performance/accessibility/
security targets.

## Post-Phase-8 Fix: CI Pipeline Was Missing Two Steps (2026-09-16)

Found while answering a direct "what's left" question, not during the
phase's own execution — worth recording separately since it's a real,
previously-unverified defect rather than part of Phase 8's planned work.
`.github/workflows/ci.yml` ran `pnpm test` against a freshly-created,
never-migrated `void_test` Postgres service container — every integration
test would have failed with "relation does not exist" on an actual CI run.
Nothing in this engagement had exercised real GitHub Actions before this
point; every verification throughout Phases 0–8 was against the local
`void_dev` database, which already had migrations applied from normal
development, so this had never surfaced. Separately, CI never ran the
Playwright critical-path E2E test built in Phase 6 at all.

**Fixed:** added a `pnpm db:migrate` step before `Test`, and a Playwright
install + `pnpm --filter @void/web test:e2e` step after it, plus a
trace-upload-on-failure step so a CI failure is debuggable without
reproducing locally. **Verified, not just written:** created a genuinely
fresh, never-migrated local Postgres database (`void_ci_sim`, dropped
afterward) to simulate CI's ephemeral service container exactly, ran
`pnpm db:migrate` then `pnpm test` against it with CI's own env vars
(`DATABASE_URL`/`SESSION_SECRET`, no `.env` file involved) — confirmed the
migration creates all 20 tables from empty and the full 142-test suite
passes. The E2E step itself was not re-simulated against the CI-only
database (would have meant spawning dev servers against it from a local
shell, with real risk of port/env conflicts with actual local dev state,
for a step whose command has already been run successfully dozens of times
this engagement against a comparably fresh, migrated database) — judged
sufficient given the migration step, which was the actual broken
mechanism, is now proven.

## Post-Launch Refinement Pass (2026-09-16)

A large, single-pass refinement requested after the MVP was live on Railway
and used for real: a polished visual/motion system for auth and canvas
surfaces, spatial double-click-to-create replacing toolbar buttons, proper
Tags and a 6-level Priority scale, human-identity display everywhere
(username + visible name, not raw email/UUID), a searchable assignee
picker, a less punitive breached-password UX, and a real (previously
dormant) email-verification flow. Phone verification was requested, then
explicitly withdrawn during clarification — out of scope entirely, and
confirmed to require no code removal since the shipped MVP had none.
Planned via three research/validation agent passes against the live code
and this document before any implementation began; approved by the user
with two clarifications, both recorded below.

**Priority: 4-level enum replaced by a 6-level scale, single source of
truth.** `low|medium|high|urgent` → `lowest|low|medium|high|highest|
first_priority`, ordered exactly in that sequence (`first_priority` is a
deliberate top "drop everything" tier _above_ `highest`, not a synonym for
it — encoded as `packages/shared/src/index.ts`'s `taskPriorityRank`). The
value list, its display labels, and its rank now live in one place
(`@void/shared`'s `taskPriorityValues`/`taskPriorityLabels`/
`taskPriorityRank`), imported by `schema.ts`, `routers/task.ts`, and every
frontend priority display — previously three independently hardcoded
copies that could (and eventually would) drift. `tasks.priority` is a
plain `text` column with no DB-level enum/CHECK constraint (Drizzle's
`{ enum: [...] }` is TypeScript-only metadata) — the value-list change
therefore produced no schema diff; the only real migration was a
hand-authored data remap (`UPDATE tasks SET priority='highest' WHERE
priority='urgent'`), since `low`/`medium`/`high` were already valid
strings in the new set.

**Tags: new Organization-scoped entity, not Void-scoped.** Reusable across
every Void in an Organization rather than duplicated per-Void. New `tags`
table (`organizationId`, `name`, unique per-org case-insensitively via
`lower(name)`) plus `task_tags`/`group_tags` join tables, replacing the old
free-text `tasks.tags` text[] column (migrated: existing free-text values
deduped case-insensitively into `tags` rows, attributed to each Task's own
`createdBy`, then the column dropped — three separate migrations, kept as
deliberate checkpoints rather than combined). **Authorization: no new
capability.** Tag creation/assignment is gated by the same Editor+
capability already used for the Task/Group being tagged
(`canEditVoidForTask`/`canEditVoidForGroup`) — sound because `canEditVoid`
already structurally requires active Organization membership
(`getVoidRole` resolves the Void's Organization and calls
`getActiveMembership` before returning any role), so Editor-on-a-Void
already implies valid standing in that Void's Organization. **Explicit
invariant, confirmed with the user during review and enforced in code:** a
Tag's existence never grants access to anything — it is a plain
Organization-scoped data row, not an access-control mechanism (Non-
negotiable #4 is unaffected). The tRPC procedures resolve `organizationId`
server-side from `taskId`/`groupId` only, never accept it as direct client
input (mirrors the existing child-resource-capability-wrapper rule), and
`assignTagsToTask`/`assignTagsToGroup` enforce app-layer that a Tag's
`organizationId` matches the Task/Group's own — a Task in Organization A
can never be tagged with a Tag belonging to Organization B. Tags are
accepted as plain name strings (`tagNames: string[]`, full-replace
semantics matching the old column) via `task.update`/`group.update`,
find-or-created inline server-side — no separate `tag.create` endpoint;
`tag.list` is the only Tag procedure exposed at all, and it's read-only.
`duplicateTask` (ID5) now copies a Task's `task_tags` associations onto the
copy (same Tag ids — Tags are shared vocabulary, duplication must never
create new Tag rows), not the removed text[] column.

**Identity: `username` + `visibleName` added to `User`, `email` no longer
the only identity signal.** `username` is a stable, globally-unique,
lowercase-normalized (matching the existing `email` convention — a plain
`unique()` index on the already-normalized value, not a functional index)
mention/search/lookup identifier, set at registration and not editable in
this pass. `visibleName` is the human-readable display name, freely
editable via `auth.updateVisibleName`. Existing rows (the handful of test
accounts from Railway deploy verification — no real users predate this)
were backfilled from their email local-part, normalized to the username
pattern (`[a-z0-9_]{3,20}`) and de-duplicated with a numeric suffix
_before_ the follow-up migration added the `NOT NULL`/`unique` constraints
— a naive one-line "use the local part" would have produced values
violating the very constraint being added. A brand-new account created via
magic-link (which collects no username/visibleName at all) gets one
auto-generated the same way (`generateUsernameFromEmail`), editable
afterward from Account settings. **New shared identity-resolution utility**
(`getUsersDisplayInfo`, `domains/auth/users.ts`) replaces what used to be
ad hoc, per-caller email lookups scattered across `TaskDetailPanel`,
`MembersPanel`, and comment/notification display — including a real
pre-existing gap where a User with only a direct (non-Team) Void grant had
no email available to display at all and rendered as a truncated UUID.
**New `void.listEligibleMembers`** (authorization-scoped exactly like
`listAccessibleVoids` — never returns a user without current access to the
specific Void queried) unifies direct + Team-derived access into one
deduped, server-side-searchable list, powering the new searchable assignee
picker ("Search members…" → "Alex Johnson (@alex)") that replaces every
raw-ID/email assignment dropdown.

**Comment `@mentions` switched from `@`+email to `@`+username.** The old
D39 syntax predated `username` existing at all (`User` had no handle of
any kind). `parseMentionedEmails` → `parseMentionedUsernames`, resolved via
`findUserByUsername`; same non-disclosure semantics as before (a mention
only notifies a User who has an account _and_ currently has access to the
Task's Void).

**Breached-password UX: warn-and-override, not hard rejection.** `signup`/
`resetPassword` gained an `acknowledgeBreach` flag. The length floor
(12 chars) remains never overridable — only the HIBP breach check has an
override path, and it is a real server-validated override, not a
client-asserted one: `checkPasswordPolicy` (`domains/auth/password.ts`)
calls `isPasswordBreached()` **unconditionally on every submission**
regardless of the flag's value; the flag only decides what happens with an
already-computed result, and never short-circuits the check itself — an
explicit, tested invariant (`test/integration/auth.test.ts`: the mocked
HIBP call is asserted to fire exactly once per submission, including the
acknowledged one). A breach-without-acknowledgement is signaled via a
distinct TRPCError code (`PRECONDITION_FAILED`, vs. `BAD_REQUEST` for the
un-overridable length violation) rather than message-string matching —
there was no existing precedent in this codebase for the frontend
distinguishing tRPC error types (`LoginPage`/`SignupPage` previously just
rendered `err.message` verbatim), so a structural code was used instead of
inventing a fragile convention. The frontend shows the breach explicitly
(never silently rejects) with an "Use anyway" button that resubmits with
the flag set.

**Email verification: frontend built for an already-existing but dormant
backend, confirmed non-blocking by design — this supersedes D19's
"required verification" wording.** The `email_verification` AuthToken
flow and `verifyEmail` procedure existed since Phase 1 but had zero
frontend consumer and were never actually enforced anywhere — login has
never read `emailVerifiedAt`, and `SignupPage` has always auto-logged-in
immediately after signup regardless of verification status. This pass adds
what was missing (a real `VerifyEmailPage`, an `Account`-page status
badge + persistent non-blocking indicator, and a rate-limited
`resendVerificationEmail` procedure reusing `issueAuthToken`'s existing
"revoke prior pending token of the same purpose" behavior) without
changing that non-blocking behavior — per explicit user instruction during
review ("don't require a new email verification code every login" /
"unverified accounts remain usable rather than being blocked by a login
gate"). **A future reader of this document should treat email verification
as intentionally non-blocking-by-design, not merely unimplemented** — D19's
original "required" language described an intent that was never actually
built that way, and this pass makes that the confirmed, permanent
behavior rather than reopening it.

**Phone verification: explicitly out of scope, confirmed no-op.** Raised
during the initial request, then withdrawn by the user before any design
or implementation work started. Confirmed via code search that the
shipped MVP has zero phone/SMS-related code anywhere (auth is email/
password, magic-link, and TOTP only) — there was nothing to remove.

**Canvas: toolbar "+ Task"/"+ Group" buttons replaced with double-click-
anywhere-to-create.** The old buttons created objects at a fixed offset
from the camera's top-left corner, never at any position the user actually
indicated. A double-click on empty canvas background (guarded to fire only
when the event target is the background itself, not a bubbled event from a
TaskCard/GroupBox — both now `stopPropagation()` their own double-clicks)
opens a screen-positioned creation panel (captured once at the moment of
the click, like a context menu — deliberately not re-projected as the
camera pans/zooms while it's open) offering Task or Group, then an inline
form for the chosen type. On submission, the object's `x`/`y` are set to
the exact world coordinate of the original double-click. **If that point
falls inside an existing Group's rectangle, `groupId` is computed once, at
creation time only** — consistent with D38's "Group membership is always
explicit FK, never geometric, never continuously re-derived." **New
`GroupDetailPanel`** — Groups previously had no edit UI of any kind beyond
create/drag/resize (no rename, no way to view/set tags); it mirrors
`TaskDetailPanel`'s structure (page-local open-state in `CanvasPage`, same
panel-entrance motion) and reuses the rename support `group.update` already
had at the API level.

**Motion system: plain CSS, no new library.** Two reusable
animations — `void-panel-in` (right-edge slide-in, for `TaskDetailPanel`/
`GroupDetailPanel`) and `void-pop-in` (scale+fade, for the creation panel,
tag/assignee picker dropdowns, and `NotificationBell`'s dropdown) — plus
shared duration/easing tokens (`--motion-fast/base/slow`,
`--ease-standard/--ease-emphasized`) and a single global
`prefers-reduced-motion` override (`global.css`) that neutralizes every
transition/animation in the app at once, rather than each component
checking the media query individually. Deliberately not framer-motion or
any animation library — matches the project's existing stated philosophy
("No component library — plain CSS custom properties," `tokens.css`) and
its only prior precedent (one CSS transition on `Button`). Canvas pan/zoom
physics were not touched — "fluid" motion is scoped to UI-layer
transitions (panels, hover/selection states, dropdowns); the camera math
itself was already performance-validated in Phase 8 and re-litigating it
was out of scope here.

**Visual design: auth/UI-chrome stays light, canvas stays dark — not
converted into a system dark-mode toggle.** Void's existing design system
(Phase 6 Kickoff Notes) deliberately uses two fixed palettes (light UI
chrome, permanently-dark canvas workspace) rather than a light/dark toggle
tied to OS preference. This pass's "light and dark theme consistency"
requirement is interpreted, and implemented, within that existing model —
refining each palette's typography/spacing/motion coherently (a real Inter
webfont replacing the system-font stack, IBM Plex Mono for
code/credentials, a subtle dot-grid + radial-gradient auth background
echoing the canvas's own visual language) — not as a new app-wide
dark-mode architectural decision, which would contradict an established
decision rather than refine it.

**Verification:** all 152 server tests passing (10 new: 4 tag-domain
tests covering org-scoped dedup and cross-org non-sharing, 1
`listEligibleMembers` authorization-scoping test, 5 auth tests covering
username uniqueness, the breached-password unconditional-check invariant,
and `resendVerificationEmail`'s token-supersession/no-op-once-verified
behavior), full workspace `typecheck`/`lint`/`format:check` clean, the
Playwright critical-path E2E test updated for the new signup fields and
double-click creation flow and passing, and a manual pass through a real
running instance (signup including a genuine HIBP-positive breach warning
against the live API, the creation panel positioned exactly at a
double-click point, the tag/assignee pickers, the Account page's
verification status) at both desktop (1440px) and tablet (820px) widths.

**A real bug found and fixed during this pass, not present before it:**
signup's username-uniqueness check initially ran _before_ the
existing-email short-circuit, which meant a resubmission for an
already-registered email (whose deterministically-suggested username would
collide with itself) leaked account existence via a distinguishable
"username taken" `CONFLICT` error instead of the intended silent
`{ ok: true }`. Caught by the existing `notification.test.ts` mention test
(which calls `signupAndLogin` twice for the same address) failing after
the identity fields were added — fixed by reordering the two checks so the
existing-email check always runs first.

## Approved assumptions (not separately interviewed, confirmed by user at documentation handoff)

- **A1.** A Team Lead who creates a Void associated with their own Team becomes
  that Void's Manager (Void-level role, D13) by default.
- **A2.** A user who creates a private/personal Void (no Team association)
  becomes that Void's Manager by default.

These are implementation defaults the user explicitly approved when flagged
during the final consistency review — they were not put to the user as
standalone interview questions, and are labeled as assumptions accordingly,
not decisions reached through the interview process itself.
