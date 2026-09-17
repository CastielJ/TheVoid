/**
 * Second feature pass — left-panel "recent Voids" shortcut list. Client-only,
 * localStorage-backed, no new table (explicitly proposed as optional/cuttable
 * in the plan) — just a per-device convenience, not state anything needs to
 * read back reliably.
 */
export interface RecentVoidEntry {
  voidId: string;
  organizationId: string;
  name: string;
  visitedAt: number;
}

const STORAGE_KEY = "void-recent-voids";
const MAX_ENTRIES = 8;

export function getRecentVoids(): RecentVoidEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentVoidEntry[];
  } catch {
    return [];
  }
}

export function recordVoidVisit(entry: Omit<RecentVoidEntry, "visitedAt">): void {
  try {
    const existing = getRecentVoids().filter((e) => e.voidId !== entry.voidId);
    const next = [{ ...entry, visitedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort only.
  }
}
