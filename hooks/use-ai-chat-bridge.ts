import { useChat } from "@ai-sdk/react";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { useCallback, useEffect, useRef } from "react";
import {
  CHATGPT_PLAN_SCOPE_RECONNECT_MESSAGE,
  hasChatGptPlanUsage,
  resolveChatGptAccessToken,
} from "@/lib/ai/chatgpt-session";
import { prepareRecreateImage } from "@/lib/ai/recreate-image";
import { extractAssistantText } from "@/lib/ai/tool-output";
import { useAiSettingsStore } from "@/stores/ai-settings-store";
import { useAiStore } from "@/stores/ai-store";
import { useProjectStore } from "@/stores/project-store";
import type { AiContextSnapshot } from "@/types/ai";

function deriveCurrentStatus(messages: UIMessage[], status: string): string {
  if (status !== "submitted" && status !== "streaming") return "";

  const latestAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (!latestAssistant?.parts) return "";

  const activeToolPart = [...latestAssistant.parts]
    .reverse()
    .find((p): p is DynamicToolUIPart | ToolUIPart => {
      if ("state" in p) {
        if (p.type === "dynamic-tool") {
          return p.state === "input-streaming" || p.state === "input-available";
        }
        if (typeof p.type === "string" && p.type.startsWith("tool-")) {
          return p.state === "input-streaming" || p.state === "input-available";
        }
      }
      return false;
    });

  if (activeToolPart) {
    const args = activeToolPart.input;

    if (
      args &&
      typeof args === "object" &&
      "rationale" in args &&
      typeof args.rationale === "string" &&
      args.rationale
    ) {
      if (
        "state" in activeToolPart &&
        activeToolPart.state === "input-streaming"
      ) {
        return `Planning: ${args.rationale}`;
      } else {
        return `AI: ${args.rationale}`;
      }
    }

    if (args && typeof args === "object") {
      if (
        "componentType" in args &&
        typeof args.componentType === "string" &&
        args.componentType
      ) {
        return `AI: Designing ${args.componentType}...`;
      }
      if ("patch" in args) {
        return "AI: Updating theme...";
      }
    }

    const toolName =
      (activeToolPart as any).toolName ||
      (typeof activeToolPart.type === "string" &&
      activeToolPart.type.startsWith("tool-")
        ? activeToolPart.type.replace("tool-", "")
        : "");

    if (toolName === "update_component_code") {
      return "AI: Updating component code...";
    }
    if (toolName === "add_component") {
      return "AI: Creating a component...";
    }
    if (toolName === "draft_layout") {
      return "AI: Drafting the layout...";
    }
    if (toolName === "update_theme") {
      return "AI: Updating theme...";
    }
  }

  const textPart = [...latestAssistant.parts]
    .reverse()
    .find((p) => p.type === "text");
  if (
    textPart &&
    "text" in textPart &&
    typeof (textPart as any).text === "string" &&
    (textPart as any).text.trim()
  ) {
    return "AI is thinking...";
  }

  return "";
}

function mapChatStatus(
  status: "submitted" | "streaming" | "ready" | "error"
): "submitted" | "streaming" | "ready" | "error" {
  return status;
}

export function useAiChatBridge() {
  const chat = useChat({
    experimental_throttle: 100,
    onError: (err) => {
      useAiStore.setState({ error: err.message, status: "error" });
    },
  });

  const requestVersionRef = useRef(0);
  const prevMessagesRef = useRef(chat.messages);
  const prevStatusRef = useRef(chat.status);
  const prevErrorRef = useRef(chat.error);

  // Clear AI SDK history when the app state transitions to idle
  useEffect(() => {
    let lastStatus: string | undefined;
    const unsubscribe = useAiStore.subscribe((state) => {
      if (lastStatus && lastStatus !== "idle" && state.status === "idle") {
        chat.setMessages([]);
      }
      lastStatus = state.status;
    });
    return unsubscribe;
  }, [chat]);

  useEffect(() => {
    const messagesChanged = chat.messages !== prevMessagesRef.current;
    const statusChanged = chat.status !== prevStatusRef.current;
    const errorChanged = chat.error !== prevErrorRef.current;

    if (!messagesChanged && !statusChanged && !errorChanged) return;

    prevMessagesRef.current = chat.messages;
    prevStatusRef.current = chat.status;
    prevErrorRef.current = chat.error;

    const updates: Record<string, unknown> = {};

    if (messagesChanged) {
      updates.messages = chat.messages;

      const latestAssistant = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (latestAssistant) {
        updates.assistantMessageId = latestAssistant.id;
        updates.assistantText = extractAssistantText(latestAssistant);
      }
    }

    if (statusChanged) {
      updates.status = mapChatStatus(chat.status);
    }

    if (errorChanged) {
      updates.error = chat.error?.message ?? null;
    }

    if (statusChanged || messagesChanged) {
      updates.currentStatus = deriveCurrentStatus(chat.messages, chat.status);
    }

    useAiStore.setState(updates);
  }, [chat.messages, chat.status, chat.error]);

  const send = useCallback(
    async (text: string, context: AiContextSnapshot) => {
      const requestVersion = ++requestVersionRef.current;
      const { activeProvider, apiKeys, getModel, getBaseUrl, chatgptAuth } =
        useAiSettingsStore.getState();
      const { systemPrompt, systemPromptEnabled } = useProjectStore.getState();
      const model = getModel(activeProvider);
      const baseURL = getBaseUrl(activeProvider);
      // ChatGPT plan: the OAuth access token acts as the bearer credential
      // (refreshing it first when near expiry). Identity-only sign-in
      // (without the plan-usage scope) must not reach inference.
      if (activeProvider === "chatgpt" && !hasChatGptPlanUsage(chatgptAuth)) {
        throw new Error(CHATGPT_PLAN_SCOPE_RECONNECT_MESSAGE);
      }
      const apiKey =
        activeProvider === "chatgpt"
          ? ((await resolveChatGptAccessToken()) ?? "")
          : (apiKeys[activeProvider] ?? "");

      const messageText =
        text || "Process the attached context and node intents.";

      const attachment = context.sourceImage
        ? await prepareRecreateImage(context.sourceImage.assetId)
        : undefined;

      if (requestVersion !== requestVersionRef.current) return;

      // Force a completely fresh session history for every request
      chat.setMessages([]);

      await chat.sendMessage(
        attachment
          ? { parts: [attachment, { type: "text", text: messageText }] }
          : { text: messageText },
        {
          body: {
            context,
            activeProvider,
            apiKey,
            model,
            baseURL,
            systemPrompt: systemPromptEnabled ? systemPrompt : undefined,
            chatgptScopes:
              activeProvider === "chatgpt"
                ? (chatgptAuth?.grantedScopes ?? [])
                : undefined,
          },
        }
      );
    },
    [chat]
  );

  const stop = useCallback(() => {
    requestVersionRef.current += 1;
    chat.stop();
    useAiStore.setState({ status: "ready", currentStatus: "" });
  }, [chat]);

  const replaceMessages = useCallback(
    (messages: UIMessage[]) => {
      chat.setMessages(messages);
      useAiStore.setState({ messages });
    },
    [chat]
  );

  return { send, stop, replaceMessages };
}
