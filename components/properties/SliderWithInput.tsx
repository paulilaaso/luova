import { GripVertical } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Input } from "@/components/luova-ui/input";
import { cn } from "@/lib/luova-utils";

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface SliderWithInputProps {
  value: number;
  onChange: (value: number) => void;
  onChangeImmediate?: (value: number) => void;
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  icon?: React.ReactNode;
  unit?: string;
  secondaryValue?: number;
  onSecondaryChange?: (value: number) => void;
  onSecondaryChangeImmediate?: (value: number) => void;
  onSecondaryCommit?: (value: number) => void;
  secondaryLabel?: string;
  secondaryMin?: number;
  secondaryMax?: number;
  secondaryStep?: number;
  onStart?: () => void;
  onSecondaryStart?: () => void;
  onReset?: () => void;
}

export const SliderWithInput = ({
  value,
  onChange,
  onChangeImmediate,
  onCommit,
  min,
  max,
  step = 1,
  label,
  icon,
  unit,
  secondaryValue,
  onSecondaryChange,
  onSecondaryChangeImmediate,
  onSecondaryCommit,
  secondaryLabel,
  secondaryMin = 0,
  secondaryMax = 100,
  secondaryStep = 1,
  onStart,
  onSecondaryStart,
  onReset,
}: SliderWithInputProps) => {
  const [localValue, setLocalValue] = useState(value.toString());
  const [, setLocalSecondaryValue] = useState(
    secondaryValue?.toString() ?? "0"
  );
  const unitRef = useRef<HTMLSpanElement>(null);
  const [unitWidth, setUnitWidth] = useState(0);
  const scrubRef = useRef<{
    startX: number;
    startValue: number;
    isSecondary: boolean;
  } | null>(null);
  const lastScrubValueRef = useRef<number | null>(null);
  const lastSecondaryScrubValueRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  useEffect(() => {
    if (secondaryValue !== undefined) {
      setLocalSecondaryValue(secondaryValue.toString());
    }
  }, [secondaryValue]);

  // Observe the unit through panel expansion, resizing, and font changes so
  // hidden controls never keep a stale zero-width measurement.
  useIsomorphicLayoutEffect(() => {
    const label = unitRef.current;
    if (!label) {
      setUnitWidth(0);
      return;
    }
    const measure = () => setUnitWidth(label.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [unit]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalValue(raw);
    const num = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(num)) {
      const clamped = clamp(snap(num));
      if (onChangeImmediate) {
        onChangeImmediate(clamped);
      }
    }
  };

  const _handleSecondaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalSecondaryValue(raw);
    // Only update local display, defer validation/clamping to onBlur/onKeyDown
  };

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, v)),
    [min, max]
  );

  const clampSecondary = useCallback(
    (v: number) => Math.max(secondaryMin, Math.min(secondaryMax, v)),
    [secondaryMin, secondaryMax]
  );

  const decimals = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
  const secondaryDecimals =
    secondaryStep < 1 ? Math.max(0, Math.ceil(-Math.log10(secondaryStep))) : 0;

  const snap = useCallback(
    (v: number) => parseFloat((Math.round(v / step) * step).toFixed(decimals)),
    [step, decimals]
  );

  const snapSecondary = useCallback(
    (v: number) =>
      parseFloat(
        (Math.round(v / secondaryStep) * secondaryStep).toFixed(
          secondaryDecimals
        )
      ),
    [secondaryStep, secondaryDecimals]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, isSecondary: boolean) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const startValue = isSecondary ? (secondaryValue ?? 0) : value;
      scrubRef.current = {
        startX: e.clientX,
        startValue,
        isSecondary,
      };
      if (isSecondary) {
        onSecondaryStart?.();
      } else {
        onStart?.();
      }
    },
    [value, secondaryValue, onStart, onSecondaryStart]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubRef.current) return;
      const delta = e.clientX - scrubRef.current.startX;
      const isSecondary = scrubRef.current.isSecondary;
      const range = isSecondary ? secondaryMax - secondaryMin : max - min;
      const sensitivity = range / 200;
      const startValue = scrubRef.current.startValue;

      if (isSecondary) {
        const newValue = clampSecondary(
          snapSecondary(startValue + delta * sensitivity)
        );
        setLocalSecondaryValue(newValue.toString());
        lastSecondaryScrubValueRef.current = newValue;
        if (onSecondaryChangeImmediate) {
          onSecondaryChangeImmediate(newValue);
        }
      } else {
        const newValue = clamp(snap(startValue + delta * sensitivity));
        setLocalValue(newValue.toString());
        lastScrubValueRef.current = newValue;
        if (onChangeImmediate) {
          onChangeImmediate(newValue);
        }
      }
    },
    [
      max,
      min,
      secondaryMax,
      secondaryMin,
      clamp,
      clampSecondary,
      snap,
      snapSecondary,
      onChangeImmediate,
      onSecondaryChangeImmediate,
    ]
  );

  const handlePointerUp = useCallback(() => {
    scrubRef.current = null;
    if (lastScrubValueRef.current !== null) {
      if (onCommit) {
        onCommit(lastScrubValueRef.current);
      } else if (onChange) {
        onChange(lastScrubValueRef.current);
      }
    }
    if (lastSecondaryScrubValueRef.current !== null) {
      if (onSecondaryCommit) {
        onSecondaryCommit(lastSecondaryScrubValueRef.current);
      } else if (onSecondaryChange) {
        onSecondaryChange(lastSecondaryScrubValueRef.current);
      }
    }
    lastScrubValueRef.current = null;
    lastSecondaryScrubValueRef.current = null;
  }, [onChange, onCommit, onSecondaryChange, onSecondaryCommit]);

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (
        !scrubRef.current &&
        lastScrubValueRef.current === null &&
        lastSecondaryScrubValueRef.current === null
      ) {
        return;
      }
      handlePointerUp();
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => window.removeEventListener("pointerup", handleGlobalPointerUp);
  }, [handlePointerUp]);

  const isDual = secondaryValue !== undefined && onSecondaryChange;

  const handleHandlePointerDown = (
    e: React.PointerEvent,
    isSecondary: boolean
  ) => {
    if ((e.metaKey || e.ctrlKey) && onReset) {
      e.preventDefault();
      onReset();
    } else {
      handlePointerDown(e, isSecondary);
    }
  };

  return (
    <div className="min-w-0">
      {!icon && (
        <label
          htmlFor={`input-${label.replace(/\s+/g, "-").toLowerCase()}`}
          className={cn(
            "text-xs font-medium block truncate",
            label ? "mb-1.5" : "mb-0"
          )}
        >
          {label}
        </label>
      )}
      <div className="relative h-7">
        <div
          ref={trackRef}
          className="absolute inset-0 z-0"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {isDual && (
            <div
              className="absolute top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-accent border-2 border-accent-foreground/20 cursor-ew-resize select-none flex items-center justify-center hover:border-accent-foreground/40 transition-colors"
              style={{
                left: `${(((secondaryValue ?? 0) - secondaryMin) / (secondaryMax - secondaryMin)) * 100}%`,
                touchAction: "none",
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(e) => handleHandlePointerDown(e, true)}
              title={
                onReset
                  ? "Drag to adjust, Cmd+Click to reset"
                  : (secondaryLabel ?? "Smoothing")
              }
            >
              <GripVertical className="size-2.5 text-muted-foreground opacity-50" />
            </div>
          )}
        </div>
        <div
          className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-7 h-full cursor-ew-resize select-none text-muted-foreground opacity-50 hover:opacity-100 transition-opacity"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => handleHandlePointerDown(e, false)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          title={onReset ? "Drag to adjust, Cmd+Click to reset" : label}
        >
          {icon ?? <GripVertical className="size-3" />}
        </div>
        <Input
          id={`input-${label.replace(/\s+/g, "-").toLowerCase()}`}
          type="number"
          value={localValue}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const num = parseFloat(localValue.replace(",", "."));
              if (!Number.isNaN(num)) {
                const clamped = Math.max(min, Math.min(max, num));
                if (onCommit) {
                  onCommit(clamped);
                } else if (onChange) {
                  onChange(clamped);
                }
              }
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const num = parseFloat(localValue.replace(",", "."));
              if (!Number.isNaN(num)) {
                const delta = e.key === "ArrowUp" ? step : -step;
                const newValue = clamp(snap(num + delta));
                setLocalValue(newValue.toString());
                if (onChangeImmediate) {
                  onChangeImmediate(newValue);
                }
              }
            }
          }}
          onBlur={() => {
            const num = parseFloat(localValue.replace(",", "."));
            if (!Number.isNaN(num)) {
              const clamped = Math.max(min, Math.min(max, num));
              if (onCommit) {
                onCommit(clamped);
              } else if (onChange) {
                onChange(clamped);
              }
            }
            setLocalValue(value.toString());
          }}
          onPointerDown={(e) => e.stopPropagation()}
          min={min}
          max={max}
          step={step}
          style={{
            paddingInlineStart: "1.75rem",
            paddingInlineEnd: unit
              ? `calc(${unitWidth}px + 0.875rem)`
              : "0.5rem",
            textAlign: "right",
          }}
          className="absolute left-0 right-0 top-0 h-7 pl-7 text-right tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:[-webkit-appearance:none] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:[-webkit-appearance:none] [&::-webkit-outer-spin-button]:m-0"
        />
        {unit && (
          <span
            ref={unitRef}
            className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2 text-xs text-muted-foreground"
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
};
