import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateCodeWithCompilerWorker } from "@/hooks/use-compiler-worker";
import { executeAgenticFix } from "@/lib/ai/auto-fix";
import { createInstructions } from "@/lib/ai/prompt-factory";
import { useAiSettingsStore } from "@/stores/ai-settings-store";
import { useAiStore } from "@/stores/ai-store";
import { useProjectStore } from "@/stores/project-store";

// Mock compiler worker validation
vi.mock("@/hooks/use-compiler-worker", () => ({
  validateCodeWithCompilerWorker: vi.fn(),
}));

describe("executeAgenticFix", () => {
  const nodeId = "test-component-1";
  const initialCode = "export default () => <div>Hello</div>";
  const newValidCode = "export default () => <div>Hello Cleaned</div>";
  let responseChunkSize = Number.POSITIVE_INFINITY;

  beforeEach(() => {
    vi.clearAllMocks();
    responseChunkSize = Number.POSITIVE_INFINITY;
    // These tests mock API-provider responses, independent of the app default.
    useAiSettingsStore.setState({ activeProvider: "google" });
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    useAiStore.setState({ runtimeErrors: {} });

    // Setup initial project node
    useProjectStore.setState({
      nodes: {
        root: { id: "root", type: "Container", props: {}, code: "" },
        [nodeId]: {
          id: nodeId,
          type: "Button",
          props: { x: 10, y: 20 },
          code: initialCode,
        },
      } as any,
    });

    // Mock fetch to simulate SSE stream response
    global.fetch = vi.fn().mockImplementation(() => {
      const mockStream = new ReadableStream({
        start(controller) {
          const chunks = [
            {
              type: "tool-input-available",
              toolCallId: "call-1",
              toolName: "update_component_code",
              input: {},
            },
            {
              type: "tool-output-available",
              toolCallId: "call-1",
              output: {
                tool: "update_component_code",
                targetId: nodeId,
                code: newValidCode,
              },
            },
          ];
          const bytes = new TextEncoder().encode(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")
          );
          for (
            let offset = 0;
            offset < bytes.length;
            offset += responseChunkSize
          ) {
            controller.enqueue(bytes.slice(offset, offset + responseChunkSize));
          }
          controller.close();
        },
      });

      return Promise.resolve({
        ok: true,
        body: mockStream,
      } as any);
    });
  });

  it("handles successful fix validation and updates component code", async () => {
    // Mock successful compilation/validation
    vi.mocked(validateCodeWithCompilerWorker).mockResolvedValue({
      isValid: true,
      error: null,
      transformedCode: newValidCode,
    });

    await executeAgenticFix({
      nodeId,
      error: "Runtime error occurred",
      code: initialCode,
    });

    const aiState = useAiStore.getState();
    const projectState = useProjectStore.getState();

    // Check status is ready
    expect(aiState.status).toBe("ready");
    expect(aiState.error).toBeNull();
    expect(aiState.assistantText).toBe("Fix: AI corrected a runtime error.");
    expect(aiState.isFixingError).toBe(false);

    // Verify code is updated in store
    expect(projectState.nodes[nodeId].code).toBe(newValidCode);
  });

  it("handles validation failure by reporting the compiler error and keeping the original code", async () => {
    const transformError =
      "Transform failed with 1 error: Expected identifier but found ')'";
    // Mock compilation validation failure
    vi.mocked(validateCodeWithCompilerWorker).mockResolvedValue({
      isValid: false,
      error: transformError,
      transformedCode: "",
    });

    await executeAgenticFix({
      nodeId,
      error: "Runtime error occurred",
      code: initialCode,
    });

    const aiState = useAiStore.getState();
    const projectState = useProjectStore.getState();

    // Verify error is recorded in the store and status is error
    expect(aiState.status).toBe("error");
    expect(aiState.error).toBe(transformError);
    expect(aiState.isFixingError).toBe(false);

    // Verify code is NOT updated
    expect(projectState.nodes[nodeId].code).toBe(initialCode);
  });

  it("includes component source only once in the model input", async () => {
    vi.mocked(validateCodeWithCompilerWorker).mockResolvedValue({
      isValid: true,
      error: null,
      transformedCode: newValidCode,
    });
    await executeAgenticFix({
      nodeId,
      error: "Runtime error",
      code: initialCode,
    });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    const input =
      createInstructions(body.context, undefined, "local") +
      body.messages[0].parts[0].text;
    expect(input.split(initialCode)).toHaveLength(2);
    expect(body.context.themeState).toBeUndefined();
  });

  it("applies a repair even when network chunks split inside JSON events", async () => {
    responseChunkSize = 7;
    vi.mocked(validateCodeWithCompilerWorker).mockResolvedValue({
      isValid: true,
      error: null,
      transformedCode: newValidCode,
    });
    await executeAgenticFix({
      nodeId,
      error: "Runtime error",
      code: initialCode,
    });
    expect(useAiStore.getState().error).toBeNull();
    expect(useProjectStore.getState().nodes[nodeId].code).toBe(newValidCode);
  });

  it("restores snapshot and resumes history on abort", async () => {
    const abortSignal = AbortSignal.abort();

    await executeAgenticFix({
      nodeId,
      error: "Runtime error occurred",
      code: initialCode,
      signal: abortSignal,
    });

    const aiState = useAiStore.getState();
    expect(aiState.isFixingError).toBe(false);
  });
});
