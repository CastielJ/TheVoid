# Void — Planning Dialogue (Raw Transcript)

**Status: historical / non-authoritative.** This file preserves the raw
question-and-answer exchanges from the Phase 0 discovery interview (conducted
2026-09-15, in a single continuous session). It exists for historical
color and to let a future reader see the reasoning/back-and-forth behind a
decision, not just its final form.

**If anything in this file appears to conflict with `project-context.md`,
`decisions.md`, `spec.md`, or `architecture.md`, those four documents are
authoritative and win.** This file is the unedited process; they are the
reviewed, consistency-checked result.

**Availability note:** this transcript covers the full interview as it
occurred in the Claude Code session that produced it — Round 1 through Round
7, plus the final documentation handoff instructions. It was compiled by
copying the actual questions and the user's actual answers from that session's
conversation history; nothing here has been invented, paraphrased into a
different meaning, or reconstructed from assumption. The interview's seed
document, `Prompt.md` (the original product-vision brainstorm), is not
reproduced in this file — it already exists as its own file at the repository
root and is the starting point this whole interview was conducted against.
No dialogue prior to Round 1 (i.e., the initial reading of `Prompt.md` and
repository inspection) involved back-and-forth with the user, so there is
nothing to transcribe for that step beyond what's noted here.

---

## Round 1 — Core Hierarchy & Multi-Tenancy

**Questions asked** (condensed to the core of each — full option text with
rationale is in the original session and is reflected completely in
`decisions.md` D1–D10):

1. What is a "Void," conceptually? (workspace/container vs. canvas-per-team vs. decoupled view/session-state)
2. What's the hierarchy if Void = container? (Org→Team→Void→Group→Task rigid vs. Team dropped to a tag vs. optional Team association)
3. Is Group a separate concept from Team, or the same thing?
4. Multi-tenancy: what's the isolation boundary — Organization, or Team directly?
5. Do personal Voids exist, and whose tenant are they under?
6. Can a Void be shared across Teams within the same Organization?
7. Can Groups be nested?
8. Can a user belong to multiple Organizations?
9. Can a user belong to multiple Teams/Groups within one Organization?
10. Should Organization support fully custom, user-defined Team structure?

**User's answers (verbatim, as given):**

> Here are my decisions for Round 1.
>
> 1. **Void:** A — Void is a workspace/project/container. The spatial canvas is a view of the Void's underlying data, not the definition of the Void itself.
>
> 2. **Hierarchy:** I choose **C**, with an important clarification.
>
>    Organization → optional Team association → Void → Group → Task
>
>    However, a Team should NOT necessarily own a Void.
>
>    Teams are real organizational entities representing groups of people and access. A Void can optionally be associated with a Team, but it must also be possible for a Void to be shared across multiple Teams or individual users within the same Organization.
>
>    In other words, Teams should not be treated merely as tags, but they also should not be a mandatory parent of every Void.
>
> 3. **Team vs Group:** Yes, they are completely separate concepts.
>
>    - Team = organizational grouping of people and potentially permissions/access.
>    - Group = spatial organization of work/tasks inside a Void.
>
>    A Group may happen to be named "Red Team", but it is not the Red Team entity.
>
> 4. **Multi-tenancy:** A — Organization is the tenant boundary.
>
>    Users can belong to multiple Organizations, but Organization data must remain strictly isolated.
>
> 5. **Personal Voids:** C, with a slight priority adjustment.
>
>    Personal/private Voids can exist inside a user's Organization and should use the same underlying Void/permission model rather than creating a separate personal-workspace architecture.
>
>    However, personal Voids are not a major MVP priority unless they are cheap to support naturally through the core model.
>
> 6. **Cross-Team Voids:** A — yes.
>
>    A Void can be accessible by multiple Teams and/or individual users within the same Organization through explicit access/permissions.
>
> 7. **Nested Groups:** A — no nested Groups in MVP.
>
>    Groups are flat spatial containers inside a Void. Revisit nesting later if it proves valuable.
>
> 8. **Multiple Organizations:** Yes. One user account can belong to multiple Organizations.
>
> 9. **Multiple Teams:** Yes. A user can belong to multiple Teams within an Organization.
>
> 10. **Custom Teams:** Yes. Teams are completely user-defined and there should be no hardcoded organizational taxonomy.
>
> ### Important conceptual model
>
> Please use this as the current working model:
>
> Organization
> ├── Members
> ├── Teams
> │ ├── Red Team
> │ ├── Blue Team
> │ └── Development
> │
> └── Voids
> ├── Void A
> │ ├── Groups
> │ └── Tasks
> └── Void B
> ├── Groups
> └── Tasks
>
> A Void may optionally be associated with a Team, but its access should ultimately be controlled through explicit membership/access rules so that cross-Team collaboration is possible.
>
> Please treat all of these as confirmed decisions unless later discovery reveals a contradiction that requires us to revisit them.
>
> Continue with the next round, focusing on membership, invitations, access control, and RBAC.

---

## Round 2 — Membership, Invitations & RBAC

**Questions asked** (condensed; full text reflected in `decisions.md` D11–D18):

11. What's the org-level role set? (fixed 3-tier Owner/Admin/Member vs. +Guest vs. fully custom roles)
12. Does a Team have its own roles (e.g. Team Lead), or is membership binary?
13. Can Void access be scoped (Viewer/Editor, or a 3rd tier)?
14. Default visibility when a Void is created — private, Team-visible, or org-wide?
15. Do task permissions inherit entirely from the Void, or can tasks have their own ACLs?
16. Evaluation of the proposed static join-token idea, and recommended replacement.
17. What happens to a removed member's assignments/Voids/history?
18. Should a removed member's historical identity/references be preserved?

**User's answers (verbatim, as given):**

> Round 2 decisions:
>
> 11. **Org-level roles: A — Owner, Admin, Member.**
>
> Keep the fixed 3-tier model for MVP.
>
> - Owner: full organization control, including billing and organization deletion/transfer.
> - Admin: organization/member/team/settings management, but not Owner-only destructive/billing actions.
> - Member: no organization-management permissions by default; access comes from scoped permissions.
>
> Please implement permission checks internally against granular permissions rather than hardcoded role-name checks, so custom roles can be introduced later without redesigning the authorization system.
>
> 12. **Team-level roles: B — Team Lead.**
>
> I do want a Team Lead role because Teams are an important organizational concept in Void.
>
> However, Team Lead permissions must be strictly scoped to their Team. They should not become a mini-Admin.
>
> For MVP, Team Lead can have permissions such as:
>
> - manage membership of their own Team;
> - view Team membership;
> - create/manage Voids associated with their Team where appropriate.
>
> Do not give Team Leads organization-wide administrative permissions.
>
> 13. **Void-level roles: B — Viewer, Editor, Manager.**
>
> - Viewer: can view the Void, Groups, and Tasks.
> - Editor: can create/edit/delete Groups and Tasks within the Void.
> - Manager: everything Editor can do, plus manage the Void's access grants and Void-level settings.
>
> Void Manager must remain scoped to that Void and must not gain organization-wide administrative powers.
>
> 14. **Default visibility: B.**
>
> If a Void is created with a Team association, it is visible to that Team by default.
>
> If a Void has no Team association, it is private by default.
>
> Explicit access grants can then expand access to additional Teams or individual users.
>
> This should be implemented through the same access-control system rather than special-case permission logic.
>
> 15. **Task-level permissions: A.**
>
> Tasks inherit permissions entirely from the Void.
>
> No per-task ACLs in MVP. If you can access a Void, you can see its tasks, and your ability to modify them follows your Void-level permission.
>
> 16. **Invitation mechanism: A for MVP.**
>
> Use email invitations as the primary invitation mechanism.
>
> Each invitation should be unique, single-use, revocable, and expire after a reasonable period such as 7 days.
>
> Do NOT implement the original permanent/unlimited static organization join code.
>
> I agree that it is a security problem.
>
> The architecture should nevertheless leave room for a future secondary invitation-link mechanism with:
>
> - expiration;
> - optional use limits;
> - revocation;
> - lowest-privilege default role;
> - no ability to grant Admin/Owner through a public link.
>
> 17. **Member removal: A.**
>
> Removing a member must not automatically destroy or silently reassign their work.
>
> - Existing task assignments remain associated with the former user, but should indicate that the assignee is no longer an active member.
> - Managers can later reassign those tasks.
> - Voids they created are not deleted.
> - Team memberships are removed.
> - Existing data/history remains intact.
>
> 18. **Historical identity: Yes.**
>
> Never hard-delete a User merely because they were removed from an Organization.
>
> Keep the global User account separate from Organization Membership.
>
> Historical records such as:
>
> - created_by;
> - comments;
> - audit logs;
> - task history;
> - previous assignments
>
> should continue referencing the real User identity.
>
> This is especially important because one User can belong to multiple Organizations.
>
> ### Additional authorization principle
>
> Please make the authorization model explicit in the architecture:
>
> **Organization role → Team-scoped permissions → Void-scoped permissions**
>
> and avoid scattering role-name checks throughout the application.
>
> The underlying permission system should answer questions such as:
>
> - Can this user manage this organization?
> - Can this user manage this Team?
> - Can this user access this Void?
> - What permission level does this user have for this Void?
>
> Please continue to Round 3 with Authentication and Session Security.

---

## Round 3 — Authentication & Session Security

**Questions asked** (condensed; full text reflected in `decisions.md` D19–D29):

19. Primary sign-in method(s) — password, passwordless, or both?
20. Which OAuth providers, and MVP or later?
21. Enterprise SSO — MVP or deferred?
22. Password requirements & breach protection baseline.
23. MFA/2FA — required, optional, org-enforceable, MVP or later?
24. Passkeys (WebAuthn) — MVP, V1, or skip?
25. Session model — stateless JWT vs. server-side sessions vs. hybrid?
26. Device/session management — "log out other devices" in MVP?
27. "Remember me" semantics?
28. Account recovery when email/2FA access is lost?
29. Rate limiting/brute-force protection requirements?

**User's answers (verbatim, as given):**

> Round 3 decisions:
>
> 19. **Primary sign-in: C — both email/password and passwordless magic link.**
>
> Email + password should be the normal authentication method, with email verification required.
>
> Also support passwordless magic-link authentication.
>
> Both methods should authenticate the same underlying User account rather than creating separate account types.
>
> 20. **OAuth: A — none for MVP.**
>
> Do not add Google, Microsoft, or GitHub OAuth in MVP.
>
> OAuth can be added in V1 once the core product is validated.
>
> 21. **Enterprise SSO: defer to V1/V2.**
>
> No SAML/OIDC/SCIM implementation in MVP.
>
> 22. **Password security: use the recommended baseline.**
>
> - Minimum password length around 12 characters.
> - Do not require arbitrary complexity rules or periodic password rotation.
> - Check passwords against known breached-password databases at signup/password reset where practical.
> - Store passwords using Argon2id.
> - Never store plaintext passwords.
> - Follow current security guidance rather than inventing custom password rules.
>
> 23. **MFA: B — optional TOTP 2FA in MVP.**
>
> Users can enable TOTP-based 2FA voluntarily.
>
> Include secure backup/recovery codes when 2FA is enabled.
>
> Do not require organization-wide MFA in MVP. That can be added later as an organization security setting.
>
> 24. **Passkeys: V1.**
>
> Do not implement WebAuthn/passkeys in MVP. Keep the authentication architecture extensible enough to add them later.
>
> 25. **Session model: A — server-side sessions.**
>
> Use opaque session tokens stored in secure httpOnly cookies with server-side session records.
>
> Prioritize simple, revocable sessions over JWT complexity for MVP.
>
> Important: do not introduce Redis purely because sessions exist. A database-backed session store is acceptable for MVP. Redis can be introduced later if actual performance/scaling requirements justify it.
>
> Sessions must be revocable immediately.
>
> 26. **Device/session management: Yes, MVP.**
>
> Users should be able to:
>
> - view their active sessions/devices;
> - revoke an individual session;
> - log out of all other sessions.
>
> Track useful metadata such as browser/device, creation time, last activity, and approximate location only where appropriate and privacy-safe.
>
> 27. **Remember me/session lifetime: Yes.**
>
> Use explicit session lifetime behavior rather than an ambiguous permanent login.
>
> A reasonable initial policy is:
>
> - normal session: relatively short inactivity lifetime;
> - Remember Me: longer lifetime, e.g. around 30–60 days.
>
> Exact durations can be finalized during implementation/security review.
>
> 28. **Account recovery: B — controlled Admin-assisted recovery.**
>
> Provide normal email-based password reset.
>
> For lost 2FA access, backup codes are the primary self-service recovery mechanism.
>
> Additionally, an authorized Org Admin/Owner may initiate a controlled recovery/reset for an organization member.
>
> This action must:
>
> - be explicitly confirmed;
> - create an audit-log entry;
> - never reveal the user's password;
> - never allow the administrator to silently impersonate the user.
>
> Do not build a complicated support/identity-verification recovery system for MVP.
>
> 29. **Rate limiting: standard strong protection.**
>
> Apply rate limiting and abuse protection to authentication-sensitive endpoints, including:
>
> - login;
> - password reset;
> - magic-link requests;
> - invitation acceptance;
> - 2FA verification;
> - account recovery.
>
> Use per-IP and per-account protections where appropriate, with exponential backoff/temporary blocking for repeated failures.
>
> CAPTCHA/Turnstile-style protection can be introduced when automated abuse is detected rather than forcing it on every legitimate user.
>
> ### Additional architectural principle
>
> Keep **authentication and authorization strictly separate**.
>
> Authentication answers:
>
> "Who is this User?"
>
> Authorization answers:
>
> "What can this User do in this Organization/Team/Void?"
>
> A single User account can belong to multiple Organizations and must receive permissions independently in each Organization.
>
> Continue to Round 4: spatial canvas engine, realtime collaboration, and Task/Group data model.

---

## Round 4 — Spatial Canvas, Realtime Collaboration & Task/Group Data Model

**Questions asked** (condensed; full text reflected in `decisions.md` D30–D38):

30. Canvas rendering technology — DOM/SVG, Canvas2D/library, WebGL, or a DOM+virtualization hybrid?
31. Coordinate system & camera persistence.
32. Realtime collaboration scope for MVP — none, live object sync, or full presence?
33. Conflict resolution for simultaneous edits — last-write-wins, field-merge, or CRDT?
34. WebSocket authorization approach.
35. Which Task fields make the MVP cut?
36. Fixed vs. custom task statuses?
37. Full recursive subtasks, or a lighter checklist?
38. Group appearance/behavior — auto-sizing vs. freeform resizable, and is membership spatial or an explicit FK?

**User's answers (verbatim, as given):**

> Round 4 decisions:
>
> 30. **Canvas rendering: D — DOM/SVG objects + custom viewport/transform layer + virtualization.**
>
> Use DOM/SVG for rich interactive objects such as Tasks and Groups.
>
> The infinite canvas itself should be implemented as a viewport/coordinate system with pan/zoom transforms rather than adopting a heavyweight WebGL renderer for MVP.
>
> Use virtualization so only objects within or near the viewport are rendered.
>
> Do not introduce PixiJS/WebGL/Konva/Fabric unless later profiling demonstrates that the DOM/SVG approach has become a genuine performance bottleneck.
>
> The important principle is that Void objects are rich interactive UI elements, not just simple vector shapes.
>
> 31. **Coordinate system: accepted.**
>
> Each Void has an independent infinite coordinate space with floating-point x/y positions for objects.
>
> Each User has their own persisted per-Void camera state:
>
> - x
> - y
> - zoom
>
> Camera state is personal and is not shared between users.
>
> Object positions are shared Void data.
>
> 32. **Realtime: B — live object synchronization via WebSockets.**
>
> Realtime object synchronization is part of MVP because shared spatial state is core to the Void concept.
>
> MVP should support:
>
> - Task creation/update/movement broadcasting;
> - Group creation/update/movement broadcasting;
> - relevant edits appearing to other connected users without refresh.
>
> Do NOT include full presence/cursor sharing in MVP.
>
> No collaborative cursors, "who is viewing", typing indicators, or similar presence features yet.
>
> 33. **Conflict resolution: A — server-authoritative last-write-wins.**
>
> The server is the source of truth.
>
> For simultaneous conflicting changes, the latest accepted server write wins.
>
> Do not build CRDT infrastructure or sophisticated collaborative conflict resolution for MVP.
>
> If real usage later demonstrates that field-level merging is necessary, revisit it.
>
> 34. **WebSocket authorization: accepted.**
>
> WebSocket authentication uses the same server-side session model as normal HTTP requests.
>
> The initial socket handshake authenticates using the secure session cookie.
>
> Subscribing to a Void's realtime channel must verify the user's current Void-level permissions.
>
> Permission changes/revocations must prevent further access to that Void's realtime data rather than relying only on permissions checked at initial login.
>
> 35. **Task fields: accept the recommended MVP cut.**
>
> MVP Task fields:
>
> - title
> - description
> - status
> - priority
> - multiple assignees
> - creator
> - due date
> - created_at
> - updated_at
> - tags
> - group_id
> - comments
> - basic activity history
>
> Defer:
>
> - file attachments
> - full subtasks
> - dependencies
> - recurring tasks
>
> Do not add attachment infrastructure unless later discovery shows that attachments are genuinely essential to the initial target users.
>
> 36. **Task status: A — fixed MVP status set.**
>
> Use a simple fixed status model initially:
>
> - To Do
> - In Progress
> - Done
> - Blocked
>
> No custom status-management UI in MVP.
>
> Keep the underlying model extensible enough to support custom statuses later.
>
> 37. **Subtasks: A — lightweight checklist for MVP.**
>
> A checklist consists of simple embedded checklist items.
>
> Checklist items are NOT independent Task entities.
>
> They do not have their own:
>
> - canvas positions;
> - independent status;
> - independent assignees;
> - comments;
> - task history.
>
> Full hierarchical subtasks can be considered later.
>
> 38. **Group behavior: B — freeform resizable spatial areas.**
>
> I want Groups to contribute meaningfully to the spatial nature of Void.
>
> A Group should have its own:
>
> - x/y position;
> - width;
> - height;
> - name/title;
> - visual appearance where appropriate.
>
> Users can manually resize and move Groups.
>
> However, **Group membership must be represented explicitly in the data model**, not inferred from spatial containment.
>
> Use an explicit relationship such as:
>
> `Task.group_id → Group.id`
>
> The position of a Task relative to a Group is visual/presentational only.
>
> Being physically inside a Group's rectangle must NOT automatically change `group_id`.
>
> This is important because spatial geometry should remain presentation state while database relationships remain deterministic.
>
> Therefore:
>
> **Data model:**
> Organization → Void → Group → Task relationship via explicit foreign keys.
>
> **Canvas:**
> The canvas visualizes those relationships spatially.
>
> If Groups overlap, move, resize, or visually contain tasks, that must not implicitly mutate database relationships.
>
> ### Additional canvas principle
>
> [Note: this message was cut off mid-sentence in the live session after "Please treat" and the assistant asked the user to resend the missing portion before continuing. The user then resent the full Round 4 answer, including the completed principle below, in their next message. Both the truncated and the completed message are part of the actual session history; the completed version is reproduced here as the operative one.]
>
> Please treat the canvas as a projection of the underlying Void data rather than the source of truth.
>
> For example:
>
> - Task position is persisted data.
> - Group membership is persisted data.
> - Group dimensions are persisted data.
> - Camera position is user-specific view state.
> - Rendering merely visualizes these values.
>
> This should make the architecture much easier to reason about, test, synchronize, and eventually optimize.
>
> Continue to Round 5.

---

## Round 5 — Notifications, Files, Search, Admin & Billing

**Questions asked** (condensed; full text reflected in `decisions.md` D39–D46):

39. Which notification events make the MVP cut?
40. In-app only, or also email, for MVP delivery?
41. Push notifications — MVP or later?
42. Should the schema reserve a place for attachments even though the feature is deferred?
43. Global search — MVP or later, and what should it search?
44. Non-canvas List/Calendar/Dashboard views — any in MVP?
45. Admin dashboard scope for MVP?
46. Confirming billing is fully out of MVP.

**User's answers (verbatim, as given):**

> Round 5 decisions:
>
> 39. **Notifications: accept the recommended MVP cut.**
>
> MVP notification events:
>
> - task assigned to you;
> - mentioned in a comment;
> - invited to an organization;
> - your role/permissions changed.
>
> Defer:
>
> - due-soon/overdue reminders;
> - generic new-comment notifications;
> - task-completed notifications;
> - added/removed from group notifications.
>
> However, keep the notification/event architecture extensible so additional event types can be added later without redesigning the system.
>
> 40. **Delivery: A — in-app only for MVP.**
>
> Build an in-app notification inbox/bell.
>
> Email remains necessary for authentication and invitations, but do not build a general notification-email system yet.
>
> 41. **Push notifications: defer.**
>
> No browser/mobile push notifications in MVP.
>
> 42. **Attachments: skip entirely from MVP schema.**
>
> Do not create attachment tables or speculative attachment fields.
>
> Implement attachments as a dedicated V1 feature when we are ready to make the storage, file-type, size, scanning, and permission decisions properly.
>
> 43. **Global search: A — MVP.**
>
> Search is important because the infinite canvas creates an inherent navigation problem.
>
> MVP search should cover:
>
> - Task title;
> - Task description;
> - Group names.
>
> Search results must only include objects the current user is authorized to access.
>
> Use normal database search initially (Postgres ILIKE/trigram indexing or equivalent). Do not introduce Elasticsearch/Algolia/etc. for MVP.
>
> Selecting a result should navigate the user directly to that object's position in its Void by moving the camera to the object's persisted coordinates.
>
> 44. **Views: B — Canvas + minimal My Tasks in MVP.**
>
> The canvas remains the primary Void interface.
>
> Add a minimal cross-Void "My Tasks" view for the current user.
>
> It should show tasks assigned to the current user across accessible Voids, with basic sorting/filtering such as:
>
> - due date;
> - priority;
> - status.
>
> Clicking a task should open/navigate to that task's location on its Void canvas.
>
> Do NOT build a full general-purpose List View for every Void yet.
>
> Do NOT build Calendar/Dashboard views in MVP.
>
> 45. **Admin dashboard: accept the recommended MVP scope.**
>
> MVP Admin functionality:
>
> - organization member list;
> - member roles;
> - Team management;
> - pending invitations;
> - invitation revocation;
> - basic organization settings.
>
> Audit-log **data collection starts in MVP**, even though the dedicated audit-log viewer can be deferred to V1.
>
> Capture structured security/relevant events from day one, including things such as:
>
> - authentication/security events;
> - role changes;
> - member additions/removals;
> - Team membership changes;
> - Void access-grant changes;
> - important Void/task permission changes;
> - administrator recovery actions.
>
> The audit system should be append-oriented and should preserve historical identity.
>
> 46. **Billing: completely deferred.**
>
> No billing implementation in MVP.
>
> Specifically:
>
> - no Stripe;
> - no subscription plans;
> - no plan/feature gating;
> - no seat-limit enforcement;
> - no usage-based billing logic.
>
> All MVP functionality is available without artificial plan tiers.
>
> When billing becomes relevant, design the pricing model first and then implement it deliberately rather than retrofitting assumptions into the MVP architecture.
>
> ### Additional principle for search
>
> Search must always pass through the same authorization layer as normal Void access.
>
> A user's search results must never reveal the existence, title, description, Group name, or other metadata of a Task/Void they are not authorized to access.
>
> Continue to Round 6: technology stack, hosting, database, API architecture, and deployment.

---

## Round 6 — Technology Stack, Database, API & Deployment

**Questions asked** (condensed; full text reflected in `decisions.md` D47–D53):

47. Backend language/framework?
48. Frontend framework — React/Next.js or otherwise?
49. Database — Postgres, confirmed?
50. API style — REST, GraphQL, or tRPC?
51. Realtime transport — raw WebSockets or a managed realtime service?
52. Hosting/infrastructure constraints?
53. File/object storage preference (even though deferred)?

**User's answers (verbatim, as given):**

> For Round 6, these are my decisions:
>
> **47. Backend — TypeScript/Node.js**
>
> Choose TypeScript + Node.js.
>
> I want the shared TypeScript ecosystem between frontend and backend because the canvas, Tasks, Groups, Voids, permissions, and realtime events have complex shared data shapes.
>
> However, I want you to reconsider the specific framework combination rather than automatically choosing NestJS. Since we are leaning toward tRPC, I would prefer a relatively lightweight backend such as Fastify + tRPC if that gives us a cleaner architecture.
>
> Please evaluate this combination against NestJS and tell me if you see a strong reason to use NestJS instead. Avoid framework complexity that doesn't materially help Void.
>
> [The assistant evaluated Fastify+tRPC against NestJS in response and recommended Fastify+tRPC — see `decisions.md` D47 for the full reasoning. The user confirmed this recommendation in their Round 7 message, reproduced below.]
>
> **48. Frontend — React + Vite + TypeScript**
>
> Choose React + Vite + TypeScript.
>
> The authenticated Void application is primarily a highly interactive client-side application, so I don't see a strong reason to introduce Next.js/SSR for the core product.
>
> If we eventually build a public marketing site, that can be considered separately.
>
> **49. Database — PostgreSQL**
>
> Confirmed: PostgreSQL.
>
> Use it as the primary relational source of truth for the application.
>
> **50. API — tRPC**
>
> Choose tRPC, assuming the final backend architecture remains TypeScript.
>
> The main reason is end-to-end type safety between the React frontend and backend without maintaining duplicated API contracts or code generation.
>
> I do not currently need a public third-party API, so REST's external API advantages aren't important enough to outweigh the simplicity/type safety of tRPC.
>
> Please make sure the API structure remains modular and doesn't turn into one giant collection of procedures.
>
> **51. Realtime — self-hosted WebSockets**
>
> Confirmed.
>
> Use our own WebSocket layer as part of the backend rather than introducing Pusher, Ably, Supabase Realtime, etc.
>
> Keep the authorization rules we already established:
>
> - authenticate using the existing server-side session;
> - re-check Void permissions when subscribing to a Void;
> - permission revocation must stop further realtime access;
> - server is authoritative;
> - last-write-wins;
> - no CRDT;
> - no cursors/presence/typing indicators in MVP.
>
> **52. Hosting/infrastructure**
>
> Leave this open for now.
>
> I don't have an existing cloud-provider requirement that should dictate the architecture.
>
> When we reach implementation planning, recommend the simplest reliable production setup for this architecture. I do NOT want Kubernetes or unnecessary infrastructure for MVP.
>
> **53. File/object storage**
>
> Defer completely.
>
> Attachments are not part of MVP, so don't introduce storage infrastructure or attachment abstractions just because we might need them later.
>
> We can properly design storage when attachments become a V1 requirement.
>
> ---
>
> ### IMPORTANT ADDITION — FINAL PLANNING HANDOFF
>
> [The user's full instructions for the `docs/` handoff package — including the required file list, the complete 30-point outline for `project-context.md`, the "Non-negotiable / established decisions" requirement, the "raw planning conversation" requirement for this file, and the "source-of-truth rule" — were given at this point in the session. These instructions are what produced the `docs/` package itself (this file included), and are reflected in full in how that package was structured — see `project-context.md` §28 and this file's own header. They are not re-transcribed a second time here since they are the reason this document exists in its current form.]
>
> Continue to Round 7 after recording these decisions.

---

## Round 6 follow-up — Fastify vs. NestJS evaluation

The assistant evaluated the two options as the user requested (full text in
the session; summarized findings recorded in `decisions.md` D47): NestJS's
DI/module/decorator structure mainly benefits large teams needing enforced
conventions, and integrates less naturally with tRPC (designed to sit
directly on a lightweight HTTP server) and with direct control over the
WebSocket upgrade/auth handshake. Fastify + tRPC was recommended instead,
with module boundaries enforced via folder structure and code review rather
than a DI framework. The user confirmed this recommendation at the start of
their Round 7 answer (see below, "Q47 — Backend").

---

## Round 7 — Canvas Interaction, Performance, Testing, Final MVP Lock-In

**Questions asked** (condensed; full text reflected in `decisions.md` D54–D62):

54. WASD + mouse navigation — both simultaneously, or one as a power-user mode?
55. Minimap — MVP or deferred?
56. Full keyboard shortcuts / multi-select / copy-paste / undo-redo — all in MVP, or a subset?
57. Mobile/touch — MVP requirement, or desktop-only for now?
58. Accessibility — what standard should MVP meet?
59. Performance targets — concrete numbers, or reasonable defaults?
60. Testing strategy — what's the actual bar for MVP?
61. Monitoring/logging — what's needed on day one?
62. Final consolidated MVP scope confirmation (a full list was presented for sign-off).

**User's answers (verbatim, as given):**

> Yes. Confirmed.
>
> ### Q47 — Backend
>
> Confirmed:
>
> **TypeScript + Fastify + tRPC**
>
> Use Fastify as the lightweight HTTP server, tRPC as the typed API layer, and TypeScript throughout.
>
> Keep the backend modular through clear domain boundaries and composed tRPC routers rather than introducing unnecessary framework abstractions.
>
> The architecture should remain compatible with the WebSocket layer we already decided on.
>
> ---
>
> ### Q54 — WASD + mouse navigation
>
> Confirmed:
>
> **Both always available. No mode switching.**
>
> - Mouse/trackpad drag-to-pan
> - Scroll/pinch-to-zoom
> - WASD moves the camera while the canvas is focused
> - WASD must not interfere with text inputs, textareas, selects, or other interactive controls
>
> ---
>
> ### Q55 — Minimap
>
> Confirmed:
>
> **Defer minimap to V1.**
>
> MVP should instead have:
>
> - search;
> - My Tasks navigation;
> - a zoom-to-fit/all-objects capability where practical.
>
> Do not build a minimap just because it might eventually be useful.
>
> ---
>
> ### Q56 — Keyboard interaction
>
> Confirmed:
>
> ### MVP
>
> - click-drag selection box / multi-select;
> - Delete key for selected objects;
> - basic copy/paste for Tasks within the same Void.
>
> ### V1+
>
> - undo/redo;
> - cross-Void copy/paste;
> - large customizable keyboard-shortcut system;
> - more advanced canvas editing operations.
>
> For copy/paste, make sure duplicated Tasks receive new IDs and do not incorrectly duplicate historical activity/comments/audit history. Define the exact duplication semantics in the implementation specification.
>
> The important point is that **undo/redo is explicitly not an MVP requirement** because of the realtime synchronization complexity.
>
> ---
>
> ### Q57 — Mobile/touch
>
> Confirmed:
>
> **Desktop/laptop is the primary MVP experience.**
>
> Tablet should have basic usable touch support for:
>
> - pan;
> - pinch-to-zoom;
> - interacting with the canvas.
>
> No dedicated phone-optimized layout is required for MVP.
>
> A genuinely good mobile experience can be a V1 feature.
>
> ---
>
> ### Q58 — Accessibility
>
> Confirmed:
>
> Target **WCAG 2.1 AA for normal/non-canvas UI surfaces** in MVP.
>
> This includes:
>
> - authentication;
> - forms;
> - dialogs/modals;
> - task detail UI;
> - organization/team administration;
> - My Tasks;
> - navigation;
> - sufficient color contrast in both themes;
> - keyboard navigation where applicable;
> - semantic HTML/ARIA where appropriate.
>
> For the spatial canvas itself, full screen-reader spatial navigation is not an MVP requirement.
>
> However, don't make the canvas completely inaccessible. Where practical, use the DOM/SVG architecture to provide sensible keyboard/focus behavior and accessible labels. My Tasks and task-detail interfaces should provide an alternate non-spatial way to access important task information.
>
> ---
>
> ### Q59 — Performance
>
> Confirmed with one clarification:
>
> Target approximately **60 FPS during normal pan/zoom/interactions around 1,000–2,000 rendered/active objects in a Void**, using virtualization and spatial indexing.
>
> However, **1,000–2,000 is a performance target, not an artificial database/product limit.**
>
> Do NOT encode a rule saying users must split a Void after reaching some object count.
>
> The data model should support larger Voids.
>
> For MVP, we simply don't promise that extremely large Voids will perform at the same level.
>
> If profiling later shows that DOM/SVG becomes the bottleneck, we can optimize or reconsider the rendering architecture based on actual measurements rather than prematurely adopting WebGL/Pixi/etc.
>
> ---
>
> ### Q60 — Testing
>
> Confirmed.
>
> Testing should prioritize correctness and security over superficial coverage.
>
> MVP should include:
>
> **Unit tests**
>
> - authorization/capability resolution;
> - organization/team/Void permission boundaries;
> - access grants;
> - important security-sensitive business logic.
>
> **Integration tests**
>
> - tRPC procedures;
> - authentication flows;
> - organization creation;
> - invitations;
> - membership;
> - Void access;
> - task/group CRUD;
> - permission enforcement;
> - important realtime authorization behavior where practical.
>
> **E2E tests**
> Use Playwright for critical user journeys, such as:
>
> 1. signup/login;
> 2. create organization;
> 3. invite member;
> 4. create Team;
> 5. create Void;
> 6. create Group;
> 7. create Task;
> 8. assign Task;
> 9. another authorized user accesses/edits it;
> 10. unauthorized user cannot access it.
>
> Do not attempt to cover every possible canvas interaction with brittle E2E tests.
>
> Authorization testing is particularly important because a permission bug is potentially a security incident.
>
> ---
>
> ### Q61 — Monitoring/logging
>
> Confirmed.
>
> From the beginning, use:
>
> - structured application logging;
> - request/error logging appropriate for Fastify;
> - production error tracking.
>
> Something like Pino for structured logging and Sentry or an equivalent service for error tracking is reasonable.
>
> Full observability/metrics infrastructure can wait until actual production scale justifies it.
>
> Do not introduce Kubernetes, distributed tracing infrastructure, complex metrics systems, or other operational complexity merely for the sake of having it.
>
> ---
>
> # Q62 — MVP Lock-In
>
> Yes, the consolidated MVP list matches my mental model.
>
> I do not want to add more major features to MVP at this point.
>
> The MVP should remain focused on the core idea:
>
> **Organizations → Teams → Voids → spatial Groups → Tasks**, with secure permissions, realtime collaboration, and a genuinely useful spatial workspace.
>
> The following are explicitly outside MVP:
>
> - OAuth;
> - SSO/SAML/OIDC/SCIM;
> - passkeys;
> - push notifications;
> - general notification emails;
> - attachments;
> - billing/subscriptions;
> - plan gating;
> - seat limits;
> - usage billing;
> - minimap;
> - undo/redo;
> - cross-Void copy/paste;
> - full List View;
> - Calendar;
> - Dashboard;
> - custom task statuses;
> - task-level ACLs;
> - nested Groups;
> - task dependencies;
> - recurring tasks;
> - full subtasks;
> - advanced mobile UI;
> - advanced canvas accessibility;
> - presence/cursors/typing indicators;
> - CRDT-based collaboration;
> - dedicated search infrastructure;
> - unnecessary enterprise infrastructure.
>
> The MVP should not grow further unless a newly discovered requirement is genuinely necessary for the core product to work.
>
> ---
>
> # Final planning phase
>
> After recording these decisions, I consider the **discovery/interview phase complete**.
>
> [The remainder of this message consisted of the user's detailed instructions
> for producing the final `docs/` package — the five-file structure, the full
> requirements for `project-context.md` (including the 30-point outline, the
> "Non-negotiable / Established Decisions" section, the "Explicitly Deferred"
> section, and the "Source of Truth / Change Process" section), the
> requirement for a final consistency review across all documents before
> presenting them, the requirement to explicitly distinguish confirmed
> decisions from recommendations/open questions/future ideas, and the
> explicit instruction not to begin implementation after the documents are
> created. These instructions are fully reflected in how this `docs/` package
> was actually built — see `project-context.md` §28 in particular — and are
> not repeated a second time verbatim here since the package itself is the
> record of having followed them.]

---

## Final handoff instructions (given after the assistant's consistency-review summary and updated plan)

The user approved the assistant's plan to write the `docs/` package after a
brief plan-mode exchange, with these additional, explicit instructions
(verbatim):

> Approved. Proceed with the documentation phase exactly as planned.
>
> The discovery phase is complete. Do not open another discovery round unless your consistency review finds a genuine contradiction that cannot be resolved from the existing decisions.
>
> The two implicit gaps you identified are approved as documented assumptions:
>
> 1. When a Team Lead creates a Void associated with their own Team, they become that Void's Manager by default.
> 2. When a user creates a private/personal Void with no Team association, they become that Void's Manager by default.
>
> Keep these explicitly labeled as assumptions rather than pretending they were separately decided during the interview.
>
> Please now create the five files under `docs/` and perform the cross-document consistency review described in your plan.
>
> One additional requirement for `planning-dialogue.md`:
>
> Preserve the actual planning dialogue that is available to you. Do not invent, reconstruct, or fabricate missing portions of the transcript. If some earlier dialogue is not technically available to your current session, state that clearly in the file rather than creating a false "full transcript."
>
> Remember that `planning-dialogue.md` is historical/non-authoritative. The cleaned documentation is the source of truth.
>
> Do not write any application code, install dependencies, scaffold the project, or begin implementation.
>
> After the five documents are written and cross-checked, present them to me with a concise final planning summary and wait for my explicit approval before doing anything related to implementation.

This instruction is what directly produced this file (and its "Availability
note" at the top, and this closing section, in compliance with the
instruction not to fabricate any portion of the transcript that wasn't
actually available).

---

---

## Post-Discovery Documentation Review (2026-09-16)

After the initial five-document `docs/` package was produced and presented,
the user reviewed it and requested corrections. Their message is reproduced
here in full as it is part of the actual planning dialogue, not a new
discovery round:

> I reviewed the final documentation package across `decisions.md`, `project-context.md`, `spec.md`, and `architecture.md`.
>
> Overall the planning is strong and I do NOT want another discovery round. However, I found several implementation/security consistency issues that should be corrected in the documentation before implementation begins.
>
> Please update the affected documents and then run the consistency check again.
>
> ### 1. IMPORTANT — Org Admin must not automatically bypass Void access control
>
> `architecture.md` currently says:
>
> - Organization Owner → full access
> - Organization Admin → full access
>
> This is too broad and was not explicitly decided.
>
> Our confirmed decisions give Owner/Admin organization-level management capabilities, but we did not decide that Org Admin automatically sees every private/cross-team Void.
>
> Do NOT silently make Admin equivalent to "access every Void."
>
> Instead, structure authorization around explicit capabilities, for example:
>
> - `canManageOrganization`
> - `canManageTeam`
> - `canCreateVoidForTeam`
> - `canAccessVoid`
> - `canEditVoid`
> - `canManageVoidAccess`
>
> Org-level administrative capabilities must not automatically imply unrestricted Void access unless a specific capability explicitly grants it.
>
> Preserve the principle that Void access is controlled through `VoidAccessGrant`.
>
> Please update the authorization-resolution section accordingly.
>
> ### 2. Fix the tenant-isolation wording
>
> `project-context.md` currently says every tenant-scoped table carries `organization_id`, while the proposed schema uses parent relationships for some entities such as Group → Void and Task → Void.
>
> This is fine architecturally, but the documentation must match the schema.
>
> Use language equivalent to:
>
> > Every tenant-scoped record must have an unambiguous Organization ownership path, either directly through `organization_id` or through a mandatory tenant-owned parent relationship such as `void_id` or `team_id`. Every query must enforce this ownership boundary.
>
> Do not add redundant `organization_id` columns simply to make the sentence literally true unless there is a concrete architectural reason.
>
> ### 3. Strengthen same-tenant/same-parent integrity
>
> The proposed schema needs explicit integrity requirements for relationships that must never cross boundaries.
>
> Document and, where practical, enforce:
>
> - `Task.group_id`, when non-null, must reference a Group belonging to the same Void as the Task.
> - `Void.team_id`, when non-null, must reference a Team belonging to the same Organization as the Void.
> - `VoidAccessGrant.team_id` / `user_id` must belong to the same Organization as the Void.
> - `TeamMembership` users must belong to the Team's Organization.
> - Cross-Organization references must never be valid.
>
> Prefer database constraints where practical for invariants such as same-Void relationships, with application-level authorization/validation as an additional layer.
>
> ### 4. Authentication token storage is missing from the proposed schema
>
> MVP requires:
>
> - magic links;
> - email verification;
> - password reset;
> - related short-lived recovery/verification flows.
>
> The schema currently has no explicit token mechanism for these.
>
> Add an appropriate authentication-token design to `architecture.md` (for example a purpose-specific token table or equivalent abstraction).
>
> Requirements:
>
> - cryptographically random tokens;
> - only hashed token material stored server-side;
> - purpose-specific;
> - expiring;
> - single-use where appropriate;
> - revocable where appropriate;
> - never plaintext persistence.
>
> Do not invent unnecessary complexity; just make the missing security mechanism explicit so implementation does not improvise it later.
>
> ### 5. Fix the "no unresolved decisions" wording
>
> `spec.md` correctly lists some still-open implementation details, while `project-context.md` currently says there are no unresolved decisions.
>
> Change the context wording to:
>
> > No unresolved decisions were identified that block MVP implementation planning.
>
> Keep the actual open questions visible.
>
> Do not pretend that things such as ORM choice, deletion semantics, exact priorities, session durations, CSRF mechanism, WebSocket eviction mechanism, and hosting have already been decided.
>
> ### 6. Restore GitHub OAuth to V1 scope
>
> D20 explicitly deferred Google/Microsoft/GitHub OAuth.
>
> `spec.md` currently lists only Google/Microsoft in V1.
>
> Add GitHub so the scope matches `decisions.md`.
>
> ### 7. Organization ownership invariant
>
> The proposed schema contains both:
>
> - `Organization.owner_user_id`
> - `Membership.role = owner`
>
> Either:
>
> A. keep both, but explicitly document the invariant that `owner_user_id` must always correspond to exactly one active Organization Membership with role `owner`, including ownership-transfer transaction behavior;
>
> or
>
> B. remove `owner_user_id` and derive ownership from Membership.
>
> Choose whichever is architecturally cleaner, but do not leave two independent sources of truth.
>
> My preference is to avoid duplicated ownership state unless there is a strong reason to retain it.
>
> ### 8. Clarify Task assignment eligibility
>
> We decided that former members may remain as inactive historical assignees.
>
> Please also define the positive rule for active assignments.
>
> Recommended default:
>
> > An active Task assignment must target a User belonging to the same Organization and eligible to participate in the relevant Void. Former Organization members may remain attached only as inactive historical assignees.
>
> Do not invent a completely new permission model; document this as an implementation invariant consistent with the existing Organization/Void security model.
>
> ---
>
> After making these corrections, re-run the consistency review across:
>
> `decisions.md`
> `project-context.md`
> `spec.md`
> `architecture.md`
>
> Do not begin implementation or dependency installation yet.
>
> Then give me a concise report of:
>
> 1. what was corrected;
> 2. any remaining genuinely open implementation questions;
> 3. confirmation that the four documents are internally consistent;
> 4. confirmation that planning/specification is still complete and implementation has not begun.

The assistant applied all eight corrections directly to `architecture.md`,
`project-context.md`, `spec.md`, and `decisions.md` (recorded in
`decisions.md` under "Post-Discovery Documentation Review Corrections
(2026-09-16)", items C1–C8), chose option B for item 7 (removed
`Organization.owner_user_id`, derived ownership from `Membership`) per the
user's stated preference, and re-ran the cross-document consistency review —
see the assistant's summary message following this transcript entry in the
live session for the outcome.

---

_End of transcript. See `project-context.md` for the authoritative summary,
`decisions.md` for the structured decision log this transcript was distilled
into, and `spec.md` / `architecture.md` for the product and technical
specifications derived from it._
