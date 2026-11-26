"use client";

import { useEffect } from "react";
import { useNodeOperations } from "@/hooks/use-node-operations";
import { isInteractiveTextElement } from "@/lib/luova-utils";
import { useCanvasStore } from "@/stores/canvas-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

export function useAlignmentShortcuts() {
  const selectedIds = useUIStore((state) => state.selectedIds);
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const { moveMultipleComponents } = useNodeOperations();
  const gridConfig = useCanvasStore((state) => state.gridConfig);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveTextElement(e.target)) return;

      const validSelectedIds = selectedIds.filter(
        (id) => id !== "root" && nodes[id]
      );
      if (validSelectedIds.length === 0) return;

      const leadNode = nodes[validSelectedIds[0]];
      if (!leadNode) return;

      const currentX = leadNode.props.x;
      const currentY = leadNode.props.y;
      const gridSize = gridConfig.gridSize;
      const isShift = e.shiftKey;

      let newX = currentX;
      let newY = currentY;
      let shouldUpdate = false;

      switch (e.key) {
        case "ArrowLeft":
          if (isShift && gridConfig.snapToGrid && gridSize > 0) {
            newX = Math.floor((currentX - 0.1) / gridSize) * gridSize;
          } else {
            newX = currentX - (isShift ? 10 : 1);
          }
          shouldUpdate = true;
          break;
        case "ArrowRight":
          if (isShift && gridConfig.snapToGrid && gridSize > 0) {
            newX = Math.ceil((currentX + 0.1) / gridSize) * gridSize;
          } else {
            newX = currentX + (isShift ? 10 : 1);
          }
          shouldUpdate = true;
          break;
        case "ArrowUp":
          if (isShift && gridConfig.snapToGrid && gridSize > 0) {
            newY = Math.floor((currentY - 0.1) / gridSize) * gridSize;
          } else {
            newY = currentY - (isShift ? 10 : 1);
          }
          shouldUpdate = true;
          break;
        case "ArrowDown":
          if (isShift && gridConfig.snapToGrid && gridSize > 0) {
            newY = Math.ceil((currentY + 0.1) / gridSize) * gridSize;
          } else {
            newY = currentY + (isShift ? 10 : 1);
          }
          shouldUpdate = true;
          break;
      }

      if (shouldUpdate) {
        e.preventDefault();

        const dx = newX - currentX;
        const dy = newY - currentY;

        const updates = validSelectedIds.map((id) => ({
          id,
          x: nodes[id].props.x + dx,
          y: nodes[id].props.y + dy,
        }));

        // Pass snapToGrid: false so moveNodes applies the exact calculated
        // delta without re-snapping 1px/10px nudges back to the grid origin.
        moveMultipleComponents(updates, { ...gridConfig, snapToGrid: false });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, nodes, moveMultipleComponents, gridConfig]);
}
