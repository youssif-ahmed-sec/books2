import { useEffect, useRef } from "react";

export function useSectionSearchSelection(onSelect: (id: string) => void) {
  const callback = useRef(onSelect);
  useEffect(() => { callback.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("focus");
    if (initial) callback.current(initial);
    const select = (event: Event) => callback.current((event as CustomEvent<string>).detail);
    window.addEventListener("section-search-focus", select);
    return () => window.removeEventListener("section-search-focus", select);
  }, []);
}
