/**
 * Export Shape Validator
 *
 * Validates that imported symbols actually exist in their source modules.
 * This catches errors like:
 * - Importing a named export that doesn't exist
 * - Using default import when there are only named exports
 * - Importing properties that don't exist
 *
 * Used after compilation but before rendering, so errors are clear.
 */

import { RUNTIME_SCOPE } from "@/config/runtime-scope";
import { parseImports } from "./parse-imports";

export interface ExportError {
  moduleId: string;
  importType: "default" | "named" | "namespace";
  symbol: string;
  reason: string;
  suggestion?: string;
  line: number;
}

/**
 * Validate that all imported symbols exist in their source modules.
 */
export function validateExports(code: string): {
  isValid: boolean;
  errors: ExportError[];
} {
  const { imports } = parseImports(code);
  const errors: ExportError[] = [];

  for (const imp of imports) {
    // Skip validation for path aliases (e.g. @/lib/utils) — these are resolved at build time
    if (imp.source.startsWith("@/")) {
      continue;
    }

    // Skip validation for namespace imports — namespaces are resolved dynamically
    const isNamespace = imp.specifiers.some((s) => s.type === "namespace");
    if (isNamespace) {
      continue;
    }

    const module = RUNTIME_SCOPE[imp.source as keyof typeof RUNTIME_SCOPE];

    if (!module) {
      // Module not in runtime scope — point user to config
      errors.push({
        moduleId: imp.source,
        importType: "named",
        symbol: imp.source,
        reason: `Module "${imp.source}" is not in the runtime scope.`,
        suggestion: `Add "${imp.source}" to config/runtime-scope.ts to make it available.`,
        line: imp.line,
      });
      continue;
    }

    // Validate each imported symbol
    for (const specifier of imp.specifiers) {
      if (specifier.type === "default") {
        // Default import — check if module has a default export
        // Most of our modules are namespaces, not default exports
        // But React and framer-motion support both
        if (
          imp.source !== "react" &&
          imp.source !== "framer-motion" &&
          imp.source !== "@/lib/utils"
        ) {
          // These are namespace-style modules
          errors.push({
            moduleId: imp.source,
            importType: "default",
            symbol: specifier.names[0],
            reason: `Module "${imp.source}" does not have a default export.`,
            suggestion: `Use named or namespace import instead.`,
            line: imp.line,
          });
        }
      } else if (specifier.type === "named") {
        // Named imports — check if all symbols exist
        for (const symbol of specifier.names) {
          if (!module[symbol]) {
            errors.push({
              moduleId: imp.source,
              importType: "named",
              symbol,
              reason: `Named export "${symbol}" not found in "${imp.source}".`,
              suggestion: buildExportSuggestion(imp.source, symbol, module),
              line: imp.line,
            });
          }
        }
      } else if (specifier.type === "namespace") {
        // Namespace imports are generally safe — the namespace itself exists
        // But validate that if the code later accesses properties, those exist
        // This is harder to do statically, so we skip for now
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Build a helpful suggestion for a missing export.
 */
function buildExportSuggestion(
  moduleId: string,
  symbol: string,
  module: any
): string | undefined {
  // Find similar exports (case-insensitive)
  const available = Object.keys(module).filter(
    (k) => typeof module[k] !== "undefined"
  );
  if (available.length === 0) return undefined;

  const similar = available.find(
    (k) => k.toLowerCase() === symbol.toLowerCase()
  );
  if (similar) {
    return `Did you mean: import { ${similar} } from "${moduleId}"`;
  }

  // For lucide-react, give icon examples
  if (moduleId === "lucide-react" && available.length > 0) {
    return `Available icons include: ${available.slice(0, 5).join(", ")} and more.`;
  }

  return undefined;
}

/**
 * Format export errors for display.
 */
export function formatExportErrors(errors: ExportError[]): string {
  if (errors.length === 0) return "";

  const lines = errors.map((err) => {
    let msg = `Line ${err.line}: [EXPORT_ERROR] ${err.reason}`;
    if (err.suggestion) {
      msg += `\n  → ${err.suggestion}`;
    }
    return msg;
  });

  return lines.join("\n");
}
