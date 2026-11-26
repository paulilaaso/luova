"use client";

import { useCallback, useRef, useState } from "react";
import { COMMON_STYLES } from "@/config/theme";
import { COLOR_TOKEN_KEYS } from "@/config/theme-tokens";
import { useThemeStore } from "@/stores/theme-store";
import { adjustColor } from "@/utils/color-converter";
import { ThemeEngine } from "@/utils/theme-engine";
import { SliderWithInput } from "./SliderWithInput";

export interface ColorAdjustments {
  hueShift: number;
  chromaScale: number;
  lightnessScale: number;
  contrast: number;
  temperature: number;
}

const NEUTRAL_ADJUSTMENTS: ColorAdjustments = {
  hueShift: 0,
  chromaScale: 1,
  lightnessScale: 1,
  contrast: 1,
  temperature: 0,
};

const applyAdjustmentsToMode = (
  modeStyles: Record<string, string>,
  adjustments: ColorAdjustments
): Record<string, string> => {
  return Object.keys(modeStyles).reduce<Record<string, string>>((acc, key) => {
    const value = modeStyles[key] || "";

    if (key === "shadow-groups") {
      try {
        const parsed = JSON.parse(value);
        const adjusted = parsed.map((group: any) => ({
          ...group,
          layers: group.layers.map((layer: any) => ({
            ...layer,
            color: adjustColor(
              layer.color,
              adjustments.hueShift,
              adjustments.chromaScale,
              adjustments.lightnessScale,
              adjustments.contrast ?? 1,
              adjustments.temperature ?? 0
            ),
          })),
        }));
        acc[key] = JSON.stringify(adjusted);
        return acc;
      } catch {
        acc[key] = value;
        return acc;
      }
    }

    acc[key] = adjustColor(
      value,
      adjustments.hueShift,
      adjustments.chromaScale,
      adjustments.lightnessScale,
      adjustments.contrast ?? 1,
      adjustments.temperature ?? 0
    );
    return acc;
  }, {});
};

const ColorAdjustmentControls = () => {
  const themeState = useThemeStore((state) => state.themeState);
  const setThemeState = useThemeStore((state) => state.setThemeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const [localAdjustments, setLocalAdjustments] =
    useState<ColorAdjustments>(NEUTRAL_ADJUSTMENTS);
  const baseThemeSnapshotRef = useRef<Record<string, string> | null>(null);

  const captureSnapshot = useCallback(() => {
    baseThemeSnapshotRef.current = themeState.styles[currentMode] as Record<
      string,
      string
    >;
  }, [themeState.styles, currentMode]);

  const handleBatchChangeImmediate = useCallback(
    (values: ColorAdjustments) => {
      setLocalAdjustments(values);

      const baseStyles =
        baseThemeSnapshotRef.current ||
        (themeState.styles[currentMode] as Record<string, string>);

      const previewStyles = applyAdjustmentsToMode(baseStyles, values);

      const target = document.documentElement;

      if (!target) return;

      Object.entries(previewStyles).forEach(([key, val]) => {
        target.style.setProperty(`--${key}`, val);
        if (
          COLOR_TOKEN_KEYS.includes(key as (typeof COLOR_TOKEN_KEYS)[number])
        ) {
          target.style.setProperty(`--color-${key}`, `var(--${key})`);
        }
      });
    },
    [themeState.styles, currentMode]
  );

  const applyAdjustments = useCallback(
    (finalAdjustments: ColorAdjustments) => {
      const baseStyles =
        baseThemeSnapshotRef.current ||
        (themeState.styles[currentMode] as Record<string, string>);
      const otherMode = currentMode === "light" ? "dark" : "light";
      const otherModeStyles = themeState.styles[otherMode];

      const bakedStyles = applyAdjustmentsToMode(baseStyles, finalAdjustments);

      // Ensure non-color tokens are strictly preserved if they were somehow touched
      const currentModeCommon: Record<string, string> = {};
      for (const key of COMMON_STYLES) {
        if (key === "shadow-groups") continue;
        const v = baseStyles[key];
        if (v !== undefined) currentModeCommon[key] = v;
      }

      setThemeState({
        ...themeState,
        styles: {
          ...themeState.styles,
          [currentMode]: {
            ...baseStyles,
            ...bakedStyles,
            ...currentModeCommon,
          },
          [otherMode]: otherModeStyles,
        },
      });

      // Reset UI state
      setLocalAdjustments(NEUTRAL_ADJUSTMENTS);
      baseThemeSnapshotRef.current = null;
      ThemeEngine.clearAllThemeCSSVariables();
    },
    [themeState, currentMode, setThemeState]
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <SliderWithInput
          value={localAdjustments.hueShift}
          onStart={captureSnapshot}
          onChangeImmediate={(value) =>
            handleBatchChangeImmediate({ ...localAdjustments, hueShift: value })
          }
          onCommit={(value) =>
            applyAdjustments({ ...localAdjustments, hueShift: value })
          }
          onChange={() => {}} // Controlled by local state via immediate/commit
          min={-180}
          max={180}
          step={1}
          label="Hue Shift"
        />
        <SliderWithInput
          value={localAdjustments.chromaScale}
          onStart={captureSnapshot}
          onChangeImmediate={(value) =>
            handleBatchChangeImmediate({
              ...localAdjustments,
              chromaScale: value,
            })
          }
          onCommit={(value) =>
            applyAdjustments({ ...localAdjustments, chromaScale: value })
          }
          onChange={() => {}}
          min={0.01}
          max={5}
          step={0.01}
          label="Chroma"
        />
        <SliderWithInput
          value={localAdjustments.lightnessScale}
          onStart={captureSnapshot}
          onChangeImmediate={(value) =>
            handleBatchChangeImmediate({
              ...localAdjustments,
              lightnessScale: value,
            })
          }
          onCommit={(value) =>
            applyAdjustments({ ...localAdjustments, lightnessScale: value })
          }
          onChange={() => {}}
          min={0.1}
          max={5}
          step={0.01}
          label="Lightness"
        />
        <SliderWithInput
          value={localAdjustments.contrast}
          onStart={captureSnapshot}
          onChangeImmediate={(value) =>
            handleBatchChangeImmediate({ ...localAdjustments, contrast: value })
          }
          onCommit={(value) =>
            applyAdjustments({ ...localAdjustments, contrast: value })
          }
          onChange={() => {}}
          min={0.25}
          max={4}
          step={0.05}
          label="Contrast"
        />
        <div className="col-span-2">
          <SliderWithInput
            value={localAdjustments.temperature}
            onStart={captureSnapshot}
            onChangeImmediate={(value) =>
              handleBatchChangeImmediate({
                ...localAdjustments,
                temperature: value,
              })
            }
            onCommit={(value) =>
              applyAdjustments({ ...localAdjustments, temperature: value })
            }
            onChange={() => {}}
            min={-100}
            max={100}
            step={1}
            label="Temperature"
          />
        </div>
      </div>
    </div>
  );
};

export default ColorAdjustmentControls;
