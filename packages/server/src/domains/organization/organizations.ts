import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { organizations, memberships, type Organization } from "../../db/schema.js";

/**
 * Organization creation (architecture.md §4, C7): the creator becomes Owner
 * via a Membership row in the same transaction, never a denormalized
 * `owner_user_id` column on Organization.
 */
export async function createOrganization(
  creatorUserId: string,
  name: string,
): Promise<Organization> {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name }).returning();
    await tx.insert(memberships).values({
      organizationId: org!.id,
      userId: creatorUserId,
      role: "owner",
      status: "active",
    });
    return org!;
  });
}

export async function findOrganizationById(organizationId: string): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org ?? null;
}

export async function updateOrganizationName(organizationId: string, name: string): Promise<void> {
  await db.update(organizations).set({ name }).where(eq(organizations.id, organizationId));
}
