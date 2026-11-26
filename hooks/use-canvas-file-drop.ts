import { type RefObject, useEffect } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import {
  buildImageCode,
  getImageDimensions,
  isValidImageFile,
  readImageAsBase64,
} from "@/utils/file-helpers";
import { snapToGrid } from "@/utils/spatial-engine";

/**
 * Handles native OS file drag-and-drop onto the canvas.
 * Converts dropped image files to Base64 and places them at the cursor position,
 * accounting for the current camera pan and zoom.
 */
export function useCanvasFileDrop(
  containerRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      // Only intercept if there are files being dragged
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }
    };

    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;

      e.preventDefault();
      e.stopPropagation();

      const containerRect = el.getBoundingClientRect();
      const { panX, panY, zoom, gridConfig } = useCanvasStore.getState();

      const files = Array.from(e.dataTransfer.files);

      for (const file of files) {
        try {
          // A dropped .luova project file: open it wholesale on a blank
          // canvas, otherwise append its components.
          if (file.name.toLowerCase().endsWith(".luova")) {
            const projectState = useProjectStore.getState();
            const hasActiveNodes = Object.values(projectState.nodes).some(
              (n) => n.id !== projectState.rootId
            );
            const content = await file.text();
            if (!hasActiveNodes) {
              projectState.loadProjectJSON(content, { fileName: file.name });
            } else {
              projectState.importJSON(content);
            }
            continue;
          }

          // Check if it's a code file (.tsx, .ts)
          const isCodeFile =
            file.name.endsWith(".tsx") ||
            file.name.endsWith(".ts") ||
            file.type === "application/typescript" ||
            file.type === "text/typescript" ||
            file.type === "text/plain";

          // Convert screen drop position to canvas coordinates
          const screenX = e.clientX - containerRect.left;
          const screenY = e.clientY - containerRect.top;
          const canvasX = (screenX - panX) / zoom;
          const canvasY = (screenY - panY) / zoom;

          if (
            isCodeFile &&
            (file.name.endsWith(".tsx") || file.name.endsWith(".ts"))
          ) {
            // Handle code files
            const fileContent = await file.text();

            const w = 200;
            const h = 100;

            let x = canvasX - w / 2;
            let y = canvasY - h / 2;

            // Snap to grid if enabled
            if (gridConfig.snapToGrid && gridConfig.gridSize > 0) {
              x = snapToGrid(x, gridConfig.gridSize);
              y = snapToGrid(y, gridConfig.gridSize);
            }

            x = Math.max(0, Math.round(x));
            y = Math.max(0, Math.round(y));

            const newId = useProjectStore
              .getState()
              .addComponent("Container", { x, y }, fileContent, { w, h });
            useUIStore.getState().selectComponent(newId);
          } else if (isValidImageFile(file)) {
            // Handle image files — preserve original filename for labels, code + AI context
            const base64 = await readImageAsBase64(file);
            const dims = await getImageDimensions(base64);
            const fileName = file.name;
            const assetId = useProjectStore
              .getState()
              .addAsset(base64, fileName);
            const code = buildImageCode(assetId, { fileName, alt: fileName });

            const w = dims.width;
            const h = dims.height;

            // Center image on cursor
            let x = canvasX - w / 2;
            let y = canvasY - h / 2;

            // Snap to grid if enabled
            if (gridConfig.snapToGrid && gridConfig.gridSize > 0) {
              x = snapToGrid(x, gridConfig.gridSize);
              y = snapToGrid(y, gridConfig.gridSize);
            }

            x = Math.max(0, Math.round(x));
            y = Math.max(0, Math.round(y));

            const newId = useProjectStore
              .getState()
              .addComponent(
                "Image",
                { x, y },
                code,
                { w },
                { fileName, alt: fileName }
              );
            useUIStore.getState().selectComponent(newId);
          }
        } catch (err) {
          console.error("Failed to drop file:", err);
        }
      }
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);

    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [containerRef]);
}
