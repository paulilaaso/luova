"use client";

import React from "react";
import { defaultThemeState } from "@/config/theme";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import type { ThemeStyleProps } from "@/types/theme";
import { ThemeEngine } from "@/utils/theme-engine";
import ColorAdjustmentControls from "./ColorAdjustmentControls";
import { OptimizedColorPicker } from "./OptimizedColorPicker";
import PresetSelector from "./PresetSelector";
import { ExpandableCard } from "./ui/ExpandableCard";

const PANEL_KEY = "theme";

interface ColorSectionProps {
  value: string;
  title: string;
  children: React.ReactNode;
}

interface ColorContentProps {
  styles: ThemeStyleProps;
}

const ColorAccordionSection = ({
  value,
  title,
  children,
}: ColorSectionProps) => {
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

const BaseColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.background}
        onChange={(value) => updateThemeToken("background", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["background"]);
          updateThemeToken("background", undefined);
        }}
        label="Background"
        name="background"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.foreground}
        onChange={(value) => updateThemeToken("foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["foreground"]);
          updateThemeToken("foreground", undefined);
        }}
        label="Foreground"
        name="foreground"
      />
    </div>
  );
};

const CardColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.card}
        onChange={(value) => updateThemeToken("card", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["card"]);
          updateThemeToken("card", undefined);
        }}
        label="Background"
        name="card"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["card-foreground"]}
        onChange={(value) => updateThemeToken("card-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["card-foreground"]);
          updateThemeToken("card-foreground", undefined);
        }}
        label="Foreground"
        name="card-foreground"
      />
    </div>
  );
};

const PrimaryColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.primary}
        onChange={(value) => updateThemeToken("primary", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["primary"]);
          updateThemeToken("primary", undefined);
        }}
        label="Background"
        name="primary"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["primary-foreground"]}
        onChange={(value) => updateThemeToken("primary-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["primary-foreground"]);
          updateThemeToken("primary-foreground", undefined);
        }}
        label="Foreground"
        name="primary-foreground"
      />
    </div>
  );
};

const SecondaryColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.secondary}
        onChange={(value) => updateThemeToken("secondary", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["secondary"]);
          updateThemeToken("secondary", undefined);
        }}
        label="Background"
        name="secondary"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["secondary-foreground"]}
        onChange={(value) => updateThemeToken("secondary-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["secondary-foreground"]);
          updateThemeToken("secondary-foreground", undefined);
        }}
        label="Foreground"
        name="secondary-foreground"
      />
    </div>
  );
};

const AccentColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.accent}
        onChange={(value) => updateThemeToken("accent", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["accent"]);
          updateThemeToken("accent", undefined);
        }}
        label="Background"
        name="accent"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["accent-foreground"]}
        onChange={(value) => updateThemeToken("accent-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["accent-foreground"]);
          updateThemeToken("accent-foreground", undefined);
        }}
        label="Foreground"
        name="accent-foreground"
      />
    </div>
  );
};

const PopoverColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.popover}
        onChange={(value) => updateThemeToken("popover", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["popover"]);
          updateThemeToken("popover", undefined);
        }}
        label="Background"
        name="popover"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["popover-foreground"]}
        onChange={(value) => updateThemeToken("popover-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["popover-foreground"]);
          updateThemeToken("popover-foreground", undefined);
        }}
        label="Foreground"
        name="popover-foreground"
      />
    </div>
  );
};

const MutedColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.muted}
        onChange={(value) => updateThemeToken("muted", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["muted"]);
          updateThemeToken("muted", undefined);
        }}
        label="Background"
        name="muted"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["muted-foreground"]}
        onChange={(value) => updateThemeToken("muted-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["muted-foreground"]);
          updateThemeToken("muted-foreground", undefined);
        }}
        label="Foreground"
        name="muted-foreground"
      />
    </div>
  );
};

const DestructiveColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.destructive}
        onChange={(value) => updateThemeToken("destructive", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["destructive"]);
          updateThemeToken("destructive", undefined);
        }}
        label="Background"
        name="destructive"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["destructive-foreground"]}
        onChange={(value) => updateThemeToken("destructive-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["destructive-foreground"]);
          updateThemeToken("destructive-foreground", undefined);
        }}
        label="Foreground"
        name="destructive-foreground"
      />
    </div>
  );
};

const BorderInputColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.border}
        onChange={(value) => updateThemeToken("border", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["border"]);
          updateThemeToken("border", undefined);
        }}
        label="Border"
        name="border"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.input}
        onChange={(value) => updateThemeToken("input", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["input"]);
          updateThemeToken("input", undefined);
        }}
        label="Input"
        name="input"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.ring}
        onChange={(value) => updateThemeToken("ring", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["ring"]);
          updateThemeToken("ring", undefined);
        }}
        label="Ring"
        name="ring"
      />
    </div>
  );
};

const SidebarColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      <OptimizedColorPicker
        enableGradient={false}
        color={styles.sidebar}
        onChange={(value) => updateThemeToken("sidebar", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar"]);
          updateThemeToken("sidebar", undefined);
        }}
        label="Background"
        name="sidebar"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-foreground"]}
        onChange={(value) => updateThemeToken("sidebar-foreground", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-foreground"]);
          updateThemeToken("sidebar-foreground", undefined);
        }}
        label="Foreground"
        name="sidebar-foreground"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-primary"]}
        onChange={(value) => updateThemeToken("sidebar-primary", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-primary"]);
          updateThemeToken("sidebar-primary", undefined);
        }}
        label="Primary Background"
        name="sidebar-primary"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-primary-foreground"]}
        onChange={(value) =>
          updateThemeToken("sidebar-primary-foreground", value)
        }
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-primary-foreground"]);
          updateThemeToken("sidebar-primary-foreground", undefined);
        }}
        label="Primary Foreground"
        name="sidebar-primary-foreground"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-accent"]}
        onChange={(value) => updateThemeToken("sidebar-accent", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-accent"]);
          updateThemeToken("sidebar-accent", undefined);
        }}
        label="Accent Background"
        name="sidebar-accent"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-accent-foreground"]}
        onChange={(value) =>
          updateThemeToken("sidebar-accent-foreground", value)
        }
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-accent-foreground"]);
          updateThemeToken("sidebar-accent-foreground", undefined);
        }}
        label="Accent Foreground"
        name="sidebar-accent-foreground"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-border"]}
        onChange={(value) => updateThemeToken("sidebar-border", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-border"]);
          updateThemeToken("sidebar-border", undefined);
        }}
        label="Border"
        name="sidebar-border"
      />
      <OptimizedColorPicker
        enableGradient={false}
        color={styles["sidebar-ring"]}
        onChange={(value) => updateThemeToken("sidebar-ring", value)}
        onReset={() => {
          ThemeEngine.clearTokensCssVariables(["sidebar-ring"]);
          updateThemeToken("sidebar-ring", undefined);
        }}
        label="Ring"
        name="sidebar-ring"
      />
    </div>
  );
};

const ChartColorsContent = ({ styles }: ColorContentProps) => {
  const updateThemeToken = useThemeStore((state) => state.updateThemeToken);

  return (
    <div className="grid grid-cols-2 gap-2 [&>*:nth-child(odd):last-child]:col-span-2">
      {(["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const).map(
        (chart) => (
          <OptimizedColorPicker
            enableGradient={false}
            key={chart}
            color={styles[chart]}
            onChange={(value) => updateThemeToken(chart, value)}
            onReset={() => {
              ThemeEngine.clearTokensCssVariables([chart]);
              updateThemeToken(chart, undefined);
            }}
            label={`Chart ${chart.split("-")[1]}`}
            name={chart}
          />
        )
      )}
    </div>
  );
};

export default function ColorSettings() {
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);

  const currentStyles = React.useMemo(
    () => ({
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    }),
    [currentMode, themeState]
  );

  return (
    <div className="flex flex-col gap-5">
      <PresetSelector />
      <ColorAccordionSection value="hsl-adjustments" title="Color Adjustments">
        <ColorAdjustmentControls />
      </ColorAccordionSection>

      <ColorAccordionSection value="base-colors" title="Base">
        <BaseColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="card-colors" title="Card">
        <CardColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="primary-colors" title="Primary">
        <PrimaryColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="secondary-colors" title="Secondary">
        <SecondaryColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="accent-colors" title="Accent">
        <AccentColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="popover-colors" title="Popover">
        <PopoverColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="muted-colors" title="Muted">
        <MutedColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="destructive-colors" title="Destructive">
        <DestructiveColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="border-input-colors" title="Border & Input">
        <BorderInputColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="sidebar-colors" title="Sidebar">
        <SidebarColorsContent styles={currentStyles} />
      </ColorAccordionSection>

      <ColorAccordionSection value="chart-colors" title="Chart">
        <ChartColorsContent styles={currentStyles} />
      </ColorAccordionSection>
    </div>
  );
}
