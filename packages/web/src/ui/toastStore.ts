import { create } from "zustand";

export type ToastVariant = "error" | "info" | "success";

export interface ToastEntry {
  id: string;
  message: string;
  variant: ToastVariant;
}

const TOAST_DURATION_MS = 5000;

interface ToastState {
  toasts: ToastEntry[];
  pushToast: (message: string, variant?: ToastVariant) => string;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  pushToast: (message, variant = "error") => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => useToastStore.getState().dismissToast(id), TOAST_DURATION_MS);
    return id;
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Imperative access (same pattern as `useCanvasStore.getState()` elsewhere in
 * this codebase) so a `trpc.*.useMutation({ onError })` callback can show a
 * toast without needing to be a component that calls the hook itself.
 */
export function showToast(message: string, variant?: ToastVariant): string {
  return useToastStore.getState().pushToast(message, variant);
}

/**
 * A TRPCError's `.message` defaults to its bare `code` (e.g. "NOT_FOUND")
 * when the router didn't pass an explicit message — showing that verbatim
 * would read as an internal code, not a sentence. Only BAD_REQUEST errors in
 * this codebase always carry a deliberately-authored, user-facing message
 * (see e.g. task.ts's "That Group does not belong to this Void.") — so only
 * those are safe to surface as-is; everything else falls back to a generic,
 * caller-supplied sentence.
 */
export function mutationErrorMessage(
  err: { message?: string; data?: { code?: string } | null } | undefined,
  fallback: string,
): string {
  if (err?.data?.code === "BAD_REQUEST" && err.message) return err.message;
  return fallback;
}
