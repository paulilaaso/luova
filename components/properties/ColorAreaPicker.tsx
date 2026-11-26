"use client";

import * as culori from "culori";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  composeFromOklch,
  decomposeToOklch,
  type OklchComponents,
} from "@/utils/color-converter";

export interface ColorAreaPickerProps {
  color: string;
  alpha: number;
  onChange: (components: OklchComponents) => void;
  onChangeImmediate: (components: OklchComponents) => void;
  onDragStart?: () => void;
  onDragEnd?: (components: OklchComponents) => void;
  liveOklchRef?: React.RefObject<OklchComponents>;
}

const MAX_C = 0.37;

function renderAreaCanvas(canvas: HTMLCanvasElement, hue: number, dpr: number) {
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 180;
  const backingW = Math.round(cssW * dpr);
  const backingH = Math.round(cssH * dpr);

  canvas.width = backingW;
  canvas.height = backingH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = Math.max(1, Math.round(backingW / 2));
  const H = Math.max(1, Math.round(backingH / 2));

  const offscreen = document.createElement("canvas");
  offscreen.width = W;
  offscreen.height = H;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;

  const img = offCtx.createImageData(W, H);
  const d = img.data;

  const toRgb = culori.converter("rgb");

  for (let y = 0; y < H; y++) {
    const l = 1 - y / (H - 1);
    for (let x = 0; x < W; x++) {
      const c = (x / (W - 1)) * MAX_C;

      const rgb = toRgb({ mode: "oklch", l, c, h: hue });

      const i = (y * W + x) * 4;
      if (!rgb) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 255;
        continue;
      }

      d[i] = Math.round(Math.max(0, Math.min(1, rgb.r ?? 0)) * 255);
      d[i + 1] = Math.round(Math.max(0, Math.min(1, rgb.g ?? 0)) * 255);
      d[i + 2] = Math.round(Math.max(0, Math.min(1, rgb.b ?? 0)) * 255);
      d[i + 3] = 255;
    }
  }

  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, 0, 0, backingW, backingH);
}

export function ColorAreaPicker({
  color,
  alpha,
  onChange,
  onChangeImmediate,
  onDragStart,
  onDragEnd,
  liveOklchRef,
}: ColorAreaPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [thumbPos, setThumbPos] = useState({ x: 50, y: 50 });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const components = decomposeToOklch(color) ?? { l: 0.5, c: 0, h: 0, alpha };

  // Render canvas when hue changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    const rafId = requestAnimationFrame(() => {
      renderAreaCanvas(canvas, components.h, dpr);
    });

    return () => cancelAnimationFrame(rafId);
  }, [components.h]);

  // Observe container resize to re-render canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        renderAreaCanvas(canvas, components.h, dpr);
      }
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [components.h]);

  // Update thumb position when color changes externally
  useEffect(() => {
    if (isDraggingRef.current) return;
    const x = Math.min(100, (components.c / MAX_C) * 100);
    const y = (1 - components.l) * 100;
    setThumbPos({ x, y });
  }, [components.c, components.l]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      const thumb = thumbRef.current;
      if (!container) return;

      container.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      onDragStart?.();
      document.body.classList.add("is-color-dragging");

      container.getBoundingClientRect();

      const updateFromPointer = (clientX: number, clientY: number) => {
        const r = container.getBoundingClientRect();
        const xNorm = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        const yNorm = Math.max(0, Math.min(1, (clientY - r.top) / r.height));

        const c = xNorm * MAX_C;
        const l = 1 - yNorm;

        // Update thumb position imperatively during drag (no setState)
        if (thumb) {
          thumb.style.left = `${xNorm * 100}%`;
          thumb.style.top = `${yNorm * 100}%`;
        }

        const next: OklchComponents = { ...components, l, c };

        // Update thumb background color imperatively using liveOklchRef (C4)
        if (thumb && liveOklchRef?.current) {
          thumb.style.backgroundColor = composeFromOklch({
            ...liveOklchRef.current,
            l,
            c,
            alpha: 1,
          });
        }

        onChangeImmediate(next);
      };

      updateFromPointer(e.clientX, e.clientY);

      const handleMove = (ev: PointerEvent) => {
        ev.preventDefault();
        updateFromPointer(ev.clientX, ev.clientY);
      };

      const handleUp = (ev: PointerEvent) => {
        container.releasePointerCapture(ev.pointerId);
        isDraggingRef.current = false;
        document.body.classList.remove("is-color-dragging");

        const r = container.getBoundingClientRect();
        const xNorm = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        const yNorm = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));

        const c = xNorm * MAX_C;
        const l = 1 - yNorm;

        const next: OklchComponents = { ...components, l, c };
        onChange(next);
        onDragEnd?.(next);

        // Commit thumb position to state after drag ends
        setThumbPos({ x: xNorm * 100, y: yNorm * 100 });

        container.removeEventListener("pointermove", handleMove);
        container.removeEventListener("pointerup", handleUp);
        container.removeEventListener("pointercancel", handleCancel);
      };

      const handleCancel = () => {
        isDraggingRef.current = false;
        document.body.classList.remove("is-color-dragging");
        container.removeEventListener("pointermove", handleMove);
        container.removeEventListener("pointerup", handleUp);
        container.removeEventListener("pointercancel", handleCancel);
      };

      container.addEventListener("pointermove", handleMove);
      container.addEventListener("pointerup", handleUp);
      container.addEventListener("pointercancel", handleCancel);
    },
    [
      components,
      onChange,
      onChangeImmediate,
      onDragStart,
      onDragEnd,
      liveOklchRef,
    ]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[180px] w-full cursor-crosshair overflow-hidden rounded-md border"
      onPointerDown={handlePointerDown}
      style={{ contain: "layout style", touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "auto" }}
      />
      {/* Thumb */}
      <div
        ref={thumbRef}
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_1px_1px_rgba(0,0,0,0.25)] transition-transform duration-150 ease-out"
        style={{
          left: `${thumbPos.x}%`,
          top: `${thumbPos.y}%`,
          backgroundColor: composeFromOklch({ ...components, alpha: 1 }),
        }}
      />
    </div>
  );
}
