"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { ensureFontsLoaded, loadCustomFont } from "@/utils/fonts";
import { ThemeEngine } from "@/utils/theme-engine";

function loadThemeFonts(themeState: any) {
  if (!themeState) return;

  const { light, dark } = themeState.styles;
  ensureFontsLoaded(light as any);
  ensureFontsLoaded(dark as any);

  const customFonts = [
    ...((light as any).customFonts ?? []),
    ...((dark as any).customFonts ?? []),
  ];
  if (customFonts.length > 0) {
    loadCustomFont(customFonts as any);
  }
}

export function ThemeEngineInitializer() {
  useEffect(() => {
    // Sync the dark class on mount — replaces next-themes attribute="class"
    const { currentMode, themeState } = useThemeStore.getState();
    if (currentMode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    loadThemeFonts(themeState);

    const { isThemeLocked, lockedThemeState } = useUIStore.getState();
    if (isThemeLocked && lockedThemeState) {
      loadThemeFonts(lockedThemeState);
    }

    const unsubscribeUI = useUIStore.subscribe((state, prevState) => {
      if (state.isThemeLocked !== prevState.isThemeLocked) {
        ThemeEngine.clearAllThemeCSSVariables();
      }

      if (
        state.isThemeLocked &&
        state.lockedThemeState &&
        (state.isThemeLocked !== prevState.isThemeLocked ||
          state.lockedThemeState !== prevState.lockedThemeState)
      ) {
        loadThemeFonts(state.lockedThemeState);
      }
    });

    // Subscribe to store changes to apply theme updates to the DOM
    const unsubscribe = useThemeStore.subscribe((state, prevState) => {
      // 1. Check if mode changed
      const modeChanged = state.currentMode !== prevState.currentMode;
      if (modeChanged) {
        // Sync the dark class on the HTML element
        if (state.currentMode === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        // Clear inline CSS variables when mode changes to prevent bleed
        ThemeEngine.clearAllThemeCSSVariables();
      }

      // 2. Font assets are fetched from IndexedDB on demand — no sync needed

      // 3. Diff styles to find changed tokens
      const currentStyles = state.themeState.styles[state.currentMode];
      const prevStyles = prevState.themeState.styles[prevState.currentMode];

      if (currentStyles !== prevStyles || modeChanged) {
        // Find which keys changed (or re-apply all if mode changed)
        const allKeys = new Set([
          ...Object.keys(currentStyles),
          ...Object.keys(prevStyles),
        ]);
        for (const key of allKeys) {
          const val = (currentStyles as any)[key];
          const prevVal = (prevStyles as any)[key];

          // Re-apply if value changed OR if mode changed (since we cleared everything)
          if (modeChanged || val !== prevVal) {
            ThemeEngine.applyToken(key, val);
          }
        }
      }

      // 4. Handle font loading — keep fonts for both modes loaded so
      //    switching doesn't unload a font still needed in the other mode.
      const { light, dark } = state.themeState.styles;
      const prevLight = prevState.themeState.styles.light;
      const prevDark = prevState.themeState.styles.dark;

      if (light !== prevLight || dark !== prevDark || modeChanged) {
        ensureFontsLoaded(light as any);
        ensureFontsLoaded(dark as any);

        // Handle custom fonts
        const currentCustomFonts = (light as any).customFonts;
        const prevCustomFonts = (prevLight as any).customFonts;
        if (currentCustomFonts !== prevCustomFonts) {
          loadCustomFont(currentCustomFonts as any);
        }
      }
    });

    return () => {
      unsubscribeUI();
      unsubscribe();
    };
  }, []);

  return null;
}
