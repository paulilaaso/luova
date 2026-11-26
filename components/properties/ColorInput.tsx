"use client";

import * as culori from "culori";
import { Crosshair, Pipette } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { Button } from "@/components/luova-ui/button";
import { Input } from "@/components/luova-ui/input";
import { usePreferencesStore } from "@/stores/preferences-store";
import { formatColorObject } from "@/utils/color-converter";

export interface ColorInputProps {
  color: string;
  currentAlpha: number;
  onChange: (color: string) => void;
  onChangeImmediate: (color: string) => void;
  onChangeCommit?: (color: string) => void;
  isOutOfGamut?: boolean;
  onClampToSrgb?: () => void;
}

export function ColorInput({
  color,
  currentAlpha,
  onChange,
  onChangeImmediate,
  isOutOfGamut = false,
  onClampToSrgb,
}: ColorInputProps) {
  const isFocusedRef = useRef(false);
  const [inputValue, setInputValue] = useState(color);
  const { colorFormat: preferredFormat } = usePreferencesStore();

  const supportsEyeDropper =
    typeof window !== "undefined" && "EyeDropper" in window;

  // Sync external color into the input only when the user isn't actively typing
  React.useEffect(() => {
    if (!isFocusedRef.current) {
      setInputValue(color);
    }
  }, [color]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      const parsed = culori.parse(val);
      if (parsed && parsed.alpha === undefined) {
        parsed.alpha = currentAlpha;
        const updated = formatColorObject(parsed, preferredFormat);
        onChangeImmediate(updated);
        return;
      }
      if (parsed) {
        onChangeImmediate(val);
      }
    },
    [currentAlpha, preferredFormat, onChangeImmediate]
  );

  const commitCurrentValue = useCallback(() => {
    const parsed = culori.parse(inputValue);
    if (parsed) {
      if (parsed.alpha === undefined) {
        parsed.alpha = currentAlpha;
      }
      const updated = formatColorObject(parsed, preferredFormat);
      onChange(updated);
    } else {
      setInputValue(color);
    }
  }, [inputValue, currentAlpha, preferredFormat, onChange, color]);

  const handleEyeDropper = useCallback(async () => {
    if (!supportsEyeDropper) return;
    try {
      const dropper = new (window as any).EyeDropper();
      const result = await dropper.open();
      const parsed = culori.parse(result.sRGBHex);
      if (!parsed) return;
      parsed.alpha = currentAlpha;
      const updated = formatColorObject(parsed, preferredFormat);
      onChangeImmediate(updated);
      onChange(updated);
    } catch {
      // user cancelled
    }
  }, [
    supportsEyeDropper,
    currentAlpha,
    preferredFormat,
    onChange,
    onChangeImmediate,
  ]);

  return (
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <div
        className="h-7 w-7 shrink-0 rounded-[var(--micro-radius,0.375rem)] border"
        style={{ backgroundColor: color }}
      />
      <Input
        type="text"
        value={inputValue}
        onChange={handleTextChange}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          commitCurrentValue();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitCurrentValue();
          }
        }}
        className="h-7 flex-1 text-xs"
        placeholder="oklch(…)"
      />
      {isOutOfGamut && onClampToSrgb && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onClampToSrgb}
          title="Clamp to sRGB"
        >
          <Crosshair className="size-3.5" />
        </Button>
      )}
      {supportsEyeDropper && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleEyeDropper}
        >
          <Pipette className="size-3" />
        </Button>
      )}
    </div>
  );
}
