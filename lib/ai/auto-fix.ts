import {
  parseJsonEventStream,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  uiMessageChunkSchema,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import { validateCodeWithCompilerWorker } from "@/hooks/use-compiler-worker";
import {
  CHATGPT_PLAN_SCOPE_RECONNECT_MESSAGE,
  hasChatGptPlanUsage,
  resolveChatGptAccessToken,
} from "@/lib/ai/chatgpt-session";
import { cleanComponentCode } from "@/lib/ai/code-cleaner";
import {
  extractToolOutputsFromMessage,
  toPendingActions,
} from "@/lib/ai/tool-output";
import { useAiSettingsStore } from "@/stores/ai-settings-store";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";
import { useProjectStore } from "@/stores/project-store";
import type { AiPendingAction } from "@/types/ai";
import { applyCodeDiff, isSearchReplaceDiff } from "@/utils/code-processing";

async function streamAgenticFix(
  prompt: string,
  context: Record<string, unknown>,
  signal?: AbortSignal
): Promise<AiPendingAction[] | null> {
  const { activeProvider, apiKeys, getModel, getBaseUrl, chatgptAuth } =
    useAiSettingsStore.getState();
  if (activeProvider === "chatgpt" && !hasChatGptPlanUsage(chatgptAuth)) {
    throw new Error(CHATGPT_PLAN_SCOPE_RECONNECT_MESSAGE);
  }
  const apiKey =
    activeProvider === "chatgpt"
      ? ((await resolveChatGptAccessToken()) ?? "")
      : (apiKeys[activeProvider] ?? "");
  const model = getModel(activeProvider);
  const baseURL = getBaseUrl(activeProvider);

  const messages = [
    {
      id: uuidv4(),
      role: "user" as const,
      content: prompt,
      parts: [{ type: "text" as const, text: prompt }],
      createdAt: new Date(),
    },
  ];

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      context,
      activeProvider,
      apiKey,
      model,
      baseURL,
      chatgptScopes:
        activeProvider === "chatgpt"
          ? (chatgptAuth?.grantedScopes ?? [])
          : undefined,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errorBody = await response
      .json()
      .catch(() => ({ error: `API error: ${response.status}` }));
    throw new Error(errorBody.error ?? `API error: ${response.status}`);
  }

  let lastMessage: UIMessage | null = null;
  let streamError: Error | null = null;

  // Network chunks can split anywhere inside an SSE event or JSON value.
  const lineStream = parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(
        result,
        controller: TransformStreamDefaultController<UIMessageChunk>
      ) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    })
  );

  for await (const uiMessage of readUIMessageStream({
    stream: lineStream,
    onError: (error) => {
      streamError = error instanceof Error ? error : new Error(String(error));
    },
  })) {
    lastMessage = uiMessage;
  }

  if (streamError) {
    throw streamError;
  }

  if (!lastMessage) return null;

  const outputs = extractToolOutputsFromMessage(lastMessage);
  if (outputs.length === 0) return null;

  // Pass context.selectedIds as the fallback so toPendingActions can resolve
  // the targetId even when the AI omits it from the tool call.
  const pending = toPendingActions(
    outputs,
    (context as any).selectedIds ?? [],
    (context as any).mode ?? "edit"
  );
  const nodes = useProjectStore.getState().nodes;
  return validateFixActions(
    pending,
    nodes,
    (context as any).depth || 0,
    signal
  );
}

async function validateFixActions(
  actions: AiPendingAction[],
  nodes: Record<string, unknown>,
  _depth: number = 0,
  _signal?: AbortSignal
): Promise<AiPendingAction[]> {
  const validated = await Promise.all(
    actions.map(async (action) => {
      if (action.tool === "update_theme") return action;

      // draft_layout has no code — nothing to validate
      if (action.tool === "draft_layout") return action;

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
          const currentCode = (targetNode as { code?: string }).code ?? "";
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
          (targetNode as { props: Record<string, unknown> }).props
        );
        return {
          ...action,
          validationError: result.isValid
            ? null
            : (result.error ?? "Invalid code."),
        };
      }

      const cleanedCode = cleanComponentCode(action.code);
      const result = await validateCodeWithCompilerWorker(cleanedCode, {});
      return {
        ...action,
        validationError: result.isValid
          ? null
          : (result.error ?? "Invalid code."),
      };
    })
  );

  return validated;
}

interface ExecuteAgenticFixParams {
  nodeId: string;
  error: string;
  code: string;
  signal?: AbortSignal;
}

export async function executeAgenticFix({
  nodeId,
  error,
  code,
  signal,
}: ExecuteAgenticFixParams) {
  const nodes = useProjectStore.getState().nodes;
  const aiStore = useAiStore.getState();
  const appStore = useAppStore.getState();

  const node = nodes[nodeId];
  if (!node) {
    aiStore.clearRuntimeError(nodeId);
    aiStore.setIsFixingError(false);
    return;
  }

  // Capture snapshot for undo/reject
  const snapshot = JSON.stringify({
    nodes: appStore.nodes,
    themeState: appStore.themeState,
    currentMode: appStore.currentMode,
    layerOrder: appStore.layerOrder,
    rootId: appStore.rootId,
  });
  aiStore.setInitialAppSnapshot(snapshot);

  // Pause history tracking during auto-fix
  useAppStore.temporal.getState().pause();

  const nodeType = node.type;
  const nodeProps = node.props;

  const context = {
    mode: "edit" as const,
    activeTab: "code" as const,
    prompt: `AUTO-FIX: The component crashed with runtime error: "${error}". Fix the code to resolve this error.`,
    selectedIds: [nodeId],
    selectedNodes: [
      {
        id: nodeId,
        type: nodeType as any,
        props: nodeProps,
        code,
      },
    ],
    canvasBounds: { width: 1200, height: 800 },
  };

  const fixPrompt = [
    `The component "${nodeType}" (id: ${nodeId}) crashed with this runtime error:`,
    "",
    error,
    "",
    "The current code that caused the error is in selectedNodes in the builder context.",
    "",
    `Fix the code to resolve this error. Use update_component_code to correct the existing component.`,
    "Identify if this is a Slot/asChild error (multiple children in a Slot) and resolve by wrapping multiple children in a single container or removing asChild.",
    "Do not change the component's functionality — only fix the error.",
  ].join("\n");

  try {
    const validated = await streamAgenticFix(fixPrompt, context, signal);

    if (!validated || validated.length === 0) {
      throw new Error("AI did not return any tool calls to fix the error.");
    }

    const firstInvalid = validated.find(
      (a: AiPendingAction) => a.validationError
    );
    if (firstInvalid) {
      throw new Error(
        firstInvalid.validationError ?? "Code validation failed."
      );
    }

    const { applyAiActions } = await import(
      "@/hooks/use-ai-action-orchestrator"
    );
    const result = applyAiActions(validated, "edit");
    if (!result.success) {
      throw new Error(result.error ?? "Failed to apply AI actions.");
    }

    aiStore.setAssistantText("Fix: AI corrected a runtime error.");
    aiStore.setStatus("ready");

    // Clear the error AFTER applying the fix so the boundary key change
    // (triggered by the code update) and the error dismissal happen together,
    // causing the error boundary to remount with the corrected code.
    aiStore.clearRuntimeError(nodeId);
    aiStore.setIsFixingError(false);
  } catch (err) {
    // Resume temporal tracking since the fix failed
    useAppStore.temporal.getState().resume();

    if ((err as Error).name === "AbortError") {
      aiStore.setIsFixingError(false);
      return;
    }
    console.error("Fix failed:", err);
    aiStore.setIsFixingError(false);
    aiStore.setError(err instanceof Error ? err.message : "Fix failed.");
  }
}
