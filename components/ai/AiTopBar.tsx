"use client";

import {
  ImagePlus,
  Layers,
  Palette,
  PencilLine,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import AiSettingsDialog from "@/components/ai/AiSettingsDialog";
import { Button } from "@/components/luova-ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/luova-ui/context-menu";
import { Input } from "@/components/luova-ui/input";
import { useAiChatBridge } from "@/hooks/use-ai-chat-bridge";
import { validateCodeWithCompilerWorker } from "@/hooks/use-compiler-worker";
import { useMCPStatus } from "@/hooks/use-mcp-status";
import { hasChatGptPlanUsage } from "@/lib/ai/chatgpt-session";
import { cleanComponentCode } from "@/lib/ai/code-cleaner";
import { buildAiContextSnapshot } from "@/lib/ai/context";
import {
  AI_MODE_LABEL,
  canSubmitWithoutPrompt,
  canSubmitWithTheme,
  detectAiMode,
  getArmedSelectionIds,
} from "@/lib/ai/mode";
import {
  extractAssistantText,
  extractToolErrorMessagesFromMessage,
  extractToolOutputsFromMessage,
  toPendingActions,
} from "@/lib/ai/tool-output";
import { cn } from "@/lib/luova-utils";
import {
  PROVIDER_LABELS,
  useAiSettingsStore,
} from "@/stores/ai-settings-store";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import type { AiContextSnapshot, AiMode, AiPendingAction } from "@/types/ai";
import type { ComponentNodeAny } from "@/types/builder";
import { applyCodeDiff, isSearchReplaceDiff } from "@/utils/code-processing";
import { sortIdsByReadingOrder } from "@/utils/spatial-engine";

interface AiTopBarProps {
  disabled?: boolean;
}

const MODE_ICON: Record<AiMode, ComponentType<{ className?: string }>> = {
  create: WandSparkles,
  edit: PencilLine,
  bake: Layers,
  theme: Palette,
  recreate: ImagePlus,
};

const MODE_PLACEHOLDER: Record<AiMode, string> = {
  create: "Describe what to create...",
  edit: "Describe the edits to make...",
  bake: "Describe how to merge these, or just Bake...",
  theme: "Describe the theme changes...",
  recreate: "Recreate image — optional instructions...",
};

/** The user message for a theme derived from the attached image. */
function themeFromImageText(prompt: string): string {
  const base = "Create a theme from the attached image.";
  return prompt ? `${base} ${prompt}` : base;
}

async function validatePendingActions(
  actions: AiPendingAction[],
  nodes: ReturnType<typeof useProjectStore.getState>["nodes"]
): Promise<AiPendingAction[]> {
  const validated = await Promise.all(
    actions.map(async (action) => {
      if (action.tool === "update_theme") {
        return action;
      }

      // draft_layout has no code — nothing to validate
      if (action.tool === "draft_layout") {
        return action;
      }

      if (action.tool === "update_component_code") {
        const targetNode = nodes[action.targetId];
        if (!targetNode) {
          return {
            ...action,
            validationError: `Component ${action.targetId} no longer exists.`,
          };
        }

        // Check if code contains diff markers
        let codeToValidate = action.code;
        if (isSearchReplaceDiff(action.code)) {
          const currentCode = targetNode.code ?? "";
          try {
            codeToValidate = applyCodeDiff(currentCode, action.code);
            // Update action.code with the resolved code so it's passed to the orchestrator resolved
            action.code = codeToValidate;
          } catch (error) {
            return {
              ...action,
              validationError: `Diff application failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        }

        const cleanedCode = cleanComponentCode(codeToValidate);
        const result = await validateCodeWithCompilerWorker(
          cleanedCode,
          targetNode.props
        );
        return {
          ...action,
          validationError: result.isValid
            ? null
            : (result.error ?? "Invalid component code."),
        };
      }

      const cleanedCode = cleanComponentCode(action.code);
      const result = await validateCodeWithCompilerWorker(cleanedCode, {});
      return {
        ...action,
        validationError: result.isValid
          ? null
          : (result.error ?? "Invalid component code."),
      };
    })
  );

  return validated;
}

export default function AiTopBar({ disabled = false }: AiTopBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedIds = useUIStore((state) => state.selectedIds);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const deleteComponents = useProjectStore(
    (state: ProjectStore) => state.deleteComponents
  );
  const themeState = useThemeStore((state) => state.themeState);
  const currentMode = useThemeStore((state) => state.currentMode);

  const propertiesTab = useAiStore((state) => state.propertiesTab);
  const clearState = useAiStore((state) => state.clearState);
  const setAssistantText = useAiStore((state) => state.setAssistantText);
  const prompt = useAiStore((state) => state.prompt);
  const setPrompt = useAiStore((state) => state.setPrompt);
  const messages = useAiStore((state) => state.messages);
  const status = useAiStore((state) => state.status);
  const assistantMessageId = useAiStore((state) => state.assistantMessageId);

  const { send, stop, replaceMessages } = useAiChatBridge();
  const useAiChatBridgeStopRef = useRef(stop);
  useEffect(() => {
    useAiChatBridgeStopRef.current = stop;
  }, [stop]);
  const mcpEnabled = useAiSettingsStore((s) => s.mcpEnabled);
  const mcpConnected = useMCPStatus(mcpEnabled);

  const mode = useMemo(
    () => detectAiMode(selectedIds, propertiesTab, nodes),
    [nodes, propertiesTab, selectedIds]
  );
  // The selection a request is built from: in create mode, fresh wireframes
  // join automatically; used ones only while selected.
  const armedIds = useMemo(
    () => getArmedSelectionIds(mode, selectedIds, nodes),
    [mode, nodes, selectedIds]
  );
  const processedIdsRef = useRef<Set<string>>(new Set());
  const processedToolCallIdsRef = useRef<Set<string>>(new Set());

  const stagedOutputCountRef = useRef<number>(0);

  // Create/Recreate with Theme run two requests under one snapshot: a theme
  // (from the prompt, or derived from the image), then the normal create or
  // recreate against that new theme. This holds the second step until the
  // theme step has been applied.
  const chainedStepRef = useRef<{
    mode: "create" | "recreate";
    prompt: string;
    selectedIds: string[];
    themeApplied: boolean;
    streamDone: boolean;
    tokenSources?: Record<string, string>;
  } | null>(null);

  // Starts one request. The caller owns the pre-AI snapshot, so a chained
  // step keeps the first step's snapshot and Reject reverts both.
  const startRequest = useCallback(
    (requestMode: AiMode, context: AiContextSnapshot, text: string) => {
      clearState();
      useAiStore.getState().setActiveMode(requestMode);
      useAiStore.getState().setArmedSelectionIds(context.selectedIds);
      stagedOutputCountRef.current = 0;
      processedIdsRef.current.clear();
      processedToolCallIdsRef.current.clear();

      useAiStore.getState().setStatus("submitted");
      send(text, context).catch((err: unknown) => {
        chainedStepRef.current = null;
        useAppStore.temporal.getState().resume();
        useAiStore
          .getState()
          .setError(err instanceof Error ? err.message : "AI request failed.");
      });
    },
    [clearState, send]
  );
  const startRequestRef = useRef(startRequest);
  useEffect(() => {
    startRequestRef.current = startRequest;
  }, [startRequest]);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[AiTopBar] Effect running, messages:",
        messages.length,
        "status:",
        status
      );
    }
    const latestAssistant = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" && typeof message.id === "string"
      );

    if (process.env.NODE_ENV === "development") {
      console.log(
        "[AiTopBar] Latest assistant:",
        latestAssistant?.id,
        "parts:",
        latestAssistant?.parts
      );
    }
    if (!latestAssistant || typeof latestAssistant.id !== "string") {
      return;
    }

    // ONLY process the active assistant message for the current response.
    // This prevents historic messages from re-staging their tools.
    if (latestAssistant.id !== assistantMessageId) {
      return;
    }

    // Already fully processed (stream finished and all outputs staged)
    if (processedIdsRef.current.has(latestAssistant.id)) {
      return;
    }

    const outputs = extractToolOutputsFromMessage(latestAssistant);
    if (process.env.NODE_ENV === "development") {
      console.log("[AiTopBar] Extracted outputs:", outputs.length, outputs);
    }

    const isStreaming = status === "streaming" || status === "submitted";

    // Once the theme step's stream has finished AND its theme is applied
    // (applying is async, so either can happen last), run the create or
    // recreate step against the new theme tokens.
    const continueChainedStep = (streamDone: boolean) => {
      const chain = chainedStepRef.current;
      if (!chain || useAiStore.getState().activeMode !== "theme") return;
      if (streamDone) chain.streamDone = true;
      if (!chain.streamDone || !chain.themeApplied) return;
      chainedStepRef.current = null;
      const {
        nodes: liveNodes,
        themeState: liveTheme,
        currentMode: liveMode,
      } = useAppStore.getState();
      let context: AiContextSnapshot;
      try {
        context = buildAiContextSnapshot({
          prompt: chain.prompt,
          mode: chain.mode,
          activeTab: useAiStore.getState().propertiesTab,
          selectedIds: chain.selectedIds,
          nodes: liveNodes,
          themeState: liveTheme,
          currentMode: liveMode,
        });
      } catch (error) {
        useAiStore
          .getState()
          .setError(
            error instanceof Error
              ? error.message
              : "Could not read the selected image."
          );
        return;
      }
      // The theme step's record of which image element each token came
      // from, so recreate maps colors exactly as the theme was built.
      if (chain.tokenSources && Object.keys(chain.tokenSources).length > 0) {
        context.themeTokenSources = chain.tokenSources;
      }
      startRequestRef.current(chain.mode, context, chain.prompt);
    };

    if (outputs.length === 0) {
      if (!isStreaming) {
        processedIdsRef.current.add(latestAssistant.id);
        // If we already applied tools for this message, the text is just a summary — not an error
        if (stagedOutputCountRef.current > 0) {
          const assistantText = extractAssistantText(latestAssistant);
          if (assistantText) setAssistantText(assistantText);
          continueChainedStep(true);
          return;
        }
        chainedStepRef.current = null;
        const toolErrors = extractToolErrorMessagesFromMessage(latestAssistant);
        if (toolErrors.length > 0) {
          useAiStore
            .getState()
            .setError(
              `The AI tried to make changes, but the edit tool failed:\n\n${toolErrors.join("\n\n")}`
            );
          return;
        }
        const assistantText = extractAssistantText(latestAssistant);
        if (assistantText) {
          useAiStore
            .getState()
            .setError(`AI responded without using tools:\n\n${assistantText}`);
        } else {
          useAiStore
            .getState()
            .setError(
              "The AI did not make any changes. Please try rephrasing your request."
            );
        }
      }
      return;
    }

    // During streaming, re-stage whenever new tool outputs appear.
    // Only mark as fully processed once the stream is complete.
    const hasNewOutputs = outputs.length !== stagedOutputCountRef.current;

    if (!hasNewOutputs && isStreaming) {
      return;
    }

    if (!isStreaming) {
      processedIdsRef.current.add(latestAssistant.id);
    }

    stagedOutputCountRef.current = outputs.length;

    (async () => {
      // Fallback target resolution must agree with the snapshot's spatial
      // order — never let live click order pick a different merge target
      // than the top-left source the prompt names.
      const requestIds = useAiStore.getState().armedSelectionIds ?? selectedIds;
      const spatiallyOrderedIds = sortIdsByReadingOrder(requestIds, (id) => {
        const node = nodes[id];
        return node
          ? {
              x: node.props.x,
              y: node.props.y,
              w: node.props.w ?? 0,
              h: node.props.h ?? 0,
            }
          : undefined;
      });
      const requestMode = useAiStore.getState().activeMode ?? mode;
      const pending = toPendingActions(
        outputs,
        spatiallyOrderedIds,
        requestMode
      );

      // Filter out tool calls we've already applied
      const newActions = pending.filter((action) => {
        if (action.toolCallId) {
          if (processedToolCallIdsRef.current.has(action.toolCallId))
            return false;
          processedToolCallIdsRef.current.add(action.toolCallId);
          return true;
        }
        return true;
      });

      if (newActions.length === 0 && isStreaming) return;

      // An empty batch means the stream finished with no new tool calls
      // (typically the trailing run after the summary text lands). There is
      // nothing to apply — and calling applyAiActions([]) would be actively
      // harmful: bake-mode cleanup would run with no updatedIds to protect
      // fulfilled targets and could delete just-created components against
      // stale selection. Finalize the text and stop.
      if (newActions.length === 0) {
        if (!isStreaming) {
          processedIdsRef.current.add(latestAssistant.id);
          const assistantText = extractAssistantText(latestAssistant);
          if (assistantText) setAssistantText(assistantText);
          continueChainedStep(true);
        }
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[AiTopBar] Applying new AI actions:", newActions);
      }

      const validated = await validatePendingActions(newActions, nodes);

      if (process.env.NODE_ENV === "development") {
        console.log("[AiTopBar] Validated actions:", validated);
      }

      const { applyAiActions } = await import(
        "@/hooks/use-ai-action-orchestrator"
      );
      const result = applyAiActions(validated, requestMode);

      // Check if all actions were successfully applied
      if (!result.success) {
        chainedStepRef.current = null;
        const aiStore = useAiStore.getState();
        aiStore.setError(result.error ?? "Failed to apply AI changes.");
        return;
      }

      const chain = chainedStepRef.current;
      const themeAction = validated.find(
        (action) => action.tool === "update_theme"
      );
      if (chain && requestMode === "theme" && themeAction) {
        chain.themeApplied = true;
        chain.tokenSources = themeAction.tokenSources;
      }

      const assistantText = extractAssistantText(latestAssistant);
      setAssistantText(assistantText);
      continueChainedStep(!isStreaming);
    })();
  }, [
    assistantMessageId,
    mode,
    messages,
    nodes,
    selectedIds,
    setAssistantText,
    status,
  ]);

  // withTheme: Create/Recreate with Theme (create and recreate modes only).
  const handleSubmit = useCallback(
    (withTheme = false) => {
      if (withTheme && !canSubmitWithTheme(mode, prompt, armedIds, nodes)) {
        return;
      }
      const trimmed = prompt.trim();
      // Allow submitting with no prompt if wireframes are armed (the selected
      // ones, or in create mode with nothing selected every fresh one), there
      // are captured intents, or the mode is bake (merging the selection needs
      // no prompt). Used, unselected wireframes are inert — they never arm an
      // empty-prompt submission.
      if (
        (!trimmed && !canSubmitWithoutPrompt(mode, armedIds, nodes)) ||
        disabled ||
        status === "submitted" ||
        status === "streaming"
      ) {
        return;
      }

      // Guard: require API key for non-local providers (ChatGPT uses OAuth)
      const { activeProvider, apiKeys, chatgptAuth } =
        useAiSettingsStore.getState();
      const hasChatGptToken = Boolean(chatgptAuth?.accessToken?.trim());
      if (
        activeProvider !== "local" &&
        activeProvider !== "chatgpt" &&
        !apiKeys[activeProvider]?.trim()
      ) {
        setSettingsOpen(true);
        toast.error(`No API key for ${PROVIDER_LABELS[activeProvider]}`, {
          description: "Add your API key in settings to start generating.",
        });
        return;
      }
      if (activeProvider === "chatgpt" && !hasChatGptToken) {
        setSettingsOpen(true);
        toast.error(`Not signed in with ChatGPT`, {
          description: "Continue with ChatGPT in settings to use your plan.",
        });
        return;
      }
      if (activeProvider === "chatgpt" && !hasChatGptPlanUsage(chatgptAuth)) {
        setSettingsOpen(true);
        toast.error(`ChatGPT plan usage not authorized`, {
          description:
            "Reconnect in AI Settings and approve plan usage to continue.",
        });
        return;
      }

      let context: AiContextSnapshot;
      try {
        context = buildAiContextSnapshot({
          prompt: trimmed,
          mode,
          activeTab: propertiesTab,
          selectedIds: armedIds,
          nodes,
          themeState,
          currentMode,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not read the selected image."
        );
        return;
      }

      // Pause temporal tracking before AI starts changing things
      useAppStore.temporal.getState().pause();

      const appState = useAppStore.getState();
      const snapshot = JSON.stringify({
        nodes: appState.nodes,
        themeState: appState.themeState,
        currentMode: appState.currentMode,
        layerOrder: appState.layerOrder,
        rootId: appState.rootId,
      });
      useAiStore.getState().setInitialAppSnapshot(snapshot);

      if (withTheme && (mode === "create" || mode === "recreate")) {
        // Step one: the theme. The create or recreate step starts once this
        // theme is applied (see continueChainedStep).
        chainedStepRef.current = {
          mode,
          prompt: trimmed,
          selectedIds: armedIds,
          themeApplied: false,
          streamDone: false,
        };
        // Recreate keeps the image selected, which makes this an
        // image-derived theme; Create's theme comes from the prompt alone.
        const themeContext = buildAiContextSnapshot({
          prompt: trimmed,
          mode: "theme",
          activeTab: propertiesTab,
          selectedIds: mode === "recreate" ? armedIds : [],
          nodes,
          themeState,
          currentMode,
        });
        startRequest(
          "theme",
          themeContext,
          mode === "recreate"
            ? themeFromImageText(trimmed)
            : `Create a theme that fits this request: ${trimmed}`
        );
        return;
      }

      chainedStepRef.current = null;
      startRequest(
        mode,
        context,
        mode === "theme" && context.sourceImage
          ? themeFromImageText(trimmed)
          : trimmed
      );
    },
    [
      armedIds,
      currentMode,
      disabled,
      mode,
      nodes,
      prompt,
      propertiesTab,
      startRequest,
      status,
      themeState,
    ]
  );

  const isFixingError = useAiStore((state) => state.isFixingError);
  const stopFix = useAiStore((state) => state.stopFix);

  const isWorking =
    status === "submitted" || status === "streaming" || isFixingError;
  const ModeIcon = MODE_ICON[mode];

  // Count valid intents (wireframes/captured nodes with comments) — shown as a badge
  // In create mode: count every ARMED wireframe (the selected ones, or every
  // fresh one when nothing is selected), even one with an empty text bubble,
  // since armed wireframes arm a submission on their own (strictly exclude
  // captured and used, unselected wireframes)
  // In edit mode: count intents related to the selected component
  // In bake mode: count intents that are in the selection
  // In theme mode: never show badge
  const intentCount = (() => {
    const nodeArray = Object.values(nodes) as ComponentNodeAny[];

    if (mode === "theme") {
      return 0;
    }

    if (mode === "create") {
      const armedSet = new Set(armedIds);
      return nodeArray.filter(
        (n) => n.kind === "wireframe" && armedSet.has(n.id)
      ).length;
    }

    if (mode === "edit" && selectedIds.length > 0) {
      const selectedId = selectedIds[0];
      return nodeArray.filter(
        (n) =>
          (n.kind === "wireframe" || n.kind === "captured") &&
          (n.comment ?? "").trim().length > 0 &&
          // Wireframes that are children of the selected component
          ((n.kind === "wireframe" && n.parentId === selectedId) ||
            // Captured nodes that were captured from the selected component
            (n.kind === "captured" &&
              n.capturedMetadata?.sourceComponentId === selectedId) ||
            // The captured node itself if it is selected
            (n.kind === "captured" && n.id === selectedId))
      ).length;
    }

    if (mode === "bake" && selectedIds.length > 0) {
      const selectedSet = new Set(selectedIds);
      return nodeArray.filter(
        (n) =>
          n.kind === "wireframe" &&
          (n.comment ?? "").trim().length > 0 &&
          selectedSet.has(n.id)
      ).length;
    }

    return 0;
  })();
  // Count armed wireframes ("frames ready") — shown in placeholder text.
  // In create mode fresh wireframes count too; used, unselected wireframes
  // are inert and must not nag. In theme mode never show count.
  const frameCount = (() => {
    const nodeArray = Object.values(nodes) as ComponentNodeAny[];

    if (mode === "theme") {
      return 0;
    }

    if (mode === "create") {
      const armedSet = new Set(armedIds);
      return nodeArray.filter(
        (n) => n.kind === "wireframe" && armedSet.has(n.id)
      ).length;
    }

    const selectedSet = new Set(selectedIds);
    if (selectedSet.size === 0) {
      return 0;
    }

    if (mode === "edit" && selectedIds.length > 0) {
      const selectedId = selectedIds[0];
      return nodeArray.filter(
        (n) => n.kind === "wireframe" && n.parentId === selectedId
      ).length;
    }

    if (mode === "bake" && selectedIds.length > 0) {
      return nodeArray.filter(
        (n) => n.kind === "wireframe" && selectedSet.has(n.id)
      ).length;
    }

    return 0;
  })();
  const handleClearAiTasks = useCallback(() => {
    const allNodes = Object.entries(nodes) as [string, ComponentNodeAny][];
    const wireframeIds = allNodes
      .filter(([, n]) => n.kind === "wireframe")
      .map(([id]) => id);
    // For captured nodes, check if they have been edited
    const capturedNodesToDiscard: string[] = [];
    const capturedNodesToClearComment: string[] = [];
    allNodes
      .filter(
        ([, n]) => n.kind === "captured" && (n.comment ?? "").trim().length > 0
      )
      .forEach(([id, n]) => {
        // If the captured node hasn't been edited, dismiss the overlay
        if (!n.capturedMetadata?.hasEdits) {
          capturedNodesToDiscard.push(id);
        } else {
          // If it has been edited, just clear the comment
          capturedNodesToClearComment.push(id);
        }
      });

    // "Clear Tasks" is strictly an AI workflow cancellation — it must never
    // modify TSX source code. Wireframes are standalone placeholders (safe to
    // delete), but captured overlays are dismissed non-destructively via the
    // discard path (deleteComponents would excise the JSX element from the
    // source component's code). Everything collapses into one undo entry.
    useProjectStore.getState().withBatchedHistory(() => {
      if (wireframeIds.length > 0) {
        deleteComponents(wireframeIds);
      }
      if (capturedNodesToDiscard.length > 0) {
        useProjectStore.getState().discardCapturedNodes(capturedNodesToDiscard);
      }
      capturedNodesToClearComment.forEach((id) => {
        useProjectStore.getState().updateNodeComment(id, "");
      });
      // Clear comments on kept nodes to reset intent counters in the top bar
      for (const [, n] of allNodes) {
        if (
          n.kind !== "captured" &&
          n.kind !== "wireframe" &&
          (n.comment ?? "").length > 0
        ) {
          useProjectStore.getState().updateNodeComment(n.id, "");
        }
      }
    });
    clearSelection();

    clearState();
    replaceMessages([]);
  }, [nodes, deleteComponents, clearSelection, clearState, replaceMessages]);

  return (
    <search
      className="flex w-full flex-1 items-center gap-2"
      aria-label="AI Command Bar"
    >
      <AiSettingsDialog
        mcpConnected={mcpConnected}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <Input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={
          disabled
            ? "AI is disabled in Preview"
            : frameCount > 0
              ? `${frameCount} frame${frameCount > 1 ? "s" : ""} ready — add a prompt or just ${AI_MODE_LABEL[mode]}`
              : mode === "theme" &&
                  canSubmitWithoutPrompt(mode, selectedIds, nodes)
                ? "Theme from image — optional instructions..."
                : MODE_PLACEHOLDER[mode]
        }
        disabled={disabled}
        aria-label="Describe UI changes"
        autoComplete="off"
        className={cn(
          "h-8 flex-1 text-sm py-1",
          "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "placeholder:text-muted-foreground/50"
        )}
      />

      {isWorking && (
        <div className="sr-only" aria-live="polite">
          AI is generating component...
        </div>
      )}

      {isWorking ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            chainedStepRef.current = null;
            if (isFixingError) stopFix();
            else stop();
          }}
          className="h-8 py-1"
        >
          <Square className="mr-2 h-3 w-3" />
          Stop
        </Button>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger>
            <Button
              type="button"
              onClick={() => handleSubmit()}
              disabled={
                disabled ||
                isWorking ||
                (prompt.trim().length === 0 &&
                  !canSubmitWithoutPrompt(mode, armedIds, nodes))
              }
              className="relative h-8 text-sm px-3 py-1 overflow-visible gap-1.5 w-[100px] justify-center disabled:opacity-100 disabled:pointer-events-none"
            >
              <ModeIcon className="h-3 w-3" />
              {AI_MODE_LABEL[mode]}
              {intentCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold ring-2 ring-background">
                  {intentCount}
                </span>
              )}
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {(mode === "create" || mode === "recreate") && (
              <ContextMenuItem
                onClick={() => handleSubmit(true)}
                disabled={
                  disabled || !canSubmitWithTheme(mode, prompt, armedIds, nodes)
                }
                className="flex items-center gap-2"
              >
                <Palette className="h-4 w-4" />
                {AI_MODE_LABEL[mode]} with Theme
              </ContextMenuItem>
            )}
            {/* Recreate works from one image, not wireframe tasks. */}
            {mode !== "recreate" && (
              <ContextMenuItem
                onClick={handleClearAiTasks}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear Tasks
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </search>
  );
}
