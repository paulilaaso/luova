import { Code, Palette, Settings2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Separator } from "@/components/luova-ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/luova-ui/tabs";
import { cn } from "@/lib/luova-utils";
import { useAiStore } from "@/stores/ai-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import CodeEditor from "./CodeEditor";
import ComponentPropsForm from "./ComponentPropsForm";
import ThemeEditor from "./ThemeEditor";

export default function PropertiesPanel() {
  const selectedIds = useUIStore((state) => state.selectedIds);
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const selectedNode = selectedIds[0] ? nodes[selectedIds[0]] : null;
  const selectedId = selectedIds[0] ?? null;
  const deleteComponent = useProjectStore(
    (state: ProjectStore) => state.deleteComponent
  );
  const deleteComponents = useProjectStore(
    (state: ProjectStore) => state.deleteComponents
  );
  const globalPropertiesTab = useUIStore((state) => state.propertiesTab);
  const setGlobalPropertiesTab = useUIStore((state) => state.setPropertiesTab);
  const setAiPropertiesTab = useAiStore((state) => state.setPropertiesTab);

  const prevSelectedId = useRef<string | null>(null);

  useEffect(() => {
    // Auto-cleanup: remove empty captured elements when deselecting or selecting a different component
    if (selectedId !== prevSelectedId.current && prevSelectedId.current) {
      const prevNode = useProjectStore.getState().nodes[prevSelectedId.current];
      if (
        prevNode &&
        prevNode.kind === "captured" &&
        (!prevNode.comment || prevNode.comment.trim() === "") &&
        !prevNode.capturedMetadata?.hasEdits
      ) {
        // Dropping an untouched edit isn't an undo step (undo skips the
        // matching creation step, which no longer changes anything).
        const store = useProjectStore.getState();
        const id = prevSelectedId.current;
        store.withoutHistory(() => store.discardCapturedNode(id));
      }
    }

    if (
      selectedNode &&
      selectedId &&
      selectedId !== prevSelectedId.current &&
      // "Go to Code" selects the component and opens the Code tab itself.
      !useUIStore.getState().consumeRevealSelect(selectedId)
    ) {
      queueMicrotask(() => {
        setGlobalPropertiesTab("components");
      });
    }

    prevSelectedId.current = selectedId;
  }, [selectedId, selectedNode, setGlobalPropertiesTab]);

  useEffect(() => {
    if (
      globalPropertiesTab === "components" ||
      globalPropertiesTab === "code" ||
      globalPropertiesTab === "theme"
    ) {
      setAiPropertiesTab(globalPropertiesTab);
    }
  }, [globalPropertiesTab, setAiPropertiesTab]);

  const handleTabChange = (nextTab: string) => {
    setGlobalPropertiesTab(nextTab as "components" | "theme" | "code");
    if (nextTab === "components" || nextTab === "code" || nextTab === "theme") {
      setAiPropertiesTab(nextTab);
    }
  };

  const handleDelete = () => {
    useProjectStore.getState().withBatchedHistory(() => {
      if (selectedIds.length > 1) {
        deleteComponents(selectedIds);
      } else if (selectedId && selectedId !== "root") {
        deleteComponent(selectedId);
      }
    });
    useUIStore.getState().clearSelection();
  };

  const renderTabsList = () => (
    <>
      <TabsList
        className="properties-panel-main-tabs-list flex w-full bg-muted/50 gap-1 min-h-8 h-auto items-center rounded-none p-1"
        style={
          {
            "--tabs-radius": "0px",
            "--tabs-border-w": "0px",
          } as React.CSSProperties
        }
      >
        <TabsTrigger
          value="components"
          className="properties-panel-main-tab-trigger flex items-center justify-center gap-1.5 !h-7 px-3 text-xs font-medium flex-1"
          style={
            {
              "--tabs-trigger-radius": "var(--control-radius, var(--radius))",
            } as React.CSSProperties
          }
        >
          <Settings2 className="h-4 w-4" />
          <span>Config</span>
        </TabsTrigger>
        <TabsTrigger
          value="theme"
          className="properties-panel-main-tab-trigger flex items-center justify-center gap-1.5 !h-7 px-3 text-xs font-medium flex-1"
          style={
            {
              "--tabs-trigger-radius": "var(--control-radius, var(--radius))",
            } as React.CSSProperties
          }
          onClick={() => handleTabChange("theme")}
        >
          <Palette className="h-4 w-4" />
          <span>Theme</span>
        </TabsTrigger>
        <TabsTrigger
          value="code"
          className="properties-panel-main-tab-trigger flex items-center justify-center gap-1.5 !h-7 px-3 text-xs font-medium flex-1"
          style={
            {
              "--tabs-trigger-radius": "var(--control-radius, var(--radius))",
            } as React.CSSProperties
          }
        >
          <Code className="h-4 w-4" />
          <span>Code</span>
        </TabsTrigger>
      </TabsList>
      <Separator orientation="horizontal" />
    </>
  );

  if (selectedIds.length > 1) {
    return (
      <div className="properties-panel flex flex-col bg-sidebar text-sidebar-foreground h-full min-h-0">
        <Tabs
          value={globalPropertiesTab}
          onValueChange={handleTabChange}
          className="properties-panel-main-tabs flex flex-col h-full min-h-0 gap-0"
        >
          {renderTabsList()}
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin outline-none",
              globalPropertiesTab === "components" ? "flex flex-col" : "hidden"
            )}
          >
            <div className="p-4 scrollbar-thin-compensate">
              <div className="flex items-center justify-between mb-4 h-7 px-2">
                <h2 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
                  {selectedIds.length} Selected
                </h2>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full px-3 py-2 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md transition-colors"
                >
                  Delete All ({selectedIds.length})
                </button>
              </div>
            </div>
          </div>
          <div
            className={cn(
              "flex-1 min-h-0 overflow-hidden outline-none",
              globalPropertiesTab === "code" ? "flex flex-col" : "hidden"
            )}
          >
            <h2 className="text-sm font-semibold mb-4">Source Code</h2>
            <p className="text-xs text-muted-foreground">
              Select a component to edit its source code
            </p>
          </div>
          <div
            className={cn(
              "flex-1 min-h-0 flex flex-col overflow-hidden outline-none p-0 theme-editor-wrapper",
              globalPropertiesTab === "theme" ? "flex" : "hidden"
            )}
          >
            <ThemeEditor />
          </div>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="properties-panel flex flex-col bg-sidebar text-sidebar-foreground h-full min-h-0">
      <Tabs
        value={globalPropertiesTab}
        onValueChange={handleTabChange}
        className="properties-panel-main-tabs flex flex-col h-full min-h-0 overflow-hidden gap-0"
      >
        {renderTabsList()}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin outline-none",
            globalPropertiesTab === "components" ? "flex flex-col" : "hidden"
          )}
        >
          <div className="scrollbar-thin-compensate">
            <ComponentPropsForm onDelete={handleDelete} />
          </div>
        </div>
        <div
          className={cn(
            "flex-1 min-h-0 overflow-hidden outline-none",
            globalPropertiesTab === "code" ? "flex flex-col" : "hidden"
          )}
        >
          <CodeEditor nodeId={selectedId} />
        </div>
        <div
          className={cn(
            "flex-1 min-h-0 overflow-hidden outline-none",
            globalPropertiesTab === "theme" ? "flex flex-col" : "hidden"
          )}
        >
          <ThemeEditor />
        </div>
      </Tabs>
    </div>
  );
}
