import { createContext, useContext, useState } from "react";

/**
 * Second feature pass — the left panel needs to be reachable from every page
 * (including CanvasPage, which doesn't use AppShell at all — it has its own
 * full-bleed dark header), so its open/closed state lives above both rather
 * than inside AppShell specifically. The panel UI itself renders once, at
 * the App root (see App.tsx), and any page's header just needs a button
 * calling toggle().
 */
interface LeftPanelContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const LeftPanelContext = createContext<LeftPanelContextValue | null>(null);

export function LeftPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value: LeftPanelContextValue = {
    open,
    toggle: () => setOpen((v) => !v),
    close: () => setOpen(false),
  };
  return <LeftPanelContext.Provider value={value}>{children}</LeftPanelContext.Provider>;
}

export function useLeftPanel(): LeftPanelContextValue {
  const ctx = useContext(LeftPanelContext);
  if (!ctx) throw new Error("useLeftPanel must be used within a LeftPanelProvider");
  return ctx;
}
