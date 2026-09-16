/**
 * Type-only entry point consumed by @void/web for its tRPC client
 * (`import type { AppRouter } from "@void/server"`). Nothing here is
 * imported at runtime by the client — only the type.
 */
export type { AppRouter } from "./routers/root.js";
