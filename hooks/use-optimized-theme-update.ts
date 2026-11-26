import { useCallback } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeEngine } from "@/utils/theme-engine";

/**
 * Hook for optimized theme token updates.
 * Now primarily handles store updates, with the ThemeEngine subscription
 * handling the imperative DOM side-effects.
 */
export function useOptimizedThemeUpdate() {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);
  const updateThemeTokenImmediate = useThemeStore(
    (state) => state.updateThemeTokenImmediate
  );

  const updateToken = useCallback(
    (key: string, value: string | undefined) => {
      ThemeEngine.applyToken(key, value);
      updateThemeToken(key, value);
    },
    [updateThemeToken]
  );

  const updateTokenImmediate = useCallback(
    (key: string, value: string | undefined) => {
      updateThemeTokenImmediate(key, value);
    },
    [updateThemeTokenImmediate]
  );

  return {
    updateToken,
    updateTokenImmediate,
    syncToStore: updateThemeToken,
    updateAndSync: updateToken,
  };
}

export function useOptimizedSliderUpdate() {
  const { updateTokenImmediate } = useOptimizedThemeUpdate();

  const handleSliderChange = useCallback(
    (key: string, value: number, unit: string = "") => {
      const fullValue = `${value}${unit}`;
      ThemeEngine.applyToken(key, fullValue);
      updateTokenImmediate(key, fullValue);
    },
    [updateTokenImmediate]
  );

  return {
    handleSliderChange,
  };
}
