import { createTRPCClient, httpLink } from "@trpc/client";
import type { FastifyInstance } from "fastify";
import type { AppRouter } from "../../src/routers/root.js";

/**
 * A tRPC client that routes requests through `app.inject()` instead of a
 * real network call — exercises the actual wire protocol (so tests catch
 * real serialization/routing bugs) without binding a port. Manages a single
 * session cookie so a test can log in once and stay "logged in" across
 * subsequent calls, mirroring how a browser would behave.
 */
export function createTestClient(app: FastifyInstance) {
  const cookieJar: { cookie?: string } = {};

  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: "http://localhost/trpc",
        fetch: async (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          const path = url.replace("http://localhost", "");

          const headers: Record<string, string> = { origin: "http://localhost:5173" };
          if (init?.headers) {
            for (const [key, value] of new Headers(init.headers as HeadersInit)) {
              headers[key] = value;
            }
          }
          if (cookieJar.cookie) headers["cookie"] = cookieJar.cookie;

          const response = await app.inject({
            method: (init?.method as "GET" | "POST") ?? "GET",
            url: path,
            headers,
            payload: init?.body ? init.body.toString() : undefined,
          });

          const setCookie = response.headers["set-cookie"];
          if (setCookie) {
            const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
            const cookiePair = raw!.split(";")[0]!;
            // A clearCookie (logout) sets an empty value — drop the jar entry then.
            cookieJar.cookie = cookiePair.endsWith("=") ? undefined : cookiePair;
          }

          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders[key] = String(value);
          }

          return new Response(response.rawPayload, {
            status: response.statusCode,
            headers: responseHeaders,
          });
        },
      }),
    ],
  });

  return { client, cookieJar };
}
