import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc.js";
import {
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../domains/notification/notifications.js";

export const notificationRouter = router({
  // Ungated: always scoped to the caller (ctx.session.user.id), same
  // reasoning as void.list/organization.listMine — there is no "whose
  // notifications" input to authorize against.
  list: protectedProcedure.query(async ({ ctx }) => {
    return listNotificationsForUser(ctx.session.user.id);
  }),

  countUnread: protectedProcedure.query(async ({ ctx }) => {
    return countUnreadNotifications(ctx.session.user.id);
  }),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await markNotificationRead(input.notificationId, ctx.session.user.id);
      if (!result.ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllNotificationsRead(ctx.session.user.id);
    return { ok: true as const };
  }),
});
