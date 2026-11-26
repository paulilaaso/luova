"use client";

import { useEffect, useRef } from "react";
import { applyAiActions } from "@/hooks/use-ai-action-orchestrator";
import { validateCodeWithCompilerWorker } from "@/hooks/use-compiler-worker";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import type { AiPendingAction } from "@/types/ai";
import { applyCodeDiff, isSearchReplaceDiff } from "@/utils/code-processing";

const SYNC_DEBOUNCE_MS = 300;

async function validateMcpActions(
  actions: AiPendingAction[]
): Promise<AiPendingAction[]> {
  const nodes = useProjectStore.getState().nodes;

  return Promise.all(
    actions.map(async (action) => {
      if (action.tool === "update_theme" || action.tool === "draft_layout") {
        return action;
      }

      if (action.tool === "update_component_code") {
        // Normalize captured overlay targets to their source component so
        // code validation and diff checks run against the real component.
        let effectiveAction = action;
        const initialTarget = nodes[action.targetId];
        if (
          initialTarget?.kind === "captured" &&
          initialTarget.capturedMetadata?.sourceComponentId
        ) {
          effectiveAction = {
            ...action,
            targetId: initialTarget.capturedMetadata.sourceComponentId,
          };
        }
        const targetNode = nodes[effectiveAction.targetId];
        if (!targetNode) {
          return {
            ...effectiveAction,
            validationError: `Component ${effectiveAction.targetId} no longer exists.`,
          };
        }

        let codeToValidate = effectiveAction.code;
        if (isSearchReplaceDiff(effectiveAction.code)) {
          try {
            codeToValidate = applyCodeDiff(
              targetNode.code ?? "",
              effectiveAction.code
            );
            effectiveAction.code = codeToValidate;
          } catch (error) {
            return {
              ...effectiveAction,
              validationError: `Diff application failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        }

        const result = await validateCodeWithCompilerWorker(
          codeToValidate,
          targetNode.props
        );
        return {
          ...effectiveAction,
          validationError: result.isValid
            ? null
            : (result.error ?? "Invalid code."),
        };
      }

      const result = await validateCodeWithCompilerWorker(action.code, {});
      return {
        ...action,
        validationError: result.isValid
          ? null
          : (result.error ?? "Invalid code."),
      };
    })
  );
}

export function useMCPStream(enabled: boolean) {
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const processedToolCallIdsRef = useRef<Set<string>>(new Set());

  const nodes = useProjectStore((s: ProjectStore) => s.nodes);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const systemPrompt = useProjectStore((s: ProjectStore) => s.systemPrompt);
  const systemPromptEnabled = useProjectStore(
    (s: ProjectStore) => s.systemPromptEnabled
  );

  useEffect(() => {
    if (!enabled) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      processedToolCallIdsRef.current.clear();
      return;
    }

    const es = new EventSource("/api/mcp/canvas-stream");
    eventSourceRef.current = es;

    // Pause temporal tracking while MCP is streaming changes
    const temporalState = useAppStore.temporal.getState();
    temporalState.pause();

    try {
      const appState = useAppStore.getState();
      const snapshot = JSON.stringify({
        nodes: appState.nodes,
        themeState: appState.themeState,
        currentMode: appState.currentMode,
        layerOrder: appState.layerOrder,
        rootId: appState.rootId,
      });
      useAiStore.getState().setInitialAppSnapshot(snapshot);

      es.addEventListener("connected", () => {
        console.log("[MCP Stream] Connected");
      });

      es.addEventListener("actions", async (e) => {
        try {
          const actions = JSON.parse(e.data) as AiPendingAction[];
          if (actions.length > 0) {
            const newActions = actions.filter((a) => {
              if (a.toolCallId) {
                if (processedToolCallIdsRef.current.has(a.toolCallId))
                  return false;
                processedToolCallIdsRef.current.add(a.toolCallId);
                return true;
              }
              return true;
            });

            if (newActions.length > 0) {
              const validated = await validateMcpActions(newActions);
              const mcpMode = useAiStore.getState().activeMode ?? undefined;
              applyAiActions(validated, mcpMode);
              // Report per-action compiler/validation results back to the
              // server so get_canvas_state.recentActions lets the agent
              // self-correct instead of assuming fire-and-forget success.
              const actionResults = validated.map((action) => ({
                id: action.id,
                tool: action.tool,
                status: action.validationError ? "failed" : "applied",
                error: action.validationError ?? null,
              }));
              fetch("/api/mcp/canvas-stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  actionResults,
                  ackActionIds: validated.map((action) => action.id),
                }),
              }).catch(() => {});
            }
          }
        } catch {}
      });

      es.onerror = () => {
        console.warn("[MCP Stream] Connection lost, reconnecting...");
      };
    } finally {
      temporalState.resume();
    }

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);

    syncDebounceRef.current = setTimeout(() => {
      fetch("/api/mcp/canvas-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes,
          selectedIds,
          customSystemPrompt:
            systemPromptEnabled && systemPrompt.trim()
              ? systemPrompt
              : undefined,
        }),
      }).catch(() => {});
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    };
  }, [enabled, nodes, selectedIds, systemPrompt, systemPromptEnabled]);
}
