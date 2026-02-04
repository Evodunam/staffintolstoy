import { useEffect, useRef } from "react";

const PILL_VISIBLE_CLASS = "scrollbar-pill-visible";
const PILL_TARGET_CLASSES = ["overflow-y-auto", "overflow-auto", "scrollbar-pill-on-scroll"];
const HIDE_DELAY_MS = 800;

function isPillTarget(el: EventTarget | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  const c = el.classList;
  return PILL_TARGET_CLASSES.some((cls) => c.contains(cls));
}

/**
 * Global scroll listener: when user scrolls inside an overflow-y-auto / overflow-auto
 * (or scrollbar-pill-on-scroll) element, add scrollbar-pill-visible so the pill
 * scrollbar thumb appears; remove it after a short delay. Used for the shared
 * pill scrollbar across all pages, pop-ups, and mobile.
 */
export function useGlobalScrollbarPill() {
  const lastElRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const target = e.target;
      if (!isPillTarget(target)) return;

      const last = lastElRef.current;
      if (last && last !== target) {
        last.classList.remove(PILL_VISIBLE_CLASS);
      }
      lastElRef.current = target;
      target.classList.add(PILL_VISIBLE_CLASS);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        target.classList.remove(PILL_VISIBLE_CLASS);
        if (lastElRef.current === target) lastElRef.current = null;
        timeoutRef.current = null;
      }, HIDE_DELAY_MS);
    };

    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (lastElRef.current) {
        lastElRef.current.classList.remove(PILL_VISIBLE_CLASS);
        lastElRef.current = null;
      }
    };
  }, []);
}
