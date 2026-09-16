# Void — Product & Functional Specification

Status: authoritative. See `project-context.md` §28 for how this document
relates to `decisions.md` and `architecture.md`. This document covers the
_what_ (product requirements, scope); `architecture.md` covers the _how_
(technical design).

Note: throughout this document, **[Recommendation]** marks an implementation
approach that was proposed during discovery and adopted as the working
default, as distinct from a hard product requirement the user stated
directly. Both are "confirmed" in the sense that the user approved them, but
recommendations are more open to revisiting if implementation reveals a
better approach, whereas explicit user requirements (identified as such) are
not.

---

## 1. Overview

**Problem:** Traditional list/table project-management tools don't convey the
organizational and relational structure of a team's work in a way people can
build spatial intuition around. Void's hypothesis is that a spatial canvas —
where teams and tasks are laid out as objects in an infinite 2D space — helps
people organize and _understand_ their work, not just track it.

**Solution:** A multi-tenant SaaS platform where each Organization creates
Voids (workspaces/projects), each rendered as an infinite pan/zoom canvas
containing Groups (spatial task clusters) and Tasks (the core work unit),
with real-time collaborative updates, backed by a proper multi-tenant RBAC
system.

**Success criteria for MVP:** the core loop — create organization → invite/
join users → create Teams → create Voids → create Groups/Tasks → assign
tasks → manage permissions → collaborate in real time through the spatial
canvas — works end-to-end, feels smooth and "alive" (per the product vision),
and is secure enough for a real company's data (proper tenant isolation,
capability-based RBAC, no invitation-token abuse vector).

**Primary stakeholders/personas (from discovery):**

- **Org Owner** — creates the Organization, holds billing/deletion authority (not exercised in MVP since billing is deferred), typically also acts as initial Admin.
- **Org Admin** — manages membership, Teams, settings; day-to-day org operator.
- **Team Lead** — manages their own Team's membership and Voids associated with that Team; no org-wide power.
- **Member** — regular contributor; permissions come entirely from Team/Void-scoped grants, not from the org role itself.
- **(V1+) Guest** — external collaborator with limited access; not modeled in MVP.

## 2. Functional Requirements by Area

### 2.1 Organizations & Teams

- A User can create an Organization; the creator becomes its Owner.
- A User can hold Memberships (with independent roles) in multiple
  Organizations simultaneously.
- Org roles: Owner, Admin, Member (fixed set for MVP).
- Teams are fully user-defined (name, no fixed taxonomy) within an
  Organization.
- A User can belong to multiple Teams within an Organization.
- A Team can have a Team Lead (or more than one — **[Open for implementation
  detail]**: whether multiple simultaneous Team Leads per Team are allowed is
  not explicitly decided; default to allowing multiple unless a reason
  emerges to restrict to one).
- Team Lead can: manage own Team's membership (add/remove), view own Team's
  membership, create/manage Voids associated with own Team.
- Team Lead cannot: manage other Teams, manage org-wide settings/members,
  manage Voids they have no grant on.

### 2.2 Voids

- A Void belongs to exactly one Organization.
- A Void may optionally have a "home" Team (`team_id`, nullable) — affects
  default visibility only, not access control.
- Void access is controlled by `VoidAccessGrant` records, each targeting
  either a Team or an individual User, with a role: Viewer, Editor, or
  Manager.
- Default visibility on creation: Team-associated → visible to that Team;
  no Team association → private to creator.
- A Void can be shared with additional Teams and/or individual Users via
  explicit grants, regardless of its home Team.
- Void Manager can manage that Void's access grants and settings; cannot
  affect any other Void or org-level settings.
- Deleting a Void: **[Open for implementation detail]** — soft-delete vs.
  hard-delete, and exact permission required (likely Void Manager or org
  Admin) was not explicitly specified during discovery; recommend soft-delete
  with restoration window, consistent with the "removal is never silently
  destructive" principle applied elsewhere (member removal, D17), but this
  should be confirmed before implementation.

### 2.3 Groups

- A Group belongs to exactly one Void.
- A Group has: name, x, y, width, height.
- Groups are flat (no nesting) in MVP.
- Groups are manually resizable/movable by users with Editor+ access to the
  Void.
- A Task's Group membership is set via `Task.group_id`, an explicit
  relationship — never inferred from the Task's canvas position relative to
  a Group's rectangle.

### 2.4 Tasks

- A Task belongs to exactly one Void; optionally belongs to one Group.
- Fields (MVP): title, description, status, priority, assignees (multiple),
  creator, due date, created_at, updated_at, tags, group_id, comments, basic
  activity history, checklist items, canvas position (x, y).
- Status: fixed set — To Do, In Progress, Done, Blocked. No custom statuses
  in MVP.
- Priority: **[Open for implementation detail]** — exact priority levels
  (e.g. Low/Medium/High/Urgent) were not explicitly enumerated during
  discovery; recommend a simple 3–4 level fixed enum, consistent with the
  fixed-status-set approach, to be confirmed at implementation time.
- Checklist items: embedded, lightweight, boolean-complete items on a Task.
  Not independent entities.
- Comments: support @mentions (referenced in notification requirements, §2.6
  below) — full comment-editing/deletion semantics **[Open for
  implementation detail]**, not explicitly specified; recommend standard
  edit/delete-own-comment permissions scoped to Void Editor+.
- Activity history: basic field-change tracking (who changed what, when) for
  key fields — exact field list **[Open for implementation detail]**,
  recommend at minimum status, assignees, priority, due date.
- Copy/paste: duplicating a Task within the same Void creates a new Task with
  a new ID; duplication must not copy over comments, activity history, or
  audit history from the original. Exact field-copy semantics (e.g. does the
  duplicate keep the same assignees? Same Group?) **[Open for implementation
  detail]** — recommend copying all direct fields (title, description,
  status→reset to default, priority, assignees, tags, group_id, checklist
  items as unchecked) except comments/history, but this needs confirmation
  before implementation.
- No task-level ACLs — permission follows the parent Void's grant.

### 2.5 Invitations & Membership

- Org Admin/Owner can invite a User by email; invitation is single-use,
  expires in ~7 days, revocable before acceptance.
- Accepting an invitation while authenticated as the invited email (or
  signing up with it) creates a Membership with the role specified in the
  invitation.
- Removing a member ends their Membership and Team memberships but does not
  delete their User account, reassign their tasks automatically, or delete
  Voids they created. Task assignments to a removed member are flagged as
  having an inactive assignee.

### 2.6 Notifications

- MVP events: assigned to a task, mentioned in a comment, invited to an
  organization, own role/permissions changed.
- Delivery: in-app inbox/bell only.
- Users should be able to mark notifications read/unread and see an unread
  count. **[Recommendation, not separately specified in discovery]** —
  standard in-app notification UX, confirm no deviation needed.

### 2.7 Search

- Search covers Task title, Task description, Group name, scoped to the
  current user's accessible Voids.
- Results never reveal existence/metadata of inaccessible objects.
- Selecting a result navigates the camera to that object's Void and
  coordinates.

### 2.8 My Tasks View

- Lists tasks assigned to the current user across all Voids they can access.
- Sortable/filterable by due date, priority, status.
- Clicking a task navigates to its position on its Void's canvas.

### 2.9 Admin

- Org Admin/Owner can: view/manage member list and roles, manage Teams,
  view/revoke pending invitations, edit basic org settings (name, etc.).
- Audit-log events are captured from day one (see `project-context.md` §15
  for the event list); no viewer UI in MVP.

### 2.10 Authentication & Account

- Sign up/sign in via email+password (verified) or magic link.
- Optional TOTP 2FA with backup codes.
- Session management UI: active sessions list, revoke individual, log out
  everywhere.
- Password reset via email; Admin-assisted recovery for locked-out members
  (confirmed, audited, non-revealing, non-impersonating).

## 3. Non-Functional Requirements

- **Multi-tenancy:** strict Organization-level data isolation on every query.
- **Security:** see `project-context.md` §22 (Argon2id hashing, revocable
  sessions, rate limiting, authorization-filtered search/realtime,
  no-static-join-code).
- **Performance:** ~60fps canvas interaction target at ~1,000–2,000 objects/
  Void (soft target, not a hard cap — see `project-context.md` §23).
- **Accessibility:** WCAG 2.1 AA on non-canvas UI; best-effort on the canvas
  itself (see `project-context.md` §9/§11).
- **Availability/reliability:** no specific SLA was set during discovery
  **[Open question]** — flag if a specific uptime target matters before
  choosing hosting infrastructure.

## 4. MVP / V1 / V2 Scope

### MVP (build first)

See `project-context.md` §17 for the full enumerated list. Summary: complete
Org/Team/Void/Group/Task model with capability-based RBAC, email-only auth
(password + magic link, optional TOTP), email-only invitations, live
WebSocket canvas sync with last-write-wins, DB-backed search, My Tasks view,
minimal admin, in-app notifications, audit-log data collection (no viewer).

### V1 (soon after MVP)

- OAuth providers (Google, Microsoft, GitHub — corrected 2026-09-16 to match
  `decisions.md` D20, which deferred all three, not just Google/Microsoft)
- Passkeys (WebAuthn)
- Scoped/expiring/revocable invite links (secondary invitation mechanism)
- Attachments (storage, size/type limits, scanning — designed properly at
  that time)
- Full per-Void List View; Calendar view
- Minimap
- Undo/redo
- Cross-Void copy/paste
- Dedicated mobile-friendly layout
- Custom/configurable task statuses
- Due-soon/overdue notification reminders (needs job scheduling)
- Dedicated audit-log viewer UI
- Org-wide enforced MFA (security setting)
- Full independent subtasks (pending the canvas-position design question)

### V2 / Future

- Enterprise SSO (SAML/OIDC/SCIM)
- Custom/user-defined organization roles
- Domain-based auto-join
- Presence/cursor-sharing collaboration
- Field-level merge or CRDT-based conflict resolution
- Nested Groups
- Task dependencies
- Recurring tasks
- Dashboard/overview view
- Billing/subscriptions/plan-gating (pricing model to be designed first)
- Public marketing site (likely a separate project)
- WebGL/PixiJS canvas rendering (only if DOM/SVG proven insufficient by
  profiling)

## 5. Open Questions

These were not resolved during the 7-round discovery interview and should be
addressed before or during the relevant implementation work — do not invent
answers silently:

1. Void deletion: soft vs. hard delete, and exact permission required (§2.2).
2. Exact Task priority levels/enum values (§2.4).
3. Comment edit/delete permission semantics (§2.4).
4. Exact activity-history field-change list (§2.4).
5. Exact Task copy/paste field-duplication semantics (§2.4).
6. Whether a Team can have multiple simultaneous Team Leads (§2.1).
7. Specific uptime/availability SLA, if any (§3).
8. Exact session lifetime durations (short default, "remember me" extended) —
   noted in discovery as "finalized at implementation/security-review time."

## 6. Future Ideas (not commitments)

See `project-context.md` §27 for the full list of ideas raised during
discovery that are not part of any committed scope tier above.
