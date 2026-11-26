"use client";

import React from "react";
import { Label } from "@/components/luova-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/luova-ui/select";
import { defaultThemeState } from "@/config/theme";
import { useRegisterCyclable } from "@/hooks/use-register-cyclable";
import { useThemeStore } from "@/stores/theme-store";
import type { ShadowGroup } from "@/types/theme";

interface ShadowSelectProps {
  value: string | undefined;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
  onReset?: () => void;
  /** "row": no visible label (a panel row labels it), field look, icon. */
  variant?: "stacked" | "row";
  icon?: React.ReactNode;
}

export default function ShadowSelect({
  value,
  onChange,
  label = "Shadow",
  name,
  onReset,
  variant = "stacked",
  icon,
}: ShadowSelectProps) {
  const row = variant === "row";
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);

  const currentStyles = React.useMemo(
    () => ({
      ...defaultThemeState.styles[currentMode],
      ...themeState.styles[currentMode],
    }),
    [currentMode, themeState]
  );

  const shadowGroupsRaw = currentStyles["shadow-groups"];
  const groups = React.useMemo<ShadowGroup[]>(() => {
    try {
      const parsed = JSON.parse(shadowGroupsRaw || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return [];
  }, [shadowGroupsRaw]);

  const currentValue = value && value !== "none" ? value : "none";

  const getShadowDisplayName = (val: string): string => {
    if (val === "none" || !val) return "None";
    const match = val.match(/var\(--shadow-(.+)\)/);
    if (!match) return val;
    const groupId = match[1];
    const group = groups.find((g) => g.id === groupId);
    return group?.name ?? val;
  };

  const shadowOptions = React.useMemo(
    () => ["none", ...groups.map((g) => `var(--shadow-${g.id})`)],
    [groups]
  );

  const uniqueId = name || `shadow-${label.replace(/\s+/g, "-").toLowerCase()}`;

  useRegisterCyclable({
    id: uniqueId,
    label,
    options: shadowOptions,
    currentValue,
    onChange,
    priority: 5,
    enabled: shadowOptions.length > 1,
  });

  return (
    <div className="min-w-0">
      <Label
        className={
          row ? "sr-only" : "text-xs font-medium mb-1.5 block truncate"
        }
      >
        {label}
      </Label>
      <Select
        value={currentValue}
        onValueChange={(val) => {
          if (val) onChange(val);
        }}
      >
        <SelectTrigger
          aria-label={label}
          {...(row ? { "data-slot": "input" } : {})}
          className={
            row
              ? "!h-7 w-full justify-start gap-2 text-xs px-2 !py-1 [&>svg:last-child]:ml-auto [&>svg:last-child]:size-3.5 [&>svg:last-child]:text-muted-foreground"
              : "!h-7 w-full text-xs bg-input/25 border-border/20 px-2 !py-1"
          }
          onPointerDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && onReset) {
              e.preventDefault();
              onReset();
            }
          }}
          title={onReset ? "Click to open, Cmd+Click to reset" : undefined}
        >
          {row && icon && (
            <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5">
              {icon}
            </span>
          )}
          <SelectValue>{getShadowDisplayName(currentValue)}</SelectValue>
        </SelectTrigger>{" "}
        {/* Row: drop below the field at its width instead of overlaying it
            (overlaying lines the item text up and spills past the card). */}
        <SelectContent alignItemWithTrigger={!row}>
          <SelectItem value="none">None</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={`var(--shadow-${group.id})`}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
