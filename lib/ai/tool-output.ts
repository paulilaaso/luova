import type { AiMode, AiPendingAction, AiToolOutput } from "@/types/ai";
import { getDefaultComponentSize } from "@/types/builder";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads tool results from a completed UIMessage produced by the AI SDK (v6).
 *
 * In SDK v6, static tool parts have type `tool-${toolName}` and state
 * `output-available`; dynamic tools use type `dynamic-tool` with the same
 * state. The route's `execute` handlers already validate and shape each result,
 * so we just read `output` and trust the `tool` discriminant.
 */
export function extractToolOutputsFromMessage(
  message: unknown
): AiToolOutput[] {
  if (!isRecord(message)) return [];

  const parts = Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts?: unknown }).parts as unknown[])
    : [];

  return parts
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) &&
        part.state === "output-available" &&
        typeof part.type === "string" &&
        (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
        isRecord(part.output) &&
        typeof part.output.tool === "string"
    )
    .map((part) => ({
      ...(part.output as Record<string, unknown>),
      toolCallId: part.toolCallId as string | undefined,
    })) as AiToolOutput[];
}

export function extractToolErrorMessagesFromMessage(
  message: unknown
): string[] {
  if (!isRecord(message)) return [];

  const parts = Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts?: unknown }).parts as unknown[])
    : [];

  return parts
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.state === "output-error"
    )
    .map((part) => {
      const type = typeof part.type === "string" ? part.type : "";
      const toolName =
        typeof part.toolName === "string"
          ? part.toolName
          : type.startsWith("tool-")
            ? type.slice("tool-".length)
            : "tool";
      return `${toolName}: ${typeof part.errorText === "string" ? part.errorText : "Unknown tool execution error."}`;
    });
}

export function extractAssistantText(message: unknown): string {
  if (!isRecord(message)) return "";

  const parts = Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts?: unknown }).parts as unknown[])
    : [];

  return parts
    .filter(
      (p) => isRecord(p) && p.type === "text" && typeof p.text === "string"
    )
    .map((p) => String((p as Record<string, unknown>).text as string))
    .join("\n")
    .trim();
}

export function toPendingActions(
  outputs: AiToolOutput[],
  selectedIds: string[],
  mode?: AiMode
): AiPendingAction[] {
  return outputs.map((output, index): AiPendingAction => {
    if (output.tool === "add_component") {
      const defaultSize = getDefaultComponentSize(output.componentType);
      return {
        id: `pending-add-${index}`,
        tool: "add_component",
        toolCallId: output.toolCallId,
        componentType: output.componentType,
        // code is already cleaned by the route's execute handler
        code: output.code,
        position:
          output.position?.x != null && output.position?.y != null
            ? { x: output.position.x, y: output.position.y }
            : undefined,
        size: output.size
          ? { w: output.size.w, h: output.size.h }
          : { w: defaultSize.w, h: defaultSize.h },
        draftId: output.draftId,
        rationale: output.rationale,
      };
    }

    if (output.tool === "update_component_code") {
      const targetId = output.targetId ?? selectedIds[0] ?? "";
      // bakedSourceIds marks an intentional bake merge only. In Create mode
      // with multiple selected wireframes selectedIds.length > 1 is true for
      // independent fulfillments — never attach bake sources there.
      const bakedSourceIds =
        mode === "bake" && selectedIds.length > 1
          ? [...selectedIds]
          : undefined;
      return {
        id: `pending-update-${index}`,
        tool: "update_component_code",
        toolCallId: output.toolCallId,
        targetId,
        // code is already cleaned by the route's execute handler
        code: output.code,
        componentType: output.componentType,
        rationale: output.rationale,
        bakedSourceIds,
      };
    }

    if (output.tool === "draft_layout") {
      return {
        id: `pending-draft-${index}`,
        tool: "draft_layout",
        toolCallId: output.toolCallId,
        components: output.components,
        rationale: output.rationale,
      };
    }

    return {
      id: `pending-theme-${index}`,
      tool: "update_theme",
      toolCallId: output.toolCallId,
      patch: output.patch,
      rationale: output.rationale,
      tokenSources: output.tokenSources,
    };
  });
}
