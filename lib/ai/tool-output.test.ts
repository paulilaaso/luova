import { describe, expect, it } from "vitest";
import {
  extractToolErrorMessagesFromMessage,
  extractToolOutputsFromMessage,
} from "@/lib/ai/tool-output";

describe("AI tool output extraction", () => {
  it("extracts successful static tool outputs from AI SDK UI messages", () => {
    const message = {
      role: "assistant",
      parts: [
        {
          type: "tool-update_component_code",
          state: "output-available",
          toolCallId: "call-1",
          output: {
            tool: "update_component_code",
            targetId: "node-1",
            code: "export default function Component() { return <div />; }",
          },
        },
      ],
    };

    expect(extractToolOutputsFromMessage(message)).toEqual([
      {
        tool: "update_component_code",
        toolCallId: "call-1",
        targetId: "node-1",
        code: "export default function Component() { return <div />; }",
      },
    ]);
  });

  it("extracts failed tool execution messages instead of treating them as no-op responses", () => {
    const message = {
      role: "assistant",
      parts: [
        {
          type: "tool-update_component_code",
          state: "output-error",
          toolCallId: "call-1",
          errorText:
            "Diff validation failed: Could not find the SEARCH block in the code.",
        },
      ],
    };

    expect(extractToolOutputsFromMessage(message)).toEqual([]);
    expect(extractToolErrorMessagesFromMessage(message)).toEqual([
      "update_component_code: Diff validation failed: Could not find the SEARCH block in the code.",
    ]);
  });

  it("uses the dynamic tool name when extracting dynamic tool errors", () => {
    const message = {
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "update_component_code",
          state: "output-error",
          toolCallId: "call-1",
          errorText: "Edit application failed.",
        },
      ],
    };

    expect(extractToolErrorMessagesFromMessage(message)).toEqual([
      "update_component_code: Edit application failed.",
    ]);
  });
});
