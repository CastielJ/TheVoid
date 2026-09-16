import { createContext, useContext } from "react";
import { trpc } from "../trpc/client";

interface SessionUser {
  id: string;
  email: string;
  username: string;
  visibleName: string;
}

interface SessionContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  refetch: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * `auth.me` is the single source of truth for "am I logged in" — no
 * separate client-side auth-state store, since the cookie session is what
 * actually gates every request anyway (mirrors the reconnect protocol's
 * "ask the server for the truth" philosophy, architecture.md §6.1).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });

  const value: SessionContextValue = {
    user: me.data ?? null,
    isLoading: me.isLoading,
    refetch: () => void me.refetch(),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
