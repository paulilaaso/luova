import { useMemo } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import {
  buildThemeVariables,
  generateLockedThemeCSS,
  generateThemeCSS,
} from "@/utils/generate-theme-css";

export function useThemeCSS() {
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const isThemeLocked = useUIStore((state) => state.isThemeLocked);
  const lockedThemeState = useUIStore((state) => state.lockedThemeState);

  const css = useMemo(() => {
    // Defensive: multi-step store resets notify subscribers on intermediate
    // states. Never let a transient undefined theme crash the render tree —
    // emit no CSS until a valid theme is present.
    if (!themeState) return "";
    if (!isThemeLocked || !lockedThemeState) {
      return generateThemeCSS(themeState);
    }

    return generateLockedThemeCSS(themeState, lockedThemeState);
  }, [themeState, isThemeLocked, lockedThemeState]);

  const themeVariables = useMemo(
    () =>
      !themeState
        ? ({} as never)
        : isThemeLocked && lockedThemeState
          ? buildThemeVariables(lockedThemeState, currentMode)
          : buildThemeVariables(themeState, currentMode),
    [themeState, lockedThemeState, currentMode, isThemeLocked]
  );

  return { css, currentMode, themeVariables };
}
