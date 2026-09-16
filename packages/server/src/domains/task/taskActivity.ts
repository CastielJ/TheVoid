import type { db } from "../../db/client.js";
import { taskActivities, type TaskActivityField } from "../../db/schema.js";

// Same structural-typing pattern as domains/audit/auditLog.ts: callers pass
// their own `tx` so this insert joins the caller's transaction.
type DbClient = Pick<typeof db, "insert">;

export interface RecordTaskActivityInput {
  taskId: string;
  actorId: string;
  field: TaskActivityField;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * ID4: only `status`/`priority`/`assignees`/`due_date`/`group_id` are ever
 * recorded — callers only call this for those five fields (enforced by
 * `TaskActivityField`'s type, not a runtime allowlist check).
 */
export async function recordTaskActivity(
  tx: DbClient,
  input: RecordTaskActivityInput,
): Promise<void> {
  await tx.insert(taskActivities).values(input);
}
