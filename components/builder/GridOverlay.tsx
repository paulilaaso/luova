"use client";

import React, { type RefObject } from "react";
import { cn } from "@/lib/luova-utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";

interface GridOverlayProps {
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}

const DEFAULT_GRID_COLOR = "#e0e0e0";

export default function GridOverlay({
  containerRef: _containerRef,
  className = "",
}: GridOverlayProps) {
  const gridConfig = useCanvasStore((state) => state.gridConfig);
  const zoom = useCanvasStore((state) => state.zoom);
  const currentMode = useThemeStore((state) => state.currentMode);
  const isThemeLocked = useUIStore((state) => state.isThemeLocked);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const _isDark = mounted && currentMode === "dark";

  // When theme is locked, always use the live canvas theme colors
  // Otherwise use the configured grid color
  const strokeColor =
    gridConfig.gridColor === DEFAULT_GRID_COLOR || isThemeLocked
      ? "var(--border)"
      : gridConfig.gridColor;

  const { gridSize, showGrid, gridOpacity } = gridConfig;
  const largeGridSize = gridSize * 5;

  // Smooth opacity ramp: Primary grid fades in as zoom increases
  // Uses cubic easing for natural fade-in (0 at zoom=0, 1 at zoom=0.5)
  const zoomFactor = Math.min(zoom / 0.5, 1);
  const baseOpacity =
    gridOpacity * (zoomFactor * zoomFactor * (3 - 2 * zoomFactor)); // Cubic easing

  // Secondary grid fades out before primary becomes visible to avoid artifacts
  // Completely invisible below 0.15 zoom, fully visible above 0.35 zoom
  const secondaryFadeStart = 0.15;
  const secondaryFadeEnd = 0.35;
  const secondaryRamp = Math.max(
    0,
    Math.min(
      1,
      (secondaryFadeEnd - zoom) / (secondaryFadeEnd - secondaryFadeStart)
    )
  );
  const secondaryOpacity = gridOpacity * 0.75 * secondaryRamp;

  if (!showGrid || !mounted) return null;

  const bgImage = `linear-gradient(to right, var(--grid-color, ${strokeColor}) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-color, ${strokeColor}) 1px, transparent 1px)`;

  return (
    <div
      data-app-chrome="true"
      className={cn(
        "grid-overlay pointer-events-none absolute inset-0 z-0 overflow-hidden",
        className
      )}
      style={
        {
          "--grid-bg-image": bgImage,
          "--grid-color": strokeColor,
          "--grid-size": `${gridSize}px`,
          "--grid-large-size": `${largeGridSize}px`,
          "--canvas-grid-opacity": baseOpacity,
          "--canvas-grid-secondary-opacity": secondaryOpacity,
        } as React.CSSProperties
      }
    >
      {/* Primary Grid: Always rendered, opacity controlled by CSS for smooth transitions */}
      <div data-grid="primary" className="absolute inset-0 w-full h-full" />
      {/* Secondary (Large) Grid: Always rendered, opacity ramp prevents artifacts */}
      <div data-grid="secondary" className="absolute inset-0 w-full h-full" />
    </div>
  );
}
