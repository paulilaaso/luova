import { type RefObject, useLayoutEffect } from "react";
import { measureShadowBleed } from "@/lib/shadow-bleed";
import { useThemeStore } from "@/stores/theme-store";

const SIDES = ["top", "right", "bottom", "left"] as const;

const themeListeners = new Set<() => void>();
let stopWatchingTheme: (() => void) | null = null;

/**
 * Theme shadows live in CSS variables outside the frame: live previews are
 * written to <html>'s inline style by ThemeEngine, and committed changes go
 * through the theme store. Neither mutates the frame's subtree, so one shared
 * watcher fans those changes out to every mounted frame.
 */
function onThemeChange(listener: () => void) {
  themeListeners.add(listener);
  if (!stopWatchingTheme) {
    const notify = () => {
      for (const fn of themeListeners) fn();
    };
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    const unsubscribe = useThemeStore.subscribe(notify);
    stopWatchingTheme = () => {
      observer.disconnect();
      unsubscribe();
    };
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      stopWatchingTheme?.();
      stopWatchingTheme = null;
    }
  };
}

/**
 * Keeps `--shadow-bleed-{side}` custom properties on the element in sync with
 * how far its descendants' shadows reach past its edges, so a clip-path built
 * from them clips overflowing content but never the shadows.
 */
export function useShadowBleed(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let frame = 0;
    let last = "";

    const apply = () => {
      frame = 0;
      const bleed = measureShadowBleed(el);
      const key = SIDES.map((side) => bleed[side]).join(",");
      // Skip identical writes: the style mutation would re-trigger the observer.
      if (key === last) return;
      last = key;
      for (const side of SIDES) {
        el.style.setProperty(`--shadow-bleed-${side}`, `${bleed[side]}px`);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(el);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    // Hover/transition-driven shadows don't mutate the DOM.
    const events = [
      "transitionend",
      "animationend",
      "pointerover",
      "pointerout",
    ];
    for (const type of events) el.addEventListener(type, schedule);
    const stopThemeWatch = onThemeChange(schedule);

    return () => {
      cancelAnimationFrame(frame);
      stopThemeWatch();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      for (const type of events) el.removeEventListener(type, schedule);
      for (const side of SIDES)
        el.style.removeProperty(`--shadow-bleed-${side}`);
    };
  }, [ref, enabled]);
}
