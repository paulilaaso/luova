import { defaultThemeState } from "@/config/theme";
import type { CustomFont } from "@/types/theme";
import { generateFontId } from "@/utils/asset-manager";
import { ThemeEngine } from "@/utils/theme-engine";
import { getPresetThemeStyles } from "@/utils/theme-preset-helper";
import {
  clearThemeTokensInState,
  updateThemeTokenInState,
} from "@/utils/theme-token-utils";
import type { AppStateCreator, ThemeSlice } from "../types";

export const createThemeSlice: AppStateCreator<ThemeSlice> = (
  set,
  _get,
  store
) => ({
  themeState: defaultThemeState,
  currentMode: "light" as const,

  setThemeState: (state) =>
    set((s) => {
      s.themeState = state;
    }),

  setCurrentMode: (mode) =>
    set((s) => {
      s.currentMode = mode;
      s.themeState.currentMode = mode;
    }),

  applyThemePreset: (preset) =>
    set((_s) => {
      console.log("Applying preset:", preset);
    }),

  resetToCurrentPreset: () => {
    ThemeEngine.clearAllThemeCSSVariables();
    set((s) => {
      const currentPreset = s.themeState.preset || "default";
      const presetStyles = getPresetThemeStyles(currentPreset);
      s.themeState = {
        ...defaultThemeState,
        preset: currentPreset,
        styles: presetStyles,
      };
    });
  },

  updateThemeToken: (key, value) => {
    const appStore = store as any;
    const preState = appStore._pendingHistoryPreState as
      | Record<string, unknown>
      | undefined;
    appStore._pendingHistoryPreState = undefined;

    if (preState) {
      // The value was already applied via ...Immediate; just commit the history
      // entry from the captured pre-drag state → current state.
      appStore.getState().commitHistory(preState);
    } else {
      set((s) => {
        updateThemeTokenInState(s.themeState, key, value, s.currentMode);
      });
    }
  },

  updateThemeTokenImmediate: (key, value) => {
    const temporalState = (store as any).temporal.getState();
    // Capture the pre-drag state before the first immediate mutation so the
    // eventual commit can push a meaningful history entry.
    const appStore = store as any;
    if (!appStore._pendingHistoryPreState) {
      const s = appStore.getState();
      const { nodes, themeState, currentMode, layerOrder, rootId, assets } = s;
      appStore._pendingHistoryPreState = {
        nodes,
        themeState,
        currentMode,
        layerOrder,
        rootId,
        assets,
      };
    }
    temporalState.pause();
    try {
      set((s) => {
        updateThemeTokenInState(s.themeState, key, value, s.currentMode);
      });
    } finally {
      temporalState.resume();
    }
  },

  updateThemeRadius: (value, smoothingValue) =>
    set((s) => {
      const radiusVal = `${value}rem`;
      const smoothingVal = smoothingValue?.toString();

      const apply = (m: "light" | "dark") => {
        (s.themeState.styles[m] as any).radius = radiusVal;
        if (smoothingVal !== undefined) {
          (s.themeState.styles[m] as any).smoothing = smoothingVal;
        }
      };

      apply("light");
      apply("dark");
    }),

  clearThemeTokens: (keys) =>
    set((s) => {
      clearThemeTokensInState(s.themeState, keys, s.currentMode);
      ThemeEngine.clearTokensCssVariables(keys);
    }),

  reset: (_preset) =>
    set((s) => {
      s.themeState = defaultThemeState;
      s.currentMode = "light";
    }),

  canUndo: (): boolean =>
    (store as any).temporal.getState().pastStates.length > 0,

  canRedo: (): boolean =>
    (store as any).temporal.getState().futureStates.length > 0,

  addCustomFont: (family, assetId, extension) =>
    set((s) => {
      const customFonts = s.themeState.styles.light.customFonts || [];
      const newFont: CustomFont = {
        id: generateFontId(),
        family,
        assetId,
        extension,
      };
      s.themeState.styles.light.customFonts = [...customFonts, newFont];
      s.themeState.styles.dark.customFonts = [...customFonts, newFont];
    }),

  removeCustomFont: (id) =>
    set((s) => {
      const customFonts = s.themeState.styles.light.customFonts || [];
      s.themeState.styles.light.customFonts = customFonts.filter(
        (f) => f.id !== id
      );
      s.themeState.styles.dark.customFonts = customFonts.filter(
        (f) => f.id !== id
      );
    }),
});
