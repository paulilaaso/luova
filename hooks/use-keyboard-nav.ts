"use client";

import { useEffect } from "react";
import { isInteractiveTextElement } from "@/lib/luova-utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { useKeyboardNavStore } from "@/stores/keyboard-nav-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

export function useKeyboardNav() {
  // Only subscribe to values that are needed for non-paste/duplicate logic
  // (arrow-key group navigation). Paste and duplicate read live state via
  // .getState() inside the handler to avoid stale-closure bugs with rapid
  // sequential keypresses.
  const cycleActiveGroup = useKeyboardNavStore((s) => s.cycleActiveGroup);
  const groups = useKeyboardNavStore((s) => s.groups);
  const activeGroupId = useKeyboardNavStore((s) => s.activeGroupId);
  const setActiveGroup = useKeyboardNavStore((s) => s.setActiveGroup);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Save shortcut (Cmd+S / Ctrl+S): intercept even inside text
      // inputs so the browser's native "Save Page As" dialog never appears.
      // The actual write runs in BuilderLayout via the `luova:save-project`
      // event, where permission prompts have a valid user gesture.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("luova:save-project"));
        return;
      }

      if (isInteractiveTextElement(e.target)) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // If canvas components are selected, defer to alignment shortcuts for
        // nudging instead of cycling property-panel cyclable groups.
        const { selectedIds } = useUIStore.getState();
        const validSelected = selectedIds.filter((id) => id !== "root");
        if (validSelected.length > 0) return;

        const hasGroups = Object.keys(groups).length > 0;
        if (!hasGroups) return;

        e.preventDefault();
        e.stopPropagation();
        cycleActiveGroup(e.key === "ArrowDown" ? "down" : "up");
      }

      // Alt+Left/Right to switch between registered groups
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const groupIds = Object.keys(groups);
        if (groupIds.length <= 1) return;

        e.preventDefault();
        e.stopPropagation();
        const currentIdx = activeGroupId ? groupIds.indexOf(activeGroupId) : -1;
        let nextIdx: number;

        if (currentIdx === -1) {
          nextIdx = 0;
        } else if (e.key === "ArrowRight") {
          nextIdx = (currentIdx + 1) % groupIds.length;
        } else {
          nextIdx = (currentIdx - 1 + groupIds.length) % groupIds.length;
        }

        setActiveGroup(groupIds[nextIdx]);
      }

      // Backspace / Delete to delete selected components
      // Read selectedIds fresh from the store — not from the closure — so
      // rapid sequential deletes always see the latest selection state.
      // Both keys are handled: Backspace (⌫, macOS "delete") and Delete
      // (forward-delete: Windows Del key, macOS fn+Delete).
      if (e.key === "Backspace" || e.key === "Delete") {
        const { selectedIds } = useUIStore.getState();
        if (selectedIds.length === 0) return;

        e.preventDefault();
        e.stopPropagation();
        const { deleteComponent, deleteComponents } =
          useProjectStore.getState();
        useProjectStore.getState().withBatchedHistory(() => {
          if (selectedIds.length > 1) {
            deleteComponents(selectedIds.filter((id) => id !== "root"));
          } else if (selectedIds[0] !== "root") {
            deleteComponent(selectedIds[0]);
          }
        });
        useUIStore.getState().clearSelection();
      }

      // "e" key to toggle Inspector (Edit) Mode
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "e"
      ) {
        e.preventDefault();
        useUIStore.getState().toggleInspectorMode();
      }

      // "g" key to toggle Grid visibility
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "g"
      ) {
        e.preventDefault();
        useCanvasStore.getState().toggleGrid();
      }

      // Cmd+C / Ctrl+C to copy selected components
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        // Read fresh — copy after a paste should copy the newly pasted nodes
        const { selectedIds } = useUIStore.getState();
        if (selectedIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          useProjectStore.getState().copyComponents(selectedIds);
        }
      }

      // Cmd+X / Ctrl+X to cut selected components
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "x") {
        const { selectedIds } = useUIStore.getState();
        if (selectedIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          useProjectStore.getState().withBatchedHistory(() => {
            useProjectStore.getState().cutComponents(selectedIds);
          });
          useUIStore.getState().clearSelection();
        }
      }

      // Cmd+V / Ctrl+V to paste components
      // Fetch application state fresh immediately before the batched call so
      // the preState snapshot inside withBatchedHistory is always up-to-date,
      // even when two pastes fire back-to-back before React re-renders.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopPropagation();
        const newIds = useProjectStore.getState().withBatchedHistory(() => {
          return useProjectStore.getState().pasteComponents();
        });
        if (newIds.length > 0) {
          useUIStore.getState().selectComponents(newIds);
        }
      }

      // Cmd+D / Ctrl+D to duplicate selected components
      // Read selectedIds fresh from the stores so that a second
      // rapid Cmd+D sees the nodes added by the first duplication.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        // Pull live state — never use the closure's selectedIds here
        const { selectedIds } = useUIStore.getState();
        if (selectedIds.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const { duplicateComponents } = useProjectStore.getState();

        const newIds = useProjectStore.getState().withBatchedHistory(() => {
          return duplicateComponents(selectedIds);
        });
        if (newIds.length > 0) {
          useUIStore.getState().selectComponents(newIds);
        }
      }
    };

    // Use capture phase so we fire before Radix Select/DropdownMenu handlers
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    // Only the group-navigation values remain as closure dependencies.
    // Everything else is read via .getState() inside the handler.
    cycleActiveGroup,
    groups,
    activeGroupId,
    setActiveGroup,
  ]);
}
