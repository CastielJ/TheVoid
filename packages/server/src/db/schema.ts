import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  doublePrecision,
  bigint,
  date,
  integer,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { taskPriorityValues as sharedTaskPriorityValues } from "@void/shared";

/**
 * Phase 1 — Identity Foundation (docs/implementation-plan.md §2 Phase 1;
 * docs/architecture.md §4). No Organization/Team/Void concepts exist yet —
 * a User can exist and authenticate with no org membership at all.
 */

export const themePreferenceValues = ["light", "dark", "system"] as const;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Post-launch refinement pass: stable, unique mention/search/lookup
  // identifier. Lowercase-normalized on write (domains/auth/users.ts),
  // matching the existing `email` convention — a plain unique() index on
  // the already-normalized value, not a functional index.
  username: text("username").notNull().unique(),
  // Human-readable display name, editable independently of username.
  visibleName: text("visible_name").notNull(),
  // Second feature pass: nullable, NULL means "system" (resolve via the
  // client's prefers-color-scheme). Server-side so the choice is consistent
  // across devices/sessions rather than per-device localStorage-only.
  themePreference: text("theme_preference", { enum: themePreferenceValues }),
  // Nullable: magic-link-only users may never set a password (D19).
  passwordHash: text("password_hash"),
  // Nullable, only set once TOTP 2FA is enrolled (D23).
  totpSecret: text("totp_secret"),
  // Hashed backup codes (never stored plaintext), one row per code via
  // totpBackupCodes below — kept as a separate table rather than an array
  // column so an individual code can be marked consumed without rewriting
  // the whole array.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const totpBackupCodes = pgTable(
  "totp_backup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("totp_backup_codes_user_id_idx").on(table.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Hash of the opaque session token — the raw token lives only in the
    // client's httpOnly cookie, never persisted (architecture.md §8).
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label"),
    ipAddress: text("ip_address"),
    // Determines which cap (config/auth.ts SESSION_IDLE_EXPIRY_MS vs.
    // SESSION_REMEMBER_ME_EXPIRY_MS) activity-based renewal extends toward.
    rememberMe: boolean("remember_me").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    // Inactivity-extended up to SESSION_IDLE_EXPIRY_MS / SESSION_REMEMBER_ME_EXPIRY_MS
    // (config/auth.ts, D27/ID7) — pushed forward on activity, not fixed from login.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const authTokenPurposeValues = [
  "email_verification",
  "magic_link",
  "password_reset",
] as const;

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: authTokenPurposeValues }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_tokens_user_id_purpose_idx").on(table.userId, table.purpose)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ThemePreference = (typeof themePreferenceValues)[number];
export type Session = typeof sessions.$inferSelect;
export type AuthToken = typeof authTokens.$inferSelect;

/**
 * Phase 2 — Organizations, Teams, Membership & Authorization Engine
 * (docs/implementation-plan.md §2 Phase 2; docs/architecture.md §4).
 */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // No owner_user_id column (C7): ownership is derived solely from the
  // Membership row with role = 'owner'.
});

export const membershipRoleValues = ["owner", "admin", "member"] as const;
export const membershipStatusValues = ["active", "removed"] as const;

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: membershipRoleValues }).notNull(),
    status: text("status", { enum: membershipStatusValues }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memberships_organization_id_user_id_idx").on(table.organizationId, table.userId),
    index("memberships_user_id_idx").on(table.userId),
    // C7 ownership invariant: exactly one active owner per Organization,
    // enforced at the database level (not just application logic) —
    // ownership transfer (domains/organization/memberships.ts) relies on
    // this to make a zero/two-owner intermediate state impossible to commit.
    uniqueIndex("memberships_one_active_owner_per_org_idx")
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner' AND ${table.status} = 'active'`),
  ],
);

// Third feature pass — Team was merged into Void (a self-referencing
// hierarchy, see the `voids` table below): a "Team" is now just a Void row
// with a non-null `parentVoidId`. This enum, originally Team-only, now
// governs visibility for every Void regardless of nesting depth.
export const voidVisibilityValues = ["public", "private", "invisible"] as const;

/**
 * Transactional audit logging (ID15): every writer passes the same `tx` it
 * used for the state mutation (domains/audit/auditLog.ts) so the AuditLog
 * row commits or rolls back atomically with it. Migrated in Phase 2
 * alongside Organization/Membership per implementation-plan.md §3's
 * recommendation, even though write-calls for later domains (Void, Task,
 * ...) are added incrementally as those phases are built.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_organization_id_idx").on(table.organizationId)],
);

export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRoleValues)[number];
export type AuditLog = typeof auditLogs.$inferSelect;

/**
 * Phase 3 — Voids, Groups, Access Grants (Non-Canvas)
 * (docs/implementation-plan.md §2 Phase 3; docs/architecture.md §4/§4.1/§6.2).
 */

export const voids = pgTable(
  "voids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Third feature pass — Void is now a self-referencing hierarchy: NULL
    // means a top-level Void, non-null means this row is a "Team" (a child
    // Void nested under its parent — imagine a subdirectory). Unlimited
    // nesting depth is allowed by design; the UI just happens to usually
    // stop at one level. `onDelete: "cascade"` is a dormant safety net —
    // the app only ever soft-deletes Voids (see `deletedAt` below), so this
    // only fires on a genuine hard row delete, which never happens in
    // normal operation.
    parentVoidId: uuid("parent_void_id").references((): AnyPgColumn => voids.id, {
      onDelete: "cascade",
    }),
    // Applies uniformly at every nesting depth (a top-level Void and a
    // deeply-nested child Void both use the same three-tier model): public
    // (visible to all Org members in listings, joining still requires a
    // Manager/Org Admin to grant access — visibility only, not a self-join
    // mechanism), private (visible, joining requires a voidJoinRequests row
    // a Manager/Org Admin decides on), invisible (only current members can
    // see this Void exists at all, enforced everywhere Voids are listed —
    // domains/void/voids.ts's listChildVoids/listTopLevelAccessibleVoids are
    // the choke points every caller goes through). Default 'private' matches
    // the pre-existing implicit behavior (a Void was invisible to anyone
    // without a grant before this column existed).
    visibility: text("visibility", { enum: voidVisibilityValues }).notNull().default("private"),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete (ID1/ID16, architecture.md §6.2): a deleted Void is
    // authorization-inaccessible outright; Groups/Tasks beneath it become
    // unreachable via this column rather than being cascade-soft-deleted.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("voids_organization_id_idx").on(table.organizationId),
    index("voids_parent_void_id_idx").on(table.parentVoidId),
  ],
);

export const voidAccessGrantRoleValues = ["viewer", "editor", "manager"] as const;

export const voidAccessGrants = pgTable(
  "void_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    // Third feature pass — Team was merged into Void, so "grant to a whole
    // Team" no longer exists as a separate concept (a Team's own members are
    // just plain per-user grants on that child Void). Every grant is now a
    // plain per-user grant — the explicit access-control mechanism
    // (Non-negotiable #4, architecture.md §4).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: voidAccessGrantRoleValues }).notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("void_access_grants_void_id_idx").on(table.voidId),
    index("void_access_grants_user_id_idx").on(table.userId),
    // At most one grant per (Void, User) — keeps role lookup unambiguous
    // and revocation well-defined.
    uniqueIndex("void_access_grants_void_id_user_id_idx").on(table.voidId, table.userId),
  ],
);

export const voidJoinRequestStatusValues = ["pending", "accepted", "denied"] as const;

/**
 * Third feature pass — join-request workflow for a `private` Void (at any
 * nesting depth, top-level or a child "Team"), modeled directly on
 * `invitations` below (same shape: created/decided/status). Renamed from
 * the second pass's Team-only `teamJoinRequests` now that Team no longer
 * exists as a separate entity. A `public` Void never generates rows here —
 * joining a public Void still only happens via a Manager/Org Admin granting
 * access directly, not a self-join mechanism.
 */
export const voidJoinRequests = pgTable(
  "void_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: voidJoinRequestStatusValues }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // The role the deciding Manager chose to grant on accept (viewer/editor/
    // manager) — not a fixed default; recorded here for audit clarity. NULL
    // until decided (and always NULL on a denied request).
    grantedRole: text("granted_role", { enum: voidAccessGrantRoleValues }),
  },
  (table) => [
    index("void_join_requests_void_id_idx").on(table.voidId),
    index("void_join_requests_user_id_idx").on(table.userId),
    // At most one *live* (pending) request per Void+User — enforced at the
    // DB level via a partial unique index, not just an application check, so
    // a race between two concurrent requestJoin calls can't both succeed.
    // A user whose prior request was decided can request again freely.
    uniqueIndex("void_join_requests_void_id_user_id_pending_idx")
      .on(table.voidId, table.userId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type VoidJoinRequest = typeof voidJoinRequests.$inferSelect;
export type VoidJoinRequestStatus = (typeof voidJoinRequestStatusValues)[number];

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Immutable after creation (no update path ever changes it) — a Group
    // belongs to exactly one Void for its whole lifetime.
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width").notNull(),
    height: doublePrecision("height").notNull(),
    // Server-assigned, incremented on every update — last-write-wins
    // ordering (ID14); not exercised until Phase 5 wires up broadcasts.
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("groups_void_id_idx").on(table.voidId),
    // D43 global search: trigram GIN index for fast ILIKE/similarity matching
    // on Group name. `pg_trgm` itself is enabled via a raw statement
    // prepended to this migration (drizzle-kit doesn't diff extensions).
    index("groups_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

export type Void = typeof voids.$inferSelect;
export type VoidVisibility = (typeof voidVisibilityValues)[number];
export type VoidAccessGrant = typeof voidAccessGrants.$inferSelect;
export type VoidAccessGrantRole = (typeof voidAccessGrantRoleValues)[number];
export type Group = typeof groups.$inferSelect;

/**
 * Phase 4 — Tasks (Core Data, No Realtime Yet)
 * (docs/implementation-plan.md §2 Phase 4; docs/architecture.md §4; D35/D36/D37).
 */

export const taskStatusValues = ["todo", "in_progress", "done", "blocked"] as const;
// Post-launch refinement pass: value list now lives in @void/shared (the
// single source of truth server and web both import), not declared here —
// re-exported under the same name so every existing `taskPriorityValues`
// reference in this file keeps working unchanged.
export const taskPriorityValues = sharedTaskPriorityValues;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    // Nullable; explicit membership (Non-negotiable #5) — never inferred
    // from canvas position. Must belong to the same Void as this Task (C3),
    // enforced at the application layer in domains/task/tasks.ts.
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: taskStatusValues }).notNull().default("todo"),
    priority: text("priority", { enum: taskPriorityValues }),
    dueDate: date("due_date"),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    // Server-assigned, incremented on every update (ID14) — not exercised
    // until Phase 5 wires up broadcasts.
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_void_id_idx").on(table.voidId),
    index("tasks_group_id_idx").on(table.groupId),
    // D43 global search — see the matching comment on groups_name_trgm_idx.
    index("tasks_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    index("tasks_description_trgm_idx").using("gin", sql`${table.description} gin_trgm_ops`),
  ],
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    // C8: false once the assignee's Organization Membership ends (D17) —
    // flipped as part of that same removal transaction
    // (domains/organization/memberships.ts), never a separate manual step.
    assigneeActive: boolean("assignee_active").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index("task_assignees_user_id_idx").on(table.userId),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    isComplete: boolean("is_complete").notNull().default(false),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("checklist_items_task_id_idx").on(table.taskId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // Always a real User (Non-negotiable #12) — never hard-deleted out from
    // under a historical comment.
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("comments_task_id_idx").on(table.taskId)],
);

// ID4: exactly these five fields are tracked — not title/description/tags
// (would be noisy for free-text fields with no fixed-value semantics).
export const taskActivityFieldValues = [
  "status",
  "priority",
  "assignees",
  "due_date",
  "group_id",
] as const;

export const taskActivities = pgTable(
  "task_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    field: text("field", { enum: taskActivityFieldValues }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_activities_task_id_idx").on(table.taskId)],
);

export type Task = typeof tasks.$inferSelect;
export type TaskStatus = (typeof taskStatusValues)[number];
export type TaskPriority = (typeof taskPriorityValues)[number];
export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type TaskActivity = typeof taskActivities.$inferSelect;

export const taskLinkTypeValues = ["flow", "dependency"] as const;

/**
 * Task-to-task connections ("arrows" on the canvas) — third feature pass.
 * "flow" is purely visual/informational ordering; "dependency" is the same
 * directed shape but enforced (domains/task/tasks.ts's updateTask blocks
 * marking the target Task "done" while its source isn't). Directionality
 * convention: `sourceTaskId` is the Task that must finish first,
 * `targetTaskId` is the one that follows/depends on it — reads naturally
 * for both types. No `deletedAt` — a link row is hard-deleted (unlike
 * Task/Group/Void); create+delete only, no update (change type/endpoints
 * by deleting and recreating). Self-loop and cross-Void checks are
 * application-layer (domains/task/taskLinks.ts), mirroring how C3's
 * groupId-same-Void check on Tasks is enforced, not a DB constraint. The
 * `onDelete: "cascade"` FKs below are a dormant safety net exactly like
 * `voids.parentVoidId`'s — Task deletion is always a soft-delete, so the
 * real, live-path cascade lives in deleteTask's own transaction instead.
 */
export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    targetTaskId: uuid("target_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type", { enum: taskLinkTypeValues }).notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("task_links_void_id_idx").on(table.voidId),
    index("task_links_source_task_id_idx").on(table.sourceTaskId),
    index("task_links_target_task_id_idx").on(table.targetTaskId),
    // Blocks an accidental duplicate (e.g. double-drag) while still
    // allowing a "flow" and a "dependency" edge on the same ordered pair
    // (they answer different questions) and the reverse direction as a
    // distinct row.
    uniqueIndex("task_links_source_target_type_idx").on(
      table.sourceTaskId,
      table.targetTaskId,
      table.type,
    ),
  ],
);

export type TaskLink = typeof taskLinks.$inferSelect;
export type TaskLinkType = (typeof taskLinkTypeValues)[number];

/**
 * Post-launch refinement pass — Organization-scoped Tags. Reusable across
 * every Void in an Organization (not duplicated per-Void); created inline
 * while editing a Task/Group, gated by that resource's own Editor+ Void
 * capability (canEditVoidForTask/canEditVoidForGroup) — no separate
 * "manage tags" capability exists. A Tag's existence never grants access to
 * anything: it is a plain Organization-scoped data row, not an access-
 * control mechanism (Non-negotiable #4 is unaffected by this table).
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tags_organization_id_idx").on(table.organizationId),
    // Case-insensitive per-Organization dedup — findOrCreateTag
    // (domains/tag/tags.ts) relies on this to make "create if missing" safe
    // under concurrent requests (unique-violation retry), not just an
    // application-layer check.
    uniqueIndex("tags_organization_id_name_idx").on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
  ],
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tagId] }),
    index("task_tags_tag_id_idx").on(table.tagId),
  ],
);

export const groupTags = pgTable(
  "group_tags",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.tagId] }),
    index("group_tags_tag_id_idx").on(table.tagId),
  ],
);

export type Tag = typeof tags.$inferSelect;

// Phase 6 (docs/implementation-plan.md §2; D31): personal, per-Void-per-User
// camera state — never shared between users, distinct from the
// shared/visible object positions on Task/Group.
export const voidCameras = pgTable(
  "void_cameras",
  {
    voidId: uuid("void_id")
      .notNull()
      .references(() => voids.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    zoom: doublePrecision("zoom").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.voidId, table.userId] })],
);

export type VoidCamera = typeof voidCameras.$inferSelect;
export type TaskActivityField = (typeof taskActivityFieldValues)[number];

/**
 * Phase 7 — Invitations, Notifications (docs/implementation-plan.md §2;
 * architecture.md's DB-schema sketch for both tables).
 */

export const invitationRoleValues = ["admin", "member"] as const; // never "owner" (D16)
export const invitationStatusValues = ["pending", "accepted", "revoked", "expired"] as const;

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: invitationRoleValues }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: invitationStatusValues }).notNull().default("pending"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_organization_id_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type InvitationRole = (typeof invitationRoleValues)[number];

export const notificationTypeValues = [
  "task_assigned",
  "mentioned",
  "invited",
  "role_changed",
  // Third feature pass — Void join-request lifecycle notifications (renamed
  // from the second pass's Team-only variants now that Team no longer
  // exists as a separate entity — see voidJoinRequests above).
  "void_join_requested",
  "void_join_approved",
  "void_join_denied",
] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: notificationTypeValues }).notNull(),
    // Event-specific data (taskId, organizationId, actorEmail, etc.) — shape
    // varies per type, resolved by the frontend per notification.type (D39).
    payload: jsonb("payload").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_user_id_idx").on(table.userId)],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationType = (typeof notificationTypeValues)[number];
