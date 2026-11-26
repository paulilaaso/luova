/**
 * AST Modifier v2 — Deterministic Edition
 *
 * Uses ast-index to locate and modify JSX elements with 100% accuracy.
 * No more text fingerprinting, nth-child selectors, or fragile heuristics.
 *
 * Instead: click element → read data-ast-index → update that exact JSX node
 *
 * Structural drift recovery: when an astIndex no longer resolves (because the AI
 * wrapped/unwrapped elements), callers can pass an optional `elementFingerprint`
 * to attempt re-location via `findElementByFingerprint`.
 */

import { twMerge } from "tailwind-merge";
import * as ts from "typescript";
import { findElementByAstIndex, findElementByFingerprint } from "./ast-indexer";
import { getBorderWidthFromClasses } from "./tailwind-mapping";

// ─── Surgical Edit ────────────────────────────────────────────────────────────

interface SurgicalEdit {
  start: number;
  end: number;
  replacement: string;
}

function applySurgicalEdits(source: string, edits: SurgicalEdit[]): string {
  if (edits.length === 0) return source;

  // Group insertions at the same position so order is preserved
  const groups = new Map<number, { end: number; parts: string[] }>();
  const nonInsertions: SurgicalEdit[] = [];

  for (const edit of edits) {
    if (edit.start === edit.end) {
      const g = groups.get(edit.start);
      if (g) {
        g.parts.push(edit.replacement);
      } else {
        groups.set(edit.start, { end: edit.end, parts: [edit.replacement] });
      }
    } else {
      nonInsertions.push(edit);
    }
  }

  for (const [start, { end, parts }] of groups) {
    nonInsertions.push({ start, end, replacement: parts.join("") });
  }

  // Sort descending by start so that later (rightmost) edits are applied first,
  // preventing position shifts from affecting earlier (leftmost) edits.
  nonInsertions.sort((a, b) => b.start - a.start);

  let result = source;
  for (const edit of nonInsertions) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

// ─── Identification Helpers ──────────────────────────────────────────────────

/**
 * Resolve a JSX element by astIndex, with optional fingerprint-based fallback.
 *
 * When the source code has been structurally modified (e.g. the AI wrapped a
 * <div> in a <section>), the numeric astIndex may point to the wrong element or
 * be out of range entirely.  If `elementFingerprint` is provided and the direct
 * lookup fails, we attempt to re-locate the element by its ancestor-tag chain.
 *
 * Returns `{ node, resolvedIndex }` where `resolvedIndex` is the index that
 * actually resolved (may differ from `astIndex` after drift recovery).
 */
function resolveElement(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): {
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  resolvedIndex: number;
} | null {
  const direct = findElementByAstIndex(sourceCode, astIndex);
  if (direct) return { node: direct, resolvedIndex: astIndex };

  if (elementFingerprint) {
    const recovered = findElementByFingerprint(sourceCode, elementFingerprint);
    if (recovered) {
      return { node: recovered.node, resolvedIndex: recovered.newIndex };
    }
  }

  return null;
}

// ─── Task 1: Safe className extraction ────────────────────────────────────────

const CLASS_UTILITY_FNS = new Set(["cn", "clsx", "twMerge"]);

function extractStringLiteralsFromCallExpression(
  expr: ts.Expression | undefined,
  sourceFile: ts.SourceFile
): string[] {
  if (!expr) return [];
  if (!ts.isCallExpression(expr)) return [];

  const calleeText = expr.expression.getText(sourceFile);
  if (!CLASS_UTILITY_FNS.has(calleeText)) return [];

  const classes: string[] = [];
  for (const arg of expr.arguments) {
    if (ts.isStringLiteral(arg)) {
      classes.push(...arg.text.split(/\s+/).filter(Boolean));
    }
  }
  return classes;
}

function getExistingClasses(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): string[] {
  const attr = el.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText(sourceFile) === "className"
  );
  if (!attr?.initializer) return [];

  if (ts.isStringLiteral(attr.initializer)) {
    return attr.initializer.text.split(/\s+/).filter(Boolean);
  }

  if (ts.isNoSubstitutionTemplateLiteral(attr.initializer)) {
    const lit = attr.initializer as ts.NoSubstitutionTemplateLiteral;
    return lit.text.split(/\s+/).filter(Boolean);
  }

  if (ts.isJsxExpression(attr.initializer)) {
    const inner = attr.initializer.expression;
    if (inner) {
      if (ts.isNoSubstitutionTemplateLiteral(inner)) {
        return inner.text.split(/\s+/).filter(Boolean);
      }
      if (ts.isCallExpression(inner)) {
        return extractStringLiteralsFromCallExpression(inner, sourceFile);
      }
    }
  }

  return [];
}

// ─── className info (Task 1+2) ────────────────────────────────────────────────

type ClassInitializerKind =
  | "string"
  | "template"
  | "cn-call"
  | "other-expression"
  | "none";

interface ClassNameInfo {
  attr: ts.JsxAttribute;
  existingClasses: string[];
  initializerKind: ClassInitializerKind;
  callExpression?: ts.CallExpression;
  jsxExpression?: ts.JsxExpression;
}

function getClassNameInfo(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): ClassNameInfo | null {
  for (const attr of el.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (!ts.isIdentifier(attr.name) || attr.name.text !== "className") continue;

    if (!attr.initializer)
      return { attr, existingClasses: [], initializerKind: "none" };

    if (ts.isStringLiteral(attr.initializer)) {
      return {
        attr,
        existingClasses: attr.initializer.text.split(/\s+/).filter(Boolean),
        initializerKind: "string",
      };
    }

    if (ts.isNoSubstitutionTemplateLiteral(attr.initializer)) {
      const lit = attr.initializer as ts.NoSubstitutionTemplateLiteral;
      return {
        attr,
        existingClasses: lit.text.split(/\s+/).filter(Boolean),
        initializerKind: "template",
      };
    }

    if (ts.isJsxExpression(attr.initializer)) {
      const expr = attr.initializer.expression;
      if (expr) {
        if (ts.isNoSubstitutionTemplateLiteral(expr)) {
          return {
            attr,
            existingClasses: expr.text.split(/\s+/).filter(Boolean),
            initializerKind: "template",
            jsxExpression: attr.initializer,
          };
        }
        if (ts.isCallExpression(expr)) {
          const calleeText = expr.expression.getText(sourceFile);
          if (CLASS_UTILITY_FNS.has(calleeText)) {
            const classes: string[] = [];
            for (const arg of expr.arguments) {
              if (ts.isStringLiteral(arg)) {
                classes.push(...arg.text.split(/\s+/).filter(Boolean));
              }
            }
            return {
              attr,
              existingClasses: classes,
              initializerKind: "cn-call",
              callExpression: expr,
              jsxExpression: attr.initializer,
            };
          }
        }
      }
      return {
        attr,
        existingClasses: [],
        initializerKind: "other-expression",
        jsxExpression: attr.initializer,
      };
    }

    return { attr, existingClasses: [], initializerKind: "none" };
  }
  return null;
}

// ─── Task 2: Non-destructive class name rewriting ─────────────────────────────

function rewriteCnCallExpression(
  source: string,
  sourceFile: ts.SourceFile,
  classInfo: ClassNameInfo,
  mergedClasses: string[]
): string {
  const callExpr = classInfo.callExpression!;
  const existingCnClasses = new Set(classInfo.existingClasses);
  const newClassSet = new Set(mergedClasses);

  const removedClasses = [...existingCnClasses].filter(
    (c) => !newClassSet.has(c)
  );
  const addedClasses = [...newClassSet].filter(
    (c) => !existingCnClasses.has(c)
  );

  const newArgs: string[] = [];

  for (const arg of callExpr.arguments) {
    if (ts.isStringLiteral(arg)) {
      const argClasses = arg.text.split(/\s+/).filter(Boolean);
      const filtered = argClasses.filter((c) => !removedClasses.includes(c));
      if (filtered.length > 0) {
        newArgs.push(`"${filtered.join(" ")}"`);
      }
    } else {
      newArgs.push(arg.getText(sourceFile));
    }
  }

  if (addedClasses.length > 0) {
    newArgs.push(`"${addedClasses.join(" ")}"`);
  }

  if (newArgs.length === 0) {
    const info = classInfo.jsxExpression ?? classInfo.attr;
    const start = info.getStart(sourceFile);
    const end = info.getEnd();
    return `${source.slice(0, start)}"${mergedClasses.join(" ")}"${source.slice(end)}`;
  }

  const calleeText = callExpr.expression.getText(sourceFile);
  const newCallText = `${calleeText}(${newArgs.join(", ")})`;

  if (classInfo.jsxExpression) {
    const exprStart = classInfo.jsxExpression.getStart(sourceFile);
    const exprEnd = classInfo.jsxExpression.getEnd();
    return `${source.slice(0, exprStart)}{${newCallText}}${source.slice(exprEnd)}`;
  }

  const callStart = callExpr.getStart(sourceFile);
  const callEnd = callExpr.getEnd();
  return `${source.slice(0, callStart)}${newCallText}${source.slice(callEnd)}`;
}

function rewriteClassName(
  source: string,
  sourceFile: ts.SourceFile,
  attr: ts.JsxAttribute,
  newClasses: string[],
  classInfo?: ClassNameInfo
): string {
  const classStr = newClasses.join(" ");

  if (!attr.initializer) {
    if (newClasses.length === 0) return source;
    const pos = attr.getEnd();
    return `${source.slice(0, pos)}="${classStr}"${source.slice(pos)}`;
  }

  if (classInfo?.initializerKind === "cn-call" && classInfo.callExpression) {
    return rewriteCnCallExpression(source, sourceFile, classInfo, newClasses);
  }

  if (
    classInfo?.initializerKind === "other-expression" &&
    classInfo.jsxExpression
  ) {
    const innerText =
      classInfo.jsxExpression.expression?.getText(sourceFile) ?? "";
    const start = classInfo.jsxExpression.getStart(sourceFile);
    const end = classInfo.jsxExpression.getEnd();
    return `${source.slice(0, start)}{cn(${innerText}, "${classStr}")}${source.slice(end)}`;
  }

  if (newClasses.length === 0) {
    // Nothing remains for this element — drop the empty attribute (with its
    // leading whitespace) instead of leaving a dangling `className=""`.
    return `${source.slice(0, attr.getFullStart())}${source.slice(attr.getEnd())}`;
  }

  const start = attr.initializer.getStart(sourceFile);
  const end = attr.initializer.getEnd();
  return `${source.slice(0, start)}"${classStr}"${source.slice(end)}`;
}

function ensureCnImportIfNeeded(
  source: string,
  classInfo: ClassNameInfo | null
): string {
  if (
    classInfo?.initializerKind !== "other-expression" ||
    !source.includes("cn(") ||
    /\bimport\s+\{[^}]*\bcn\b[^}]*\}\s+from/.test(source)
  ) {
    return source;
  }

  return `import { cn } from "@/lib/utils";\n${source}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Update className on a JSX element identified by ast-index.
 * This is the new, deterministic way to modify elements.
 *
 * @param sourceCode The original source code
 * @param astIndex The data-ast-index value from the DOM
 * @param classesToAdd Classes to add
 * @param classesToRemove Classes to remove
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns Modified source code
 */
export function updateJsxClassNameByAstIndex(
  sourceCode: string,
  astIndex: number,
  classesToAdd: string[],
  classesToRemove: string[],
  elementFingerprint?: string
): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;
  const target = resolved.node;

  const classInfo = getClassNameInfo(target, sourceFile);
  const existingClasses: string[] = classInfo?.existingClasses ?? [];

  const filtered = existingClasses.filter(
    (cls) => !classesToRemove.some((r) => cls === r)
  );

  const allClasses = [...filtered, ...classesToAdd];

  const simpleFonts: string[] = [];
  const arbitraryFonts: string[] = [];
  const otherClasses: string[] = [];

  for (const cls of allClasses) {
    if (cls.startsWith("font-[") && cls.endsWith("]")) {
      arbitraryFonts.push(cls);
    } else if (cls.startsWith("font-")) {
      simpleFonts.push(cls);
    } else {
      otherClasses.push(cls);
    }
  }

  const mergedString = twMerge([...simpleFonts, ...otherClasses].join(" "));
  const mergedOther = mergedString.split(/\s+/).filter(Boolean);
  const merged = [...mergedOther, ...arbitraryFonts];

  if (classInfo) {
    const result = rewriteClassName(
      sourceCode,
      sourceFile,
      classInfo.attr,
      merged,
      classInfo
    );
    return ensureCnImportIfNeeded(result, classInfo);
  }

  if (merged.length === 0) return sourceCode;

  const tagEnd = target.tagName.getEnd();
  const classStr = merged.join(" ");
  return (
    sourceCode.slice(0, tagEnd) +
    ` className="${classStr}"` +
    sourceCode.slice(tagEnd)
  );
}

/**
 * Remove a JSX element identified by ast-index from the source code.
 *
 * @param sourceCode The original source code
 * @param astIndex The data-ast-index value from the DOM
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns Modified source code with the element removed
 */
export function removeJsxElementByAstIndex(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;
  const target = resolved.node;

  let nodeToRemove: ts.Node = target;
  if (ts.isJsxOpeningElement(target)) {
    if (ts.isJsxElement(target.parent)) {
      nodeToRemove = target.parent;
    }
  }

  const start = nodeToRemove.getStart(sourceFile);
  const end = nodeToRemove.getEnd();

  return sourceCode.slice(0, start) + sourceCode.slice(end);
}

/**
 * Extract className from a JSX element identified by ast-index.
 *
 * @param sourceCode The original source code
 * @param astIndex The data-ast-index value from the DOM
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns Array of class names
 */
export function extractJsxClassNamesByAstIndex(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): string[] {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return [];

  return getExistingClasses(resolved.node, sourceFile);
}

/**
 * Extract inline style from a JSX element identified by ast-index.
 *
 * @param sourceCode The original source code
 * @param astIndex The data-ast-index value from the DOM
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns The style attribute value, or empty string if not present
 */
export function extractJsxStyleByAstIndex(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return "";

  return getExistingStyle(resolved.node, sourceFile);
}

/**
 * The element's inline style as camelCase declarations with static values
 * (string literal text, or the raw source text of other expressions).
 * Spreads like `{...box(...)}` are skipped.
 */
export function extractJsxInlineStyleByAstIndex(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): Record<string, string> {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return {};
  const attr = getStyleAttribute(resolved.node, sourceFile);
  if (!attr?.initializer) return {};
  if (ts.isStringLiteral(attr.initializer)) {
    return parseCSSStyleString(attr.initializer.text);
  }
  return getStyleObjectInfo(attr, sourceFile)?.staticDeclarations ?? {};
}

// ─── Inline style attribute handling ──────────────────────────────────────────

function getStyleAttribute(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText(sourceFile) === "style"
  );
}

/** Strips `as`, `satisfies` and parentheses around an expression. */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Finds the object literal a style identifier refers to, by looking for a
 * `const name = {...}` in each block enclosing the element.
 */
function findStyleConstant(identifier: ts.Identifier): {
  object: ts.ObjectLiteralExpression;
  statement: ts.VariableStatement;
} | null {
  for (let node: ts.Node = identifier; node; node = node.parent) {
    if (!(ts.isBlock(node) || ts.isSourceFile(node))) continue;
    for (const statement of node.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (decl.name.text !== identifier.text || !decl.initializer) continue;
        const object = unwrapExpression(decl.initializer);
        return ts.isObjectLiteralExpression(object)
          ? { object, statement }
          : null;
      }
    }
  }
  return null;
}

function countIdentifier(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name) count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/**
 * Makes a style given as an expression editable. After a bake, styles are
 * often hoisted into constants (`style={surface}`). When the constant is an
 * object literal in the same file, its properties are copied inline, so every
 * value (e.g. both light and dark gradients) stays visible to the writers; the
 * constant is dropped if nothing else uses it. Any other expression is spread
 * (`style={{...expr}}`) so new properties can override it.
 */
function inlineStyleExpression(
  sourceCode: string,
  astIndex: number,
  elementFingerprint?: string
): string {
  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;
  const sourceFile = resolved.node.getSourceFile();
  const attr = getStyleAttribute(resolved.node, sourceFile);
  const init = attr?.initializer;
  if (!(init && ts.isJsxExpression(init) && init.expression)) {
    return sourceCode;
  }
  const expr = init.expression;
  if (ts.isObjectLiteralExpression(expr)) return sourceCode;
  const start = expr.getStart(sourceFile);
  const end = expr.getEnd();

  const constant = ts.isIdentifier(expr) ? findStyleConstant(expr) : null;
  if (!constant) {
    return `${sourceCode.slice(0, start)}{...${sourceCode.slice(start, end)}}${sourceCode.slice(end)}`;
  }

  const objectText = constant.object.getText(sourceFile);
  let result = `${sourceCode.slice(0, start)}${objectText}${sourceCode.slice(end)}`;
  const { statement } = constant;
  const removable =
    statement.declarationList.declarations.length === 1 &&
    statement.getEnd() <= start &&
    countIdentifier(sourceFile, (expr as ts.Identifier).text) === 2;
  if (removable) {
    let from = statement.getStart(sourceFile);
    let to = statement.getEnd();
    // Take the statement's own line with it.
    while (from > 0 && /[ \t]/.test(result[from - 1])) from--;
    if (result[to] === "\n") to++;
    result = result.slice(0, from) + result.slice(to);
  }
  return result;
}

function parseCSSStyleString(style: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && value) declarations[cssPropertyToCamelCase(key)] = value;
  }
  return declarations;
}

function getExistingStyle(
  el: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): string {
  const attr = getStyleAttribute(el, sourceFile);
  if (!attr?.initializer) return "";

  if (ts.isStringLiteral(attr.initializer)) {
    return attr.initializer.text;
  }

  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    return attr.initializer.expression.getText(sourceFile);
  }

  return "";
}

/**
 * Convert CSS property names (kebab-case) to camelCase for React style objects.
 * e.g., "box-shadow" → "boxShadow", "background-color" → "backgroundColor"
 */
function cssPropertyToCamelCase(cssProperty: string): string {
  if (cssProperty.startsWith("--")) return cssProperty;
  return cssProperty.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

// ─── Task 3: Position-tracked style object info ───────────────────────────────

type TrackedStylePropertyKind = "property" | "shorthand" | "spread";

interface TrackedStyleProperty {
  key: string;
  fullStart: number;
  fullEnd: number;
  valueStart: number;
  valueEnd: number;
  valueKind: "string" | "numeric" | "other";
  kind: TrackedStylePropertyKind;
}

interface StyleObjectInfo {
  attr: ts.JsxAttribute;
  objectExpr: ts.ObjectLiteralExpression;
  objectStart: number;
  objectEnd: number;
  properties: TrackedStyleProperty[];
  staticDeclarations: Record<string, string>;
}

function getStyleObjectInfo(
  attr: ts.JsxAttribute,
  sourceFile: ts.SourceFile
): StyleObjectInfo | null {
  if (!attr.initializer) return null;

  if (ts.isStringLiteral(attr.initializer)) return null;

  if (!ts.isJsxExpression(attr.initializer)) return null;

  const expr = attr.initializer.expression;
  if (!expr || !ts.isObjectLiteralExpression(expr)) return null;

  const properties: TrackedStyleProperty[] = [];
  const staticDeclarations: Record<string, string> = {};

  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const keyNode = prop.name;
      const key = ts.isIdentifier(keyNode)
        ? keyNode.text
        : ts.isStringLiteral(keyNode)
          ? keyNode.text
          : keyNode.getText(sourceFile);

      const valueNode = prop.initializer;
      const valueStart = valueNode.getStart(sourceFile);
      const valueEnd = valueNode.getEnd();

      let valueKind: TrackedStyleProperty["valueKind"] = "other";
      if (ts.isStringLiteral(valueNode)) {
        valueKind = "string";
        staticDeclarations[key] = valueNode.text;
      } else if (ts.isNumericLiteral(valueNode)) {
        valueKind = "numeric";
        staticDeclarations[key] = valueNode.text;
      } else if (ts.isPrefixUnaryExpression(valueNode)) {
        staticDeclarations[key] = valueNode.getText(sourceFile);
      } else {
        staticDeclarations[key] = valueNode.getText(sourceFile);
      }

      properties.push({
        key,
        fullStart: prop.getStart(sourceFile),
        fullEnd: prop.getEnd(),
        valueStart,
        valueEnd,
        valueKind,
        kind: "property",
      });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      properties.push({
        key,
        fullStart: prop.getStart(sourceFile),
        fullEnd: prop.getEnd(),
        valueStart: prop.getStart(sourceFile),
        valueEnd: prop.getEnd(),
        valueKind: "other",
        kind: "shorthand",
      });
      staticDeclarations[key] = key;
    } else if (ts.isSpreadAssignment(prop)) {
      properties.push({
        key: prop.expression.getText(sourceFile),
        fullStart: prop.getStart(sourceFile),
        fullEnd: prop.getEnd(),
        valueStart: prop.getStart(sourceFile),
        valueEnd: prop.getEnd(),
        valueKind: "other",
        kind: "spread",
      });
    }
  }

  return {
    attr,
    objectExpr: expr,
    objectStart: expr.getStart(sourceFile),
    objectEnd: expr.getEnd(),
    properties,
    staticDeclarations,
  };
}

// ─── Task 4: Surgical inline style rewriting ──────────────────────────────────

function formatStyleValue(
  value: string,
  valueKind: TrackedStyleProperty["valueKind"]
): string {
  if (valueKind === "numeric") return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function updateStyleSurgically(
  source: string,
  _sourceFile: ts.SourceFile,
  styleInfo: StyleObjectInfo,
  cssProperty: string,
  cssValue: string | null
): string | null {
  const edits: SurgicalEdit[] = [];
  const camelKey = cssPropertyToCamelCase(cssProperty);

  if (cssValue === null) {
    const propIndex = styleInfo.properties.findIndex(
      (p) => p.key === cssProperty && p.kind === "property"
    );
    if (propIndex === -1) return null;

    const prop = styleInfo.properties[propIndex];
    let deleteStart = prop.fullStart;
    let deleteEnd = prop.fullEnd;

    if (styleInfo.properties.length === 1) {
      edits.push({
        start: styleInfo.objectStart + 1,
        end: styleInfo.objectEnd - 1,
        replacement: "",
      });
      return applySurgicalEdits(source, edits);
    }

    if (propIndex > 0) {
      const prevEnd = styleInfo.properties[propIndex - 1].fullEnd;
      const between = source.slice(prevEnd, prop.fullStart);
      const commaIdx = between.lastIndexOf(",");
      if (commaIdx >= 0) {
        deleteStart = prevEnd + commaIdx;
      }
    } else {
      const nextStart = styleInfo.properties[1].fullStart;
      const between = source.slice(prop.fullEnd, nextStart);
      const match = between.match(/^\s*,\s*/);
      if (match) {
        deleteEnd = prop.fullEnd + match[0].length;
      }
    }

    edits.push({ start: deleteStart, end: deleteEnd, replacement: "" });
  } else {
    const existingProp = styleInfo.properties.find(
      (p) => p.key === cssProperty && p.kind === "property"
    );

    if (existingProp) {
      edits.push({
        start: existingProp.valueStart,
        end: existingProp.valueEnd,
        replacement: formatStyleValue(cssValue, existingProp.valueKind),
      });
    } else {
      const insertPos = styleInfo.objectEnd - 1;
      const needsComma = styleInfo.properties.length > 0 ? "," : "";
      const quotedKey = camelKey.startsWith("--") ? `"${camelKey}"` : camelKey;
      edits.push({
        start: insertPos,
        end: insertPos,
        replacement: `${needsComma} ${quotedKey}: "${cssValue.replace(/"/g, '\\"')}"`,
      });
    }
  }

  return applySurgicalEdits(source, edits);
}

/**
 * Replace or update the entire inline style attribute on a JSX element identified by ast-index.
 *
 * @param sourceCode The original source code
 * @param astIndex The data-ast-index value from the DOM
 * @param styleValue The new style value (e.g., "{color: 'red'}" or "color: red")
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns Modified source code
 */
export function setJsxStyleByAstIndex(
  sourceCode: string,
  astIndex: number,
  styleValue: string,
  elementFingerprint?: string
): string {
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;
  const target = resolved.node;

  const styleAttr = target.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText(sourceFile) === "style"
  );

  if (styleAttr) {
    if (!styleValue) {
      const start = styleAttr.getStart(sourceFile);
      const end = styleAttr.getEnd();
      let sliceStart = start;
      while (sliceStart > 0 && /\s/.test(sourceCode[sliceStart - 1])) {
        sliceStart--;
      }
      return sourceCode.slice(0, sliceStart) + sourceCode.slice(end);
    }

    // Try surgical approach: if the new value is an object expression,
    // surgically rewrite rather than wholesale replace
    if (
      styleAttr.initializer &&
      ts.isJsxExpression(styleAttr.initializer) &&
      styleAttr.initializer.expression &&
      ts.isObjectLiteralExpression(styleAttr.initializer.expression) &&
      styleValue.startsWith("{")
    ) {
      try {
        const newDecl = parseCSSStyleString(
          styleValue.slice(1, -1).replace(/["']/g, "")
        );
        const styleObjInfo = getStyleObjectInfo(styleAttr, sourceFile);
        if (styleObjInfo) {
          const edits: SurgicalEdit[] = [];
          const processed = new Set<string>();

          for (const [key, val] of Object.entries(newDecl)) {
            processed.add(key);
            const existingProp = styleObjInfo.properties.find(
              (p) => p.key === key && p.kind === "property"
            );
            if (existingProp) {
              edits.push({
                start: existingProp.valueStart,
                end: existingProp.valueEnd,
                replacement: `"${val.replace(/"/g, '\\"')}"`,
              });
            } else {
              const insertPos = styleObjInfo.objectEnd - 1;
              const needsComma =
                styleObjInfo.properties.length +
                  edits.filter((e) => e.start === styleObjInfo.objectEnd - 1)
                    .length >
                0
                  ? ","
                  : "";
              const camelKey = cssPropertyToCamelCase(key);
              const quotedKey = camelKey.startsWith("--")
                ? `"${camelKey}"`
                : camelKey;
              edits.push({
                start: insertPos,
                end: insertPos,
                replacement: `${needsComma} ${quotedKey}: "${val.replace(/"/g, '\\"')}"`,
              });
            }
          }

          for (const prop of styleObjInfo.properties) {
            if (prop.kind !== "property") continue;
            if (!processed.has(prop.key)) {
              // Remove properties not in the new set
              const propIndex = styleObjInfo.properties.indexOf(prop);
              let deleteStart = prop.fullStart;
              let deleteEnd = prop.fullEnd;

              if (styleObjInfo.properties.length === 1) {
                edits.push({
                  start: styleObjInfo.objectStart + 1,
                  end: styleObjInfo.objectEnd - 1,
                  replacement: "",
                });
                break;
              }

              if (propIndex > 0) {
                const prevEnd = styleObjInfo.properties[propIndex - 1].fullEnd;
                const between = sourceCode.slice(prevEnd, prop.fullStart);
                const commaIdx = between.lastIndexOf(",");
                if (commaIdx >= 0) {
                  deleteStart = prevEnd + commaIdx;
                }
              } else {
                const nextStart = styleObjInfo.properties[1].fullStart;
                const between = sourceCode.slice(prop.fullEnd, nextStart);
                const match = between.match(/^\s*,\s*/);
                if (match) {
                  deleteEnd = prop.fullEnd + match[0].length;
                }
              }

              edits.push({
                start: deleteStart,
                end: deleteEnd,
                replacement: "",
              });
            }
          }

          if (edits.length > 0) {
            return applySurgicalEdits(sourceCode, edits);
          }
        }
      } catch {
        // Fall through to direct slice replacement
      }
    }

    const start =
      styleAttr.initializer?.getStart(sourceFile) ?? styleAttr.getEnd();
    const end = styleAttr.initializer?.getEnd() ?? styleAttr.getEnd();

    const formattedValue =
      styleValue.startsWith("{") && styleValue.endsWith("}")
        ? styleValue
        : `{${styleValue}}`;

    return sourceCode.slice(0, start) + formattedValue + sourceCode.slice(end);
  }

  if (!styleValue) return sourceCode;

  const tagEnd = target.tagName.getEnd();
  const formattedValue =
    styleValue.startsWith("{") && styleValue.endsWith("}")
      ? styleValue
      : `{${styleValue}}`;

  return (
    sourceCode.slice(0, tagEnd) +
    ` style=${formattedValue}` +
    sourceCode.slice(tagEnd)
  );
}

export function updateJsxStyleByAstIndex(
  sourceCode: string,
  astIndex: number,
  cssProperty: string,
  cssValue: string | null,
  elementFingerprint?: string
): string {
  if (cssValue !== null) {
    sourceCode = inlineStyleExpression(
      sourceCode,
      astIndex,
      elementFingerprint
    );
  }
  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;
  const target = resolved.node;

  const styleAttr = getStyleAttribute(target, sourceFile);
  if (!styleAttr) {
    if (cssValue === null) return sourceCode;
    const tagEnd = target.tagName.getEnd();
    const camelKey = cssPropertyToCamelCase(cssProperty);
    return (
      sourceCode.slice(0, tagEnd) +
      ` style={{${camelKey}: "${cssValue}"}}` +
      sourceCode.slice(tagEnd)
    );
  }

  const styleObjInfo = getStyleObjectInfo(styleAttr, sourceFile);
  if (styleObjInfo) {
    const result = updateStyleSurgically(
      sourceCode,
      sourceFile,
      styleObjInfo,
      cssProperty,
      cssValue
    );
    if (result !== null) return result;
  }

  return sourceCode;
}

// ─── Task 5: Mode-aware style injection ───────────────────────────────────────

/**
 * Write a mode-aware gradient, shadow, or border to a JSX element.
 *
 * Stores the value as a CSS custom property (--luova-bg-light/dark,
 * --luova-shadow-light/dark, or --luova-border-light/dark) in the element's
 * inline style, and ensures the corresponding utility class (luova-bg-themed,
 * luova-shadow-themed, or luova-border-themed) is present in className
 * so the CSS var is applied.
 *
 * Style consolidation: before writing, all existing --luova-* vars for the
 * given `kind` are cleared so repeated edits don't accumulate stale entries.
 *
 * Uses surgical AST position slicing to preserve spreads, shorthand properties,
 * and dynamic expressions in the style object.
 *
 * @param sourceCode  The original source code
 * @param astIndex    The data-ast-index value from the DOM
 * @param kind        "gradient", "shadow", or "border"
 * @param mode        "light" or "dark"
 * @param value       The CSS value to store, or null to remove
 * @param elementFingerprint Optional structural fingerprint for drift recovery
 * @returns Modified source code
 */
export function updateJsxModeAwareStyle(
  sourceCode: string,
  astIndex: number,
  kind: "gradient" | "shadow" | "border",
  mode: "light" | "dark",
  value: string | null,
  elementFingerprint?: string,
  additionalClassesToRemove?: string[]
): string {
  const cssVar =
    kind === "border"
      ? mode === "dark"
        ? "--luova-border-dark"
        : "--luova-border-light"
      : kind === "gradient"
        ? mode === "dark"
          ? "--luova-bg-dark"
          : "--luova-bg-light"
        : mode === "dark"
          ? "--luova-shadow-dark"
          : "--luova-shadow-light";

  const otherVar =
    kind === "border"
      ? mode === "dark"
        ? "--luova-border-light"
        : "--luova-border-dark"
      : kind === "gradient"
        ? mode === "dark"
          ? "--luova-bg-light"
          : "--luova-bg-dark"
        : mode === "dark"
          ? "--luova-shadow-light"
          : "--luova-shadow-dark";

  const utilityClass =
    kind === "border"
      ? "luova-border-themed"
      : kind === "gradient"
        ? "luova-bg-themed"
        : "luova-shadow-themed";

  if (value !== null) {
    sourceCode = inlineStyleExpression(
      sourceCode,
      astIndex,
      elementFingerprint
    );
  }
  const resolved = resolveElement(sourceCode, astIndex, elementFingerprint);
  if (!resolved) return sourceCode;

  // ── Phase 1: Read current state ─────────────────────────────────────────
  const sourceFileForRead = ts.createSourceFile(
    "temp.tsx",
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const styleAttr = getStyleAttribute(resolved.node, sourceFileForRead);
  const styleObjInfo = styleAttr
    ? getStyleObjectInfo(styleAttr, sourceFileForRead)
    : null;

  // Collect current --luova-* declarations from the tracked properties.
  // (Flattening and rebuilding the attributes would destroy spreads.)
  const declarations: Record<string, string> = {
    ...(styleObjInfo?.staticDeclarations ?? {}),
  };

  // ── Phase 2: Compute desired final state ────────────────────────────────
  if (value === null) {
    delete declarations[cssVar];
  } else {
    declarations[cssVar] = value;
    const hasThemeVar = value.includes("var(");
    if (hasThemeVar || !declarations[otherVar]) {
      declarations[otherVar] = value;
    }
  }

  const hasAnyValue = value !== null || !!declarations[otherVar];
  const shouldRemoveAll = value === null && !declarations[otherVar];

  if (shouldRemoveAll) {
    delete declarations[cssVar];
    delete declarations[otherVar];
    if (kind === "border") {
      delete declarations["--luova-border-width"];
    }
  } else if (kind === "border" && hasAnyValue) {
    const classInfo = getClassNameInfo(resolved.node, sourceFileForRead);
    const existingClasses = classInfo?.existingClasses ?? [];
    const borderWidthPx = getBorderWidthFromClasses(existingClasses);
    declarations["--luova-border-width"] =
      borderWidthPx > 0 ? `${borderWidthPx}px` : "0px";
  }

  // ── Phase 3: Apply style changes surgically ─────────────────────────────
  let result = sourceCode;

  if (styleObjInfo) {
    const edits: SurgicalEdit[] = [];
    const luovaKeys = Object.keys(declarations).filter((k) =>
      k.startsWith("--luova-")
    );

    // 3a. Delete luova props that should no longer exist
    for (const prop of styleObjInfo.properties) {
      if (prop.kind !== "property") continue;
      if (!prop.key.startsWith("--luova-")) continue;
      if (declarations[prop.key] !== undefined) continue;

      const propIndex = styleObjInfo.properties.indexOf(prop);
      let deleteStart = prop.fullStart;
      let deleteEnd = prop.fullEnd;

      if (styleObjInfo.properties.length === 1) {
        edits.push({
          start: styleObjInfo.objectStart + 1,
          end: styleObjInfo.objectEnd - 1,
          replacement: "",
        });
        break;
      }

      if (propIndex > 0) {
        const prevEnd = styleObjInfo.properties[propIndex - 1].fullEnd;
        const between = sourceCode.slice(prevEnd, prop.fullStart);
        const commaIdx = between.lastIndexOf(",");
        if (commaIdx >= 0) {
          deleteStart = prevEnd + commaIdx;
        }
      } else {
        const nextStart = styleObjInfo.properties[1].fullStart;
        const between = sourceCode.slice(prop.fullEnd, nextStart);
        const match = between.match(/^\s*,\s*/);
        if (match) {
          deleteEnd = prop.fullEnd + match[0].length;
        }
      }

      edits.push({ start: deleteStart, end: deleteEnd, replacement: "" });
    }

    // 3b. Add or update luova props
    for (const key of luovaKeys) {
      const val = declarations[key];
      if (val === undefined) continue;

      const existingProp = styleObjInfo.properties.find(
        (p) => p.key === key && p.kind === "property"
      );

      if (existingProp) {
        edits.push({
          start: existingProp.valueStart,
          end: existingProp.valueEnd,
          replacement: `"${val.replace(/"/g, '\\"')}"`,
        });
      } else {
        const insertPos = styleObjInfo.objectEnd - 1;
        const remainingCount = styleObjInfo.properties.filter(
          (p) =>
            !(p.key.startsWith("--luova-") && declarations[p.key] === undefined)
        ).length;
        const needsComma = remainingCount > 0 ? "," : "";
        edits.push({
          start: insertPos,
          end: insertPos,
          replacement: `${needsComma} "${key}": "${val.replace(/"/g, '\\"')}"`,
        });
      }
    }

    if (edits.length > 0) {
      result = applySurgicalEdits(result, edits);
    }
  } else if (!styleAttr && Object.keys(declarations).length > 0) {
    // No existing style attribute — create one with the --luova-* vars
    const entries = Object.entries(declarations)
      .filter(([k]) => k.startsWith("--luova-"))
      .map(([k, v]) => `"${k}": "${v}"`);
    const tagEnd = resolved.node.tagName.getEnd();
    result =
      result.slice(0, tagEnd) +
      ` style={{${entries.join(", ")}}}` +
      result.slice(tagEnd);
  }

  // ── Phase 4: Class management ───────────────────────────────────────────
  const classSourceFile = ts.createSourceFile(
    "temp.tsx",
    result,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  // Re-resolve element from modified source
  const classResolved = resolveElement(result, astIndex, elementFingerprint);
  if (!classResolved) return result;

  const classInfo = getClassNameInfo(classResolved.node, classSourceFile);
  const existingClasses = classInfo?.existingClasses ?? [];

  if (shouldRemoveAll) {
    const classesToRemove = [utilityClass];
    if (kind === "border") classesToRemove.push("relative");
    if (additionalClassesToRemove) {
      classesToRemove.push(...additionalClassesToRemove);
    }
    result = updateJsxClassNameByAstIndex(
      result,
      astIndex,
      [],
      classesToRemove,
      elementFingerprint
    );
    return result;
  }

  const classesToAdd: string[] = [];
  if (kind === "border" && hasAnyValue) {
    if (!existingClasses.includes(utilityClass))
      classesToAdd.push(utilityClass);
    if (!existingClasses.includes("relative")) classesToAdd.push("relative");
  } else if (
    kind !== "border" &&
    hasAnyValue &&
    !existingClasses.includes(utilityClass)
  ) {
    classesToAdd.push(utilityClass);
  }

  if (classesToAdd.length > 0) {
    const classesRemove: string[] = [];
    if (additionalClassesToRemove) {
      classesRemove.push(...additionalClassesToRemove);
    }
    result = updateJsxClassNameByAstIndex(
      result,
      astIndex,
      classesToAdd,
      classesRemove,
      elementFingerprint
    );
  } else if (!hasAnyValue && existingClasses.includes(utilityClass)) {
    const classesToRemove = [utilityClass];
    if (kind === "border") classesToRemove.push("relative");
    if (additionalClassesToRemove) {
      classesToRemove.push(...additionalClassesToRemove);
    }
    result = updateJsxClassNameByAstIndex(
      result,
      astIndex,
      [],
      classesToRemove,
      elementFingerprint
    );
  } else if (
    additionalClassesToRemove &&
    additionalClassesToRemove.length > 0
  ) {
    result = updateJsxClassNameByAstIndex(
      result,
      astIndex,
      [],
      additionalClassesToRemove,
      elementFingerprint
    );
  }

  return result;
}
