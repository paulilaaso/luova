"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/luova-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/luova-ui/dropdown-menu";
import {
  getLiveCameraState,
  useCanvasStore,
  zoomAroundViewportCenter,
} from "@/stores/canvas-store";

const ZOOM_PRESETS = [
  { label: "Zoom to 50%", value: 0.5 },
  { label: "Zoom to 100%", value: 1, shortcut: "⌘0" },
  { label: "Zoom to 200%", value: 2 },
];

/** Read the live zoom at 60fps so the percentage label stays current during scroll/pinch. */
function useLiveZoom() {
  const storeZoom = useCanvasStore((s) => s.zoom);
  const [displayZoom, setDisplayZoom] = useState(storeZoom);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const poll = () => {
      if (!active) return;
      const liveZoom = getLiveCameraState().zoom;
      setDisplayZoom(liveZoom);
      rafRef.current = requestAnimationFrame(poll);
    };

    rafRef.current = requestAnimationFrame(poll);

    return () => {
      active = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return displayZoom;
}

export default function ZoomControls() {
  const zoom = useLiveZoom();
  const zoomToFit = useCanvasStore((state) => state.zoomToFit);

  const handleZoomIn = useCallback(() => {
    const curZoom = getLiveCameraState().zoom;
    zoomAroundViewportCenter(Math.min(5, curZoom * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    const curZoom = getLiveCameraState().zoom;
    zoomAroundViewportCenter(Math.max(0.1, curZoom / 1.25));
  }, []);

  const handleZoomToFit = useCallback(() => {
    const container = document.querySelector("[data-canvas-container]");
    if (container) {
      const rect = container.getBoundingClientRect();
      zoomToFit(rect.width, rect.height);
    }
  }, [zoomToFit]);

  const zoomPercentage = Math.round(zoom * 100);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-2 font-mono text-xs rounded-lg shadow-sm"
            title="Zoom level"
            data-app-chrome="true"
          >
            {zoomPercentage}%
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="min-w-[180px]"
        data-app-chrome="true"
      >
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            onClick={() => zoomAroundViewportCenter(preset.value)}
            className={
              Math.round(zoom * 100) === Math.round(preset.value * 100)
                ? "bg-accent"
                : ""
            }
          >
            {preset.label}
            {preset.shortcut && (
              <DropdownMenuShortcut>{preset.shortcut}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleZoomIn}>
          Zoom in
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleZoomOut}>
          Zoom out
          <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleZoomToFit}>
          Zoom to fit
          <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
