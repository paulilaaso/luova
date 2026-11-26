"use client";

import { useEffect, useRef } from "react";
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store";

interface UseCyclableOptions {
  id: string;
  label: string;
  options: string[];
  currentValue: string;
  onChange: (value: string) => void;
  priority?: number;
  enabled?: boolean;
}

export function useRegisterCyclable({
  id,
  label,
  options,
  currentValue,
  onChange,
  priority = 0,
  enabled = true,
}: UseCyclableOptions) {
  const registerGroup = useKeyboardNavStore((s) => s.registerGroup);
  const unregisterGroup = useKeyboardNavStore((s) => s.unregisterGroup);
  const updateGroupValue = useKeyboardNavStore((s) => s.updateGroupValue);
  const updateGroupOptions = useKeyboardNavStore((s) => s.updateGroupOptions);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Register/unregister on mount/unmount
  useEffect(() => {
    if (!enabled || options.length === 0) return;

    registerGroup({
      id,
      label,
      options,
      currentValue,
      onChange: (v) => onChangeRef.current(v),
      priority,
    });

    return () => {
      unregisterGroup(id);
    };
  }, [
    id,
    enabled,
    registerGroup,
    unregisterGroup,
    options,
    priority,
    label,
    currentValue,
  ]);

  // Keep value in sync
  useEffect(() => {
    if (enabled) {
      updateGroupValue(id, currentValue);
    }
  }, [id, currentValue, enabled, updateGroupValue]);

  // Keep options in sync
  useEffect(() => {
    if (enabled) {
      updateGroupOptions(id, options);
    }
  }, [id, enabled, updateGroupOptions, options]);
}
