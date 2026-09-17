import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "void-theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    // localStorage unavailable (private mode, blocked site data) — system is
    // a safe default; the page still renders correctly without it.
    return "system";
  }
}

function writeStoredPreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Best-effort only — see readStoredPreference.
  }
}

/**
 * Called once, synchronously, before React mounts (main.tsx) — sets
 * `data-theme` from whatever's in localStorage (or "system") so the very
 * first paint is already correctly themed, avoiding a flash of the wrong
 * theme. The server's value (once the session loads) reconciles over this
 * via useTheme's effect below — server wins on conflict, matching a
 * cross-device preference rather than a per-device localStorage-only one.
 */
export function initTheme(): void {
  applyTheme(readStoredPreference());
}

/**
 * Self-contained: applies + persists locally (localStorage, instant) and to
 * the server (trpc, cross-device) on every explicit change, and reconciles
 * from the server's value once the session loads if it differs from what
 * localStorage had — server wins, per docs/decisions.md's addendum.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));
  const me = trpc.auth.me.useQuery();
  const updateThemePreference = trpc.auth.updateThemePreference.useMutation();
  const reconciledFromServer = useRef(false);

  // Live OS-preference changes while "system" is selected.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      setResolved(resolveTheme("system"));
      applyTheme("system");
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, [preference]);

  // Server reconciliation, once, the first time the session's own value is
  // available — a different device's more-recent choice wins over whatever
  // this device's localStorage had.
  useEffect(() => {
    if (reconciledFromServer.current) return;
    if (!me.data) return;
    reconciledFromServer.current = true;
    const serverPref = me.data.themePreference;
    if (serverPref && serverPref !== preference) {
      setPreferenceState(serverPref);
      setResolved(resolveTheme(serverPref));
      applyTheme(serverPref);
      writeStoredPreference(serverPref);
    }
  }, [me.data, preference]);

  function setPreference(pref: ThemePreference) {
    setPreferenceState(pref);
    setResolved(resolveTheme(pref));
    applyTheme(pref);
    writeStoredPreference(pref);
    updateThemePreference.mutate({ themePreference: pref });
  }

  return { preference, resolved, setPreference };
}
