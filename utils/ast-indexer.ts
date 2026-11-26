/**
 * AST Indexer
 *
 * Injects deterministic data-ast-index attributes into JSX elements at compile time.
 * This enables 100% deterministic element identification without fragile CSS paths.
 *
 * Works with React.map(), conditional rendering, and dynamic expressions naturally.
 *
 * Structural drift recovery: when an astIndex no longer resolves (because the AI
 * wrapped/unwrapped elements), `findElementByFingerprint` attempts to re-locate the
 * element by matching its tag name and ancestor chain.
 */

import * as ts from "typescript";

/**
 * Inject data-ast-index attributes into JSX elements in the source code.
 * Returns the modified source code.
 */
export function injectAstIndices(sourceCode: string): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const edits: Array<{
    pos: number;
    text: string;
  }> = [];

  let index = 0;

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText();
      if (tagName !== "Fragment" && tagName !== "React.Fragment") {
        // Insert data-ast-index attribute after the tag name
        const tagEnd = node.tagName.getEnd();
        edits.push({
          pos: tagEnd,
          text: ` data-ast-index="${index}"`,
        });
        index++;
      }
    } else if (ts.isJsxFragment(node)) {
      // Skip fragment nodes but still traverse their children
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Apply edits in reverse order to preserve positions
  edits.sort((a, b) => b.pos - a.pos);

  let result = sourceCode;
  for (const edit of edits) {
    result = result.slice(0, edit.pos) + edit.text + result.slice(edit.pos);
  }

  return result;
}

/**
 * Collect the ast-indices of every JSX element nested inside the element at
 * `targetIndex` (its full subtree, excluding the element itself).
 *
 * Used by block-level typography edits so that setting e.g. a font size on a
 * text block also removes the conflicting per-run classes nested inside it,
 * matching "apply to the whole block".
 */
export function getDescendantAstIndices(
  sourceCode: string,
  targetIndex: number
): number[] {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const indexByNode = new Map<ts.Node, number>();
  const elements: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  let index = 0;

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (tagName !== "Fragment" && tagName !== "React.Fragment") {
        indexByNode.set(node, index);
        elements.push(node as ts.JsxOpeningElement | ts.JsxSelfClosingElement);
        index++;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const target = elements[targetIndex];
  if (!target || !ts.isJsxOpeningElement(target)) return [];
  const container = target.parent;
  if (!ts.isJsxElement(container) && !ts.isJsxFragment(container)) return [];

  const descendants = new Set<number>();
  function collect(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const found = indexByNode.get(node);
      if (found !== undefined) descendants.add(found);
    }
    ts.forEachChild(node, collect);
  }

  for (const child of container.children) collect(child);
  descendants.delete(targetIndex);
  return Array.from(descendants).sort((a, b) => a - b);
}

/**
 * Find a JSX element by its AST index in the source code.
 * Returns the element node or null if not found.
 */
export function findElementByAstIndex(
  sourceCode: string,
  targetIndex: number
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  let index = 0;
  let found: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;

  function visit(node: ts.Node): void {
    if (found) return; // Short-circuit once found
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText();
      if (tagName !== "Fragment" && tagName !== "React.Fragment") {
        if (index === targetIndex) {
          found = node as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
          return;
        }
        index++;
      }
    } else if (ts.isJsxFragment(node)) {
      // Skip fragment nodes but still traverse their children
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

// ─── Structural fingerprinting ────────────────────────────────────────────────

/**
 * Build a structural fingerprint for a JSX element: a "/"-joined chain of tag
 * names from the root down to (and including) the element itself.
 *
 * Example: a <button> inside a <div> inside a <nav> → "nav/div/button"
 *
 * Only JSX opening/self-closing elements (not Fragments) are counted.
 * This is intentionally coarse — it is used as a fallback when the numeric
 * astIndex no longer resolves after structural edits.
 */
function buildFingerprint(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): string {
  const chain: string[] = [];
  let current: ts.Node = node;
  while (current) {
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      const tag = current.tagName.getText(sourceFile);
      if (tag !== "Fragment" && tag !== "React.Fragment") {
        chain.unshift(tag);
      }
    }
    current = current.parent;
  }
  return chain.join("/");
}

/**
 * Compute the fingerprint for the element at a given astIndex.
 * Returns an empty string if the index is out of range.
 */
export function computeElementFingerprint(
  sourceCode: string,
  astIndex: number
): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  let index = 0;
  let fingerprint = "";

  function visit(node: ts.Node): void {
    if (fingerprint) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (tagName !== "Fragment" && tagName !== "React.Fragment") {
        if (index === astIndex) {
          fingerprint = buildFingerprint(
            node as ts.JsxOpeningElement | ts.JsxSelfClosingElement,
            sourceFile
          );
          return;
        }
        index++;
      }
    } else if (ts.isJsxFragment(node)) {
      // Skip fragment nodes but still traverse their children
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return fingerprint;
}

/**
 * Attempt to find a JSX element by structural fingerprint when the numeric
 * astIndex no longer resolves (structural drift recovery).
 *
 * Strategy:
 *  1. Collect all JSX elements with their fingerprints.
 *  2. Find the element whose fingerprint exactly matches `targetFingerprint`.
 *  3. If multiple elements share the same fingerprint (e.g. repeated list items),
 *     return the first one — this is a best-effort recovery.
 *
 * Returns the element node and its new astIndex, or null if no match.
 */
export function findElementByFingerprint(
  sourceCode: string,
  targetFingerprint: string
): {
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  newIndex: number;
} | null {
  if (!targetFingerprint) return null;

  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  let index = 0;
  let result: {
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
    newIndex: number;
  } | null = null;

  function visit(node: ts.Node): void {
    if (result) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (tagName !== "Fragment" && tagName !== "React.Fragment") {
        const fp = buildFingerprint(
          node as ts.JsxOpeningElement | ts.JsxSelfClosingElement,
          sourceFile
        );
        if (fp === targetFingerprint) {
          result = {
            node: node as ts.JsxOpeningElement | ts.JsxSelfClosingElement,
            newIndex: index,
          };
          return;
        }
        index++;
      }
    } else if (ts.isJsxFragment(node)) {
      // Skip fragment nodes but still traverse their children
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}
