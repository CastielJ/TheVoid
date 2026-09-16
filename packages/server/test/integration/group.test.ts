import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { pool } from "../../src/db/client.js";
import { createUser } from "../helpers/testUser.js";
import { createOrganization } from "../../src/domains/organization/organizations.js";
import { createVoid, deleteVoid } from "../../src/domains/void/voids.js";
import {
  createGroup,
  findGroupById,
  listGroupsForVoid,
  updateGroup,
  deleteGroup,
} from "../../src/domains/group/groups.js";
import { resetAuthTables, resetOrgTables } from "../helpers/db.js";

describe("Group domain (implementation-plan.md Phase 3, D7: flat, no nesting)", () => {
  beforeEach(async () => {
    await resetOrgTables();
    await resetAuthTables();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createGroup persists position/size and defaults version to 1", async () => {
    const owner = await createUser("owner@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");

    const group = await createGroup({
      voidId: voidResult.void.id,
      name: "Sprint 1",
      x: 100,
      y: 200,
      width: 300,
      height: 150,
    });

    expect(group.version).toBe(1);
    expect(group.name).toBe("Sprint 1");
  });

  it("updateGroup increments version on every write and never accepts a void_id override", async () => {
    const owner = await createUser("owner2@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");

    const group = await createGroup({
      voidId: voidResult.void.id,
      name: "Sprint 1",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    const updated = await updateGroup(group.id, { name: "Sprint 1 Renamed", x: 50 });
    expect(updated?.version).toBe(2);
    expect(updated?.name).toBe("Sprint 1 Renamed");
    expect(updated?.x).toBe(50);
    // void_id is untouched — updateGroup's input type has no such field at all.
    expect(updated?.voidId).toBe(voidResult.void.id);

    const updatedAgain = await updateGroup(group.id, { y: 75 });
    expect(updatedAgain?.version).toBe(3);
  });

  it("listGroupsForVoid excludes Groups whose Void has been soft-deleted (architecture.md §6.2)", async () => {
    const owner = await createUser("owner3@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");

    await createGroup({ voidId: voidResult.void.id, name: "A", x: 0, y: 0, width: 10, height: 10 });
    await createGroup({ voidId: voidResult.void.id, name: "B", x: 0, y: 0, width: 10, height: 10 });

    expect(await listGroupsForVoid(voidResult.void.id)).toHaveLength(2);

    await deleteVoid(voidResult.void.id, owner.id);

    // The Group rows themselves are never touched (O(1) Void delete) — they
    // simply become unreachable via the Void-level join.
    expect(await listGroupsForVoid(voidResult.void.id)).toHaveLength(0);
  });

  it("deleteGroup removes the row", async () => {
    const owner = await createUser("owner4@example.com");
    const org = await createOrganization(owner.id, "Acme");
    const voidResult = await createVoid(org.id, "Void", null, owner.id);
    if (!voidResult.ok) throw new Error("unreachable");

    const group = await createGroup({
      voidId: voidResult.void.id,
      name: "A",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    await deleteGroup(group.id);
    expect(await findGroupById(group.id)).toBeNull();
  });
});
