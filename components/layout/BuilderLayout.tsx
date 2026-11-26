"use client";

import { saveAs } from "file-saver";
import JSZip from "jszip";
import {
  Eye,
  File,
  FileArchive,
  FilePlus,
  FolderOpen,
  RotateCcw,
  Save,
  SaveAll,
  Target,
  Upload,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import AiResponseOverlay from "@/components/ai/AiResponseOverlay";
import AiTopBar from "@/components/ai/AiTopBar";
import Canvas from "@/components/builder/Canvas";
import PrimitivesDropdown from "@/components/builder/PrimitivesDropdown";
import { Button } from "@/components/luova-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/luova-ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/luova-ui/resizable";
import { Separator } from "@/components/luova-ui/separator";
import { TooltipProvider } from "@/components/luova-ui/tooltip";
import PropertiesPanel from "@/components/properties/PropertiesPanel";
import { ModeToggle } from "@/components/theme/mode-toggle";
import { ThemeEngineInitializer } from "@/components/theme/ThemeEngineInitializer";
import { ThemeStyleBlock } from "@/components/theme/ThemeStyleBlock";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useMCPStream } from "@/hooks/use-mcp-stream";
import { useMounted } from "@/hooks/use-mounted";
import { useUnifiedHistory } from "@/hooks/use-unified-history";
import {
  takeOverWorkspace,
  useWorkspaceLock,
} from "@/hooks/use-workspace-lock";
import { isInteractiveTextElement } from "@/lib/luova-utils";
import { useAiSettingsStore } from "@/stores/ai-settings-store";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import {
  exportProjectToZip,
  generateSimpleProjectCss,
} from "@/utils/export-project";

/**
 * Resolves once no Save write still holds the project file open. Showing a
 * picker (or detaching the handle) while a write is in flight leaves the
 * file locked, so it appears greyed out ("already open") in the native
 * picker until `close()` releases it.
 */
async function awaitFileWritesDrained(): Promise<void> {
  try {
    const { awaitPendingFileWrites } = await import(
      "@/lib/file-handle-storage"
    );
    await awaitPendingFileWrites();
  } catch {
    // best-effort
  }
}

export default function BuilderLayout() {
  const mounted = useMounted();

  const [showJSON, _setShowJSON] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<string>("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const openProjectInputRef = useRef<HTMLInputElement>(null);
  const previewMode = useUIStore((state) => state.previewMode);
  const setPreviewMode = useUIStore((state) => state.setPreviewMode);
  const activeMenu = useUIStore((state) => state.activeMenu);
  const setActiveMenu = useUIStore((state) => state.setActiveMenu);
  const exportJSON = useProjectStore((state: ProjectStore) => state.exportJSON);
  const importJSON = useProjectStore((state: ProjectStore) => state.importJSON);
  const clearState = useAiStore((state) => state.clearState);
  const { colorFormat, tailwindVersion } = usePreferencesStore();

  // Active disk-file name for the Save workflow (used in the Save tooltip).
  const activeFileName = useProjectStore(
    (state: ProjectStore) => state.fileName
  );

  // Ref to the latest save handler so the global `luova:save-project` event
  // (dispatched by the Cmd+S / Ctrl+S shortcut) always invokes fresh logic.
  const saveProjectRef = useRef<() => Promise<void>>(async () => {});

  // Global save trigger (Cmd+S / Ctrl+S) — see hooks/use-keyboard-nav.ts.
  useEffect(() => {
    const onSaveEvent = () => {
      void saveProjectRef.current();
    };
    window.addEventListener("luova:save-project", onSaveEvent);
    return () => window.removeEventListener("luova:save-project", onSaveEvent);
  }, []);

  // Warn before closing the tab when the project has unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useProjectStore.getState().hasUnsavedChanges()) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Restore the persisted file handle on mount so the first Save writes back
  // to the previously used `.luova` file. Permissions are NOT requested here —
  // they are requested on the next explicit Save gesture.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const { idbGetFileHandle } = await import("@/lib/file-handle-storage");
        const record = await idbGetFileHandle();
        if (cancelled || !record?.handle) return;
        const st = useProjectStore.getState();
        // Don't clobber a handle that was already bound (e.g. via Open).
        if (st.fileHandle) return;
        st.setFileHandle(record.handle);
        if (record.fileName) st.setFileName(record.fileName);
      } catch {
        // Best-effort: a missing handle just means Save falls back to Save As.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  // Access custom undo/redo via event-sourcing (keyboard shortcuts still work)
  useUnifiedHistory();

  const mcpEnabled = useAiSettingsStore((s) => s.mcpEnabled);
  const inspectorMode = useUIStore((state) => state.inspectorMode);
  const toggleInspectorMode = useUIStore((state) => state.toggleInspectorMode);

  // Universal keyboard navigation (Alt+Up/Down to cycle, Alt+Left/Right to switch group)
  useKeyboardNav();

  // Only one tab edits at a time; others stop saving (see hook).
  const isWorkspaceActive = useWorkspaceLock();

  // MCP stream — only runs when enabled in settings, in the editing tab
  useMCPStream(mcpEnabled && isWorkspaceActive);

  // Global native event interceptor: stop keyboard events from text inputs
  // bubbling to window where user-authored canvas components listen.
  // React 17+ attaches to the root node (below document), so React inputs
  // still process normally, but window.addEventListener('keydown') in
  // user code never sees keystrokes typed in Luova UI.
  useEffect(() => {
    const stopNativePropagation = (e: KeyboardEvent) => {
      if (isInteractiveTextElement(e.target)) {
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", stopNativePropagation);
    document.addEventListener("keyup", stopNativePropagation);
    return () => {
      document.removeEventListener("keydown", stopNativePropagation);
      document.removeEventListener("keyup", stopNativePropagation);
    };
  }, []);

  // Populate JSON preview when the JSON view is shown
  useEffect(() => {
    if (!showJSON) return;
    exportJSON().then(setJsonPreview).catch(console.error);
  }, [showJSON, exportJSON]);

  // Opening the app: an empty canvas starts at 100% (zoom-to-fit would zoom
  // far in on nothing); a canvas with content zooms to fit it.
  useEffect(() => {
    if (!mounted) return;
    setTimeout(() => {
      const container = document.querySelector("[data-canvas-container]");
      const rect = container?.getBoundingClientRect();
      if (!rect) return;
      const { nodes, rootId } = useProjectStore.getState();
      const isEmpty = Object.keys(nodes).every((id) => id === rootId);
      if (isEmpty) {
        useCanvasStore.getState().zoomTo100(rect.width, rect.height);
      } else {
        useCanvasStore.getState().zoomToFit(rect.width, rect.height);
      }
    }, 10);
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse text-sm">
          Initializing Luova...
        </div>
      </div>
    );
  }

  const handleSaveProject = async () => {
    // Don't start a write while a previous one still holds the file.
    await awaitFileWritesDrained();
    const projectState = useProjectStore.getState();
    if (projectState.isSaving) return;
    const fileHandle = projectState.fileHandle;

    if (fileHandle) {
      // File handle exists — verify permission, then overwrite.
      projectState.setIsSaving(true);
      try {
        const {
          ensureFileHandlePermission,
          idbUpdateFileHandleMeta,
          writeJsonToHandle,
        } = await import("@/lib/file-handle-storage");
        // Must run in the user gesture so the browser allows the prompt.
        const granted = await ensureFileHandlePermission(fileHandle);
        if (!granted) {
          toast.error("Permission denied", {
            description:
              "Write access was not granted. Use Save As to choose a file.",
          });
          return;
        }
        const json = await exportJSON();
        await writeJsonToHandle(fileHandle, json);
        const st = useProjectStore.getState();
        st.markSynced();
        const name = st.fileName ?? fileHandle.name ?? "project.luova";
        await idbUpdateFileHandleMeta({ lastSavedAt: Date.now() }).catch(
          () => undefined
        );
        toast.success(`Saved to ${name}`);
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        console.error("Save failed:", error);
        // A revoked/invalid handle falls back to Save As so work is not lost.
        if (
          error?.name === "NotFoundError" ||
          error?.name === "InvalidStateError"
        ) {
          useProjectStore.getState().setFileHandle(null);
          await handleSaveAsProject();
          return;
        }
        toast.error("Save failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        useProjectStore.getState().setIsSaving(false);
      }
    } else {
      // No handle — defer to Save As
      await handleSaveAsProject();
    }
  };
  // Keep the global-shortcut ref in sync (assigned every mounted render so
  // the `luova:save-project` listener always invokes the latest logic).
  saveProjectRef.current = handleSaveProject;

  const handleSaveAsProject = async () => {
    await awaitFileWritesDrained();
    const projectState = useProjectStore.getState();
    if (projectState.isSaving) return;
    projectState.setIsSaving(true);
    try {
      const json = await exportJSON();
      const blob = new Blob([json], { type: "application/json" });

      // Try File System Access API first
      const { supportsFileSystemAccess } = await import(
        "@/lib/file-handle-storage"
      );
      if (
        typeof window !== "undefined" &&
        supportsFileSystemAccess() &&
        "showSaveFilePicker" in window
      ) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `luova-project-${new Date().toISOString().split("T")[0]}.luova`,
            types: [
              {
                description: "Luova Project",
                accept: {
                  "application/json": [".luova"],
                  "application/x-luova": [".luova"],
                  "application/octet-stream": [".luova"],
                },
              },
            ],
          });

          // Write to the selected file
          const { writeJsonToHandle } = await import(
            "@/lib/file-handle-storage"
          );
          await writeJsonToHandle(handle, blob);

          // Bind the chosen file as the active working file for future Saves
          // (store syncs the handle to IndexedDB automatically).
          const st = useProjectStore.getState();
          st.setFileHandle(handle);
          st.setFileName(handle.name ?? null);
          st.markSynced();
          toast.success(`Saved to ${handle.name ?? "project.luova"}`);
          return;
        } catch (error: any) {
          // User cancelled or API not available — fall back to file-saver
          if (error.name === "AbortError") {
            return; // User cancelled, don't proceed to fallback
          }
          console.error("File System Access API error:", error);
        }
      }

      // Fallback: use file-saver
      saveAs(
        blob,
        `luova-project-${new Date().toISOString().split("T")[0]}.luova`
      );
      useProjectStore.getState().markSynced();
      toast.success("Project downloaded successfully");
    } catch (error) {
      console.error("Save As failed:", error);
      toast.error("Save As failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      useProjectStore.getState().setIsSaving(false);
    }
  };

  const handleExportComponentsAsCode = () => {
    startTransition(async () => {
      const projectState = useProjectStore.getState();
      const allSelectedIds = useUIStore.getState().selectedIds;
      const rootId = useProjectStore.getState().rootId;

      // Filter valid selected IDs (ignore root)
      const validSelectedIds = allSelectedIds.filter((id) => id !== rootId);
      const hasSelection = validSelectedIds.length > 0;

      // Determine nodes to export
      const nodesToExport = hasSelection
        ? validSelectedIds
            .map((id) => projectState.nodes[id])
            .filter((node): node is NonNullable<typeof node> => !!node)
        : Object.values(projectState.nodes).filter(
            (node) => node.id !== projectState.rootId
          );

      if (nodesToExport.length === 0) {
        toast.error("No components to export");
        return;
      }

      try {
        // Single component: export as .tsx
        if (nodesToExport.length === 1) {
          const node = nodesToExport[0];
          const code = node.code || `// ${node.type || "component"}`;
          const blob = new Blob([code], { type: "text/plain" });
          const filename = `${node.type || "component"}.tsx`;
          saveAs(blob, filename);
          toast.success(
            hasSelection
              ? "Selected component exported as .tsx"
              : "All components exported as .tsx"
          );
          return;
        }

        // Multiple components: use ZIP
        const zip = new JSZip();
        const fileCountMap: Record<string, number> = {};

        nodesToExport.forEach((node) => {
          let filename = node.type || "component";
          const count = (fileCountMap[filename] || 0) + 1;
          fileCountMap[filename] = count;

          if (count > 1) {
            filename = `${filename}${count}`;
          }

          const code = node.code || `// ${filename}`;
          zip.file(`${filename}.tsx`, code);
        });

        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, "components.zip");
        toast.success(
          hasSelection
            ? `Selected ${nodesToExport.length} component(s) exported as .tsx`
            : `All ${nodesToExport.length} component(s) exported as .tsx`
        );
      } catch (error) {
        console.error("Export failed:", error);
        toast.error("Export failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  };

  const handleExportComponentsAsJson = () => {
    startTransition(() => {
      const projectState = useProjectStore.getState();
      const allSelectedIds = useUIStore.getState().selectedIds;
      const rootId = useProjectStore.getState().rootId;

      // Filter valid selected IDs (ignore root)
      const validSelectedIds = allSelectedIds.filter((id) => id !== rootId);
      const hasSelection = validSelectedIds.length > 0;

      // Determine nodes to export
      let nodesToExport: any[];
      if (hasSelection) {
        nodesToExport = validSelectedIds
          .map((id) => projectState.nodes[id])
          .filter((node): node is NonNullable<typeof node> => !!node);
      } else {
        nodesToExport = Object.values(projectState.nodes).filter(
          (node) => node.id !== projectState.rootId
        );
      }

      if (nodesToExport.length === 0) {
        toast.error("No components to export");
        return;
      }

      const nodesDict: Record<string, any> = {};
      nodesToExport.forEach((node) => {
        nodesDict[node.id] = node;
      });

      const exportData = {
        nodes: nodesDict,
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      saveAs(blob, "components.json");
      toast.success(
        hasSelection
          ? `Selected ${nodesToExport.length} component(s) exported as .json`
          : `All ${nodesToExport.length} component(s) exported as .json`
      );
    });
  };

  const handleExportCode = async () => {
    startTransition(async () => {
      try {
        const projectState = useProjectStore.getState();
        const themeState = useThemeStore.getState();
        const allSelectedIds = useUIStore.getState().selectedIds;
        const rootId = useProjectStore.getState().rootId;

        // Filter valid selected IDs (ignore root)
        const validSelectedIds = allSelectedIds.filter((id) => id !== rootId);
        const hasSelection = validSelectedIds.length > 0;

        const blob = await exportProjectToZip(projectState, themeState, {
          colorFormat,
          tailwindVersion,
          selectedNodeIds: hasSelection ? validSelectedIds : undefined,
        });

        saveAs(blob, "luova-project-export.zip");
        toast.success(
          hasSelection
            ? "Project exported with selected components"
            : "Full project exported"
        );
      } catch (error) {
        console.error("Export failed:", error);
        toast.error("Export failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  };

  const handleExportThemeCSS = () => {
    startTransition(() => {
      const themeState = useThemeStore.getState();
      const cssCode = generateSimpleProjectCss(themeState, tailwindVersion);

      const blob = new Blob([cssCode], { type: "text/css" });
      saveAs(blob, "theme.css");
      toast.success("Theme CSS exported successfully");
    });
  };

  const loadProjectFile = async (file: File, fileHandle?: any) => {
    // Don't bind a file that is still being written — wait for its writable
    // to close first.
    await awaitFileWritesDrained();
    // Validate filename explicitly (browser may allow other extensions)
    if (!file.name.toLowerCase().endsWith(".luova")) {
      toast.error("Invalid file extension", {
        description:
          "Only .luova files can be opened as projects. Use 'Import' for .json component files.",
      });
      return;
    }

    try {
      const content = await file.text();
      const name: string | null =
        (fileHandle as any)?.name ?? file.name ?? null;
      const st = useProjectStore.getState();
      // Bind the handle atomically with the content load so parsing the JSON
      // never wipes the association (see loadProjectJSON options).
      st.loadProjectJSON(
        content,
        fileHandle ? { handle: fileHandle, fileName: name } : { fileName: name }
      );
      if (fileHandle) {
        // Set immediately for snappy UI; the async load applies the same values.
        st.setFileHandle(fileHandle);
      }
      if (name) {
        st.setFileName(name);
      }
      toast.success(name ? `Opened ${name}` : "Project opened successfully");
    } catch (error) {
      console.error("Open project failed:", error);
      toast.error("Invalid project file", {
        description:
          "The selected file is not a valid Luova project. Try importing it as a component instead.",
      });
    }
  };

  const onOpenProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    loadProjectFile(file);
  };

  const handleOpenProject = async () => {
    // Strictly separate async File System Access API from synchronous input fallback.
    if (typeof window === "undefined") return;

    // Don't show the picker while a Save write still holds the file open —
    // it would appear greyed out ("already open") until the write closes.
    await awaitFileWritesDrained();

    if (!("showOpenFilePicker" in window)) {
      openProjectInputRef.current?.click();
      return;
    }

    try {
      const handles = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "Luova Project",
            accept: {
              "application/json": [".luova"],
              "application/x-luova": [".luova"],
              "application/octet-stream": [".luova"],
            },
          },
        ],
        excludeAcceptAllOption: false,
      });

      const fileHandle = handles[0];
      const file = await fileHandle.getFile();
      await loadProjectFile(file, fileHandle);
    } catch (error: any) {
      if (error.name === "AbortError") {
        return;
      }
      console.error("File System Access API error:", error);
      toast.error("Failed to open project", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const onImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    // A .luova dropped into the Import input on a blank canvas is almost
    // certainly an attempt to open the project, not to append components.
    // Route it to the full project loader (theme + system prompt + handle).
    const isLuovaFile = file.name.toLowerCase().endsWith(".luova");
    if (isLuovaFile) {
      const state = useProjectStore.getState();
      const hasActiveNodes = Object.values(state.nodes).some(
        (n) => n.id !== state.rootId
      );
      if (!hasActiveNodes) {
        void loadProjectFile(file);
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;

        const isTsxFile =
          file.name.endsWith(".tsx") || file.name.endsWith(".ts");

        if (isTsxFile) {
          // Import as TSX component
          const projectState = useProjectStore.getState();
          const canvasState = useCanvasStore.getState();

          // Calculate drop position at center of viewport
          const viewportW =
            document.querySelector("[data-canvas-container]")?.clientWidth ||
            800;
          const viewportH =
            document.querySelector("[data-canvas-container]")?.clientHeight ||
            600;

          // Default component dimensions
          const w = 200;
          const h = 100;

          // Center in viewport
          const canvasX =
            (-canvasState.panX + viewportW / 2) / canvasState.zoom - w / 2;
          const canvasY =
            (-canvasState.panY + viewportH / 2) / canvasState.zoom - h / 2;

          const x = Math.max(0, Math.round(canvasX));
          const y = Math.max(0, Math.round(canvasY));

          // Add component with imported code
          const newId = projectState.addComponent(
            "Container",
            { x, y },
            content,
            { w, h }
          );

          // Select the newly created component
          useUIStore.getState().selectComponent(newId);
          toast.success("TSX component imported successfully");
        } else {
          // Import as JSON project (.luova and .json files)
          importJSON(content);
          if (isLuovaFile) {
            toast.message("Components imported", {
              description:
                "Your workspace already had content. To restore a whole project (theme + system prompt), use File → Open Project.",
            });
          } else {
            toast.success("Components imported successfully");
          }
        }
      } catch (error) {
        toast.error("Import Error", {
          description:
            error instanceof Error ? error.message : "Unknown error occurred",
        });
      }
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleReset = () => {
    useProjectStore.getState().resetToCurrentPreset();
  };

  const handleNewProject = async () => {
    // If a Save is still writing the old file, wait for its writable to
    // close before detaching — otherwise the file stays locked ("already
    // open") for a subsequent Open picker.
    await awaitFileWritesDrained();

    // Force the browser to drop any DOM file references held by hidden inputs.
    if (openProjectInputRef.current) openProjectInputRef.current.value = "";
    if (importInputRef.current) importInputRef.current.value = "";

    // Await the IndexedDB file-handle removal so no stale handle lingers.
    try {
      const { idbClearFileHandle } = await import("@/lib/file-handle-storage");
      await idbClearFileHandle();
    } catch {
      // best-effort
    }

    // Unified reset: project slice (nodes, assets, file handle) + theme slice.
    useAppStore.getState().reset();

    // Start the fresh canvas with empty undo/redo stacks.
    (useProjectStore as any).temporal?.getState()?.clear?.();

    // Clear AI state
    clearState();
    useAiStore.getState().setMessages([]);

    // A new project starts at 100% zoom, centered. Zoom-to-fit would zoom far
    // in on the empty canvas.
    setTimeout(() => {
      const container = document.querySelector("[data-canvas-container]");
      const rect = container?.getBoundingClientRect();
      if (rect) {
        useCanvasStore.getState().zoomTo100(rect.width, rect.height);
      }
    }, 10);
  };

  return (
    <ThemeStyleBlock>
      <ThemeEngineInitializer />
      <TooltipProvider delay={0}>
        <div
          className="h-screen w-screen overflow-hidden flex flex-col bg-background"
          data-app-backdrop="true"
        >
          {!isWorkspaceActive && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
              data-app-chrome="true"
            >
              <div className="max-w-sm space-y-3 rounded-xl border bg-card p-6 text-center shadow-lg">
                <p className="text-sm font-medium">
                  Luova is open in another tab
                </p>
                <Button onClick={() => takeOverWorkspace()}>
                  Use Luova here
                </Button>
              </div>
            </div>
          )}
          <input
            ref={openProjectInputRef}
            type="file"
            accept=".luova,application/json,application/x-luova"
            className="hidden"
            onChange={onOpenProjectFileChange}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.tsx,.ts,.luova"
            className="hidden"
            onChange={onImportFileChange}
          />
          {/* Top Header */}
          <header
            className="sticky top-0 min-h-[var(--header-height)] w-full bg-sidebar/95 backdrop-blur flex flex-row items-center px-4 py-2 gap-2 z-40 shrink-0"
            data-app-chrome="true"
          >
            <h1 className="text-lg font-semibold shrink-0 text-foreground mr-2">
              Luova
            </h1>

            <div className="flex items-center gap-2 text-foreground">
              {!previewMode && !showJSON && (
                <div>
                  <DropdownMenu
                    open={activeMenu === "project"}
                    onOpenChange={(open) =>
                      setActiveMenu(open ? "project" : null)
                    }
                    modal={false}
                  >
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-foreground flex items-center gap-2 h-8 py-1"
                        >
                          <File className="h-4 w-4" />
                          <span className="text-xs">File</span>
                        </Button>
                      }
                    />
                    <DropdownMenuContent
                      align="start"
                      side="bottom"
                      sideOffset={8}
                      className="w-48 p-1"
                    >
                      <DropdownMenuItem
                        onClick={handleNewProject}
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
                      >
                        <FilePlus className="h-4 w-4 text-muted-foreground" />
                        New Project
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleOpenProject}
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        Open Project
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleSaveProject}
                        title={
                          activeFileName
                            ? `Save to ${activeFileName} (⌘S / Ctrl+S)`
                            : "Save (⌘S / Ctrl+S) — will prompt for a location"
                        }
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
                      >
                        <Save className="h-4 w-4 text-muted-foreground" />
                        Save
                        <span className="ml-auto text-2xs text-muted-foreground">
                          ⌘S
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleSaveAsProject}
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
                      >
                        <SaveAll className="h-4 w-4 text-muted-foreground" />
                        Save As...
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleImport}
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md"
                      >
                        <Upload className="h-4 w-4 text-muted-foreground" />
                        Import
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-md">
                          <FileArchive className="h-4 w-4 text-muted-foreground" />
                          Export
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent align="start" sideOffset={-8}>
                          <DropdownMenuItem
                            onClick={handleExportComponentsAsCode}
                          >
                            Components (.tsx)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={handleExportComponentsAsJson}
                          >
                            Components (.json)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={handleExportThemeCSS}>
                            Theme (.css)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={handleExportCode}>
                            Project (.zip)
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {!previewMode && !showJSON && <PrimitivesDropdown />}

              {!previewMode && !showJSON && (
                <Button
                  variant={inspectorMode ? "secondary" : "ghost"}
                  size="sm"
                  className="text-foreground flex items-center gap-2 h-8 py-1"
                  onClick={toggleInspectorMode}
                  title="Edit"
                >
                  <Target className="h-4 w-4" />
                  <span className="text-xs">Edit</span>
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-7">
              {!previewMode && !showJSON && <AiTopBar disabled={false} />}
            </div>

            <div className="flex items-center gap-2">
              {!previewMode && !showJSON && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-foreground flex items-center gap-2 h-8 py-1"
                  onClick={handleReset}
                  title="Reset theme"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="text-xs">Reset</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground flex items-center gap-2 h-8 py-1"
                onClick={() => setPreviewMode(!previewMode)}
                title="Preview"
              >
                <Eye className="h-4 w-4" />
                <span className="text-xs">Preview</span>
              </Button>
              <ModeToggle />
            </div>
          </header>

          <Separator orientation="horizontal" data-app-chrome="true" />

          {/* Main 2-Column Layout */}
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex-1 min-h-0"
            id="builder-main-layout"
          >
            {/* Center - Canvas or JSON View */}
            <ResizablePanel
              id="main-canvas-panel"
              defaultSize={previewMode || showJSON ? 100 : 73}
              minSize={30}
              className="flex flex-col relative min-h-0"
            >
              <main
                data-canvas-container
                className="relative flex flex-col flex-1 min-h-0"
              >
                {showJSON ? (
                  <div
                    className="p-4 flex flex-col flex-1 min-h-0"
                    data-app-chrome="true"
                  >
                    <pre className="bg-background p-4 rounded-lg border flex-1 overflow-auto scrollbar-thin text-xs font-mono">
                      {jsonPreview}
                    </pre>
                  </div>
                ) : (
                  <Canvas />
                )}

                <AiResponseOverlay hidden={previewMode || showJSON} />
              </main>
            </ResizablePanel>

            {/* Right Sidebar - Properties Panel */}
            {!previewMode && !showJSON && (
              <>
                <ResizableHandle
                  withHandle
                  className="hover:bg-primary/50 transition-colors"
                  data-app-chrome="true"
                />
                <ResizablePanel
                  id="properties-panel"
                  defaultSize={27}
                  minSize={20}
                  className="flex flex-col z-20 min-h-0"
                  data-app-chrome="true"
                >
                  <PropertiesPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </TooltipProvider>
    </ThemeStyleBlock>
  );
}
