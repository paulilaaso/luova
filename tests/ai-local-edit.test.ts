import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildToolsForMode,
  getClientSafeAiErrorMessage,
} from "@/app/api/chat/route";
import { createInstructions } from "@/lib/ai/prompt-factory";
import type { AiContextSnapshot } from "@/types/ai";

const code = "export default () => <div>UniqueSourceMarker</div>";

function editContext(): AiContextSnapshot {
  return {
    mode: "edit",
    activeTab: "components",
    prompt: "extend this to the bottom",
    selectedIds: ["capture-1"],
    selectedNodes: [
      { id: "component-1", type: "Container", props: { x: 0, y: 0 }, code },
    ],
    nodeIntents: [
      {
        id: "capture-1",
        kind: "captured",
        type: "Container",
        comment: "extend this to the bottom",
        label: "Selected article",
        sourceComponentId: "component-1",
        sourceCode: code,
        rect: { x: 0, y: 0, w: 400, h: 300 },
      },
    ],
  };
}

describe("captured element edit context", () => {
  it("sends the source once while preserving selection instructions and target", () => {
    const context = editContext();
    const instructions = createInstructions(context, undefined, "local");
    expect(instructions.match(/UniqueSourceMarker/g)).toHaveLength(1);
    expect(instructions).toContain('"sourceComponentId": "component-1"');
    expect(instructions).toContain('"comment": "extend this to the bottom"');
    expect(instructions).toContain('"label": "Selected article"');
    expect(instructions).toContain('"id": "capture-1"');
    expect(context.nodeIntents?.[0].sourceCode).toBe(code);
  });

  it("keeps intent source code when it is not available in selected nodes", () => {
    const context = editContext();
    context.selectedNodes = [];
    expect(createInstructions(context, undefined, "local")).toContain(
      "UniqueSourceMarker"
    );
  });
});

describe("targeted edit execution", () => {
  const source = "export default () => <div>Original label</div>";
  const context = {
    selectedIds: ["component-1"],
    selectedNodes: [{ id: "component-1", code: source }],
  };
  const options = { toolCallId: "edit-call", messages: [], context: undefined };

  it("applies JSON edits without changing the rest of the source", async () => {
    const tool = buildToolsForMode("edit", context).update_component_code;
    await expect(
      tool.execute!(
        { edits: [{ search: "Original label", replace: "Updated label" }] },
        options
      )
    ).resolves.toMatchObject({
      targetId: "component-1",
      code: source.replace("Original label", "Updated label"),
    });
  });

  it("also accepts targeted diff blocks", async () => {
    const tool = buildToolsForMode("edit", context).update_component_code;
    await expect(
      tool.execute!(
        {
          code: "<<<< SEARCH\nOriginal label\n====\nUpdated label\n>>>> REPLACE",
        },
        options
      )
    ).resolves.toMatchObject({
      code: source.replace("Original label", "Updated label"),
    });
  });

  it("returns actionable feedback for full-file edit output", async () => {
    const tool = buildToolsForMode("edit", context).update_component_code;
    await expect(tool.execute!({ code: source }, options)).rejects.toThrow(
      "Edit mode requires targeted changes"
    );
  });

  it("still allows complete TSX when creating wireframes and baking", async () => {
    for (const mode of ["create", "bake"] as const) {
      const tool = buildToolsForMode(mode, {
        ...context,
        nodeIntents: [{ id: "component-1", kind: "wireframe" }],
      }).update_component_code;
      await expect(
        tool.execute!({ code: source }, options)
      ).resolves.toMatchObject({ code: source });
    }
  });
});

describe("local provider error reporting", () => {
  const message =
    "request (35643 tokens) exceeds the available context size (23552 tokens), try increasing it";

  it("surfaces plain string errors from OpenAI-compatible streams", () => {
    expect(getClientSafeAiErrorMessage(message)).toBe(message);
  });

  it("preserves errors from HTTP failures and retries", () => {
    const error = new APICallError({
      message,
      url: "http://localhost/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
    });
    expect(getClientSafeAiErrorMessage(error)).toBe(message);
    expect(
      getClientSafeAiErrorMessage(
        new RetryError({
          message: "Retry failed",
          reason: "maxRetriesExceeded",
          errors: [error],
        })
      )
    ).toBe(message);
  });
});
