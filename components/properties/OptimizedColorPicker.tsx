"use client";

import ColorPicker from "./ColorPicker";

interface OptimizedColorPickerProps {
  color: string | undefined;
  onChange: (value: string, tokenKey?: string) => void;
  onChangeImmediate?: (value: string, tokenKey?: string) => void;
  onChangeCommit?: (value: string, tokenKey?: string) => void;
  label: string;
  name?: string;
  enableGradient?: boolean;
  showOpacity?: boolean;
  onReset?: () => void;
  variant?: "stacked" | "row";
  displayValue?: string;
}

export function OptimizedColorPicker({
  color,
  onChange,
  onChangeImmediate,
  onChangeCommit,
  label,
  name,
  enableGradient,
  showOpacity,
  onReset,
  variant,
  displayValue,
}: OptimizedColorPickerProps) {
  return (
    <ColorPicker
      color={color}
      onChange={onChange}
      onChangeImmediate={onChangeImmediate}
      onChangeCommit={onChangeCommit}
      label={label}
      name={name}
      enableGradient={enableGradient}
      showOpacity={showOpacity}
      onReset={onReset}
      variant={variant}
      displayValue={displayValue}
    />
  );
}
