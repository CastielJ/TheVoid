# Project: Void

I want to build a web application called **Void**.

Void is a beautiful, modern, spatial task-management and team-management platform designed primarily for companies and organized teams.

The core idea is that instead of using a traditional list/table-based project-management interface, each workspace exists inside an **infinite 2D space ("Void")** that users can pan, zoom, and interact with. Tasks and groups are represented as objects inside this space.

I want you to help me plan this project properly before writing code.

## IMPORTANT: Planning First

Do **NOT** immediately start implementing anything.

Your first job is to deeply analyze this concept and interview me about it.

I intentionally know that I have forgotten many requirements. Ask me **a lot of questions** about anything that could affect architecture, UX, permissions, security, database design, scalability, and functionality.

For every important question:

1. Explain why the question matters.
2. Give me 2–5 reasonable options.
3. Recommend the option you think is best for Void and explain why.
4. If there is a standard/best-practice solution, tell me what it is.
5. Point out potential problems with my original idea when necessary.

Do not blindly agree with my decisions. If something is likely to cause security, UX, scalability, or architectural problems, tell me directly.

Group the questions into logical categories so the discussion is manageable.

---

# 1. Product Vision

The main concept:

Void is a task/project management application where users interact with an infinite canvas.

The canvas should feel like a beautiful, almost limitless digital space.

Possible visual concept:

- White/light theme and dark theme.
- Infinite canvas.
- Smooth zooming.
- Smooth panning.
- WASD movement.
- Mouse interaction.
- Subtle visual points/grid/particles/background elements to make the space feel alive.
- Minimalistic and premium-looking UI.
- Tasks and groups positioned inside the space.
- The interface should feel more like navigating a "world" than browsing a conventional project-management website.

A user should be able to interact with the canvas, for example:

- Double-click an empty area → create something.
- Create a task.
- Create a group.
- Move objects around.
- Zoom in/out.
- Pan around the world.
- Open tasks.
- Assign tasks to one or multiple users.
- Potentially connect/group tasks visually.

However, I am open to changing this interaction model if you believe another UX would be significantly better.

Ask me questions about:

- Canvas behavior.
- Object types.
- Task creation.
- Group creation.
- Navigation.
- Zoom levels.
- Minimap.
- Search.
- Filtering.
- Selection.
- Multi-selection.
- Dragging.
- Context menus.
- Keyboard shortcuts.
- Mobile/touch behavior.
- Accessibility.
- Animations.
- Visual style.
- Performance with hundreds/thousands of objects.

---

# 2. Void / Workspace Structure

I currently imagine the hierarchy roughly like:

Company/Organization
→ Team
→ Void(s)
→ Groups
→ Tasks

But I am not certain this is the correct architecture.

For example, a cybersecurity organization could have:

Organization:

- Cybersecurity

Teams/groups could include:

- Red Team
- Blue Team
- SOC
- Developers
- etc.

Another company could have completely different names and structures.

Users should be able to create their own organizational structure rather than being restricted to predefined team names.

I want you to challenge this hierarchy.

Determine whether we should have concepts such as:

- Organizations
- Teams
- Departments
- Projects
- Voids
- Groups
- Tasks
- Subtasks
- Milestones
- Views
- Folders
- Personal Voids
- Shared Voids

Ask me what the correct relationship between these objects should be.

In particular, determine whether a "Void" should be:

- A project
- A workspace
- A canvas/view
- A container
- Or something else.

Recommend the cleanest conceptual model.

---

# 3. Teams and Organizations

A company/team can create a Void environment.

The person who creates the organization/team should become its initial owner/administrator.

I currently imagine that an organization can have multiple teams/groups.

Example:

Company
└── Cybersecurity
├── Red Team
├── Blue Team
├── SOC
└── Security Development

But I want the system to be flexible.

Users should be assignable to one or multiple groups if appropriate.

Ask questions about:

- Can users belong to multiple teams?
- Can users belong to multiple groups?
- Can groups contain subgroups?
- Can groups have their own Voids?
- Can a user access multiple Voids?
- Can a Void belong to multiple groups?
- Can users create their own private Voids?
- Can users share Voids?
- Can a company have multiple independent teams?
- Can one user belong to multiple organizations?

Recommend the best model.

---

# 4. Team Joining / Invitation System

One idea I currently have:

When a team/organization is created, it receives a **Token**.

The token can be used by users to join the team.

Example:

A manager creates:

"Cybersecurity Team"

Void generates:

`ABC-XYZ-123`

A user enters the token and joins the team.

However, I am not sure whether this is secure enough.

I want you to evaluate alternatives such as:

- Invite links
- Invite codes
- One-time invitation tokens
- Permanent team codes
- Email invitations
- Admin approval
- QR codes
- Domain-based invitations
- Combination of these

Please recommend a secure and convenient approach.

Important:

Do not assume that a permanent join token is safe. Analyze possible abuse such as someone leaking the token publicly.

---

# 5. Authentication

I want authentication to feel extremely polished and comfortable.

The login/signup experience should be appropriate for:

- Team Leads
- Managers
- Regular employees
- Other roles

I want you to ask me about:

- Email/password.
- Google login.
- Microsoft login.
- GitHub login.
- Passkeys.
- 2FA/MFA.
- Password reset.
- Email verification.
- Session management.
- Device management.
- Remember me.
- SSO.
- Enterprise SSO.
- OAuth.
- Account recovery.

Recommend what should exist in the MVP versus later versions.

---

# 6. Roles and Permissions

This is extremely important.

I currently imagine something like:

Owner
→ Managers
→ Regular Users

The person who creates the team should have the highest level of control.

They should be able to:

- Create groups.
- Rename groups.
- Delete groups.
- Assign users to groups.
- Remove users from groups.
- Create Voids.
- Manage Voids.
- Assign tasks.
- Reassign tasks.
- Deassign users.
- Promote other users to managers.
- Remove manager privileges.

Managers should have a configurable subset of these permissions.

Regular users should have normal task access.

However, I want you to design a proper RBAC/permission system rather than hardcoding these assumptions.

Consider:

- Organization Owner
- Admin
- Manager
- Team Lead
- Member
- Guest
- Custom roles

Potential permissions:

- Manage organization
- Manage users
- Invite users
- Remove users
- Manage roles
- Manage groups
- Create Void
- Delete Void
- Edit Void
- View Void
- Create task
- Edit task
- Delete task
- Assign task
- Reassign task
- Complete task
- Comment
- Upload files
- Manage integrations
- View audit logs

Ask me which permissions should exist and recommend a scalable system.

---

# 7. Tasks

Tasks are one of the core features.

A task could exist visually as an object on the Void canvas.

A task should potentially contain:

- Title
- Description
- Status
- Priority
- Assignee(s)
- Creator
- Due date
- Creation date
- Updated date
- Tags
- Group
- Attachments
- Comments
- Subtasks
- Activity history
- Dependencies

I want you to ask me about:

- Task states.
- Custom statuses.
- Priorities.
- Multiple assignees.
- Task ownership.
- Recurring tasks.
- Dependencies.
- Subtasks.
- Checklists.
- Deadlines.
- Notifications.
- Comments.
- Mentions.
- Attachments.
- Task history.
- Archiving.
- Deletion.
- Restoration.

Also determine which features belong in the MVP.

---

# 8. Groups

Groups should visually organize tasks inside the Void.

For example:

[RED TEAM]

```
Task A
Task B
Task C
```

[BLUE TEAM]

```
Task D
Task E
```

But I don't necessarily want groups to behave like traditional folders.

They may be spatial objects on the canvas.

Ask me how groups should work and recommend a good UX.

Consider:

- Resizable group areas.
- Colored boundaries.
- Group titles.
- Nested groups.
- Collapsing groups.
- Moving groups.
- Locking groups.
- Permissions per group.
- Group-specific Voids.
- Group-specific task visibility.

---

# 9. Spatial Canvas UX

This is the defining feature of Void.

I want the application to feel extremely smooth.

Think about interfaces inspired by things like:

- Figma
- Miro
- FigJam
- Excalidraw
- modern spatial operating systems

But Void should have its own identity.

Ask me about:

- Canvas engine.
- Zoom behavior.
- Pan behavior.
- WASD navigation.
- Mouse navigation.
- Touchpad navigation.
- Object snapping.
- Grid.
- Background dots.
- Infinite coordinates.
- Object scaling.
- Selection boxes.
- Multi-select.
- Copy/paste.
- Undo/redo.
- Keyboard shortcuts.
- Context menus.
- Connections/arrows.
- Task grouping.
- Layers.
- Z-index.
- Locked objects.
- Viewport persistence.

Also investigate technical approaches for implementing an efficient infinite canvas.

---

# 10. Collaboration

I want Void to eventually support multiple users working together.

Ask me about:

- Real-time task updates.
- Real-time canvas movement.
- Multiple users viewing the same Void.
- Presence indicators.
- Cursor sharing.
- Live editing.
- Conflict resolution.
- WebSockets.
- Offline behavior.
- Optimistic updates.
- Version history.

Determine what is necessary for MVP and what should come later.

---

# 11. Notifications

Ask me what notifications should exist.

Potential examples:

- Task assigned to you.
- Task reassigned.
- Task due soon.
- Task overdue.
- Mentioned in comment.
- Added to group.
- Removed from group.
- Invited to team.
- Role changed.
- New comment.
- Task completed.

Consider:

- In-app notifications.
- Email.
- Push notifications.
- Notification preferences.

---

# 12. Search and Navigation

An infinite canvas could become difficult to navigate.

This needs serious consideration.

Ask me about:

- Global search.
- Search tasks.
- Search users.
- Search groups.
- Search Voids.
- Jump-to-object.
- Recent objects.
- Favorites.
- Bookmarks.
- Minimap.
- Breadcrumbs.
- Navigation history.
- Filters.

Recommend how users should quickly find something even when the canvas contains thousands of objects.

---

# 13. Security

Treat this as a real company product, not a toy project.

Ask about:

- Authentication security.
- Authorization.
- RBAC.
- Session security.
- CSRF.
- XSS.
- SQL injection.
- Rate limiting.
- Invitation-token abuse.
- Brute force protection.
- File upload security.
- API security.
- WebSocket authorization.
- Tenant isolation.
- Audit logs.
- Data deletion.
- Backups.
- Encryption.
- Secrets management.

Especially analyze **multi-tenant security**.

One company's data must never be accessible to another company.

---

# 14. Audit Logs

For a company product, I suspect audit logs will be important.

Consider recording events such as:

- User joined organization.
- User removed.
- Role changed.
- Task created.
- Task deleted.
- Task reassigned.
- Group created.
- Group deleted.
- Void created.
- Permission changed.

Ask me which actions should be auditable.

---

# 15. Files and Attachments

Tasks may eventually contain:

- Images
- PDFs
- Documents
- Screenshots
- Other files

Ask about:

- Maximum file sizes.
- Allowed file types.
- Storage provider.
- Virus scanning.
- Permissions.
- File previews.
- File deletion.
- Storage quotas.

---

# 16. Billing / SaaS

Void is intended to potentially become a real SaaS product for companies.

Ask me about:

- Free plan.
- Pro plan.
- Business plan.
- Enterprise.
- Per-user pricing.
- Per-organization pricing.
- Storage limits.
- Number of Voids.
- Number of users.
- Feature limits.
- Trial periods.
- Billing provider.

Do not assume billing must be part of the MVP.

Recommend when it should be introduced.

---

# 17. Admin Dashboard

I expect some kind of administrative interface.

Ask me what admins should be able to see/manage:

- Users
- Teams
- Groups
- Voids
- Roles
- Invitations
- Audit logs
- Usage
- Storage
- Billing
- Security settings

Recommend a clean admin architecture.

---

# 18. UI / Design

Void should feel **premium, minimal, modern, and beautiful**.

The canvas should be the visual centerpiece.

I want:

- Light mode.
- Dark mode.
- Excellent typography.
- Smooth animations.
- Subtle effects.
- Clean cards/panels.
- Minimal clutter.
- Responsive UI.
- Professional company-product appearance.

However, do not sacrifice usability for aesthetics.

Ask me about:

- Color palette.
- Typography.
- Border radius.
- Shadows.
- Glass effects.
- Animations.
- Background effects.
- Task appearance.
- Group appearance.
- Sidebar.
- Top navigation.
- Settings.
- Modal/dialog design.

You may recommend a visual design system.

---

# 19. Technology Stack

I have not necessarily finalized the technology stack.

Before deciding, ask me about:

- Frontend framework.
- Backend.
- Database.
- Authentication provider.
- Canvas/rendering technology.
- Hosting.
- Storage.
- Realtime infrastructure.
- Caching.
- Search.
- Email.
- Monitoring.

Consider technologies such as:

- React / Next.js
- TypeScript
- PostgreSQL
- Redis
- WebSockets
- WebRTC where appropriate
- Canvas
- SVG
- WebGL
- libraries such as React Flow, PixiJS, Konva, Fabric.js, etc.

Do not blindly select these.

Evaluate what is technically appropriate for Void.

Explain important tradeoffs.

---

# 20. Architecture

After gathering requirements, design the architecture.

I want you to consider:

- Frontend architecture.
- Backend architecture.
- Database schema.
- API design.
- Authentication architecture.
- Authorization architecture.
- Realtime architecture.
- Canvas state management.
- File storage.
- Notification system.
- Background jobs.
- Logging.
- Monitoring.
- Testing.

The architecture should be:

- Secure.
- Maintainable.
- Scalable.
- Reasonably simple.
- Suitable for an MVP.
- Capable of growing into a serious SaaS product.

Avoid unnecessary microservices.

Prefer a modular monolith initially unless there is a compelling reason otherwise.

---

# 21. Database Design

Eventually create a proposed database schema.

Consider entities such as:

- User
- Organization
- Membership
- Role
- Permission
- Team
- Group
- Void
- VoidMembership
- Task
- TaskAssignee
- Subtask
- Comment
- Attachment
- Invitation
- Notification
- AuditLog

But do not assume this is correct.

Determine the proper schema after asking the questions.

Pay special attention to:

- Multi-tenancy.
- Foreign keys.
- Cascading deletes.
- Soft deletion.
- Indexes.
- Unique constraints.
- Permissions.
- Query performance.

---

# 22. API Design

Eventually propose an API architecture.

Consider endpoints/actions for:

- Authentication.
- Organizations.
- Users.
- Invitations.
- Groups.
- Voids.
- Tasks.
- Comments.
- Attachments.
- Notifications.
- Audit logs.

Determine whether REST, GraphQL, tRPC, or another approach makes the most sense.

---

# 23. Performance

The infinite canvas could become extremely expensive if implemented badly.

Analyze:

- Hundreds of tasks.
- Thousands of tasks.
- Tens of thousands of objects.
- Large organizations.
- Realtime updates.
- Rendering performance.
- Virtualization.
- Spatial indexing.
- Lazy loading.
- Database indexing.
- Network traffic.

Determine how the canvas should render and synchronize efficiently.

---

# 24. MVP Definition

This is extremely important.

After the interview, separate everything into:

### MVP

Absolutely necessary for Void to be useful.

### V1

Important shortly after launch.

### V2 / Future

Interesting but not necessary initially.

Be ruthless about scope.

I do not want to spend months building enterprise features before the fundamental Void experience is excellent.

The MVP should ideally prove the core concept:

**Create organization → invite/join users → create groups/Voids → create tasks → assign tasks → manage permissions → interact with tasks through the spatial canvas.**

But modify this if your analysis suggests a better MVP.

---

# 25. Development Plan

After all questions are answered, produce a detailed implementation plan.

The final plan should include:

1. Product architecture.
2. UX architecture.
3. Technology stack.
4. Project structure.
5. Database schema.
6. Authentication system.
7. Authorization/RBAC system.
8. API architecture.
9. Canvas architecture.
10. Realtime architecture.
11. Security architecture.
12. Testing strategy.
13. Deployment architecture.
14. Monitoring/logging.
15. MVP feature list.
16. Future feature list.
17. Development phases.
18. Dependencies between phases.
19. Potential technical risks.
20. Recommended solutions to those risks.

For each development phase, specify:

- What gets built.
- Why it is built at that stage.
- What files/modules/components are likely needed.
- What database changes are needed.
- What APIs are needed.
- What tests should be written.
- What should be manually tested.

---

# 26. Codebase Planning

When we eventually begin implementation, I want the codebase to be clean and understandable.

Use:

- Strong typing.
- Clear module boundaries.
- Reusable components.
- Consistent naming.
- Validation.
- Error handling.
- Security best practices.
- Automated tests.
- Environment configuration.
- Proper database migrations.

Do not create giant files containing everything.

Do not over-engineer.

Prefer simple abstractions until complexity is justified.

---

# 27. Important Product Principle

The **spatial Void experience is the main differentiator**.

Void should not feel like:

"Another Jira/Trello clone with a fancy background."

The spatial interface should actually improve the way users organize and understand their work.

At the same time, do not force users to use the canvas for everything.

If a conventional list/table/search view would make a particular workflow significantly easier, recommend adding it.

The product can have multiple ways to view the same underlying data.

For example:

**Spatial View**
→ Visual organization.

**List View**
→ Efficient task management.

**Calendar View**
→ Deadlines.

Potentially:

**Dashboard**
→ Organization overview.

Determine whether these should exist and when.

---

# 28. How I Want You to Behave

Be an experienced:

- SaaS product architect.
- UX designer.
- Security engineer.
- Database architect.
- Full-stack engineer.
- Technical product manager.

Do not just execute my ideas.

Challenge them.

Identify hidden requirements.

Identify contradictions.

Identify dangerous assumptions.

Identify features I probably forgot.

Explain tradeoffs.

Recommend sensible defaults.

If something should be changed, say:

> "I recommend changing X because Y."

Do not overwhelm me with implementation details before we have established the product requirements.

Start by interviewing me.

Ask questions in batches of approximately **10–20 questions at a time**, grouped by topic, rather than asking 100 questions in one enormous message.

Keep track of my answers and update your understanding of the system as we go.

If my answers introduce contradictions with earlier decisions, point them out.

At the end of the discovery process, produce a **single source of truth specification for Void** that we can use as the basis for implementation.

Only after that should we move into actual coding.

---

# Initial Concept Summary

The simplest description of Void is:

> **Void is a spatial team task-management platform where companies create shared infinite workspaces, organize teams and tasks visually, and manage work through a beautiful interactive canvas.**

The key experience should feel like:

**Enter Void → see your workspace → navigate through the infinite space → discover groups and tasks → open/create/assign work → collaborate with your team.**

Now begin the requirements interview.

Start with the **highest-impact questions that could fundamentally change the architecture or product model**.
