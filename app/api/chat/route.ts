import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  NoSuchToolError,
  Output,
  RetryError,
  type StopCondition,
  streamText,
  type ToolChoice,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { NextResponse } from "next/server";
import { z } from "zod";
import { CHATGPT_PLAN_SCOPE } from "@/lib/ai/chatgpt-auth";
import {
  acceptsTemperature,
  getModelProviderOptions,
} from "@/lib/ai/model-options";
import {
  createInstructions,
  isSingleComponentRequest,
} from "@/lib/ai/prompt-factory";
import {
  type AiProvider,
  createModel,
  type ProviderConfig,
  providerRequirements,
} from "@/lib/ai/providers";
import {
  type AddComponentToolInput,
  addComponentToolSchema,
  aiContextSnapshotSchema,
  type DraftLayoutToolInput,
  draftLayoutToolSchema,
  type UpdateComponentCodeToolInput,
  type UpdateThemeToolInput,
  updateComponentCodeToolSchema,
  updateThemeToolSchema,
} from "@/lib/ai/schemas";
import { buildThemePatch } from "@/lib/ai/theme-shadow";
import { forbiddenResponse, isLocalRequest } from "@/lib/local-request";
import type { AiContextSnapshot, AiMode } from "@/types/ai";
import {
  applyCodeDiff,
  applyJsonEdits,
  cleanLLMOutput,
  isSearchReplaceDiff,
} from "@/utils/code-processing";

export const maxDuration = 600;

// ---------------------------------------------------------------------------
// Tool definitions scoped by mode
// ---------------------------------------------------------------------------

const addComponentTool = {
  description:
    "Create a new canvas component with specific position and size. For multi-component layouts, call this multiple times with calculated coordinates to arrange components spatially. For single components, call this directly with coordinates — no draft_layout needed. NEVER use bare coordinates to duplicate a wireframe — fulfill wireframes via update_component_code targeting the top-level wireframe id, embedding any nestedChildren as internal JSX.",
  inputSchema: addComponentToolSchema,
  execute: async (parsed: AddComponentToolInput) => {
    const code = cleanLLMOutput(parsed.code);
    return {
      tool: "add_component" as const,
      componentType: parsed.componentType,
      code,
      position:
        parsed.position?.x != null && parsed.position?.y != null
          ? { x: parsed.position.x, y: parsed.position.y }
          : undefined,
      size: parsed.size,
      draftId: parsed.draftId,
      rationale: parsed.rationale,
    };
  },
};

function makeUpdateComponentCodeTool(
  context: {
    selectedIds: string[];
    nodeIntents?: Array<{
      id: string;
      kind: string;
      sourceComponentId?: string;
      nestedChildren?: Array<{ id: string }>;
    }>;
    selectedNodes?: Array<{ id: string; code: string }>;
  },
  targetedEditsOnly = false
) {
  return {
    description:
      "Update code for an existing component. Use for edit mode and bake mode merges. In create mode with wireframes, target ONLY top-level nodeIntent ids — if a wireframe has nestedChildren, fulfill the PARENT id as ONE single TSX component embedding all children as internal JSX. NEVER target a nestedChildren child id individually.",
    inputSchema: updateComponentCodeToolSchema,
    execute: async (parsed: UpdateComponentCodeToolInput) => {
      const fallbackTargetId = context.selectedIds[0];
      let targetId = parsed.targetId ?? fallbackTargetId;

      if (!targetId) {
        throw new Error(
          "update_component_code requires targetId when no component is selected."
        );
      }

      // Redirect nested child wireframe targets to their parent container.
      // Child ids appear only inside parent nestedChildren and must never be
      // fulfilled as separate nodes — the parent owns the whole subtree.
      if (context.nodeIntents) {
        for (const intent of context.nodeIntents) {
          const childIds = intent.nestedChildren?.map((c) => c.id) ?? [];
          if (childIds.includes(targetId)) {
            targetId = intent.id;
            break;
          }
        }
      }

      const capturedIntent = context.nodeIntents?.find(
        (ni) =>
          ni.id === targetId && ni.kind === "captured" && ni.sourceComponentId
      );
      if (capturedIntent?.sourceComponentId) {
        targetId = capturedIntent.sourceComponentId;
      }

      // Resolve edits on the server if provided
      let finalCode: string;
      const originalNode = context.selectedNodes?.find(
        (n) => n.id === targetId
      );
      const originalCode = originalNode?.code ?? "";

      if (parsed.edits && parsed.edits.length > 0) {
        // JSON edits path
        try {
          finalCode = applyJsonEdits(originalCode, parsed.edits);
        } catch (error) {
          throw new Error(
            `Edit application failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } else if (parsed.code) {
        // Check if code contains diff markers
        if (isSearchReplaceDiff(parsed.code)) {
          // Validate the diff by attempting to apply it
          try {
            finalCode = applyCodeDiff(originalCode, parsed.code);
          } catch (error) {
            // Throw error back to LLM so it can self-correct
            throw new Error(
              `Diff validation failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        } else {
          if (targetedEditsOnly) {
            throw new Error(
              "Edit mode requires targeted changes. Return an edits array with search/replace pairs, or SEARCH/REPLACE diff blocks in code, instead of the full component file."
            );
          }
          // Plain code, no validation needed
          finalCode = parsed.code;
        }
      } else {
        throw new Error(
          "update_component_code requires either 'code' or 'edits' parameter."
        );
      }

      const code = cleanLLMOutput(finalCode);
      return {
        tool: "update_component_code" as const,
        targetId,
        code,
        rationale: parsed.rationale,
      };
    },
  };
}

const updateThemeTool = {
  description:
    "Generate a COMPLETE design system theme. You MUST supply ALL color tokens for both light and dark modes to ensure visual harmony. Do not provide partial patches unless the user explicitly asks to change only one specific thing.",
  inputSchema: updateThemeToolSchema,
  execute: async (parsed: UpdateThemeToolInput) => {
    return {
      tool: "update_theme" as const,
      patch: buildThemePatch(parsed),
      rationale: parsed.rationale,
      tokenSources: parsed.tokenSources,
    };
  },
};

const draftLayoutTool = {
  description:
    "Phase 1 of the two-phase generation pipeline. Call this ONCE at the very start of a multi-component request to declare the full spatial layout plan — never for single-component requests. Each entry becomes an animated skeleton placeholder on the canvas immediately. After this call, fulfill every planned component by calling add_component for each one (same coordinates or draftId).",
  inputSchema: draftLayoutToolSchema,
  execute: async (parsed: DraftLayoutToolInput) => {
    return {
      tool: "draft_layout" as const,
      components: parsed.components,
      rationale: parsed.rationale,
    };
  },
};

const stopAfterSuccessfulToolResult: StopCondition<ToolSet> = ({ steps }) => {
  const latestStep = steps[steps.length - 1];
  return (latestStep?.toolResults.length ?? 0) > 0;
};

export function getWireframeTargetIds(
  nodeIntents?: Array<{ id: string; kind: string }>
): string[] {
  return (nodeIntents ?? [])
    .filter((n) => n.kind === "wireframe")
    .map((n) => n.id);
}

function collectFulfilledWireframeIds(
  steps: Array<{
    toolResults?: Array<{ toolName?: unknown; output?: unknown }>;
  }>
): Set<string> {
  const fulfilled = new Set<string>();
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      const name = (result as { toolName?: unknown }).toolName;
      if (name !== "update_component_code" && name !== "add_component")
        continue;
      const output = (result as { output?: unknown }).output as
        | { targetId?: unknown; draftId?: unknown; tool?: unknown }
        | undefined;
      if (typeof output?.targetId === "string" && output.targetId) {
        fulfilled.add(output.targetId);
      } else if (typeof output?.draftId === "string" && output.draftId) {
        fulfilled.add(output.draftId);
      } else if (name === "add_component") {
        // add_component without an explicit wireframe reference still counts
        // as progress so the loop cannot spin forever on models that
        // duplicate instead of fulfilling in place.
        fulfilled.add(`__add_component:${fulfilled.size}`);
      } else {
        fulfilled.add(`__update:${fulfilled.size}`);
      }
    }
  }
  return fulfilled;
}

/**
 * Multi-wireframe create stop: halt only once every top-level target
 * wireframe has been fulfilled via update_component_code (or a matching
 * add_component) — never after the first tool result alone.
 */
export function stopWhenWireframesFulfilledFor(
  targetIds: string[]
): StopCondition<ToolSet> {
  return ({ steps }) => {
    if (targetIds.length === 0) return false;
    const fulfilled = collectFulfilledWireframeIds(steps);
    // Count only real wireframe ids (ignore synthetic add_component markers
    // unless they reference a target via draftId/targetId).
    let count = 0;
    for (const id of targetIds) {
      if (fulfilled.has(id)) count += 1;
    }
    return count >= targetIds.length;
  };
}

/**
 * Multi-component create stop: halt as soon as every drafted placeholder
 * has been fulfilled — without this the SDK makes one extra model call
 * after the last add_component just to generate follow-up chatter.
 */
export const stopWhenDraftsFulfilled: StopCondition<ToolSet> = ({ steps }) => {
  let planned = 0;
  let fulfilled = 0;
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      const name = (result as { toolName?: unknown }).toolName;
      if (name !== "draft_layout" && name !== "add_component") continue;
      const output = (result as { output?: unknown }).output as
        | { components?: Array<unknown> }
        | undefined;
      if (name === "draft_layout") {
        planned += Array.isArray(output?.components)
          ? output.components.length
          : 0;
      } else {
        fulfilled += 1;
      }
    }
  }
  return planned > 0 && fulfilled >= planned;
};

export function stopWhenForMode(
  mode: AiMode,
  wireframeTargetIds: string[] = [],
  singleComponent?: boolean
) {
  if (mode === "edit" || mode === "recreate") {
    // Let failed tool executions feed their error back to the model for repair,
    // but stop as soon as one update_component_code call executes successfully.
    return [stopAfterSuccessfulToolResult, isStepCount(5)];
  }

  if (mode === "bake") {
    // Bake is a single atomic merge — stop after the first success instead of
    // allowing redundant follow-up calls.
    return [stopAfterSuccessfulToolResult, isStepCount(5)];
  }

  if (mode === "create") {
    // Multi-wireframe fulfillment: only stop once every top-level target
    // has been fulfilled — never after the first tool result alone.
    // Allow up to 3 steps per wireframe so multi-turn models can finish.
    if (wireframeTargetIds.length > 0) {
      return [
        stopWhenWireframesFulfilledFor(wireframeTargetIds),
        isStepCount(Math.max(5, wireframeTargetIds.length * 3 + 2)),
      ];
    }
    // Fast path: one add_component, then stop immediately — no trailing
    // model call for follow-up text.
    if (singleComponent) {
      return [stopAfterSuccessfulToolResult, isStepCount(3)];
    }
    return [stopWhenDraftsFulfilled, isStepCount(12)];
  }

  return isStepCount(1);
}

/**
 * Pin the model to one tool. Local runtimes only take string tool_choice
 * values; current Claude models reject a forced tool with a 400, so
 * Anthropic gets "auto" and the rule lives in the system prompt instead.
 */
function forceTool(
  provider: AiProvider | undefined,
  toolName: string
): ToolChoice<ToolSet> {
  if (provider === "local") return "required";
  if (provider === "anthropic") return "auto";
  return { type: "tool", toolName };
}

export function toolChoiceForMode(
  mode: AiMode,
  provider?: AiProvider,
  wireframeTargetIds: string[] = [],
  singleComponent?: boolean
): ToolChoice<ToolSet> | undefined {
  // Local providers (LM Studio, Ollama, vLLM) default to conversational text
  // without an enforced tool choice — force structured tool output in every
  // mode so the model never leaks markdown code fences. Local runtimes only
  // support string tool_choice values.
  if (provider === "local") {
    return "required";
  }

  if (provider === "anthropic") {
    return "auto";
  }

  if (mode === "edit" || mode === "bake") {
    return { type: "tool", toolName: "update_component_code" };
  }

  if (mode === "create" && wireframeTargetIds.length > 0) {
    return { type: "tool", toolName: "update_component_code" };
  }

  if (mode === "recreate" || (mode === "create" && singleComponent)) {
    return { type: "tool", toolName: "add_component" };
  }

  return undefined;
}

function latestStepHadToolError(
  steps: Array<{ content: Array<{ type: string }> }>
): boolean {
  return (
    steps[steps.length - 1]?.content.some(
      (part) => part.type === "tool-error"
    ) ?? false
  );
}

export function buildToolsForMode(
  mode: AiMode,
  context: {
    selectedIds: string[];
    nodeIntents?: Array<{
      id: string;
      kind: string;
      sourceComponentId?: string;
      nestedChildren?: Array<{ id: string }>;
    }>;
    selectedNodes?: Array<{ id: string; code: string }>;
    sourceImage?: AiContextSnapshot["sourceImage"];
  },
  opts?: { singleComponent?: boolean }
): ToolSet {
  const updateCode = makeUpdateComponentCodeTool(context, mode === "edit");
  const hasWireframes = (context.nodeIntents ?? []).some(
    (n) => n.kind === "wireframe"
  );
  const hasCaptured = (context.nodeIntents ?? []).some(
    (n) => n.kind === "captured"
  );

  switch (mode) {
    case "recreate": {
      const source = context.sourceImage;
      if (!source) throw new Error("Recreate requires a source image frame.");
      return {
        add_component: {
          ...addComponentTool,
          execute: async (parsed: AddComponentToolInput) =>
            addComponentTool.execute({
              ...parsed,
              componentType: "Container",
              draftId: undefined,
              position: {
                x: source.rect.x + source.rect.w + 40,
                y: source.rect.y,
              },
              size: { w: source.rect.w, h: source.rect.h },
            }),
        },
      };
    }
    case "theme":
      return { update_theme: updateThemeTool };

    case "create":
      if (hasWireframes) {
        // Wireframes already exist on canvas — they must be fulfilled in
        // place. Don't distract the model with draft_layout.
        return { update_component_code: updateCode };
      }
      if (hasCaptured) {
        // Captured overlays reference existing components that need editing.
        return {
          draft_layout: draftLayoutTool,
          add_component: addComponentTool,
          update_component_code: updateCode,
        };
      }
      if (opts?.singleComponent) {
        // Fast path: one component, one call. Sending draft_layout as well
        // wastes schema tokens and lets the model plan instead of building.
        return { add_component: addComponentTool };
      }
      return {
        draft_layout: draftLayoutTool,
        add_component: addComponentTool,
      };

    case "edit":
      return {
        update_component_code: updateCode,
      };

    case "bake":
      // Bake is strictly an in-place merge — only the merge tool is valid.
      return {
        update_component_code: updateCode,
      };

    default:
      return {
        add_component: addComponentTool,
        update_component_code: updateCode,
      };
  }
}

export function getClientSafeAiErrorMessage(error: unknown): string {
  if (RetryError.isInstance(error)) {
    const lastError = error.lastError;
    if (APICallError.isInstance(lastError)) {
      return lastError.message;
    }
    if (lastError instanceof Error && lastError.message) {
      return lastError.message;
    }
  }

  if (APICallError.isInstance(error)) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  // OpenAI-compatible servers can emit plain strings in SSE error chunks.
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "AI request failed.";
}

interface ChatRequestBody {
  messages?: UIMessage[];
  context?: unknown;
  activeProvider?: AiProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  systemPrompt?: string;
  chatgptScopes?: string[];
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return forbiddenResponse();

  try {
    const body = (await request.json()) as ChatRequestBody;

    const provider: AiProvider = body.activeProvider ?? "google";

    for (const req of providerRequirements[provider] ?? []) {
      if (!body[req as keyof ChatRequestBody]) {
        const hint =
          provider === "chatgpt"
            ? "Sign in with ChatGPT in AI Settings to use your plan allowance."
            : `Add it in AI Settings.`;
        return NextResponse.json(
          {
            error: `${req === "apiKey" ? "An API key" : "A Base URL"} is required for ${provider}. ${hint}`,
          },
          { status: 400 }
        );
      }
    }

    if (provider === "chatgpt") {
      // Scope gate: identity-only sign-in must not enable plan-backed
      // inference. The access token is opaque to this route, so the granted
      // scopes are client-attested from the validated sign-in callback;
      // the client also pre-checks before sending.
      if (!body.chatgptScopes?.includes(CHATGPT_PLAN_SCOPE)) {
        return NextResponse.json(
          {
            error:
              "ChatGPT plan usage is not authorized for this connection. Reconnect in AI Settings and approve plan usage.",
          },
          { status: 403 }
        );
      }
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "Missing chat messages." },
        { status: 400 }
      );
    }

    const parsedContext = aiContextSnapshotSchema.safeParse(body.context);
    if (!parsedContext.success) {
      return NextResponse.json(
        {
          error: "Missing or invalid AI context payload.",
          details: z.flattenError(parsedContext.error),
        },
        { status: 400 }
      );
    }

    const context = parsedContext.data;
    const config: ProviderConfig = {
      apiKey: body.apiKey ?? "",
      model: body.model ?? "",
      baseURL: body.baseURL,
    };
    const model = createModel(provider, config);

    // Strict message truncation: only process the latest user message
    // This enforces complete context isolation by ignoring all conversation history
    const lastMessage = body.messages[body.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      return NextResponse.json(
        { error: "Latest message must be a user prompt." },
        { status: 400 }
      );
    }

    // Recreate, and a theme derived from an image, both read the attachment.
    if (
      (context.mode === "recreate" || context.sourceImage) &&
      !lastMessage.parts.some(
        (part) =>
          part.type === "file" &&
          part.mediaType === "image/png" &&
          part.url.startsWith("data:image/png;base64,")
      )
    ) {
      return NextResponse.json(
        {
          error:
            "This request requires an image attachment. Select an uploaded image and use a vision-capable model.",
        },
        { status: 400 }
      );
    }

    const sanitizedMessages = [lastMessage];

    const modelMessages = await convertToModelMessages(sanitizedMessages);

    const wireframeTargetIds = getWireframeTargetIds(
      context.nodeIntents as any
    );
    const hasWireframes = wireframeTargetIds.length > 0;
    const hasCaptured = (context.nodeIntents ?? []).some(
      (n) => n.kind === "captured"
    );
    // Fast path: single-component prompt with nothing to fulfill in place —
    // one add_component call, no planning round trip, no trailing chatter.
    const singleComponent =
      context.mode === "create" &&
      !hasWireframes &&
      !hasCaptured &&
      isSingleComponentRequest(context.prompt);
    const tools = buildToolsForMode(context.mode, context, {
      singleComponent,
    });
    const forcedInitialToolChoice = toolChoiceForMode(
      context.mode,
      provider,
      wireframeTargetIds,
      singleComponent
    );
    // Multi-component create has no single pinned tool, but step 0 must
    // still be the layout draft — otherwise the model may emit code before
    // planning and the skeletons never appear.
    const stepZeroChoice =
      forcedInitialToolChoice ??
      (context.mode === "create" && !hasWireframes && !hasCaptured
        ? forceTool(provider, "draft_layout")
        : undefined);

    const providerOptions = {
      gateway: { caching: "auto" },
      ...getModelProviderOptions(provider, config.model),
    };
    const result = streamText({
      model,
      // Stop the upstream request (and its billing) when the user presses
      // Stop or closes the tab.
      abortSignal: request.signal,
      // Reasoning models and current Claude models use their default temperature.
      temperature:
        !acceptsTemperature(provider, config.model) ||
        providerOptions.openai?.forceReasoning
          ? undefined
          : context.mode === "theme"
            ? 0.85
            : 0.2,
      stopWhen: stopWhenForMode(
        context.mode,
        wireframeTargetIds,
        singleComponent
      ),
      prepareStep: ({ stepNumber, steps }) => {
        if (stepNumber === 0 && stepZeroChoice) {
          return { toolChoice: stepZeroChoice };
        }
        if (forcedInitialToolChoice && latestStepHadToolError(steps)) {
          return { toolChoice: forcedInitialToolChoice };
        }
        // Multi-wireframe create: keep forcing update_component_code until
        // every target wireframe is fulfilled so later steps cannot drift
        // into conversational text with wireframes still pending.
        if (
          context.mode === "create" &&
          wireframeTargetIds.length > 0 &&
          stepNumber > 0
        ) {
          const fulfilled = collectFulfilledWireframeIds(
            steps as Array<{
              toolResults?: Array<{ toolName?: unknown; output?: unknown }>;
            }>
          );
          const remaining = wireframeTargetIds.filter(
            (id) => !fulfilled.has(id)
          );
          if (remaining.length > 0) {
            return {
              toolChoice: forceTool(provider, "update_component_code"),
            };
          }
        }
      },
      instructions: createInstructions(
        context as AiContextSnapshot,
        body.systemPrompt,
        provider
      ),
      messages: modelMessages,
      maxRetries: provider === "local" ? 0 : 3,
      providerOptions,
      experimental_repairToolCall: async ({ toolCall, tools, error }) => {
        if (NoSuchToolError.isInstance(error)) {
          return null;
        }

        const tool = tools?.[toolCall.toolName as keyof typeof tools];
        if (!tool?.inputSchema) return null;

        try {
          const { output: repairedInput } = await generateText({
            model,
            abortSignal: request.signal,
            providerOptions,
            instructions: [
              "You are a tool call repair assistant.",
              "The original tool call failed schema validation.",
              "Fix the input to match the schema exactly.",
              `Original error: ${error.message}`,
            ].join("\n"),
            prompt: `Original input: ${toolCall.input}\n\nRepair the input to satisfy the schema.`,
            output: Output.object({ schema: tool.inputSchema }),
          });

          return {
            ...toolCall,
            input: JSON.stringify(repairedInput),
          };
        } catch {
          return null;
        }
      },
      tools,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        onError: (error) => {
          if (APICallError.isInstance(error)) {
            // Always log the upstream details server-side for diagnosis.
            // responseBody is OpenAI's error JSON — no credentials in it.
            console.error(
              `[chat] provider=${provider} model=${config.model} ` +
                `status=${error.statusCode} ` +
                `body=${(error.responseBody ?? "").slice(0, 1000)}`
            );
            if (provider === "chatgpt") {
              if (error.statusCode === 401) {
                return "ChatGPT authorization failed. Your plan session may have expired — reconnect in AI Settings and approve plan usage.";
              }
              // Surface OpenAI's own message instead of a bare status text.
              try {
                const parsed = JSON.parse(error.responseBody ?? "");
                const msg = parsed?.error?.message;
                if (typeof msg === "string" && msg.trim()) {
                  return `ChatGPT request failed: ${msg.slice(0, 500)}`;
                }
              } catch {
                // fall through to generic message below
              }
              const raw = (error.responseBody ?? "").trim();
              if (raw) {
                return `ChatGPT request failed (${error.statusCode ?? "unknown"}). ${raw.slice(0, 500)}`;
              }
            }
          }
          return getClientSafeAiErrorMessage(error);
        },
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown chat route error",
      },
      { status: 500 }
    );
  }
}
