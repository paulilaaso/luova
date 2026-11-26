/**
 * Import Parser and Validator
 *
 * Parses import statements from source code, validates them against the runtime manifest,
 * and provides normalized forms or actionable error messages.
 *
 * Used in the compilation pipeline to catch import mistakes before transpilation,
 * so errors are clear and fixable rather than vague runtime failures.
 */

import { MANIFEST_INDEX, validateImport } from "@/config/runtime-manifest";

export interface ImportDeclaration {
  source: string;
  specifiers: {
    type: "default" | "named" | "namespace";
    names: string[];
  }[];
  line: number;
  column: number;
  typeOnly?: boolean;
}

export interface ImportError {
  moduleId: string;
  reason: string;
  line: number;
  column: number;
  suggestion?: string;
}

/**
 * Parse import statements from source code using a simple regex approach.
 * Returns both valid imports and errors in a single pass.
 */
export function parseImports(code: string): {
  imports: ImportDeclaration[];
  errors: ImportError[];
} {
  const imports: ImportDeclaration[] = [];
  const errors: ImportError[] = [];

  // Match import statements:
  // - import React from "react"
  // - import { Foo, Bar } from "module"
  // - import * as Mod from "module"
  // - import React, { useState } from "react"
  const importRegex =
    /^import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\}|\*\s+as\s+(\w+))?\s+from\s+["']([^"']+)["'];?/gm;

  // Process each line independently to handle indented imports
  const lines = code.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmedLine = line.trim();

    // Reset regex state for each line
    importRegex.lastIndex = 0;
    const lineMatch = importRegex.exec(trimmedLine);

    if (lineMatch) {
      // Groups: [fullMatch, defaultName, namedStr, namespaceName, moduleId]
      const defaultName = lineMatch[1];
      const namedStr = lineMatch[2];
      const namespaceName = lineMatch[3];
      const moduleId = lineMatch[4];

      const specifiers: ImportDeclaration["specifiers"] = [];

      if (defaultName) {
        specifiers.push({ type: "default", names: [defaultName] });
      }
      if (namedStr) {
        const names = namedStr
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0])
          .filter(Boolean);
        specifiers.push({ type: "named", names });
      }
      if (namespaceName) {
        specifiers.push({ type: "namespace", names: [namespaceName] });
      }

      if (specifiers.length > 0) {
        imports.push({
          source: moduleId,
          specifiers,
          line: lineNum + 1,
          column: 0,
          // esbuild strips `import type` lines, so they never hit the runtime.
          typeOnly: /^import\s+type\s/.test(trimmedLine),
        });
      }
    }
  }

  return { imports, errors };
}

/**
 * Validate imports against the runtime manifest.
 * Returns errors for unsupported or mismatched imports.
 */
export function validateImports(imports: ImportDeclaration[]): ImportError[] {
  const errors: ImportError[] = [];

  for (const imp of imports) {
    if (imp.typeOnly) continue;
    const moduleId = imp.source;

    // Determine import style from specifiers
    const _hasDefault = imp.specifiers.some((s) => s.type === "default");
    const hasNamed = imp.specifiers.some((s) => s.type === "named");
    const hasNamespace = imp.specifiers.some((s) => s.type === "namespace");

    const importStyle = hasNamespace
      ? ("namespace" as const)
      : hasNamed
        ? ("named" as const)
        : ("default" as const);

    // Validate the import
    const validation = validateImport(moduleId, importStyle);

    if (!validation.ok) {
      errors.push({
        moduleId,
        reason: validation.reason!,
        line: imp.line,
        column: imp.column,
        suggestion: buildSuggestion(moduleId, importStyle, validation.reason!),
      });
    }
  }

  return errors;
}

/**
 * Build a helpful suggestion based on the validation error.
 */
function buildSuggestion(
  moduleId: string,
  _attemptedStyle: string,
  reason: string
): string | undefined {
  // Wrong import style
  if (reason.includes("requires namespace import")) {
    return `Use: import * as Mod from "${moduleId}"`;
  }
  if (reason.includes("requires named import")) {
    return `Use: import { Component } from "${moduleId}"`;
  }
  if (reason.includes("requires default import")) {
    return `Use: import Component from "${moduleId}"`;
  }

  // Disabled module suggestions
  if (moduleId === "recharts") {
    return "Use Canvas API or SVG instead of recharts, or add recharts to config/runtime-scope.ts";
  }
  if (moduleId.startsWith("next/")) {
    return "Next.js modules are not available in the dynamic sandbox";
  }
  if (moduleId.startsWith("@/hooks/")) {
    return "Use Tailwind responsive classes or native media queries instead of hooks";
  }
  if (moduleId.startsWith("@/components/luova-ui/")) {
    return "Internal Luova UI components are not available in the sandbox. Use @radix-ui/* primitives or plain HTML instead.";
  }

  // Generic fallback — list what the sandbox provides
  return `Use one of the available modules: ${AVAILABLE_MODULES_HINT}. (To make "${moduleId}" available, add it to config/runtime-scope.ts.)`;
}

const AVAILABLE_MODULES_HINT = [
  ...new Set(
    [...MANIFEST_INDEX.supported].map((id) =>
      id.startsWith("@radix-ui/") ? "@radix-ui/react-*" : id
    )
  ),
].join(", ");

/**
 * Format import errors for display to the user.
 */
export function formatImportErrors(errors: ImportError[]): string {
  if (errors.length === 0) return "";

  const lines = errors.map((err) => {
    let msg = `Line ${err.line}: [IMPORT_ERROR] ${err.reason}`;
    if (err.suggestion) {
      msg += `\n  → Suggestion: ${err.suggestion}`;
    }
    return msg;
  });

  return lines.join("\n");
}

/**
 * Normalize imports based on manifest rules.
 * Currently mostly a validation pass—normalization for aliases would go here.
 */
export function normalizeImports(code: string): {
  normalizedCode: string;
  errors: ImportError[];
} {
  const { imports } = parseImports(code);
  const validationErrors = validateImports(imports);

  if (validationErrors.length > 0) {
    return {
      normalizedCode: code,
      errors: validationErrors,
    };
  }

  // No errors found—code is valid
  return {
    normalizedCode: code,
    errors: [],
  };
}
