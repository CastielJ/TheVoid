import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comments, type Comment } from "../../db/schema.js";
import { findTaskById } from "./tasks.js";
import { findUserByUsername } from "../auth/users.js";
import { canAccessVoid } from "../../authorization/capabilities.js";
import { createNotification } from "../notification/notifications.js";
import { findVoidById } from "../void/voids.js";

export async function listCommentsForTask(taskId: string): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt)))
    .orderBy(comments.createdAt);
}

export async function findCommentById(commentId: string): Promise<Comment | null> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  return row ?? null;
}

// Post-launch refinement pass: mentions switched from `@` + full email to
// `@` + username, now that every User has a stable username (D39's original
// email-based syntax predates that field entirely). Same non-matching
// semantics as before: a mention only produces a notification for a User
// who (a) has an account and (b) currently has access to the Task's Void —
// mirrors C8/the assignment-eligibility principle, so a comment can't be
// used to probe for or notify unrelated accounts.
const MENTION_PATTERN = /@([a-z0-9_]{3,20})/g;

export function parseMentionedUsernames(body: string): string[] {
  const matches = body.matchAll(MENTION_PATTERN);
  return [...new Set([...matches].map((m) => m[1]!.toLowerCase()))];
}

export async function addComment(taskId: string, authorId: string, body: string): Promise<Comment> {
  const task = await findTaskById(taskId);

  return db.transaction(async (tx) => {
    const [comment] = await tx.insert(comments).values({ taskId, authorId, body }).returning();

    if (task) {
      const mentionedUsernames = parseMentionedUsernames(body);
      if (mentionedUsernames.length > 0) {
        const voidRow = await findVoidById(task.voidId);
        for (const username of mentionedUsernames) {
          const mentionedUser = await findUserByUsername(username);
          if (!mentionedUser || mentionedUser.id === authorId) continue;
          if (!(await canAccessVoid(mentionedUser.id, task.voidId))) continue;

          await createNotification(tx, {
            userId: mentionedUser.id,
            type: "mentioned",
            payload: {
              taskId,
              voidId: task.voidId,
              organizationId: voidRow?.organizationId,
              commentId: comment!.id,
              mentionedBy: authorId,
            },
          });
        }
      }
    }

    return comment!;
  });
}

/**
 * ID3: the author may edit their own comment. Caller (comment router,
 * canEditComment) is responsible for verifying authorship before calling
 * this — kept separate from deletion, since a Void Manager may delete but
 * never edit someone else's comment.
 */
export async function editComment(commentId: string, body: string): Promise<Comment | null> {
  const [comment] = await db
    .update(comments)
    .set({ body, updatedAt: new Date() })
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .returning();
  return comment ?? null;
}

export async function deleteComment(commentId: string): Promise<void> {
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
}
