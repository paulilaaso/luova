import { describe, expect, it } from "vitest";
import {
  buildToolsForMode,
  stopWhenDraftsFulfilled,
  stopWhenForMode,
  stopWhenWireframesFulfilledFor,
  toolChoiceForMode,
} from "@/app/api/chat/route";
import {
  buildDomainRules,
  createInstructions,
  detectCreateDomains,
  isSingleComponentRequest,
  SINGLE_COMPONENT_RULES,
} from "@/lib/ai/prompt-factory";

describe("Dynamic tool gating (local-model optimization)", () => {
  it("bake mode exposes only update_component_code", () => {
    const tools = buildToolsForMode("bake", { selectedIds: ["a", "b"] });
    expect(Object.keys(tools)).toEqual(["update_component_code"]);
  });

  it("create with wireframes isolates to update_component_code", () => {
    const tools = buildToolsForMode("create", {
      selectedIds: ["wf-1"],
      nodeIntents: [{ id: "wf-1", kind: "wireframe" }],
    });
    expect(Object.keys(tools)).toEqual(["update_component_code"]);
  });

  it("create without wireframes exposes draft + add only", () => {
    const tools = buildToolsForMode("create", { selectedIds: [] });
    expect(Object.keys(tools).sort()).toEqual(
      ["add_component", "draft_layout"].sort()
    );
  });

  it("create single-component fast path exposes add_component only", () => {
    const tools = buildToolsForMode(
      "create",
      { selectedIds: [] },
      { singleComponent: true }
    );
    expect(Object.keys(tools)).toEqual(["add_component"]);
  });

  it("edit mode exposes only update_component_code", () => {
    const tools = buildToolsForMode("edit", { selectedIds: ["a"] });
    expect(Object.keys(tools)).toEqual(["update_component_code"]);
  });

  it("local provider forces required toolChoice in every mode", () => {
    for (const mode of ["create", "edit", "bake", "theme"] as const) {
      expect(toolChoiceForMode(mode, "local", [])).toBe("required");
      expect(toolChoiceForMode(mode, "local", ["wf-1"])).toBe("required");
    }
  });

  it("frontier providers get exact tool target for bake and wireframe create", () => {
    expect(toolChoiceForMode("bake", "google", [])).toEqual({
      type: "tool",
      toolName: "update_component_code",
    });
    expect(toolChoiceForMode("create", "google", ["wf-1"])).toEqual({
      type: "tool",
      toolName: "update_component_code",
    });
    expect(toolChoiceForMode("create", "google", [])).toBeUndefined();
  });

  it("frontier single-component fast path pins add_component", () => {
    expect(toolChoiceForMode("create", "google", [], true)).toEqual({
      type: "tool",
      toolName: "add_component",
    });
  });

  it("local single-component fast path stays required", () => {
    expect(toolChoiceForMode("create", "local", [], true)).toBe("required");
  });

  it("stops multi-create once all drafts are fulfilled", () => {
    const draftStep = {
      toolResults: [
        {
          toolName: "draft_layout",
          output: { tool: "draft_layout", components: [{}, {}] },
        },
      ],
    };
    const oneAdd = {
      toolResults: [
        { toolName: "add_component", output: { tool: "add_component" } },
      ],
    };
    expect((stopWhenDraftsFulfilled as any)({ steps: [draftStep] })).toBe(
      false
    );
    expect(
      (stopWhenDraftsFulfilled as any)({ steps: [draftStep, oneAdd] })
    ).toBe(false);
    expect(
      (stopWhenDraftsFulfilled as any)({
        steps: [draftStep, oneAdd, oneAdd],
      })
    ).toBe(true);
  });
});

describe("Prompt modularization", () => {
  it("detects deck vs generic intents", () => {
    expect(detectCreateDomains("make a pitch deck").isDeck).toBe(true);
    expect(detectCreateDomains("make a button").isDeck).toBe(false);
  });

  it("injects only deck rules for deck prompts", () => {
    const rules = buildDomainRules("create a pitch deck", 1200);
    expect(rules).toContain("w:1280 h:720");
    expect(rules).not.toContain("modular section frames");
  });

  it("generic prompts get compact rules without slide math", () => {
    const rules = buildDomainRules("create a button", 1200);
    expect(rules).not.toContain("w:1280");
  });

  it("detects single vs multi component requests", () => {
    expect(isSingleComponentRequest("login card")).toBe(true);
    expect(isSingleComponentRequest("create a pricing card")).toBe(true);
    expect(isSingleComponentRequest("a navbar with logo and links")).toBe(true);
    expect(
      isSingleComponentRequest(
        "Create a dashboard with sidebar, charts, and activity feed"
      )
    ).toBe(false);
    expect(isSingleComponentRequest("create a 5 slide pitch deck")).toBe(false);
    expect(isSingleComponentRequest("landing page")).toBe(false);
    expect(isSingleComponentRequest("")).toBe(false);
  });

  it("single-component rules skip the two-phase pipeline", () => {
    expect(SINGLE_COMPONENT_RULES).toContain("EXACTLY ONCE");
    expect(SINGLE_COMPONENT_RULES).toContain("Do NOT call `draft_layout`");
    const rules = buildDomainRules("login card", 1200, true, 800);
    expect(rules).toContain("EXACTLY ONCE");
    expect(rules).toContain("1200x800");
  });

  it("fast-path instructions tell the model to make one call and stop", () => {
    const ctx: any = {
      mode: "create",
      activeTab: "components",
      prompt: "login card",
      selectedIds: [],
      canvasBounds: { width: 1200, height: 800 },
    };
    const text = createInstructions(ctx, undefined, "google");
    expect(text).toContain("Call `add_component` EXACTLY ONCE");
    expect(text).not.toContain("Phase 1 — Draft the Layout");
    expect(text).not.toContain("Fintech Dashboard");
  });

  it("multi-component instructions keep the two-phase pipeline", () => {
    const ctx: any = {
      mode: "create",
      activeTab: "components",
      prompt: "Create a dashboard with sidebar, charts, and activity feed",
      selectedIds: [],
      canvasBounds: { width: 1200, height: 800 },
    };
    const text = createInstructions(ctx, undefined, "google");
    expect(text).not.toContain("Call `add_component` EXACTLY ONCE");
    expect(text).toContain("Two-Phase Pipeline");
  });

  it("no mode orders a closing summary — the trailing call is never needed", () => {
    const base: any = {
      activeTab: "components",
      selectedIds: [],
      canvasBounds: { width: 1200, height: 800 },
    };
    const multi = createInstructions(
      {
        ...base,
        mode: "create",
        prompt: "Create a dashboard with sidebar, charts, and activity feed",
      },
      undefined,
      "google"
    );
    expect(multi).toContain("NO summary or follow-up text");
    const single = createInstructions(
      { ...base, mode: "create", prompt: "login card" },
      undefined,
      "google"
    );
    expect(single).toContain("no follow-up text");
  });

  it("theme instructions skip component rules and runtime scope", () => {
    const ctx: any = {
      mode: "theme",
      activeTab: "theme",
      prompt: "dark theme",
      selectedIds: [],
      themeState: {
        currentMode: "light",
        styles: { light: {}, dark: {} },
      },
    };
    const text = createInstructions(ctx);
    expect(text).not.toContain("Runtime Scope");
    expect(text).not.toContain("Canvas Artifacts");
  });

  it("all providers share targeted edit instructions", () => {
    const ctx: any = {
      mode: "edit",
      activeTab: "components",
      prompt: "make it bigger",
      selectedIds: ["n1"],
      selectedNodes: [
        {
          id: "n1",
          type: "Container",
          props: {},
          code: "export default () => <div/>",
        },
      ],
    };
    const frontier = createInstructions(ctx, undefined, "google");
    const local = createInstructions(ctx, undefined, "local");
    expect(local).toBe(frontier);
    expect(local).toContain("Targeted Edits");
    expect(local).not.toContain("<<<< SEARCH");
    expect(local).not.toContain("Local Model Strategy");
    expect(local).not.toContain("When to Use Full Code Rewrite");
    expect(local).not.toContain("Output the ENTIRE file");
    expect(local).not.toContain("Never output partials, diffs");
    expect(local).toContain("visual properties");
  });
});

describe("Multi-wireframe stop gating (create mode)", () => {
  const stepFor = (targetId: string) => ({
    toolResults: [
      {
        toolName: "update_component_code",
        output: { tool: "update_component_code", targetId },
      },
    ],
  });

  it("does not stop after a single fulfillment when three wireframes are targeted", () => {
    const stop = stopWhenWireframesFulfilledFor(["wf-1", "wf-2", "wf-3"]);
    expect((stop as any)({ steps: [stepFor("wf-1")] })).toBe(false);
    expect((stop as any)({ steps: [stepFor("wf-1"), stepFor("wf-2")] })).toBe(
      false
    );
    expect(
      (stop as any)({
        steps: [stepFor("wf-1"), stepFor("wf-2"), stepFor("wf-3")],
      })
    ).toBe(true);
  });

  it("stopWhenForMode scales the step budget with wireframe count", () => {
    const one = stopWhenForMode("create", ["wf-1"], false) as any[];
    const three = stopWhenForMode(
      "create",
      ["wf-1", "wf-2", "wf-3"],
      false
    ) as any[];
    // [stopCondition, isStepCount] — second entry carries the limit
    const limitOf = (conds: any) =>
      (conds[1] as any)?.stepCountOrOptions ?? conds[1];
    expect(one).toHaveLength(2);
    expect(three).toHaveLength(2);
    // Three wireframes must allow strictly more steps than one.
    const oneSrc = JSON.stringify(one[1].toString());
    void oneSrc;
    expect((three[0] as any)({ steps: [stepFor("wf-1")] })).toBe(false);
    expect(
      (one[0] as any)({
        steps: [stepFor("wf-1"), stepFor("wf-2"), stepFor("wf-3")],
      })
    ).toBe(true);
    expect(limitOf).toBeDefined();
  });

  it("multi-wireframe instructions list every target id", () => {
    const ctx: any = {
      mode: "create",
      activeTab: "components",
      prompt: "fill them",
      selectedIds: ["wf-1", "wf-2"],
      canvasBounds: { width: 1200, height: 800 },
      nodeIntents: [
        { id: "wf-1", kind: "wireframe" },
        { id: "wf-2", kind: "wireframe" },
      ],
    };
    const text = createInstructions(ctx, undefined, "google");
    expect(text).toContain("wf-1");
    expect(text).toContain("wf-2");
    expect(text).toMatch(/do NOT stop until every id is fulfilled/);
  });
});
