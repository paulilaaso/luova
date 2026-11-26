import * as ts from "typescript";

type Replacement = {
  start: number;
  end: number;
  text: string;
};

function isParagraphTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && tagName.text === "p";
}

function renameTag(replacements: Replacement[], tagName: ts.Node) {
  replacements.push({
    start: tagName.getStart(),
    end: tagName.getEnd(),
    text: "span",
  });
}

/**
 * React will render invalid nested paragraphs, but the browser reparses them
 * differently, which triggers hydration errors. Generated scene code can
 * occasionally nest `<p>` tags for styled text blocks, so normalize only the
 * inner paragraph tags to spans before compilation.
 */
export function sanitizeInvalidJsxNesting(code: string): string {
  if (!code.includes("<p")) return code;

  const sourceFile = ts.createSourceFile(
    "component.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const replacements: Replacement[] = [];

  function visit(node: ts.Node, paragraphDepth: number) {
    if (ts.isJsxElement(node)) {
      const openingTag = node.openingElement.tagName;
      const closingTag = node.closingElement.tagName;
      const isParagraph = isParagraphTag(openingTag);

      if (isParagraph && paragraphDepth > 0) {
        renameTag(replacements, openingTag);
        renameTag(replacements, closingTag);
      }

      const nextDepth = paragraphDepth + (isParagraph ? 1 : 0);
      for (const child of node.children) {
        visit(child, nextDepth);
      }
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      if (paragraphDepth > 0 && isParagraphTag(node.tagName)) {
        renameTag(replacements, node.tagName);
      }
      return;
    }

    ts.forEachChild(node, (child) => visit(child, paragraphDepth));
  }

  visit(sourceFile, 0);
  if (replacements.length === 0) return code;

  let sanitized = code;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    sanitized =
      sanitized.slice(0, replacement.start) +
      replacement.text +
      sanitized.slice(replacement.end);
  }

  return sanitized;
}
