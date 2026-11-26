"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { isInteractiveTextElement } from "@/lib/luova-utils";
import {
  getLiveCameraState,
  setLiveCameraState,
  useCanvasStore,
  zoomAroundViewportCenter,
} from "@/stores/canvas-store";

interface UseCanvasCameraOptions {
  containerRef: RefObject<HTMLElement | null>;
  canvasRef?: RefObject<HTMLElement | null>;
  gridOverlayRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

const ZOOM_SENSITIVITY = 0.015;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 20;
const PAN_MULTIPLIER = 1.8;

export function useCanvasCamera({
  containerRef,
  canvasRef: providedCanvasRef,
  gridOverlayRef: providedGridOverlayRef,
  enabled = true,
}: UseCanvasCameraOptions) {
  const setZoom = useCanvasStore((state) => state.setZoom);
  const zoomIn = useCanvasStore((state) => state.zoomIn);
  const zoomOut = useCanvasStore((state) => state.zoomOut);
  const zoomTo100 = useCanvasStore((state) => state.zoomTo100);
  const zoomToFit = useCanvasStore((state) => state.zoomToFit);
  const setCamera = useCanvasStore((state) => state.setCamera);
  const _gridConfig = useCanvasStore((state) => state.gridConfig);
  const canvasStore = useCanvasStore;

  // Refs for space+drag and middle-click panning
  const isSpaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const rafIdRef = useRef<number | null>(null);
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useRef<HTMLElement | null>(null);

  // Cached overlay refs — eliminates querySelector from the 60fps loop
  const gridRef = useRef<HTMLElement | null>(null);

  // Mount effect: cache DOM refs, seed live state, apply initial transforms
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    canvasRef.current =
      providedCanvasRef?.current ??
      container.querySelector<HTMLElement>('[data-canvas="true"]');

    // Seed the live singleton from persisted Zustand state
    const { panX, panY, zoom } = canvasStore.getState();
    setLiveCameraState(panX, panY, zoom);

    // Apply initial camera state directly to DOM nodes
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    }

    // Cache overlay refs for the 60fps loop
    gridRef.current =
      providedGridOverlayRef?.current ??
      (container.querySelector(".grid-overlay") as HTMLElement);

    const initGrid = gridRef.current;
    if (initGrid) {
      initGrid.style.setProperty("--canvas-zoom", `${zoom}`);
      initGrid.style.setProperty("--canvas-pan-x", `${panX}px`);
      initGrid.style.setProperty("--canvas-pan-y", `${panY}px`);
    }

    // Set initial container zoom for selection borders
    container.style.setProperty("--canvas-zoom", zoom.toString());

    // Force grid repaint on container resize (handles ResizablePanel layout settling)
    const gridOverlay =
      providedGridOverlayRef?.current ??
      container.querySelector<HTMLElement>(".grid-overlay");
    const resizeObserver = new ResizeObserver(() => {
      if (gridOverlay) {
        gridOverlay.style.display = "none";
        gridOverlay.offsetHeight; // force reflow
        gridOverlay.style.display = "";
      }
    });
    resizeObserver.observe(container);
    const resizeCleanupTimer = setTimeout(
      () => resizeObserver.disconnect(),
      2000
    );

    // Subscribe to Zustand for external camera changes (zoomToFit, resetView, undo/redo).
    // Guard: ignore updates while the user is actively panning — those are just
    // debounce echoes of our own writes and would rubber-band the camera.
    const unsub = canvasStore.subscribe((state) => {
      if (
        isPanningRef.current ||
        isSpaceHeldRef.current ||
        (typeof document !== "undefined" &&
          document.body.classList.contains("is-zooming"))
      )
        return;

      const live = getLiveCameraState();
      const dx = Math.abs(live.panX - state.panX);
      const dy = Math.abs(live.panY - state.panY);
      const dz = Math.abs(live.zoom - state.zoom);

      // Skip micro-deltas caused by the debounce round-trip
      if (dx < 1 && dy < 1 && dz < 0.001) return;

      setLiveCameraState(state.panX, state.panY, state.zoom);

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`;
      }

      if (!gridRef.current && container) {
        gridRef.current = container.querySelector(
          ".grid-overlay"
        ) as HTMLElement;
      }
      const grid = gridRef.current;

      if (grid) {
        grid.style.setProperty("--canvas-pan-x", `${state.panX}px`);
        grid.style.setProperty("--canvas-pan-y", `${state.panY}px`);
        grid.style.setProperty("--canvas-zoom", `${state.zoom}`);
      }

      // Discrete update: safe to apply immediately
      if (container) {
        container.style.setProperty("--canvas-zoom", state.zoom.toString());
        const framesWithInlineZoom = container.querySelectorAll<HTMLElement>(
          '.canvas-frame[style*="--canvas-zoom"]'
        );
        for (let i = 0; i < framesWithInlineZoom.length; i++) {
          framesWithInlineZoom[i].style.removeProperty("--canvas-zoom");
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      clearTimeout(resizeCleanupTimer);
      unsub();
      gridRef.current = null;
    };
  }, [containerRef, providedCanvasRef, providedGridOverlayRef, enabled]);

  const updateDOM = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { panX: x, panY: y, zoom: z } = getLiveCameraState();

    // Direct GPU-composited transform — no layout thrash
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    }

    // CSS vars applied ONLY to the grid overlay (background-size triggers paint, not layout)
    if (!gridRef.current) {
      gridRef.current = container.querySelector(".grid-overlay") as HTMLElement;
    }
    const grid = gridRef.current;

    if (grid) {
      grid.style.setProperty("--canvas-pan-x", `${x}px`);
      grid.style.setProperty("--canvas-pan-y", `${y}px`);
      grid.style.setProperty("--canvas-zoom", z.toString());
    }

    // Continuously update container zoom for selection borders/handles
    if (typeof document !== "undefined") {
      const isZooming = document.body.classList.contains("is-zooming");
      if (isZooming) {
        // During active zoom, write directly to the active frames to avoid container layout invalidation
        const activeFrames = container.querySelectorAll<HTMLElement>(
          ".canvas-frame.is-selected, .canvas-frame:not([data-preview='true']):hover"
        );
        for (let i = 0; i < activeFrames.length; i++) {
          activeFrames[i].style.setProperty("--canvas-zoom", z.toString());
        }
      } else {
        // Outside active zoom, write to the container and clean up active frames' inline style
        container.style.setProperty("--canvas-zoom", z.toString());
        const framesWithInlineZoom = container.querySelectorAll<HTMLElement>(
          '.canvas-frame[style*="--canvas-zoom"]'
        );
        for (let i = 0; i < framesWithInlineZoom.length; i++) {
          framesWithInlineZoom[i].style.removeProperty("--canvas-zoom");
        }
      }
    }
  }, [containerRef]);

  const requestUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      updateDOM();
      rafIdRef.current = null;
    });
  }, [updateDOM]);

  const syncToStore = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced sync: write floating-point live state to Zustand (no rounding)
  const debouncedSync = useCallback(() => {
    if (syncToStore.current) clearTimeout(syncToStore.current);
    syncToStore.current = setTimeout(() => {
      const { panX, panY, zoom } = getLiveCameraState();
      setCamera(panX, panY, zoom);
    }, 150);
  }, [setCamera]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!enabled) return;

      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        // Engage GPU acceleration
        document.body.classList.add("is-zooming");

        // Disable pointer events ONLY on the canvas, not the body!
        // If set on the body, the wheel event falls through the document, breaking the scroll stream.
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.pointerEvents = "none";
        }

        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const {
          panX: currentPanX,
          panY: currentPanY,
          zoom: currentZoom,
        } = getLiveCameraState();

        // Clamp the delta to prevent standard notched mouse wheels from teleporting the camera,
        // while preserving smooth micro-movements for trackpads.
        const normalizedDelta =
          Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 30);
        const zoomFactor = Math.exp(-normalizedDelta * ZOOM_SENSITIVITY);

        // Do not round the zoom value during the high-frequency gesture!
        // Rounding swallows small trackpad deltas at extreme scales, trapping the zoom.
        const newZoom = Math.min(
          Math.max(currentZoom * zoomFactor, MIN_ZOOM),
          MAX_ZOOM
        );

        if (newZoom === currentZoom) return;

        // Adjust pan so the point under the cursor stays fixed
        const scale = newZoom / currentZoom;
        const newPanX = cursorX - scale * (cursorX - currentPanX);
        const newPanY = cursorY - scale * (cursorY - currentPanY);

        setLiveCameraState(newPanX, newPanY, newZoom);
        requestUpdate();
        debouncedSync();

        // Release zoom lock after gesture ends
        if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);
        zoomEndTimerRef.current = setTimeout(() => {
          document.body.classList.remove("is-zooming");

          // Restore canvas interactivity
          if (canvas) {
            canvas.style.removeProperty("pointer-events");
          }

          // Resolution nudge: force browser to re-rasterize at final scale
          if (canvas) {
            canvas.style.opacity = "0.999";
            requestAnimationFrame(() => {
              canvas.style.opacity = "1";
            });
          }

          // Snap selection borders/handles to the final zoom level
          updateDOM();
        }, 150);
      } else {
        const live = getLiveCameraState();
        setLiveCameraState(
          live.panX - e.deltaX * PAN_MULTIPLIER,
          live.panY - e.deltaY * PAN_MULTIPLIER,
          live.zoom
        );
        requestUpdate();
        debouncedSync();
      }
    },
    [enabled, containerRef, requestUpdate, debouncedSync, updateDOM]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      if (e.code === "Space") {
        if (isInteractiveTextElement(e.target)) return;
        e.preventDefault();
        if (isSpaceHeldRef.current) return;
        isSpaceHeldRef.current = true;
        const container = containerRef.current;
        if (container) container.style.cursor = "grab";
        if (typeof document !== "undefined")
          document.body.classList.add("is-panning-mode");
        return;
      }

      if (isInteractiveTextElement(e.target)) return;

      const isMac =
        (
          navigator as unknown as { userAgentData?: { platform?: string } }
        ).userAgentData?.platform
          ?.toLowerCase()
          .startsWith("mac") || /Mac|iPad/.test(navigator.userAgent);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const { zoom: curZoom } = getLiveCameraState();
        zoomAroundViewportCenter(Math.min(curZoom * 1.25, MAX_ZOOM));
        return;
      }
      if (modKey && e.key === "-") {
        e.preventDefault();
        const { zoom: curZoom } = getLiveCameraState();
        zoomAroundViewportCenter(Math.max(curZoom / 1.25, MIN_ZOOM));
        return;
      }
      if (modKey && e.key === "0") {
        e.preventDefault();
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          zoomTo100(rect.width, rect.height);
        }
        return;
      }
      if (modKey && e.key === "1") {
        e.preventDefault();
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          zoomToFit(rect.width, rect.height);
        }
        return;
      }
    },
    [enabled, containerRef, zoomTo100, zoomToFit]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpaceHeldRef.current = false;
        if (typeof document !== "undefined")
          document.body.classList.remove("is-panning-mode");
        if (!isPanningRef.current) {
          const container = containerRef.current;
          if (container) container.style.cursor = "";
        }
      }
    },
    [containerRef]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;

      const isSpacePan = isSpaceHeldRef.current && e.button === 0;
      const isMiddlePan = e.button === 1;

      if (isSpacePan || isMiddlePan) {
        e.preventDefault();
        isPanningRef.current = true;
        document.body.classList.add("is-panning");
        document.body.style.setProperty("pointer-events", "none");
        panStartRef.current = { x: e.clientX, y: e.clientY };
        const container = containerRef.current;
        if (container) container.style.cursor = "grabbing";
      }
    },
    [enabled, containerRef]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isPanningRef.current) return;

      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      panStartRef.current = { x: e.clientX, y: e.clientY };

      const live = getLiveCameraState();
      setLiveCameraState(
        live.panX + dx * PAN_MULTIPLIER,
        live.panY + dy * PAN_MULTIPLIER,
        live.zoom
      );

      requestUpdate();
    },
    [requestUpdate]
  );

  const handleMouseUp = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;

    const container = containerRef.current;
    if (container) {
      container.style.cursor = isSpaceHeldRef.current ? "grab" : "";
    }
    document.body.classList.remove("is-panning");
    document.body.style.removeProperty("pointer-events");

    // Final sync on mouse up — exact floating-point, no rounding
    const { panX, panY, zoom } = getLiveCameraState();
    setCamera(panX, panY, zoom);
  }, [containerRef, setCamera]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (syncToStore.current) clearTimeout(syncToStore.current);
      if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);

      if (typeof document !== "undefined") {
        document.body.classList.remove("is-panning");
        document.body.classList.remove("is-panning-mode");
        document.body.classList.remove("is-zooming");
        document.body.style.removeProperty("pointer-events");
      }
    };
  }, [
    containerRef,
    enabled,
    handleWheel,
    handleKeyDown,
    handleKeyUp,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  ]);

  return {
    zoomIn,
    zoomOut,
    zoomTo100,
    zoomToFit,
    setZoom,
  };
}
