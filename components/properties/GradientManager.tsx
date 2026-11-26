"use client";

import * as culori from "culori";
import {
  CirclePlus,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultThemeState } from "@/config/theme";
import { usePointerDrag } from "@/hooks/use-pointer-drag";
import { cn } from "@/lib/luova-utils";
import { useThemeStore } from "@/stores/theme-store";
import {
  buildGradientString,
  easeGradientCSS,
  formatNumber,
  type GradientStop,
  type GradientType,
} from "@/utils/color-converter";
import { resolveThemeVariablesInString } from "@/utils/theme-resolver";
import { ColorPickerHandle } from "./ColorPickerHandle";
import { SliderWithInput } from "./SliderWithInput";

const LIVE_GRADIENT_VAR = "--live-gradient-preview";

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function xToPosition(clientX: number, barRect: DOMRect): number {
  const x = clientX - barRect.left;
  return Math.max(0, Math.min(100, (x / barRect.width) * 100));
}

function getColorAtPosition(
  stops: GradientStop[],
  position: number,
  styles?: Record<string, string | undefined>
): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);

  if (sorted.length === 0) return "oklch(0.5 0.1 0)";
  if (sorted.length === 1) {
    const color = sorted[0].color;
    return styles ? resolveThemeVariablesInString(color, styles) : color;
  }

  if (position <= sorted[0].position) {
    const color = sorted[0].color;
    return styles ? resolveThemeVariablesInString(color, styles) : color;
  }
  if (position >= sorted[sorted.length - 1].position) {
    const color = sorted[sorted.length - 1].color;
    return styles ? resolveThemeVariablesInString(color, styles) : color;
  }

  let prevStop = sorted[0];
  let nextStop = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].position <= position && position <= sorted[i + 1].position) {
      prevStop = sorted[i];
      nextStop = sorted[i + 1];
      break;
    }
  }

  const range = nextStop.position - prevStop.position;
  if (range === 0) {
    const color = prevStop.color;
    return styles ? resolveThemeVariablesInString(color, styles) : color;
  }

  const t = (position - prevStop.position) / range;
  const easedT = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  // Resolve both stop colors if styles are provided
  const prevStopColor = styles
    ? resolveThemeVariablesInString(prevStop.color, styles)
    : prevStop.color;
  const nextStopColor = styles
    ? resolveThemeVariablesInString(nextStop.color, styles)
    : nextStop.color;

  const parsedA = culori.parse(prevStopColor);
  const parsedB = culori.parse(nextStopColor);
  if (!parsedA || !parsedB) return prevStopColor;

  const interp = culori.interpolate([parsedA, parsedB], "oklab");
  const c = interp(easedT);
  const oklch = culori.converter("oklch")(c);
  const alpha =
    oklch.alpha !== undefined && oklch.alpha < 1
      ? ` / ${formatNumber(oklch.alpha)}`
      : "";
  const hStr = oklch.h !== undefined ? oklch.h.toFixed(4) : "0";
  return `oklch(${oklch.l.toFixed(4)} ${oklch.c.toFixed(4)} ${hStr}${alpha})`;
}

export interface GradientManagerProps {
  stops: GradientStop[];
  angle: number;
  type: GradientType;
  scale: number;
  posX: number;
  posY: number;
  activeStopId: string | null;
  onStopsChange: (stops: GradientStop[]) => void;
  onAngleChange: (angle: number) => void;
  onTypeChange: (type: GradientType) => void;
  onScaleChange: (scale: number) => void;
  onPosXChange: (posX: number) => void;
  onPosYChange: (posY: number) => void;
  onActiveStopChange: (id: string | null) => void;
  onRemoveStop: (id: string) => void;
  onMoveStop: (id: string, newPos: number) => void;
  /** Called on every pointermove during stop drag for live canvas preview */
  onDragPreview?: (gradientValue: string) => void;
}

export function GradientManager({
  stops,
  angle,
  type,
  scale,
  posX,
  posY,
  activeStopId,
  onStopsChange,
  onAngleChange,
  onScaleChange,
  onPosXChange,
  onPosYChange,
  onActiveStopChange,
  onRemoveStop,
  onMoveStop,
  onDragPreview,
}: GradientManagerProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Draft ref: mutated in-place during drag, committed to React state on pointerup
  const draftStopsRef = useRef<GradientStop[]>(stops);
  // Map of stop id → handle wrapper div for direct DOM position updates during drag
  const stopHandleRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const { startDrag, cleanup: cleanupDrag } = usePointerDrag();

  // Get current live styles for resolving CSS variables
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const currentStyles = useMemo(() => {
    return {
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    };
  }, [currentMode, themeState.styles]);

  const activeStop = useMemo(
    () => stops.find((s) => s.id === activeStopId) || stops[0],
    [stops, activeStopId]
  );

  const addStop = useCallback(
    (e: React.MouseEvent) => {
      if (!barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const position = xToPosition(e.clientX, rect);
      const color = getColorAtPosition(stops, position, currentStyles);
      const newStop: GradientStop = {
        id: uid(),
        color,
        position: Math.round(position),
      };
      const next = [...stops, newStop];
      onStopsChange(next);
      onActiveStopChange(newStop.id);
    },
    [stops, onStopsChange, onActiveStopChange, currentStyles]
  );

  // Create resolved stops with literal colors for the UI track
  const resolvedStops = useMemo(() => {
    return stops.map((stop) => ({
      ...stop,
      color: resolveThemeVariablesInString(stop.color, currentStyles),
    }));
  }, [stops, currentStyles]);

  // Build gradient string using resolved colors for the UI track
  const resolvedGradientString = useMemo(
    () => buildGradientString(resolvedStops, 90, "linear"),
    [resolvedStops]
  );

  const updateLiveGradient = (currentStops: GradientStop[]) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      // Resolve colors before building the gradient string for the :root injection
      const resolvedStopsForPreview = currentStops.map((stop) => ({
        ...stop,
        color: resolveThemeVariablesInString(stop.color, currentStyles),
      }));
      const gradientCSS = easeGradientCSS(
        buildGradientString(resolvedStopsForPreview, 90, "linear")
      );
      document.documentElement.style.setProperty(
        LIVE_GRADIENT_VAR,
        gradientCSS
      );
    });
  };

  const commitLiveGradient = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    document.documentElement.style.removeProperty(LIVE_GRADIENT_VAR);
  };

  const emitGradient = useCallback(
    (
      currentStops: GradientStop[] = stops,
      currentAngle: number = angle,
      currentType: GradientType = type,
      currentScale: number = scale,
      currentPosX: number = posX,
      currentPosY: number = posY
    ) => {
      if (onDragPreview) {
        onDragPreview(
          buildGradientString(
            currentStops,
            currentAngle,
            currentType,
            currentScale,
            currentPosX,
            currentPosY
          )
        );
      }
    },
    [stops, angle, type, scale, posX, posY, onDragPreview]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      document.documentElement.style.removeProperty(LIVE_GRADIENT_VAR);
      document.body.classList.remove("is-color-dragging");
    };
  }, []);

  return (
    <div className="space-y-2 px-2 pt-1 pb-1">
      {/* Same flat h-7 track layout as OklchSliderGroup */}
      <div className="relative h-7 w-full">
        {/* Track — sits at the bottom, same as oklch sliders */}
        {/* biome-ignore lint/a11y/useSemanticElements: div as button is needed for custom gradient bar rendering */}
        <div
          ref={barRef}
          role="button"
          tabIndex={0}
          aria-label="Gradient bar — click to add a stop"
          className="absolute inset-0 cursor-crosshair rounded-md border overflow-hidden shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 bg-white bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDgiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNhYmFiYWIiIC8+PHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2FiYWJhYiIgLz48L3N2Zz4=')] bg-repeat"
          style={{ touchAction: "none" }}
          onClick={addStop}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const color = getColorAtPosition(stops, 50, currentStyles);
              const newStop: GradientStop = { id: uid(), color, position: 50 };
              const next = [...stops, newStop];
              onStopsChange(next);
              onActiveStopChange(newStop.id);
            }
          }}
        >
          <div
            className="absolute inset-0 h-full w-full"
            style={{
              background: isDragging
                ? `var(${LIVE_GRADIENT_VAR}, ${easeGradientCSS(resolvedGradientString)})`
                : easeGradientCSS(resolvedGradientString),
            }}
          />
        </div>

        {/* Handles — positioned over the full h-9 area, same as oklch sliders */}
        {stops.map((stop, _idx) => {
          const resolvedColor = resolveThemeVariablesInString(
            stop.color,
            currentStyles
          );
          return (
            <div
              key={stop.id}
              ref={(el) => {
                if (el) stopHandleRefs.current.set(stop.id, el);
                else stopHandleRefs.current.delete(stop.id);
              }}
              role="slider"
              tabIndex={0}
              aria-valuenow={stop.position}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Gradient stop at ${stop.position}%`}
              className={cn(
                "absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-grab focus:outline-none active:cursor-grabbing",
                activeStopId === stop.id ? "z-30" : "z-20"
              )}
              style={{
                left: `clamp(8px, ${stop.position}%, calc(100% - 8px))`,
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onActiveStopChange(stop.id);
                setIsDragging(true);
                draftStopsRef.current = stops.map((s) => ({ ...s }));

                const handleEl = stopHandleRefs.current.get(stop.id);

                startDrag({
                  onMove: (mv: PointerEvent) => {
                    if (!barRef.current) return;
                    const newPos = xToPosition(
                      mv.clientX,
                      barRef.current.getBoundingClientRect()
                    );
                    if (handleEl) {
                      handleEl.style.left = `clamp(8px, ${newPos}%, calc(100% - 8px))`;
                    }
                    draftStopsRef.current = draftStopsRef.current.map((s) =>
                      s.id === stop.id ? { ...s, position: newPos } : s
                    );
                    updateLiveGradient(draftStopsRef.current);
                    if (onDragPreview) {
                      onDragPreview(
                        buildGradientString(
                          draftStopsRef.current,
                          angle,
                          type,
                          scale,
                          posX,
                          posY
                        )
                      );
                    }
                  },
                  onUp: (up: PointerEvent) => {
                    const finalPos = barRef.current
                      ? xToPosition(
                          up.clientX,
                          barRef.current.getBoundingClientRect()
                        )
                      : stop.position;
                    onMoveStop(stop.id, finalPos);
                    setIsDragging(false);
                    commitLiveGradient();
                    cleanupDrag();
                  },
                });
              }}
              onClick={(e) => {
                e.stopPropagation();
                onActiveStopChange(stop.id);
              }}
              onKeyDown={(e) => {
                onActiveStopChange(stop.id);
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  onMoveStop(stop.id, stop.position - (e.shiftKey ? 10 : 1));
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  onMoveStop(stop.id, stop.position + (e.shiftKey ? 10 : 1));
                } else if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  onRemoveStop(stop.id);
                }
              }}
            >
              <ColorPickerHandle
                percent={0}
                positioned
                color={resolvedColor}
                isActive={activeStopId === stop.id}
              />
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <SliderWithInput
          label="Stop"
          icon={<CirclePlus className="size-3" />}
          value={activeStop.position}
          onChange={(v) => onMoveStop(activeStop.id, v)}
          onChangeImmediate={(value) => {
            const updatedStops = stops.map((s) =>
              s.id === activeStop.id ? { ...s, position: value } : s
            );
            emitGradient(updatedStops);
          }}
          min={0}
          max={100}
          step={1}
        />
        {type !== "radial" && (
          <SliderWithInput
            label={type === "conic" ? "Start" : "Angle"}
            icon={<RotateCw className="size-3" />}
            value={angle}
            onChange={onAngleChange}
            onChangeImmediate={(value) =>
              emitGradient(stops, value, type, scale, posX, posY)
            }
            min={0}
            max={360}
            step={1}
          />
        )}
        {type === "radial" && (
          <SliderWithInput
            label="Scale"
            icon={<Maximize2 className="size-3" />}
            value={scale}
            onChange={onScaleChange}
            onChangeImmediate={(value) =>
              emitGradient(stops, angle, type, value, posX, posY)
            }
            min={0}
            max={400}
            step={1}
          />
        )}
      </div>

      {type === "radial" && (
        <div className="grid grid-cols-2 gap-1.5">
          <SliderWithInput
            label="Position X"
            icon={<MoveHorizontal className="size-3" />}
            value={posX}
            onChange={onPosXChange}
            onChangeImmediate={(value) =>
              emitGradient(stops, angle, type, scale, value, posY)
            }
            min={-200}
            max={200}
            step={1}
          />
          <SliderWithInput
            label="Position Y"
            icon={<MoveVertical className="size-3" />}
            value={posY}
            onChange={onPosYChange}
            onChangeImmediate={(value) =>
              emitGradient(stops, angle, type, scale, posX, value)
            }
            min={-200}
            max={200}
            step={1}
          />
        </div>
      )}
    </div>
  );
}
