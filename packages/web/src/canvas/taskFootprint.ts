/**
 * Real rendered Task card sizes (not spatialIndex.ts's approximate
 * virtualization-bucket footprints) — shared by CanvasViewport's drag-into-
 * Group preview and EdgeLayer's arrow-anchor math, both of which need the
 * actual border, not a rough placement guess.
 */
export const COMPACT_TASK_WIDTH = 220;
export const COMPACT_TASK_HEIGHT_BASE = 76;
export const COMPACT_TASK_HEIGHT_WITH_BADGES = 100;
export const EXPANDED_TASK_WIDTH = 320;
/** Only used when a card is expanded but hasn't reported a measured height yet (see store.ts's measuredFootprints). */
export const EXPANDED_TASK_HEIGHT_FALLBACK = 460;

export interface TaskSummaryCounts {
  checklistCount: number;
  commentCount: number;
  tagCount: number;
  assigneeCount: number;
}

/** Mirrors domains/task/taskContentFlags.ts's "has badges" definition exactly — a due date never adds height. */
export function hasTaskBadges(summary: TaskSummaryCounts | undefined): boolean {
  return Boolean(
    summary &&
    (summary.checklistCount > 0 ||
      summary.commentCount > 0 ||
      summary.tagCount > 0 ||
      summary.assigneeCount > 0),
  );
}

export function compactTaskHeightFor(summary: TaskSummaryCounts | undefined): number {
  return hasTaskBadges(summary) ? COMPACT_TASK_HEIGHT_WITH_BADGES : COMPACT_TASK_HEIGHT_BASE;
}
