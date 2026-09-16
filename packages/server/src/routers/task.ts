import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { taskPriorityValues } from "@void/shared";
import { protectedProcedure, requireCapability, router } from "../trpc.js";
import { db } from "../db/client.js";
import { taskActivities } from "../db/schema.js";
import {
  canAccessVoid,
  canEditVoid,
  canAccessVoidForTask,
  canEditVoidForTask,
  canEditVoidForChecklistItem,
  canEditComment,
  canDeleteComment,
} from "../authorization/capabilities.js";
import {
  createTask,
  findTaskById,
  listTasksForVoid,
  listMyTasks,
  updateTask,
  moveTask,
  deleteTask,
  duplicateTask,
} from "../domains/task/tasks.js";
import { assignTask, unassignTask, listAssigneesForTask } from "../domains/task/taskAssignees.js";
import {
  listChecklistItemsForTask,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "../domains/task/checklistItems.js";
import {
  listCommentsForTask,
  addComment,
  editComment,
  deleteComment,
} from "../domains/task/comments.js";
import { assignTagsToTask, listTagsForTask } from "../domains/tag/tags.js";
import { publishVoidEvent } from "../realtime/broadcast.js";

const taskIdInput = z.object({ taskId: z.string().uuid() });
const priorityEnum = z.enum(taskPriorityValues);
const statusEnum = z.enum(["todo", "in_progress", "done", "blocked"]);
const tagNamesInput = z.array(z.string().trim().min(1).max(40)).max(20);

export const taskRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        voidId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: priorityEnum.optional(),
        dueDate: z.string().optional(),
        tagNames: tagNamesInput.optional(),
        groupId: z.string().uuid().optional(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .use(requireCapability(canEditVoid, (input: { voidId: string }) => input.voidId))
    .mutation(async ({ ctx, input }) => {
      const { tagNames, ...taskInput } = input;
      const result = await createTask(taskInput, ctx.session.user.id);
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That Group does not belong to this Void.",
        });
      }
      if (tagNames && tagNames.length > 0) {
        await assignTagsToTask(result.task.id, tagNames, ctx.session.user.id);
      }
      publishVoidEvent(input.voidId, "task.created", result.task);
      return result.task;
    }),

  get: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      const task = await findTaskById(input.taskId);
      if (!task || task.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
      return task;
    }),

  list: protectedProcedure
    .input(z.object({ voidId: z.string().uuid() }))
    .use(requireCapability(canAccessVoid, (input: { voidId: string }) => input.voidId))
    .query(async ({ input }) => {
      return listTasksForVoid(input.voidId);
    }),

  // D44 My Tasks — ungated beyond auth, same reasoning as void.list/
  // organization.listMine: authorization-scoped by construction
  // (listMyTasks only considers Voids the caller can currently access).
  listMine: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listMyTasks(ctx.session.user.id, input.organizationId);
    }),

  update: protectedProcedure
    .input(
      taskIdInput.extend({
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: statusEnum.optional(),
        priority: priorityEnum.nullable().optional(),
        dueDate: z.string().nullable().optional(),
        tagNames: tagNamesInput.optional(),
      }),
    )
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      const { taskId, tagNames, ...changes } = input;
      const task = await updateTask(taskId, changes, ctx.session.user.id);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      if (tagNames !== undefined) {
        await assignTagsToTask(taskId, tagNames, ctx.session.user.id);
      }
      publishVoidEvent(task.voidId, "task.updated", task);
      return task;
    }),

  move: protectedProcedure
    .input(
      taskIdInput.extend({
        x: z.number().optional(),
        y: z.number().optional(),
        groupId: z.string().uuid().nullable().optional(),
      }),
    )
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      const { taskId, ...changes } = input;
      const result = await moveTask(taskId, changes, ctx.session.user.id);
      if (!result.ok) {
        const message =
          result.reason === "not_found"
            ? "Task not found."
            : "That Group does not belong to this Void.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      publishVoidEvent(result.task.voidId, "task.moved", result.task);
      return result.task;
    }),

  delete: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ input }) => {
      const existing = await findTaskById(input.taskId);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const result = await deleteTask(input.taskId);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      publishVoidEvent(existing.voidId, "task.deleted", { taskId: input.taskId });
      return { ok: true as const };
    }),

  // D56: same-Void only (duplicateTask has no target-Void parameter at all).
  duplicate: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      const result = await duplicateTask(input.taskId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      publishVoidEvent(result.task.voidId, "task.created", result.task);
      return result.task;
    }),

  assign: protectedProcedure
    .input(taskIdInput.extend({ userId: z.string().uuid() }))
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      const result = await assignTask(input.taskId, input.userId, ctx.session.user.id);
      if (!result.ok) {
        const message =
          result.reason === "task_not_found"
            ? "Task not found."
            : "That user does not have access to this Task's Void.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      // Assignee changes broadcast as task.updated (D32 defines Task
      // create/update/move/delete as the sync surface; there's no separate
      // "task.assigned" event type) — the task itself is fetched fresh
      // since assignTask only returns { ok: true }.
      const task = await findTaskById(input.taskId);
      if (task) publishVoidEvent(task.voidId, "task.updated", task);
      return { ok: true as const };
    }),

  unassign: protectedProcedure
    .input(taskIdInput.extend({ userId: z.string().uuid() }))
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      const result = await unassignTask(input.taskId, input.userId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      const task = await findTaskById(input.taskId);
      if (task) publishVoidEvent(task.voidId, "task.updated", task);
      return { ok: true as const };
    }),

  listAssignees: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      return listAssigneesForTask(input.taskId);
    }),

  listTags: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      return listTagsForTask(input.taskId);
    }),

  listActivity: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      return db
        .select()
        .from(taskActivities)
        .where(eq(taskActivities.taskId, input.taskId))
        .orderBy(taskActivities.createdAt);
    }),

  // --- Checklist items -------------------------------------------------------
  addChecklistItem: protectedProcedure
    .input(taskIdInput.extend({ label: z.string().min(1) }))
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ input }) => {
      return addChecklistItem(input.taskId, input.label);
    }),

  toggleChecklistItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid(), isComplete: z.boolean() }))
    .use(
      requireCapability(canEditVoidForChecklistItem, (input: { itemId: string }) => input.itemId),
    )
    .mutation(async ({ input }) => {
      const item = await toggleChecklistItem(input.itemId, input.isComplete);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),

  deleteChecklistItem: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .use(
      requireCapability(canEditVoidForChecklistItem, (input: { itemId: string }) => input.itemId),
    )
    .mutation(async ({ input }) => {
      await deleteChecklistItem(input.itemId);
      return { ok: true as const };
    }),

  listChecklistItems: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      return listChecklistItemsForTask(input.taskId);
    }),

  // --- Comments (ID3) ---------------------------------------------------------
  // Adding a comment requires Editor+, same as editing the Task itself
  // (D13/D15 don't carve out a separate lower bar for commenting) —
  // flagged as an assumption in docs/decisions.md, not a literal decision.
  addComment: protectedProcedure
    .input(taskIdInput.extend({ body: z.string().min(1) }))
    .use(requireCapability(canEditVoidForTask, (input: { taskId: string }) => input.taskId))
    .mutation(async ({ ctx, input }) => {
      return addComment(input.taskId, ctx.session.user.id, input.body);
    }),

  editComment: protectedProcedure
    .input(z.object({ commentId: z.string().uuid(), body: z.string().min(1) }))
    .use(requireCapability(canEditComment, (input: { commentId: string }) => input.commentId))
    .mutation(async ({ input }) => {
      const comment = await editComment(input.commentId, input.body);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      return comment;
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .use(requireCapability(canDeleteComment, (input: { commentId: string }) => input.commentId))
    .mutation(async ({ input }) => {
      await deleteComment(input.commentId);
      return { ok: true as const };
    }),

  listComments: protectedProcedure
    .input(taskIdInput)
    .use(requireCapability(canAccessVoidForTask, (input: { taskId: string }) => input.taskId))
    .query(async ({ input }) => {
      return listCommentsForTask(input.taskId);
    }),
});
