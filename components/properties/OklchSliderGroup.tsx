"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePointerDrag } from "@/hooks/use-pointer-drag";
import {
  composeFromOklch,
  decomposeToOklch,
  type OklchComponents,
} from "@/utils/color-converter";
import { ColorAreaPicker } from "./ColorAreaPicker";
import { ColorPickerHandle } from "./ColorPickerHandle";

export interface OklchSliderGroupProps {
  color: string;
  alpha: number;
  onChange: (components: OklchComponents) => void;
  onChangeImmediate: (components: OklchComponents) => void;
  onOpacityChange: (alpha: number) => void;
  onOpacityChangeImmediate: (alpha: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (components: OklchComponents) => void;
  showOpacity?: boolean;
  /** Ref holding live OklchComponents during drag, for imperative visual updates (C1). */
  liveOklchRef?: React.RefObject<OklchComponents>;
}

interface OklchSliderProps {
  label: string;
  maxValue: number;
  value: number;
  trackGradient: string;
  handleColor: string;
  onChange: (value: number) => void;
  onChangeImmediate: (value: number) => void;
  onDragStart?: () => void;
  trackRef?: React.RefObject<HTMLDivElement | null>;
  liveOklchRef?: React.RefObject<OklchComponents>;
}

function OklchSlider({
  label,
  maxValue,
  value,
  trackGradient,
  handleColor,
  onChange,
  onChangeImmediate,
  onDragStart,
  trackRef,
  liveOklchRef,
}: OklchSliderProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  const percent = (value / maxValue) * 100;

  const { startDrag, cleanup } = usePointerDrag();

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onDragStart?.();

      const toValue = (clientX: number) =>
        Math.max(
          0,
          Math.min(maxValue, ((clientX - rect.left) / rect.width) * maxValue)
        );
      const toPercent = (val: number) => (val / maxValue) * 100;

      const applyValue = (clientX: number) => {
        const v = toValue(clientX);
        if (handleRef.current) {
          handleRef.current.style.left = `clamp(5px, ${toPercent(v)}%, calc(100% - 5px))`;
        }
        if (pillRef.current && liveOklchRef?.current) {
          // Compute live handle color from ref for dynamic updates during drag (C3)
          const c = liveOklchRef.current;
          if (label === "L") {
            pillRef.current.style.backgroundColor = composeFromOklch({
              ...c,
              c: 0,
              alpha: 1,
            });
          } else if (label === "C") {
            pillRef.current.style.backgroundColor = composeFromOklch({
              ...c,
              alpha: 1,
            });
          } else if (label === "H") {
            pillRef.current.style.backgroundColor = `oklch(0.75 0.18 ${c.h})`;
          }
        }
        onChangeImmediate(v);
      };

      applyValue(e.clientX);

      startDrag({
        onMove: (mv: PointerEvent) => applyValue(mv.clientX),
        onUp: (up: PointerEvent) => {
          const v = toValue(up.clientX);
          cleanup();
          onChange(v);
        },
      });
    },
    [
      maxValue,
      onChange,
      onChangeImmediate,
      onDragStart,
      startDrag,
      cleanup,
      label,
      liveOklchRef,
    ]
  );

  return (
    <div className="flex items-center gap-1">
      <span className="w-2.5 shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
      <div
        ref={trackRef}
        className="relative h-7 flex-1 cursor-pointer rounded-md border"
        style={{
          background: trackGradient,
          contain: "layout style",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
      >
        <ColorPickerHandle
          ref={handleRef}
          pillRef={pillRef}
          percent={percent}
          color={handleColor}
        />
      </div>
    </div>
  );
}

export function OklchSliderGroup({
  color,
  alpha,
  onChange,
  onChangeImmediate,
  onOpacityChange,
  onOpacityChangeImmediate,
  onDragStart,
  onDragEnd,
  showOpacity = true,
  liveOklchRef,
}: OklchSliderGroupProps) {
  const oklchComponents = useMemo<OklchComponents>(() => {
    const decomposed = decomposeToOklch(color);
    return decomposed ?? { l: 0, c: 0, h: 0, alpha };
  }, [color, alpha]);

  // L slider: simple grayscale gradient (black → white)
  const lTrack = useMemo(() => "linear-gradient(to right, #000, #fff)", []);

  // C slider: color gradient showing chroma range at current L and H
  const cTrack = useMemo(
    () =>
      `linear-gradient(to right, oklch(${oklchComponents.l} 0 ${oklchComponents.h}), oklch(${oklchComponents.l} 0.37 ${oklchComponents.h}))`,
    [oklchComponents.l, oklchComponents.h]
  );

  // H slider: static hue spectrum — does NOT change based on current color
  const hTrack = useMemo(
    () =>
      "linear-gradient(to right in oklch longer hue, oklch(0.75 0.18 0), oklch(0.75 0.18 360))",
    []
  );

  // Refs for imperative DOM updates during drag (C3)
  const cTrackRef = useRef<HTMLDivElement>(null);
  const alphaTrackRef = useRef<HTMLDivElement>(null);
  const aHandleRef = useRef<HTMLDivElement>(null);
  const aPillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-color-dragging");
    };
  }, []);

  // Handle colors: each shows the color at its position on the track
  // L handle: grayscale at current lightness (matches black→white track)
  const lHandleColor = composeFromOklch({ ...oklchComponents, c: 0, alpha: 1 });
  // C handle: full color at current chroma (matches chroma gradient track)
  const cHandleColor = composeFromOklch({ ...oklchComponents, alpha: 1 });
  // H handle: color at current hue with fixed L/C matching the static hue track
  const hHandleColor = `oklch(0.75 0.18 ${oklchComponents.h})`;

  /** Imperatively update C track gradient and handle colors using liveOklchRef (C3). */
  const updateOklchVisuals = useCallback(
    (components: OklchComponents) => {
      // Update C slider track gradient
      if (cTrackRef.current) {
        cTrackRef.current.style.background = `linear-gradient(to right, oklch(${components.l} 0 ${components.h}), oklch(${components.l} 0.37 ${components.h}))`;
      }
      // Update alpha slider track gradient
      if (alphaTrackRef.current) {
        const trackFrom = composeFromOklch({ ...components, alpha: 0 });
        const trackTo = composeFromOklch({ ...components, alpha: 1 });
        alphaTrackRef.current.style.background = `linear-gradient(to right, ${trackFrom}, ${trackTo})`;
      }
      // Update alpha handle pill color
      if (aPillRef.current) {
        aPillRef.current.style.backgroundColor = composeFromOklch({
          ...components,
          alpha: components.alpha ?? alpha,
        });
      }
    },
    [alpha]
  );

  const handleAreaChange = useCallback(
    (components: OklchComponents) => {
      // Area picker changes L and C, keeps H
      onChange({ ...components, h: oklchComponents.h });
      requestAnimationFrame(() =>
        onDragEnd?.({ ...components, h: oklchComponents.h })
      );
    },
    [oklchComponents.h, onChange, onDragEnd]
  );

  const handleAreaChangeImmediate = useCallback(
    (components: OklchComponents) => {
      const next = { ...components, h: oklchComponents.h };
      if (liveOklchRef) liveOklchRef.current = next;
      onChangeImmediate(next);
      updateOklchVisuals(next);
    },
    [oklchComponents.h, onChangeImmediate, liveOklchRef, updateOklchVisuals]
  );

  const handleLChange = useCallback(
    (l: number) => {
      const next: OklchComponents = { ...oklchComponents, l };
      onChange(next);
      requestAnimationFrame(() => onDragEnd?.(next));
    },
    [oklchComponents, onChange, onDragEnd]
  );

  const handleLChangeImmediate = useCallback(
    (l: number) => {
      const current = liveOklchRef?.current ?? oklchComponents;
      const next: OklchComponents = { ...current, l };
      if (liveOklchRef) liveOklchRef.current = next;
      onChangeImmediate(next);
      updateOklchVisuals(next);
    },
    [oklchComponents, onChangeImmediate, liveOklchRef, updateOklchVisuals]
  );

  const handleCChange = useCallback(
    (c: number) => {
      const next: OklchComponents = { ...oklchComponents, c };
      onChange(next);
      requestAnimationFrame(() => onDragEnd?.(next));
    },
    [oklchComponents, onChange, onDragEnd]
  );

  const handleCChangeImmediate = useCallback(
    (c: number) => {
      const current = liveOklchRef?.current ?? oklchComponents;
      const next: OklchComponents = { ...current, c };
      if (liveOklchRef) liveOklchRef.current = next;
      onChangeImmediate(next);
      updateOklchVisuals(next);
    },
    [oklchComponents, onChangeImmediate, liveOklchRef, updateOklchVisuals]
  );

  const handleHChange = useCallback(
    (h: number) => {
      const next: OklchComponents = { ...oklchComponents, h };
      onChange(next);
      requestAnimationFrame(() => onDragEnd?.(next));
    },
    [oklchComponents, onChange, onDragEnd]
  );

  const handleHChangeImmediate = useCallback(
    (h: number) => {
      const current = liveOklchRef?.current ?? oklchComponents;
      const next: OklchComponents = { ...current, h };
      if (liveOklchRef) liveOklchRef.current = next;
      onChangeImmediate(next);
      updateOklchVisuals(next);
    },
    [oklchComponents, onChangeImmediate, liveOklchRef, updateOklchVisuals]
  );

  const { startDrag, cleanup } = usePointerDrag();

  const handleOpacityPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onDragStart?.();

      const toAlpha = (clientX: number) =>
        Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      const applyAlpha = (clientX: number) => {
        const v = toAlpha(clientX);
        if (aHandleRef.current) {
          aHandleRef.current.style.left = `clamp(5px, ${v * 100}%, calc(100% - 5px))`;
        }
        if (aPillRef.current && liveOklchRef?.current) {
          aPillRef.current.style.backgroundColor = composeFromOklch({
            ...liveOklchRef.current,
            alpha: v,
          });
        }
        onOpacityChangeImmediate(v);
      };

      applyAlpha(e.clientX);

      startDrag({
        onMove: (mv: PointerEvent) => applyAlpha(mv.clientX),
        onUp: (up: PointerEvent) => {
          const v = toAlpha(up.clientX);
          cleanup();
          onOpacityChange(v);
          requestAnimationFrame(() => {
            onDragEnd?.({ ...oklchComponents, alpha: v });
          });
        },
      });
    },
    [
      oklchComponents,
      onOpacityChange,
      onOpacityChangeImmediate,
      onDragStart,
      onDragEnd,
      startDrag,
      cleanup,
      liveOklchRef,
    ]
  );

  const opacityTrackGradient = `linear-gradient(to right, ${composeFromOklch({ ...oklchComponents, alpha: 0 })}, ${composeFromOklch({ ...oklchComponents, alpha: 1 })})`;

  return (
    <div className="space-y-2 px-2 pt-1">
      {/* 2D color area picker */}
      <ColorAreaPicker
        color={color}
        alpha={alpha}
        onChange={handleAreaChange}
        onChangeImmediate={handleAreaChangeImmediate}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        liveOklchRef={liveOklchRef}
      />

      {/* Sliders with labels */}
      <OklchSlider
        label="L"
        maxValue={1}
        value={oklchComponents.l}
        trackGradient={lTrack}
        handleColor={lHandleColor}
        onDragStart={onDragStart}
        onChange={handleLChange}
        onChangeImmediate={handleLChangeImmediate}
        liveOklchRef={liveOklchRef}
      />

      <OklchSlider
        label="C"
        maxValue={0.37}
        value={oklchComponents.c}
        trackGradient={cTrack}
        handleColor={cHandleColor}
        onDragStart={onDragStart}
        onChange={handleCChange}
        onChangeImmediate={handleCChangeImmediate}
        trackRef={cTrackRef}
        liveOklchRef={liveOklchRef}
      />

      <OklchSlider
        label="H"
        maxValue={360}
        value={oklchComponents.h}
        trackGradient={hTrack}
        handleColor={hHandleColor}
        onDragStart={onDragStart}
        onChange={handleHChange}
        onChangeImmediate={handleHChangeImmediate}
        liveOklchRef={liveOklchRef}
      />

      {showOpacity && (
        <div className="flex items-center gap-1">
          <span className="w-2.5 shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground/60">
            A
          </span>
          <div
            className="relative h-7 flex-1 cursor-pointer rounded-md border bg-white bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDgiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNhYmFiYWIiIC8+PHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2FiYWJhYiIgLz48L3N2Zz4=')] bg-repeat"
            style={{ contain: "layout style", touchAction: "none" }}
            onPointerDown={handleOpacityPointerDown}
          >
            <div
              ref={alphaTrackRef}
              className="absolute inset-0 rounded-md"
              style={{ background: opacityTrackGradient }}
            />
            <ColorPickerHandle
              ref={aHandleRef}
              pillRef={aPillRef}
              percent={alpha * 100}
              color={composeFromOklch({ ...oklchComponents, alpha })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
