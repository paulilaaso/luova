"use client";

import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/luova-ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/luova-ui/select";
import { useAiStore } from "@/stores/ai-store";
import { useThemePresetStore } from "@/stores/theme-preset-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { ThemeEngine } from "@/utils/theme-engine";
import { getPresetThemeStyles } from "@/utils/theme-preset-helper";

const ColorBox = ({ color }: { color: string }) => (
  <div
    className="h-3 min-w-0 flex-1 rounded-sm border border-border/50"
    style={{ backgroundColor: color }}
  />
);

const ThemeColors = ({
  presetName,
  mode,
}: {
  presetName: string;
  mode: "light" | "dark";
}) => {
  const styles = getPresetThemeStyles(presetName)[mode];
  return (
    <div className="flex w-13 shrink-1 gap-0.5 overflow-hidden">
      <ColorBox color={styles.primary} />
      <ColorBox color={styles.accent} />
      <ColorBox color={styles.secondary} />
      <ColorBox color={styles.border} />
    </div>
  );
};

export default function PresetSelector() {
  const themeState = useThemeStore((state) => state.themeState);
  const setThemeState = useThemeStore((state) => state.setThemeState);
  const { getAllPresets } = useThemePresetStore();
  const propertiesTab = useAiStore((s) => s.propertiesTab);
  const presets = getAllPresets();

  const isThemeLocked = useUIStore((state) => state.isThemeLocked);
  const lockedThemeState = useUIStore((state) => state.lockedThemeState);
  const lockThemeToState = useUIStore((state) => state.lockThemeToState);
  const unlockTheme = useUIStore((state) => state.unlockTheme);

  const handlePresetChange = (presetName: string | null) => {
    if (!presetName) return;
    const newStyles = getPresetThemeStyles(presetName);

    // Preserve custom fonts from the current theme
    const customFontsLight = themeState.styles.light?.customFonts;
    const customFontsDark = themeState.styles.dark?.customFonts;

    if (customFontsLight) {
      newStyles.light.customFonts = customFontsLight;
    }
    if (customFontsDark) {
      newStyles.dark.customFonts = customFontsDark;
    }

    const nextState = {
      ...themeState,
      preset: presetName,
      styles: newStyles,
    };

    // Clear any live-preview overrides from the previous preset before applying
    ThemeEngine.clearAllThemeCSSVariables();
    setThemeState(nextState);
  };

  const handleLockToggle = () => {
    if (isThemeLocked) {
      unlockTheme();
      ThemeEngine.commitThemeToCompiledCSS();
    } else {
      // Clear inline preview overrides so stylesheet scoping owns the lock.
      ThemeEngine.clearAllThemeCSSVariables();
      lockThemeToState(themeState);
    }
  };

  const currentPreset = themeState.preset || "default";
  const currentMode = themeState.currentMode;
  const currentPresetLabel =
    currentPreset === "default"
      ? "Default"
      : presets[currentPreset]?.label || currentPreset;

  const presetOptions: string[] = Object.keys(presets)
    .filter((k) => k === "default" || !!presets[k])
    .sort((a, b) => {
      if (a === "default") return -1;
      if (b === "default") return 1;
      const la = (presets[a]?.label || a).toLowerCase();
      const lb = (presets[b]?.label || b).toLowerCase();
      return la.localeCompare(lb);
    });

  const handlePresetKeyDown = (e: React.KeyboardEvent) => {
    if (propertiesTab !== "theme") return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

    e.nativeEvent.stopImmediatePropagation();
    e.preventDefault();
    e.stopPropagation();

    const currentIndex = presetOptions.indexOf(currentPreset);
    const nextIndex =
      e.key === "ArrowDown"
        ? (currentIndex + 1) % presetOptions.length
        : (currentIndex - 1 + presetOptions.length) % presetOptions.length;

    handlePresetChange(presetOptions[nextIndex]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex w-full gap-1">
        <Select value={currentPreset} onValueChange={handlePresetChange}>
          <SelectTrigger
            className="min-w-0 flex-1 text-sm"
            style={{ height: "2.25rem", paddingInline: "1rem" }}
            onKeyDown={handlePresetKeyDown}
            onKeyDownCapture={handlePresetKeyDown}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ThemeColors presetName={currentPreset} mode={currentMode} />
              <SelectValue
                className="min-w-0 truncate"
                placeholder="Select a preset"
              >
                {currentPresetLabel}
              </SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent>
            {presetOptions.map((key) => {
              const label =
                key === "default" ? "Default" : presets[key]?.label || key;
              return (
                <SelectItem key={key} value={key} className="pl-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <ThemeColors presetName={key} mode={currentMode} />
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate">{label}</span>
                      {isThemeLocked && key === lockedThemeState?.preset && (
                        <Lock className="text-primary h-3 w-3 shrink-0" />
                      )}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="icon"
          onClick={handleLockToggle}
          title={
            isThemeLocked
              ? `UI locked to current settings — click to unlock`
              : "Lock UI to current settings while editing canvas"
          }
          className="relative z-10"
          style={{
            width: "2.25rem",
            height: "2.25rem",
            boxShadow: "var(--select-shadow, none)",
          }}
        >
          {isThemeLocked ? (
            <Lock className="h-4 w-4 text-primary" />
          ) : (
            <LockOpen className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>
    </div>
  );
}
