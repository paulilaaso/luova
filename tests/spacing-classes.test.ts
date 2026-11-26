import { describe, expect, it } from "vitest";
import {
  applySpacingEdit,
  buildSpacingClasses,
  parseSpacing,
} from "@/utils/spacing-classes";
import { spacingToken } from "@/utils/tailwind-mapping";

const ZERO = { top: true, right: true, bottom: true, left: true };
const NONE = { top: false, right: false, bottom: false, left: false };

describe("parseSpacing", () => {
  it("lets a side beat its axis and the shorthand, in any order", () => {
    expect(parseSpacing(["pt-0", "py-4", "p-2"], "p")).toEqual({
      top: "0",
      right: "2",
      bottom: "4",
      left: "2",
    });
  });

  it("ignores variants and keeps negative margins", () => {
    expect(parseSpacing(["md:mt-4", "-mt-2", "mx-auto"], "m")).toEqual({
      top: "-2",
      right: "auto",
      bottom: null,
      left: "auto",
    });
  });
});

describe("buildSpacingClasses", () => {
  it("uses the shortest form", () => {
    const all = { top: "4", right: "4", bottom: "4", left: "4" };
    expect(buildSpacingClasses(all, "p")).toEqual(["p-4"]);
    expect(
      buildSpacingClasses({ top: "4", right: "2", bottom: "4", left: "2" }, "p")
    ).toEqual(["px-2", "py-4"]);
    expect(
      buildSpacingClasses(
        { top: "[3px]", right: null, bottom: "4", left: "-2" },
        "m"
      )
    ).toEqual(["mt-[3px]", "mb-4", "-ml-2"]);
  });
});

describe("applySpacingEdit", () => {
  it("collapses py-4 + top/bottom edits instead of piling up classes", () => {
    const classes = ["font-mono", "py-4", "text-base"];
    // Top to 0, then bottom to 0, on an element whose natural padding is 0.
    const first = applySpacingEdit(classes, "p", ["top"], "0", ZERO);
    expect(first).toEqual({ remove: ["py-4"], add: ["pb-4"] });
    const second = applySpacingEdit(
      ["font-mono", "text-base", "pb-4"],
      "p",
      ["bottom"],
      "0",
      ZERO
    );
    expect(second).toEqual({ remove: ["pb-4"], add: [] });
  });

  it("keeps an explicit 0 when the element isn't naturally 0", () => {
    expect(applySpacingEdit(["py-4"], "p", ["top"], "0", NONE)).toEqual({
      remove: ["py-4"],
      add: ["pt-0", "pb-4"],
    });
  });

  it("merges sides back into an axis or shorthand", () => {
    expect(
      applySpacingEdit(["px-4", "pt-4", "pb-2"], "p", ["bottom"], "4", NONE)
    ).toEqual({ remove: ["px-4", "pt-4", "pb-2"], add: ["p-4"] });
  });

  it("changes nothing when the value is already written that way", () => {
    expect(applySpacingEdit(["p-4"], "p", ["top"], "4", NONE)).toEqual({
      remove: [],
      add: [],
    });
  });
});

describe("spacingToken", () => {
  it("uses scale steps when exact, arbitrary values otherwise", () => {
    expect(spacingToken(16)).toBe("4");
    expect(spacingToken(1)).toBe("px");
    expect(spacingToken(3)).toBe("[3px]");
  });
});
