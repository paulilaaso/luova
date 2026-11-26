"use client";

import { type ReactNode, useMemo } from "react";
import { defaultThemeState } from "@/config/theme";
import {
  useOptimizedSliderUpdate,
  useOptimizedThemeUpdate,
} from "@/hooks/use-optimized-theme-update";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { ThemeEngine } from "@/utils/theme-engine";
import { SliderWithInput } from "./SliderWithInput";
import { ExpandableCard } from "./ui/ExpandableCard";

const PANEL_KEY = "theme";

interface ShapeSectionProps {
  value: string;
  title: string;
  children: ReactNode;
}

const ShapeAccordionSection = ({
  value,
  title,
  children,
}: ShapeSectionProps) => {
  const expandedItems = useUIStore(
    (state) => state.expandedAccordions[PANEL_KEY] || []
  );
  const setExpandedItems = useUIStore((state) => state.setExpandedItems);
  const isExpanded = expandedItems.includes(value);

  const handleToggle = () => {
    if (isExpanded) {
      setExpandedItems(
        PANEL_KEY,
        expandedItems.filter((id) => id !== value)
      );
    } else {
      setExpandedItems(PANEL_KEY, [...expandedItems, value]);
    }
  };

  return (
    <ExpandableCard
      title={title}
      isExpanded={isExpanded}
      onToggle={handleToggle}
    >
      {children}
    </ExpandableCard>
  );
};

interface GlobalShapeContentProps {
  styles: Record<string, string | undefined>;
}

const GlobalShapeContent = ({ styles }: GlobalShapeContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);
  const updateThemeRadius = useThemeStore((state) => state.updateThemeRadius);
  const { handleSliderChange } = useOptimizedSliderUpdate();
  const { updateTokenImmediate } = useOptimizedThemeUpdate();

  const radius = parseFloat(styles.radius?.replace("rem", "") || "0.5");
  const smoothing = parseFloat(styles.smoothing ?? "0");

  return (
    <div className="grid grid-cols-1 gap-4">
      <SliderWithInput
        value={parseFloat(styles.spacing ?? "0") || 0.5}
        onChange={(value) => updateThemeToken("spacing", `${value}rem`)}
        onChangeImmediate={(value) =>
          handleSliderChange("spacing", value, "rem")
        }
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["spacing"]);
          updateThemeToken("spacing", undefined);
        }}
        min={0.1}
        max={1}
        step={0.01}
        label="Spacing"
      />
      <SliderWithInput
        value={radius}
        onChange={(value) => {
          ThemeEngine.applyToken("radius", `${value}rem`);
          updateTokenImmediate("radius", `${value}rem`);
          updateThemeRadius(value, smoothing);
        }}
        onChangeImmediate={(value) => {
          ThemeEngine.applyToken("radius", `${value}rem`);
          updateTokenImmediate("radius", `${value}rem`);
        }}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["radius"]);
          updateThemeToken("radius", undefined);
        }}
        min={0}
        max={2}
        step={0.1}
        label="Radius"
      />
      <SliderWithInput
        value={smoothing}
        onChange={(value) => {
          const nextValue = `${Math.round(value)}`;
          updateTokenImmediate("smoothing", nextValue);
          updateThemeToken("smoothing", nextValue);
        }}
        onChangeImmediate={(value) => {
          const nextValue = `${Math.round(value)}`;
          updateTokenImmediate("smoothing", nextValue);
          ThemeEngine.applyToken("smoothing", nextValue);
        }}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["smoothing"]);
          updateThemeToken("smoothing", undefined);
        }}
        min={0}
        max={100}
        step={1}
        label="Smoothing"
      />
      <SliderWithInput
        value={parseFloat(styles["border-width"]?.replace("px", "") || "1")}
        onChange={(value) => updateThemeToken("border-width", `${value}px`)}
        onChangeImmediate={(value) =>
          handleSliderChange("border-width", value, "px")
        }
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["border-width"]);
          updateThemeToken("border-width", undefined);
        }}
        min={0}
        max={8}
        step={0.5}
        label="Border"
      />
    </div>
  );
};

export default function ShapeSettings() {
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);

  const currentStyles = useMemo(
    () => ({
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    }),
    [currentMode, themeState]
  );

  return (
    <div className="flex flex-col gap-5">
      <ShapeAccordionSection value="global-shape" title="Global Shape">
        <GlobalShapeContent styles={currentStyles} />
      </ShapeAccordionSection>
    </div>
  );
}
