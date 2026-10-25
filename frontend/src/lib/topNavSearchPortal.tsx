"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type SearchSlot = {
  slot: HTMLDivElement | null;
  setSlot: (element: HTMLDivElement | null) => void;
  active: boolean;
  overlay: boolean;
  register: (overlay: boolean) => () => void;
};

const Context = createContext<SearchSlot | null>(null);

export function TopNavSearchProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [overlayCount, setOverlayCount] = useState(0);
  const register = useCallback((overlay: boolean) => {
    setActiveCount(count => count + 1);
    if (overlay) setOverlayCount(count => count + 1);
    return () => {
      setActiveCount(count => count - 1);
      if (overlay) setOverlayCount(count => count - 1);
    };
  }, []);
  return <Context.Provider value={{ slot, setSlot, active: activeCount > 0, overlay: overlayCount > 0, register }}>{children}</Context.Provider>;
}

export function useTopNavSearchSlot() {
  const value = useContext(Context);
  if (!value) throw new Error("TopNavSearchProvider is missing");
  return value;
}

export function TopNavSearchPortal({ children, overlay = false }: { children: ReactNode; overlay?: boolean }) {
  const { slot, register } = useTopNavSearchSlot();
  useEffect(() => register(overlay), [overlay, register]);
  return slot ? createPortal(children, slot) : null;
}
