import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@void/server";

/**
 * Phase 0 tRPC client. Domain-feature hooks (useQuery/useMutation calls)
 * are added per feature starting Phase 1 — this file only wires the
 * transport itself.
 */
export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/trpc",
        // Same-origin only (dev: proxied by Vite; prod: same deployment) —
        // consistent with the CSRF approach (SameSite + Origin validation,
        // no cross-origin fetch surface), per docs/decisions.md ID9.
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" });
        },
      }),
    ],
  });
}
