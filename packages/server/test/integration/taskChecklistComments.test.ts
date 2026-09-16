import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool, db } from "../../src/db/client.js";
import { memberships } from "../../src/db/schema.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid } from "../../src/domains/void/voids.js";
import { grantVoidAccess } from "../../src/domains/void/voidAccessGrants.js";
import { createTask } from "../../src/domains/task/tasks.js";
import {
  addChecklistItem,
  listChecklistItemsForTask,
  toggleChecklistItem,
  deleteChecklistItem,
} from "../../src/domains/task/checklistItems.js";
import {
  addComment,
  editComment,
  deleteComment,
  listCommentsForTask,
} from "../../src/domains/task/comments.js";
import { canEditComment, canDeleteComment } from "../../src/authorization/capabilities.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("ChecklistItem & Comment domains (implementation-plan.md Phase 4)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("addChecklistItem assigns sequential positions; toggleChecklistItem flips isComplete", async () => {
    const owner = await createUser("owner@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    const item1 = await addChecklistItem(task.task.id, "First");
    const item2 = await addChecklistItem(task.task.id, "Second");
    expect(item1.position).toBe(0);
    expect(item2.position).toBe(1);

    const toggled = await toggleChecklistItem(item1.id, true);
    expect(toggled?.isComplete).toBe(true);

    await deleteChecklistItem(item2.id);
    const remaining = await listChecklistItemsForTask(task.task.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(item1.id);
  });

  it("ID3: comment author can edit/delete their own comment; a non-author non-Manager cannot", async () => {
    const owner = await createUser("owner2@example.com");
    const author = await createUser("author2@example.com");
    const bystander = await createUser("bystander2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db.insert(memberships).values([
      { organizationId: org.id, userId: author.id, role: "member" },
      { organizationId: org.id, userId: bystander.id, role: "member" },
    ]);
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    await grantVoidAccess(voidResult.void.id, { userId: author.id }, "editor", owner.id);
    await grantVoidAccess(voidResult.void.id, { userId: bystander.id }, "editor", owner.id);
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    const comment = await addComment(task.task.id, author.id, "Original comment");

    expect(await canEditComment(author.id, comment.id)).toBe(true);
    expect(await canEditComment(bystander.id, comment.id)).toBe(false);
    expect(await canDeleteComment(bystander.id, comment.id)).toBe(false);
    expect(await canDeleteComment(author.id, comment.id)).toBe(true);

    const edited = await editComment(comment.id, "Edited by author");
    expect(edited?.body).toBe("Edited by author");
  });

  it("ID3: a Void Manager may delete (not edit) any comment for moderation", async () => {
    const owner = await createUser("owner3@example.com");
    const author = await createUser("author3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: author.id, role: "member" });
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");
    await grantVoidAccess(voidResult.void.id, { userId: author.id }, "editor", owner.id);
    const task = await createTask({ voidId: voidResult.void.id, title: "T", x: 0, y: 0 }, owner.id);
    if (!task.ok) throw new Error("unreachable");

    const comment = await addComment(task.task.id, author.id, "Needs moderation");

    // owner is the Void's Manager (creator, A2) — can delete but not edit.
    expect(await canDeleteComment(owner.id, comment.id)).toBe(true);
    expect(await canEditComment(owner.id, comment.id)).toBe(false);

    await deleteComment(comment.id);
    const remaining = await listCommentsForTask(task.task.id);
    expect(remaining).toHaveLength(0);
  });
});
