// utils/transform-engine.ts
// CJS-based transformation engine.
// esbuild compiles user TSX to CommonJS, converting all import/export statements
// into require() calls and module.exports assignments automatically.

/**
 * Wraps CJS output so the sandbox can extract the default export.
 * Uses parameterized function to avoid scope pollution.
 */
export function postProcess(cjsCode: string): { code: string } {
  const wrapped = [
    "(function(module, exports) {",
    cjsCode,
    "})(module, exports);",
    "var __cjsExports = module.exports;",
    "function __isRenderableCandidate(__value) {",
    '  if (typeof __value === "function") return true;',
    '  if (!__value || typeof __value !== "object") return false;',
    '  return "$$typeof" in __value || "render" in __value || "type" in __value;',
    "}",
    'if (__cjsExports && typeof __cjsExports === "object") {',
    '  if ("default" in __cjsExports && __cjsExports.default) return __cjsExports.default;',
    "  var __keys = Object.keys(__cjsExports);",
    "  if (__keys.length === 1 && __isRenderableCandidate(__cjsExports[__keys[0]])) {",
    "    return __cjsExports[__keys[0]];",
    "  }",
    "  for (var i = 0; i < __keys.length; i += 1) {",
    "    var __key = __keys[i];",
    "    if (__isRenderableCandidate(__cjsExports[__key])) return __cjsExports[__key];",
    "  }",
    "}",
    "return __cjsExports;",
  ].join("\n");

  return {
    code: wrapped,
  };
}
