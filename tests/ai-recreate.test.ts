import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildToolsForMode,
  stopWhenForMode,
  toolChoiceForMode,
} from "@/app/api/chat/route";
import { applyAiActions } from "@/hooks/use-ai-action-orchestrator";
import { buildAiContextSnapshot } from "@/lib/ai/context";
import {
  canSubmitWithoutPrompt,
  canSubmitWithTheme,
  detectAiMode,
} from "@/lib/ai/mode";
import { createInstructions } from "@/lib/ai/prompt-factory";
import { aiContextSnapshotSchema } from "@/lib/ai/schemas";
import { toPendingActions } from "@/lib/ai/tool-output";
import { useAiStore } from "@/stores/ai-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import type { AiContextSnapshot } from "@/types/ai";
import type { ComponentNodeAny } from "@/types/builder";
import type { ThemeEditorState } from "@/types/editor";

const image = {
  id: "image",
  type: "Image",
  kind: "generated",
  code: '<img src="asset:image-abc123" />',
  props: {
    x: 120,
    y: 80,
    w: 720,
    h: 360,
    widthMode: "fixed",
    heightMode: "fixed",
  },
} as ComponentNodeAny;
const context = (): AiContextSnapshot =>
  buildAiContextSnapshot({
    mode: "recreate",
    prompt: "",
    activeTab: "components",
    selectedIds: [image.id],
    nodes: { [image.id]: image },
    currentMode: "light",
    themeState: {
      styles: {
        light: {
          primary: "oklch(0.6 0.2 250)",
          background: "oklch(1 0 0)",
          "font-sans": "Test Font",
          customFonts: [],
        },
        dark: { primary: "oklch(0.7 0.2 250)" },
      },
    } as unknown as ThemeEditorState,
  });

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Image recreation", () => {
  it("activates for a single image, permits an empty prompt, and preserves other modes", () => {
    const nodes = {
      image,
      other: { type: "Container" },
      frame: { type: "Image", kind: "wireframe" },
    };
    expect(detectAiMode(["image"], "components", nodes)).toBe("recreate");
    expect(canSubmitWithoutPrompt("recreate", ["image"], nodes)).toBe(true);
    expect(canSubmitWithoutPrompt("recreate", [], nodes)).toBe(false);
    expect(detectAiMode(["image"], "theme", nodes)).toBe("theme");
    expect(detectAiMode(["image", "other"], "components", nodes)).toBe("bake");
    expect(detectAiMode(["frame"], "components", nodes)).toBe("create");
  });

  it("derives a theme from a selected image, with or without a prompt", () => {
    const nodes = {
      image,
      other: { type: "Container" },
      frame: { type: "Image", kind: "wireframe" },
    };
    expect(canSubmitWithoutPrompt("theme", ["image"], nodes)).toBe(true);
    expect(canSubmitWithoutPrompt("theme", [], nodes)).toBe(false);
    expect(canSubmitWithoutPrompt("theme", ["other"], nodes)).toBe(false);
    expect(canSubmitWithoutPrompt("theme", ["frame"], nodes)).toBe(false);

    const themeContext = (selectedIds: string[], prompt: string) =>
      buildAiContextSnapshot({
        mode: "theme",
        prompt,
        activeTab: "theme",
        selectedIds,
        nodes: { [image.id]: image },
        currentMode: "light",
        themeState: {
          styles: { light: {}, dark: {} },
        } as unknown as ThemeEditorState,
      });
    expect(themeContext(["image"], "").sourceImage).toMatchObject({
      nodeId: "image",
      assetId: "asset:image-abc123",
    });
    expect(themeContext([], "warm and calm").sourceImage).toBeUndefined();
    expect(() => themeContext([], "")).toThrow("select an uploaded image");
  });

  it("offers a theme-first variant for create (with a prompt) and recreate", () => {
    const nodes = { image, frame: { type: "Container", kind: "wireframe" } };
    expect(canSubmitWithTheme("recreate", "", ["image"], nodes)).toBe(true);
    expect(canSubmitWithTheme("create", "a coffee shop site", [], nodes)).toBe(
      true
    );
    // Armed wireframes allow an empty Create, but the theme needs a prompt.
    expect(canSubmitWithTheme("create", " ", ["frame"], nodes)).toBe(false);
    expect(canSubmitWithTheme("edit", "make it blue", ["image"], nodes)).toBe(
      false
    );
  });

  it("carries the image-derived theme's token sources into recreate", () => {
    const [themeAction] = toPendingActions(
      [
        {
          tool: "update_theme",
          patch: { light: {} },
          tokenSources: { primary: "orange CTA button" },
        },
      ],
      [],
      "theme"
    );
    expect(themeAction).toMatchObject({
      tokenSources: { primary: "orange CTA button" },
    });

    const withSources = {
      ...context(),
      themeTokenSources: { primary: "orange CTA button" },
    };
    expect(aiContextSnapshotSchema.safeParse(withSources).success).toBe(true);
    const instructions = createInstructions(withSources);
    expect(instructions).toContain(
      '"themeTokenSources":{"primary":"orange CTA button"}'
    );
    expect(instructions).toContain("give that element exactly that token");
  });

  it("includes font-family tokens, falling back to light fonts in dark mode", () => {
    const snapshot = context();
    expect(snapshot.themeState?.styles.light).toEqual({
      primary: "oklch(0.6 0.2 250)",
      background: "oklch(1 0 0)",
      "font-sans": "Test Font",
    });
    expect(snapshot.themeState?.styles.dark).toEqual({
      primary: "oklch(0.7 0.2 250)",
      "font-sans": "Test Font",
    });
  });

  it("snapshots the resized canvas frame and excludes unrelated intents and image code", () => {
    const snapshot = context();
    expect(snapshot.sourceImage).toEqual({
      nodeId: "image",
      assetId: "asset:image-abc123",
      rect: { x: 120, y: 80, w: 720, h: 360 },
    });
    expect(snapshot.selectedNodes).toBeUndefined();
    expect(snapshot.nodeIntents).toBeUndefined();
    expect(aiContextSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      aiContextSnapshotSchema.safeParse({ ...snapshot, sourceImage: undefined })
        .success
    ).toBe(false);
    expect(
      aiContextSnapshotSchema.safeParse({ ...snapshot, selectedIds: ["other"] })
        .success
    ).toBe(false);
  });

  it("uses rendered auto height after a width change rather than stale image dimensions", () => {
    const element = document.createElement("div");
    element.dataset.nodeId = "image";
    Object.defineProperties(element, {
      offsetWidth: { value: 720 },
      offsetHeight: { value: 480 },
    });
    document.body.append(element);
    const snapshot = buildAiContextSnapshot({
      mode: "recreate",
      prompt: "",
      activeTab: "components",
      selectedIds: ["image"],
      nodes: {
        image: {
          ...image,
          props: { ...image.props, h: 999, heightMode: "auto" },
        },
      },
      currentMode: "light",
      themeState: {
        styles: {
          light: {
            primary: "oklch(0.6 0.2 250)",
            background: "oklch(1 0 0)",
            "font-sans": "Test Font",
            customFonts: [],
          },
          dark: { primary: "oklch(0.7 0.2 250)" },
        },
      } as unknown as ThemeEditorState,
    });
    expect(snapshot.sourceImage?.rect).toMatchObject({ w: 720, h: 480 });
  });

  it("pins one creation and overrides model-supplied size, position and draft target", async () => {
    const snapshot = context();
    const tools = buildToolsForMode("recreate", snapshot);
    expect(Object.keys(tools)).toEqual(["add_component"]);
    const output = await (tools.add_component.execute as any)({
      code: "export default () => <div />",
      componentType: "Image",
      draftId: "image",
      size: { w: 1920, h: 1080 },
      position: { x: 0, y: 0 },
    });
    expect(output).toMatchObject({
      componentType: "Container",
      size: { w: 720, h: 360 },
      position: { x: 880, y: 80 },
    });
    expect(output.draftId).toBeUndefined();
    expect(toolChoiceForMode("recreate", "google")).toEqual({
      type: "tool",
      toolName: "add_component",
    });
    expect(toolChoiceForMode("recreate", "local")).toBe("required");
    const conditions = stopWhenForMode("recreate") as any[];
    expect(
      conditions[0]({
        steps: [{ toolResults: [{ toolName: "add_component", output }] }],
      })
    ).toBe(true);
  });

  it("uses structure-only instructions without conflicting layout and theme rules", () => {
    const instructions = createInstructions(context());
    expect(instructions).toContain("720");
    expect(instructions).toContain("percentage-based absolute");
    expect(instructions).toContain("map those roles to Luova's theme tokens");
    expect(instructions).toContain("oklch(0.6 0.2 250)");
    expect(instructions).toContain('"fonts":{"font-sans":"Test Font"}');
    expect(instructions).toContain("never write a literal font family");
    expect(instructions).toContain("`font-heading`");
    expect(instructions).not.toContain("oklch(0.7 0.2 250)");
    expect(instructions).toContain("EXACTLY ONCE");
    expect(instructions).not.toContain("Two-Phase Pipeline");
    expect(instructions).toContain("bg-primary text-primary-foreground");
    expect(instructions).not.toContain("Use only neutral");
    expect(instructions).not.toContain("grayscale image");
  });

  it("applies a fixed-size editable component while retaining the source image", async () => {
    useProjectStore.getState().reset();
    useAiStore.getState().clearState();
    const id = useProjectStore
      .getState()
      .addComponent("Image", { x: 120, y: 80 }, image.code, { w: 723, h: 361 });
    useUIStore.getState().selectComponent(id);
    const snapshot = context();
    snapshot.selectedIds = [id];
    snapshot.sourceImage = {
      nodeId: id,
      assetId: "asset:image-abc123",
      rect: { x: 120, y: 80, w: 723, h: 361 },
    };
    const tools = buildToolsForMode("recreate", snapshot);
    const output = await (tools.add_component.execute as any)({
      code: 'export default () => <div className="relative h-full w-full" />',
    });
    const result = applyAiActions(
      toPendingActions([output], [id], "recreate"),
      "recreate"
    );
    expect(result.success).toBe(true);
    const nodes = useProjectStore.getState().nodes;
    expect(nodes[id].type).toBe("Image");
    expect(nodes[id].code).toContain("asset:image-abc123");
    const created = Object.values(nodes).find(
      (node) => node.id !== id && node.id !== "root"
    );
    expect(created?.type).toBe("Container");
    expect(created?.props).toMatchObject({
      w: 723,
      h: 361,
      widthMode: "fixed",
      heightMode: "fixed",
    });
  });
});
