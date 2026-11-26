import { describe, expect, it } from "vitest";
import { postProcess } from "@/utils/transform-engine";

describe("transform-engine: postProcess", () => {
  it("wraps CJS output and returns module.exports.default when present", () => {
    const input = `
            exports.default = function Demo() { return "ok"; };
        `;

    const { code } = postProcess(input);
    const moduleMock = { exports: {} };
    const factory = new Function("module", "exports", code);
    const result = factory(moduleMock, moduleMock.exports);

    expect(typeof result).toBe("function");
    expect(result()).toBe("ok");
  });

  it("returns module.exports when default export is missing", () => {
    const input = `
            module.exports = function Demo() { return "ok"; };
        `;

    const { code } = postProcess(input);
    const moduleMock = { exports: {} };
    const factory = new Function("module", "exports", code);
    const result = factory(moduleMock, moduleMock.exports);

    expect(typeof result).toBe("function");
    expect(result()).toBe("ok");
  });

  it("returns the first named function export when only named exports exist", () => {
    const input = `
            module.exports = { Demo: function Demo() { return "ok"; } };
        `;

    const { code } = postProcess(input);
    const moduleMock = { exports: {} };
    const factory = new Function("module", "exports", code);
    const result = factory(moduleMock, moduleMock.exports);

    expect(typeof result).toBe("function");
    expect(result()).toBe("ok");
  });

  it("returns a named forwardRef-style component object", () => {
    const component = {
      $$typeof: Symbol.for("react.forward_ref"),
      render() {},
    };
    const input = `
            module.exports = { Demo: component };
        `;

    const { code } = postProcess(input);
    const moduleMock = { exports: {} };
    const factory = new Function("module", "exports", "component", code);
    const result = factory(moduleMock, moduleMock.exports, component);

    expect(result).toBe(component);
  });
});
