"use client";

import * as culori from "culori";
import { Trash2 } from "lucide-react";
import type React from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/luova-ui/input";
import { Label } from "@/components/luova-ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/luova-ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/luova-ui/tooltip";
import { defaultThemeState } from "@/config/theme";
import { COLOR_TOKEN_KEYS, getTokenDefinition } from "@/config/theme-tokens";
import { cn } from "@/lib/luova-utils";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useThemeStore } from "@/stores/theme-store";
import type { ColorPickerProps } from "@/types";
import {
  buildGradientString,
  clampToSrgb,
  composeFromOklch,
  formatColorObject,
  type GradientStop,
  type GradientType,
  isGradientValue,
  isOutsideSrgb,
  type OklchComponents,
  parseGradient,
} from "@/utils/color-converter";
import { debounce } from "@/utils/debounce";
import { getColorControlId } from "@/utils/focus-color-control";
import { ThemeEngine } from "@/utils/theme-engine";

const GradientManager = lazy(() =>
  import("./GradientManager").then((m) => ({ default: m.GradientManager }))
);

import {
  resolveDisplayColor,
  resolveThemeVariablesInString,
} from "@/utils/theme-resolver";
import { ColorInput } from "./ColorInput";
import { OklchSliderGroup } from "./OklchSliderGroup";

type ColorMode = "solid" | "gradient";

function isGradientCapableToken(name?: string): boolean {
  return !!name;
}

/** No color: a thin diagonal slash across an empty swatch. */
const EMPTY_SWATCH: React.CSSProperties = {
  background:
    "linear-gradient(to top right, transparent calc(50% - 0.75px), var(--muted-foreground) calc(50% - 0.75px), var(--muted-foreground) calc(50% + 0.75px), transparent calc(50% + 0.75px))",
  opacity: 0.6,
};

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

interface ThemeSwatchGridProps {
  themeColors: { key: string; value: string; label: string }[];
  onColorClick: (color: { key: string; value: string }) => void;
}

function ThemeSwatchGrid({ themeColors, onColorClick }: ThemeSwatchGridProps) {
  return (
    <>
      <div className="border-t border-border" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(1.3rem,1fr))] gap-1.5 px-2 py-3">
        {themeColors.map((tc) => (
          <Tooltip key={tc.key} disableHoverablePopup>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="aspect-square w-full rounded-[var(--micro-radius,0.25rem)] border border-border transition-transform hover:scale-110"
                  style={{ background: tc.value }}
                  onClick={() => onColorClick(tc)}
                />
              }
            />
            {/* Pass-through so a covered swatch can still be hovered and
                picked; hovering it moves the tooltip to that swatch. */}
            <TooltipContent side="top" align="center" passThrough>
              <p className="font-mono text-xs">--{tc.key}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </>
  );
}

const ColorPicker = ({
  color,
  onChange,
  onChangeImmediate,
  onChangeCommit,
  label,
  name,
  enableGradient: enableGradientProp,
  showOpacity: showOpacityProp,
  onReset,
  variant = "stacked",
  displayValue,
}: ColorPickerProps) => {
  // What the text field shows when it isn't being edited.
  const restingText = displayValue ?? color ?? "";
  const textInputRef = useRef<HTMLInputElement>(null);
  const textInputFocusedRef = useRef(false);
  const [textInputValue, setTextInputValue] = useState(color || "");
  const canvasRef = useRef<Element | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const liveOklchRef = useRef<OklchComponents>({
    l: 0.5,
    c: 0,
    h: 0,
    alpha: 1,
  });
  useEffect(() => {
    canvasRef.current = document.querySelector(
      '[data-canvas-container="true"]'
    );
  }, []);

  // Close the picker if its trigger leaves the document or is hidden (e.g. the
  // properties panel switches tabs or the selection is cleared). Otherwise the
  // floating positioner keeps tracking the now zero-sized trigger and snaps the
  // popup to the collision boundary's origin (the top-left of the canvas).
  useEffect(() => {
    if (!popoverOpen) return;
    const trigger = swatchRef.current;
    if (!trigger) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      if (!trigger.isConnected || !entry.isIntersecting) {
        setPopoverOpen(false);
      }
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [popoverOpen]);

  const showOpacity = showOpacityProp !== undefined ? showOpacityProp : true;

  const gradientAllowed =
    enableGradientProp !== undefined
      ? enableGradientProp
      : isGradientCapableToken(name);

  const isCurrentGradient = isGradientValue(color || "");
  const [mode, setMode] = useState<ColorMode>(
    isCurrentGradient ? "gradient" : "solid"
  );
  const modeRef = useRef<ColorMode>(isCurrentGradient ? "gradient" : "solid");
  const pendingGradientCommitRef = useRef<string | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);

  const [gradientStops, setGradientStops] = useState<GradientStop[]>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.stops;
    }
    return [
      { id: uid(), color: color || "oklch(0 0 0)", position: 0 },
      { id: uid(), color: color || "oklch(0 0 0)", position: 100 },
    ];
  });

  const [gradientAngle, setGradientAngle] = useState<number>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.angle;
    }
    return 0;
  });

  const [gradientType, setGradientType] = useState<GradientType>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.type;
    }
    return "linear";
  });

  const [radialScale, setRadialScale] = useState<number>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.radialScale;
    }
    return 100;
  });

  const [radialPositionX, setRadialPositionX] = useState<number>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.radialPositionX;
    }
    return 50;
  });

  const [radialPositionY, setRadialPositionY] = useState<number>(() => {
    if (isCurrentGradient) {
      const parsed = parseGradient(color!);
      if (parsed) return parsed.radialPositionY;
    }
    return 50;
  });

  // Internal draft state for solid color mode to ensure instant reactivity
  const [localColor, setLocalColor] = useState(color || "#000000");

  // Sync localColor from prop when it changes externally
  useEffect(() => {
    // Don't interrupt active user input (drag or text edit)
    if (isSliderDraggingRef.current || textInputFocusedRef.current) return;

    if (mode === "solid") {
      setLocalColor(color || "#000000");
    }
  }, [color, mode]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const incomingIsGradient = isGradientValue(color || "");

    if (isSliderDraggingRef.current) return;

    if (incomingIsGradient) {
      if (mode !== "gradient") {
        setMode("gradient");
      }

      if (color !== pendingGradientCommitRef.current) {
        const parsed = parseGradient(color!);
        if (parsed) {
          setGradientStops(parsed.stops);
          setGradientAngle(parsed.angle);
          setGradientType(parsed.type);
          setRadialScale(Math.max(1, parsed.radialScale));
          setRadialPositionX(parsed.radialPositionX);
          setRadialPositionY(parsed.radialPositionY);
        }
      }
    } else {
      if (mode !== "solid") {
        setMode("solid");
      }

      setLocalColor(color || "#000000");
      if (!textInputFocusedRef.current) {
        setTextInputValue(restingText);
      }
    }
  }, [color, mode, restingText]);

  useEffect(() => {
    if (!textInputFocusedRef.current && mode === "solid") {
      setTextInputValue(restingText);
    }
  }, [restingText, mode]);

  const debouncedOnChange = useMemo(
    () =>
      debounce((value: string) => {
        onChange(value);
      }, 500),
    [onChange]
  );

  const debouncedCommit = useMemo(
    () =>
      debounce((value: string) => {
        if (onChangeCommit) {
          onChangeCommit(value);
        } else {
          onChange(value);
        }
      }, 500),
    [onChangeCommit, onChange]
  );

  const flushPendingGradientCommit = useCallback(() => {
    // no-op: gradient commits now happen via debouncedCommit
  }, []);

  // Tracks whether an OklchSliderGroup drag is in progress (for gradient mode isolation)
  const isSliderDraggingRef = useRef(false);

  const handleColorChangeImmediate = useCallback(
    (value: string) => {
      if (modeRef.current === "solid") {
        setLocalColor(value);
      }
      if (onChangeImmediate) {
        onChangeImmediate(value);
      }
    },
    [onChangeImmediate]
  );

  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);
  const { colorFormat: preferredFormat } = usePreferencesStore();

  const themeColors = useMemo(() => {
    const currentStyles = {
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    };
    const colors: { key: string; value: string; label: string }[] = [];

    for (const key of COLOR_TOKEN_KEYS) {
      const value = currentStyles[key as keyof typeof currentStyles];
      if (value && typeof value === "string" && value.trim() !== "") {
        const tokenDef = getTokenDefinition(key);
        const label = tokenDef?.description
          ? tokenDef.description.split(",")[0].split(".")[0].trim()
          : key.replace(/-/g, " ");
        colors.push({ key, value, label });
      }
    }

    return colors;
  }, [currentMode, themeState.styles]);

  useEffect(() => {
    return () => {
      debouncedOnChange.cancel();
      debouncedCommit.cancel();
    };
  }, [debouncedOnChange, debouncedCommit]);

  const handleTextInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTextInputValue(e.target.value);
      debouncedOnChange(e.target.value);
    },
    [debouncedOnChange]
  );

  const emitGradient = useCallback(
    (
      stops: GradientStop[],
      angle: number,
      type: GradientType = gradientType,
      scale: number = radialScale,
      posX: number = radialPositionX,
      posY: number = radialPositionY
    ) => {
      const gradientValue = buildGradientString(
        stops,
        angle,
        type,
        scale,
        posX,
        posY
      );
      pendingGradientCommitRef.current = gradientValue;
      if (onChangeImmediate) {
        onChangeImmediate(gradientValue);
      }
      debouncedCommit(gradientValue);
    },
    [
      onChangeImmediate,
      debouncedCommit,
      gradientType,
      radialScale,
      radialPositionX,
      radialPositionY,
    ]
  );

  const updateStops = useCallback(
    (next: GradientStop[]) => {
      setGradientStops(next);
      emitGradient(next, gradientAngle, gradientType);
    },
    [emitGradient, gradientAngle, gradientType]
  );

  const updateAngle = useCallback(
    (next: number) => {
      setGradientAngle(next);
      emitGradient(gradientStops, next, gradientType);
    },
    [emitGradient, gradientStops, gradientType]
  );

  const updateGradientType = useCallback(
    (next: GradientType) => {
      setGradientType(next);
      emitGradient(gradientStops, gradientAngle, next);
    },
    [emitGradient, gradientStops, gradientAngle]
  );

  const updateRadialScale = useCallback(
    (next: number) => {
      setRadialScale(next);
      emitGradient(
        gradientStops,
        gradientAngle,
        gradientType,
        next,
        radialPositionX,
        radialPositionY
      );
    },
    [
      emitGradient,
      gradientStops,
      gradientAngle,
      gradientType,
      radialPositionX,
      radialPositionY,
    ]
  );

  const updateRadialPositionX = useCallback(
    (next: number) => {
      setRadialPositionX(next);
      emitGradient(
        gradientStops,
        gradientAngle,
        gradientType,
        radialScale,
        next,
        radialPositionY
      );
    },
    [
      emitGradient,
      gradientStops,
      gradientAngle,
      gradientType,
      radialScale,
      radialPositionY,
    ]
  );

  const updateRadialPositionY = useCallback(
    (next: number) => {
      setRadialPositionY(next);
      emitGradient(
        gradientStops,
        gradientAngle,
        gradientType,
        radialScale,
        radialPositionX,
        next
      );
    },
    [
      emitGradient,
      gradientStops,
      gradientAngle,
      gradientType,
      radialScale,
      radialPositionX,
    ]
  );

  const removeStop = useCallback(
    (id: string) => {
      if (gradientStops.length <= 2) return;
      const next = gradientStops.filter((s) => s.id !== id);
      updateStops(next);
      if (activeStopId === id) setActiveStopId(next[0].id);
    },
    [gradientStops, updateStops, activeStopId]
  );

  const moveStop = useCallback(
    (id: string, newPos: number) => {
      const next = gradientStops.map((s) =>
        s.id === id
          ? { ...s, position: Math.round(Math.max(0, Math.min(100, newPos))) }
          : s
      );
      updateStops(next);
    },
    [gradientStops, updateStops]
  );

  const updateStopColor = useCallback(
    (id: string, newColor: string) => {
      const next = gradientStops.map((s) =>
        s.id === id ? { ...s, color: newColor } : s
      );
      updateStops(next);
    },
    [gradientStops, updateStops]
  );

  const handleModeSwitch = useCallback(
    (newMode: ColorMode) => {
      setMode(newMode);
      if (newMode === "gradient") {
        // Resolve the Theme Default color for this token
        // by looking at the current styles but treating the current token as empty
        // to force resolveDisplayColor to find the theme's fallback/default
        const currentStyles = {
          ...defaultThemeState.styles[currentMode],
          ...themeState.styles[currentMode],
        };

        const themeDefaultColor = resolveDisplayColor(name || "", {
          ...currentStyles,
          [name || ""]: "", // Force the resolver to look past any custom solid color
        });

        // Initialize stops using the Theme Default
        const initial: GradientStop[] = [
          {
            id: uid(),
            color: themeDefaultColor || "oklch(0.5 0 0)",
            position: 0,
          },
          {
            id: uid(),
            color: themeDefaultColor || "oklch(0.5 0 0)",
            position: 100,
          },
        ];

        setGradientStops(initial);
        setGradientAngle(0);
        setGradientType("linear");
        setRadialScale(100);
        setRadialPositionX(50);
        setRadialPositionY(50);

        const gradientValue = buildGradientString(initial, 0, "linear");

        // Update the UI and Canvas - clear first to ensure a clean slate
        if (name) {
          ThemeEngine.clearTokensCssVariables([name]);
          ThemeEngine.applyToken(name, gradientValue);
        }

        if (onChangeImmediate) onChangeImmediate(gradientValue);
        if (onChangeCommit) onChangeCommit(gradientValue);
        else onChange(gradientValue);
      } else {
        const solidValue = gradientStops[0]?.color || "#000000";

        if (name) {
          ThemeEngine.clearTokensCssVariables([name]);
          ThemeEngine.applyToken(name, solidValue);
        }

        if (onChangeImmediate) onChangeImmediate(solidValue);
        if (onChangeCommit) onChangeCommit(solidValue);
        else onChange(solidValue);
      }
    },
    [
      currentMode,
      themeState,
      name,
      gradientStops,
      onChange,
      onChangeImmediate,
      onChangeCommit,
    ]
  );

  const activeStop =
    gradientStops.find((s) => s.id === activeStopId) || gradientStops[0];

  // Get current live styles for resolving CSS variables
  const currentStyles = useMemo(() => {
    return {
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    };
  }, [currentMode, themeState.styles]);

  const swatchStyle: React.CSSProperties = isGradientValue(color || "")
    ? { background: resolveThemeVariablesInString(color || "", currentStyles) }
    : { background: resolveThemeVariablesInString(color || "", currentStyles) };

  const toolColor = mode === "gradient" ? activeStop.color : localColor;

  // Resolve CSS variables in toolColor to get the literal color for color math
  const resolvedToolColor = useMemo(() => {
    return resolveThemeVariablesInString(toolColor, currentStyles);
  }, [toolColor, currentStyles]);

  const currentAlpha = useMemo(() => {
    const parsed = culori.parse(resolvedToolColor);
    const alpha = typeof parsed?.alpha === "number" ? parsed.alpha : 1;
    return Math.round(alpha * 100) / 100;
  }, [resolvedToolColor]);

  const isWideGamut = useMemo(
    () => isOutsideSrgb(resolvedToolColor),
    [resolvedToolColor]
  );

  const handleOklchChange = useCallback(
    (components: OklchComponents) => {
      const newColor = composeFromOklch(components);
      if (mode === "gradient") {
        updateStopColor(activeStop.id, newColor);
      } else {
        setLocalColor(newColor);
        handleColorChangeImmediate(newColor);
      }
    },
    [mode, activeStop.id, updateStopColor, handleColorChangeImmediate]
  );

  const handleOklchChangeImmediate = useCallback(
    (components: OklchComponents) => {
      const newColor = composeFromOklch(components);
      if (mode === "gradient") {
        updateStopColor(activeStop.id, newColor);
      } else {
        // Write live OklchComponents into the ref for imperative visual updates (C2)
        liveOklchRef.current = components;
        // Update swatch background imperatively (C5)
        if (swatchRef.current) {
          swatchRef.current.style.background = newColor;
        }
        if (onChangeImmediate) onChangeImmediate(newColor);
      }
    },
    [mode, activeStop.id, updateStopColor, onChangeImmediate]
  );

  const handleOklchDragStart = useCallback(() => {
    isSliderDraggingRef.current = true;
  }, []);

  const handleOklchDragEnd = useCallback(
    (components: OklchComponents) => {
      isSliderDraggingRef.current = false;
      const newColor = composeFromOklch(components);
      if (mode === "gradient") {
        updateStopColor(activeStop.id, newColor);
      } else {
        // Explicit commit on drag end — replaces the debounce for slider interactions
        if (onChangeCommit) {
          onChangeCommit(newColor);
        } else {
          onChange(newColor);
        }
        debouncedOnChange.cancel();
      }
    },
    [
      mode,
      activeStop.id,
      updateStopColor,
      onChangeCommit,
      onChange,
      debouncedOnChange,
    ]
  );

  const handleOpacityChange = useCallback(
    (newAlpha: number) => {
      const parsed = culori.parse(resolvedToolColor);
      if (!parsed) return;
      parsed.alpha = newAlpha;
      const updated = formatColorObject(parsed, preferredFormat);
      if (mode === "gradient") {
        updateStopColor(activeStop.id, updated);
      } else {
        handleColorChangeImmediate(updated);
      }
    },
    [
      resolvedToolColor,
      mode,
      activeStop.id,
      updateStopColor,
      handleColorChangeImmediate,
      preferredFormat,
    ]
  );

  const handleOpacityChangeImmediate = useCallback(
    (newAlpha: number) => {
      const parsed = culori.parse(resolvedToolColor);
      if (!parsed) return;
      parsed.alpha = newAlpha;
      const updated = formatColorObject(parsed, preferredFormat);
      if (mode === "gradient") {
        updateStopColor(activeStop.id, updated);
      } else {
        // Update live ref and swatch imperatively (C2, C5)
        if (liveOklchRef.current) {
          liveOklchRef.current = { ...liveOklchRef.current, alpha: newAlpha };
        }
        if (swatchRef.current) {
          swatchRef.current.style.background = updated;
        }
        if (onChangeImmediate) onChangeImmediate(updated);
      }
    },
    [
      resolvedToolColor,
      mode,
      activeStop.id,
      updateStopColor,
      onChangeImmediate,
      preferredFormat,
    ]
  );

  const handleToolColorChange = useCallback(
    (newColor: string) => {
      if (mode === "gradient") {
        updateStopColor(activeStop.id, newColor);
      } else {
        handleColorChangeImmediate(newColor);
        if (onChangeCommit) onChangeCommit(newColor);
        else onChange(newColor);
      }
    },
    [
      mode,
      activeStop.id,
      updateStopColor,
      handleColorChangeImmediate,
      onChangeCommit,
      onChange,
    ]
  );

  const handleToolColorChangeImmediate = useCallback(
    (newColor: string) => {
      if (mode === "gradient") {
        updateStopColor(activeStop.id, newColor);
      } else {
        handleColorChangeImmediate(newColor);
      }
    },
    [mode, activeStop.id, updateStopColor, handleColorChangeImmediate]
  );

  const handleClampToSrgb = useCallback(() => {
    const clamped = clampToSrgb(toolColor);
    if (mode === "gradient") {
      updateStopColor(activeStop.id, clamped);
    } else {
      if (onChangeCommit) onChangeCommit(clamped);
      else onChange(clamped);
    }
  }, [
    toolColor,
    mode,
    activeStop.id,
    updateStopColor,
    onChange,
    onChangeCommit,
  ]);

  const handleThemeColorClick = useCallback(
    (themeColor: { key: string; value: string }) => {
      const parsed = culori.parse(themeColor.value);
      let newValue: string;
      if (parsed && !isGradientValue(themeColor.value)) {
        parsed.alpha = currentAlpha;
        const withAlpha = formatColorObject(parsed, preferredFormat);
        newValue = withAlpha;
      } else {
        newValue = themeColor.value;
      }

      if (mode === "gradient") {
        // Use CSS variable syntax for dynamic theme colors in gradients
        const cssVarValue = `var(--${themeColor.key})`;
        updateStopColor(activeStop.id, cssVarValue);
      } else {
        setLocalColor(newValue);
        setTextInputValue(newValue);
        if (onChangeImmediate) {
          onChangeImmediate(newValue, themeColor.key);
        }
        if (onChangeCommit) {
          onChangeCommit(newValue, themeColor.key);
        } else {
          onChange(newValue, themeColor.key);
        }
      }
    },
    [
      currentAlpha,
      preferredFormat,
      mode,
      activeStop.id,
      updateStopColor,
      onChange,
      onChangeImmediate,
      onChangeCommit,
    ]
  );

  return (
    <div id={name ? getColorControlId(name) : undefined}>
      <Label
        htmlFor={`color-${label.replace(/\s+/g, "-").toLowerCase()}`}
        className={cn(
          "mb-1.5 flex w-fit max-w-full min-w-0 items-center gap-0 pb-0.5 text-xs font-medium",
          variant === "row" && "sr-only"
        )}
      >
        <span className="truncate leading-tight">{label}</span>
        {isWideGamut && (
          <span
            className="ml-1.5 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
            title="Wide-gamut P3 color"
          />
        )}
      </Label>

      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (!open && mode === "gradient") {
            flushPendingGradientCommit();
          }
        }}
      >
        <div className="flex h-7 items-center gap-1">
          <PopoverTrigger
            render={
              <button
                ref={swatchRef}
                type="button"
                className="hover:ring-primary flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[var(--micro-radius,0.375rem)] border transition-all hover:ring-2 hover:ring-offset-1"
                style={variant === "row" && !color ? EMPTY_SWATCH : swatchStyle}
                onPointerDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && onReset) {
                    e.preventDefault();
                    onReset();
                  }
                }}
                title={
                  onReset
                    ? "Click to open, Cmd+Click to reset"
                    : "Click to open color picker"
                }
              >
                <span className="sr-only">Open color picker</span>
              </button>
            }
          />
          <Input
            ref={textInputRef}
            type="text"
            value={textInputValue}
            onChange={handleTextInputChange}
            onFocus={() => {
              textInputFocusedRef.current = true;
            }}
            onBlur={() => {
              textInputFocusedRef.current = false;
              // Only an actual edit commits; the resting text may be a token
              // name, which isn't a color value.
              if (textInputValue !== restingText) {
                if (onChangeCommit) onChangeCommit(textInputValue);
                else onChange(textInputValue);
              }
              setTextInputValue(restingText);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (textInputValue !== restingText) {
                  if (onChangeCommit) onChangeCommit(textInputValue);
                  else onChange(textInputValue);
                }
              }
            }}
            className="h-7 flex-1 text-xs"
            placeholder={variant === "row" ? "None" : "Enter color"}
          />
        </div>
        <PopoverContent
          className="w-60 p-0"
          side="left"
          align="start"
          sideOffset={8}
          collisionBoundary={canvasRef.current ?? undefined}
          collisionPadding={8}
          initialFocus={false}
          disableAnchorTracking
        >
          <div className="flex flex-col gap-0">
            {/* ── Section 1: mode toggle + gradient controls ── */}
            {gradientAllowed && (
              <>
                <div className="py-3">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2",
                      mode === "gradient" ? "pb-2" : ""
                    )}
                  >
                    <div className="flex items-center rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        title="Solid color"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center transition-colors",
                          mode === "solid"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => handleModeSwitch("solid")}
                      >
                        <svg className="w-[24px] h-[24px]" viewBox="0 0 23 23">
                          <rect width="24" height="24" fill="currentColor" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex items-center rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        title="Linear gradient"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center transition-colors",
                          mode === "gradient" && gradientType === "linear"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => {
                          if (mode !== "gradient") handleModeSwitch("gradient");
                          updateGradientType("linear");
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 23 23">
                          <defs>
                            <linearGradient
                              id="linear-grad-icon"
                              x1="0%"
                              y1="0%"
                              x2="0%"
                              y2="100%"
                            >
                              <stop offset="0%" stopColor="currentColor" />
                              <stop
                                offset="100%"
                                stopColor="currentColor"
                                stopOpacity="0"
                              />
                            </linearGradient>
                          </defs>
                          <rect
                            width="24"
                            height="24"
                            fill="url(#linear-grad-icon)"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        title="Radial gradient"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center transition-colors",
                          mode === "gradient" && gradientType === "radial"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => {
                          if (mode !== "gradient") handleModeSwitch("gradient");
                          updateGradientType("radial");
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 23 23">
                          <defs>
                            <radialGradient
                              id="radial-grad-icon"
                              cx="50%"
                              cy="50%"
                              r="50%"
                            >
                              <stop
                                offset="0%"
                                stopColor="currentColor"
                                stopOpacity="0"
                              />
                              <stop offset="100%" stopColor="currentColor" />
                            </radialGradient>
                          </defs>
                          <rect
                            width="24"
                            height="24"
                            fill="url(#radial-grad-icon)"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        title="Conic gradient"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center transition-colors",
                          mode === "gradient" && gradientType === "conic"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                        onClick={() => {
                          if (mode !== "gradient") handleModeSwitch("gradient");
                          updateGradientType("conic");
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 23 23">
                          <foreignObject x="0" y="0" width="24" height="24">
                            <div
                              style={{
                                width: "24px",
                                height: "24px",
                                borderRadius: "4px",
                                background:
                                  "conic-gradient(transparent, currentColor 50%, transparent)",
                              }}
                            />
                          </foreignObject>
                        </svg>
                      </button>
                    </div>

                    <button
                      type="button"
                      title="Remove selected stop"
                      disabled={
                        mode !== "gradient" || gradientStops.length <= 2
                      }
                      className={cn(
                        "flex h-6 w-6 items-center justify-center transition-colors ml-auto",
                        mode === "gradient" && gradientStops.length > 2
                          ? "text-destructive hover:bg-destructive/10 hover:text-muted-foreground"
                          : "text-muted-foreground opacity-40",
                        mode === "gradient" &&
                          gradientStops.length > 2 &&
                          "cursor-pointer",
                        (mode !== "gradient" || gradientStops.length <= 2) &&
                          "cursor-not-allowed"
                      )}
                      onClick={() => removeStop(activeStop.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {mode === "gradient" && (
                    <div className="pt-1">
                      <Suspense fallback={null}>
                        <GradientManager
                          stops={gradientStops}
                          angle={gradientAngle}
                          type={gradientType}
                          scale={radialScale}
                          posX={radialPositionX}
                          posY={radialPositionY}
                          activeStopId={activeStopId}
                          onStopsChange={updateStops}
                          onAngleChange={updateAngle}
                          onTypeChange={updateGradientType}
                          onScaleChange={updateRadialScale}
                          onPosXChange={updateRadialPositionX}
                          onPosYChange={updateRadialPositionY}
                          onActiveStopChange={setActiveStopId}
                          onRemoveStop={removeStop}
                          onMoveStop={moveStop}
                          onDragPreview={onChangeImmediate}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>

                <div className="border-t border-border" />
              </>
            )}

            {/* ── Section 2: color input + oklch sliders ── */}
            <div className="py-3">
              <ColorInput
                color={toolColor}
                currentAlpha={currentAlpha}
                onChange={handleToolColorChange}
                onChangeImmediate={handleToolColorChangeImmediate}
                onChangeCommit={onChangeCommit}
                isOutOfGamut={isWideGamut}
                onClampToSrgb={handleClampToSrgb}
              />
              <OklchSliderGroup
                color={resolvedToolColor}
                alpha={currentAlpha}
                onChange={handleOklchChange}
                onChangeImmediate={handleOklchChangeImmediate}
                onOpacityChange={handleOpacityChange}
                onOpacityChangeImmediate={handleOpacityChangeImmediate}
                onDragStart={handleOklchDragStart}
                onDragEnd={handleOklchDragEnd}
                showOpacity={showOpacity}
                liveOklchRef={liveOklchRef}
              />
            </div>

            {/* ── Section 3: theme swatches ── */}
            {themeColors.length > 0 && (
              <ThemeSwatchGrid
                themeColors={themeColors}
                onColorClick={handleThemeColorClick}
              />
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ColorPicker;
