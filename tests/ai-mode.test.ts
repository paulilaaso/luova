import { describe, expect, it } from "vitest";
import {
  canSubmitWithoutPrompt,
  detectAiMode,
  getArmedSelectionIds,
} from "@/lib/ai/mode";

describe("detectAiMode", () => {
  it("returns theme mode when theme tab is active", () => {
    expect(detectAiMode([], "theme", {})).toBe("theme");
    expect(detectAiMode(["a", "b"], "theme", {})).toBe("theme");
  });

  it("returns create mode when nothing is selected", () => {
    expect(detectAiMode([], "components", {})).toBe("create");
  });

  it("returns edit mode for single selection", () => {
    expect(detectAiMode(["a"], "components", {})).toBe("edit");
  });

  it("returns bake mode for multi selection", () => {
    expect(detectAiMode(["a", "b"], "code", {})).toBe("bake");
  });

  describe("wireframe-aware selection", () => {
    const nodes = {
      wf1: { kind: "wireframe" },
      wf2: { kind: "wireframe" },
      el1: { kind: "generated" },
    } as Record<string, { kind?: string }>;

    it("returns create for wireframe-only selection (single or multi)", () => {
      expect(detectAiMode(["wf1"], "components", nodes)).toBe("create");
      expect(detectAiMode(["wf1", "wf2"], "components", nodes)).toBe("create");
    });

    it("returns bake for mixed wireframe + element selection", () => {
      expect(detectAiMode(["wf1", "el1"], "components", nodes)).toBe("bake");
      expect(detectAiMode(["el1", "wf1", "wf2"], "code", nodes)).toBe("bake");
    });

    it("returns edit for a single element", () => {
      expect(detectAiMode(["el1"], "components", nodes)).toBe("edit");
    });

    it("returns bake for multiple elements", () => {
      expect(
        detectAiMode(["el1", "el2"], "components", {
          ...nodes,
          el2: { kind: "generated" },
        })
      ).toBe("bake");
    });
  });
});

describe("canSubmitWithoutPrompt", () => {
  const nodes = {
    wf1: { kind: "wireframe" },
    el1: { kind: "generated" },
    el2: { kind: "generated" },
    cap1: { kind: "captured", comment: "make it red" },
    cap2: { kind: "captured", comment: "" },
  } as Record<string, { kind?: string; comment?: string }>;

  it("allows bake of selected components with no prompt", () => {
    expect(canSubmitWithoutPrompt("bake", ["el1", "el2"], nodes)).toBe(true);
  });

  it("allows empty-prompt submit with selected wireframes", () => {
    expect(canSubmitWithoutPrompt("create", ["wf1"], nodes)).toBe(true);
  });

  it("allows empty-prompt submit with commented captured intents", () => {
    expect(canSubmitWithoutPrompt("edit", ["el1"], nodes)).toBe(true);
  });

  it("blocks empty-prompt create with no selection", () => {
    const bare = {
      el1: { kind: "generated" },
    } as Record<string, { kind?: string; comment?: string }>;
    expect(canSubmitWithoutPrompt("create", [], bare)).toBe(false);
  });

  it("blocks empty-prompt edit of a plain component", () => {
    const bare = {
      el1: { kind: "generated" },
    } as Record<string, { kind?: string; comment?: string }>;
    expect(canSubmitWithoutPrompt("edit", ["el1"], bare)).toBe(false);
  });

  it("never allows prompt-less submit in theme mode", () => {
    expect(canSubmitWithoutPrompt("theme", ["el1", "el2"], nodes)).toBe(false);
  });
});

describe("getArmedSelectionIds", () => {
  const nodes = {
    fresh: { kind: "wireframe" },
    fresh2: { kind: "wireframe" },
    used: { kind: "wireframe", usedInCreation: true },
    card: { kind: "generated" },
  };

  it("arms every fresh wireframe in create mode with nothing selected", () => {
    expect(getArmedSelectionIds("create", [], nodes)).toEqual([
      "fresh",
      "fresh2",
    ]);
  });

  it("limits Create to exactly the selected wireframes", () => {
    expect(getArmedSelectionIds("create", ["fresh2"], nodes)).toEqual([
      "fresh2",
    ]);
  });

  it("arms used wireframes only while selected", () => {
    expect(getArmedSelectionIds("create", ["used"], nodes)).toEqual(["used"]);
  });

  it("leaves other modes' selection untouched", () => {
    expect(getArmedSelectionIds("edit", ["card"], nodes)).toEqual(["card"]);
    expect(getArmedSelectionIds("bake", [], nodes)).toEqual([]);
  });

  it("lets fresh wireframes arm a prompt-less Create", () => {
    const armed = getArmedSelectionIds("create", [], nodes);
    expect(canSubmitWithoutPrompt("create", armed, nodes)).toBe(true);
    const usedOnly = { used: nodes.used };
    expect(
      canSubmitWithoutPrompt(
        "create",
        getArmedSelectionIds("create", [], usedOnly),
        usedOnly
      )
    ).toBe(false);
  });
});
