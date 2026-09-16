import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { getSessionCookie } from "./domains/auth/cookies.js";
import { validateSession } from "./domains/auth/sessions.js";
import type { User } from "./db/schema.js";

/**
 * tRPC context. Carries the authenticated session's User (if any) —
 * resolved once per request here, not re-derived per procedure. `res` is
 * exposed so login/logout procedures can set/clear the session cookie
 * (docs/architecture.md §8).
 */
export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const rawToken = getSessionCookie(req);
  let session: { sessionId: string; user: User } | null = null;
  if (rawToken) {
    session = await validateSession(rawToken);
  }

  return { req, res, requestId: req.id, session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Requires a valid session. Every domain router's mutating/sensitive
 * procedures build on this (or the future Void/Org capability middleware)
 * rather than checking `ctx.session` inline per procedure — the single
 * shared-middleware pattern decisions.md/implementation-plan.md §4 calls for.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

type CapabilityCheck = (userId: string, targetId: string) => Promise<boolean>;

/**
 * The shared authorization middleware helper called for in
 * implementation-plan.md §4: wraps a capability function from
 * `authorization/capabilities.ts` so procedures never inline a permission
 * check. Chain it onto a `protectedProcedure` after `.input()`, e.g.
 * `protectedProcedure.input(schema).use(requireCapability(canManageTeam,
 * (input) => input.teamId))` — `getTargetId` reads the relevant ID out of
 * the already-validated input.
 */
export function requireCapability<TInput>(
  capability: CapabilityCheck,
  getTargetId: (input: TInput) => string,
) {
  return t.middleware(async ({ ctx, next, input }) => {
    if (!ctx.session) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const targetId = getTargetId(input as TInput);
    const allowed = await capability(ctx.session.user.id, targetId);
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx: { ...ctx, session: ctx.session } });
  });
}
