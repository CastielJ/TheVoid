import { eq, and } from "drizzle-orm";
import { db } from "../../db/client.js";
import { voidCameras, type VoidCamera } from "../../db/schema.js";

/**
 * Personal, per-Void-per-User camera state (D31) — never shared between
 * users, distinct from shared object positions. No history is kept; a save
 * simply upserts the caller's own single row for this Void.
 */
export async function getVoidCamera(voidId: string, userId: string): Promise<VoidCamera | null> {
  const [row] = await db
    .select()
    .from(voidCameras)
    .where(and(eq(voidCameras.voidId, voidId), eq(voidCameras.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function saveVoidCamera(
  voidId: string,
  userId: string,
  camera: { x: number; y: number; zoom: number },
): Promise<void> {
  await db
    .insert(voidCameras)
    .values({ voidId, userId, ...camera })
    .onConflictDoUpdate({
      target: [voidCameras.voidId, voidCameras.userId],
      set: { ...camera, updatedAt: new Date() },
    });
}
