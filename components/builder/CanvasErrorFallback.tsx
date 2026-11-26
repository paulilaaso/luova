"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/luova-ui/button";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { sanitizeProjectState } from "@/utils/node-validation";

/** Per-node fallback: one bad component degrades to a placeholder. */
export function BrokenNodeFallback({
  nodeId,
  error,
}: {
  nodeId: string;
  error: Error;
}) {
  const remove = () => {
    try {
      useProjectStore.getState().deleteComponents([nodeId]);
    } catch {
      // Last resort: drop the node directly
      useProjectStore.setState((state: any) => {
        delete state.nodes[nodeId];
        state.layerOrder = (state.layerOrder as string[]).filter(
          (id) => id !== nodeId
        );
      });
    }
    const selected = useUIStore.getState().selectedIds;
    if (selected.includes(nodeId)) {
      useUIStore
        .getState()
        .selectComponents(selected.filter((id) => id !== nodeId));
    }
  };

  return (
    <div className="absolute left-0 top-0 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive max-w-[320px]">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p className="text-xs font-medium">This component failed to render</p>
      </div>
      <pre className="mt-1 text-[length:calc(0.6875rem*var(--font-scale,1))] opacity-80 whitespace-pre-wrap font-mono">
        {error.message}
      </pre>
      <Button size="sm" variant="outline" className="mt-2" onClick={remove}>
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        Remove component
      </Button>
    </div>
  );
}

/** Top-level fallback: the whole canvas failed — offer repair, never a dead end. */
export function CanvasCrashFallback({ error }: { error: Error }) {
  const repair = () => {
    const state = useProjectStore.getState() as any;
    const sanitized = sanitizeProjectState({
      nodes: state.nodes,
      layerOrder: state.layerOrder,
      rootId: state.rootId,
    });
    useProjectStore.setState({
      nodes: sanitized.nodes,
      layerOrder: sanitized.layerOrder,
      rootId: sanitized.rootId,
    } as any);
    useUIStore.getState().clearSelection();
  };

  const reset = () => {
    (useProjectStore.getState() as any).reset?.();
    useUIStore.getState().clearSelection();
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-8">
      <div className="max-w-md p-6 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <p className="font-medium">Canvas failed to render</p>
        </div>
        <pre className="text-xs opacity-80 whitespace-pre-wrap font-mono">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={repair}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Remove broken components
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            Reset canvas
          </Button>
        </div>
      </div>
    </div>
  );
}
