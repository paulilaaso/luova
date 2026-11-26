"use client";

import { useCallback, useEffect } from "react";
import { isTextEditingTarget } from "@/lib/luova-utils";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { ThemeEngine } from "@/utils/theme-engine";

/**
 * Core undo/redo callbacks — no keyboard listener.
 * Safe to call from multiple components (e.g. Canvas context menu).
 */
export function useUndoRedo() {
  const canUndo = useAppStore((s) => s.canUndo());
  const canRedo = useAppStore((s) => s.canRedo());

  const undo = useCallback(() => {
    useAiStore.getState().abortController?.abort();
    useAppStore.getState().undo();
    ThemeEngine.clearAllThemeCSSVariables();
  }, []);

  const redo = useCallback(() => {
    useAiStore.getState().abortController?.abort();
    useAppStore.getState().redo();
    ThemeEngine.clearAllThemeCSSVariables();
  }, []);

  return { undo, redo, canUndo, canRedo };
}

/**
 * Registers the global Cmd+Z / Cmd+Shift+Z / Cmd+Y keyboard listener.
 * Call this ONCE at the top of the component tree (BuilderLayout).
 * Components that only need the undo/redo callbacks should use useUndoRedo().
 */
export function useUnifiedHistory() {
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) return;

      const isMac = /Mac|iPad/.test(navigator.userAgent);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (useAppStore.getState().canRedo()) redo();
        } else {
          if (useAppStore.getState().canUndo()) undo();
        }
      } else if (modKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (useAppStore.getState().canRedo()) redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return { undo, redo, canUndo, canRedo };
}
