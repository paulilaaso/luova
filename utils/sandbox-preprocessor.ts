import * as ts from "typescript";
import { RUNTIME_SCOPE } from "@/config/runtime-scope";

type RuntimeScope = Record<string, unknown>;

type ImportRequest =
  | {
      kind: "named";
      importedName: string;
      localName: string;
      moduleId: string;
    }
  | {
      kind: "namespace";
      localName: string;
      moduleId: string;
    };

const REACT_COMPONENT_TYPE_KEYS = new Set(["$$typeof", "render", "type"]);

function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return true;
    }

    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const hasExport = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    const hasDefault = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
    );

    if (hasExport && hasDefault) return true;

    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      const clause = statement.exportClause;
      if (ts.isNamedExports(clause)) {
        return clause.elements.some(
          (element) =>
            element.name.text === "default" ||
            element.propertyName?.text === "default"
        );
      }
    }

    return false;
  });
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isBareJsxExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(expression);
  return (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  );
}

function autoWrapBareJsx(code: string): string {
  const sourceFile = ts.createSourceFile(
    "sandbox.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  if (hasDefaultExport(sourceFile)) return code;

  const bareJsxStatement = sourceFile.statements.find(
    (statement): statement is ts.ExpressionStatement =>
      ts.isExpressionStatement(statement) &&
      isBareJsxExpression(statement.expression)
  );

  if (!bareJsxStatement) return code;

  const expressionText = code.slice(
    bareJsxStatement.expression.getStart(sourceFile),
    bareJsxStatement.expression.end
  );
  const replacement = [
    "export default function SandboxComponent() {",
    `  return (${expressionText});`,
    "}",
  ].join("\n");

  return [
    code.slice(0, bareJsxStatement.getStart(sourceFile)),
    replacement,
    code.slice(bareJsxStatement.end),
  ].join("");
}

function addBindingName(name: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      addBindingName(element.name, names);
    }
  }
}

function collectDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isImportClause(node)) {
      if (node.name) names.add(node.name.text);
    } else if (ts.isNamespaceImport(node)) {
      names.add(node.name.text);
    } else if (ts.isImportSpecifier(node)) {
      names.add(node.name.text);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (node.name) names.add(node.name.text);
    } else if (ts.isVariableDeclaration(node)) {
      addBindingName(node.name, names);
    } else if (ts.isParameter(node)) {
      addBindingName(node.name, names);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingName(node.variableDeclaration.name, names);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

function getJsxRootName(tagName: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) {
    let expression = tagName.expression;
    while (ts.isPropertyAccessExpression(expression)) {
      expression = expression.expression;
    }
    return ts.isIdentifier(expression) ? expression.text : null;
  }
  return null;
}

function isMemberJsxTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isPropertyAccessExpression(tagName);
}

function collectJsxRoots(sourceFile: ts.SourceFile): Map<string, boolean> {
  const roots = new Map<string, boolean>();

  function remember(tagName: ts.JsxTagNameExpression) {
    const rootName = getJsxRootName(tagName);
    if (!rootName) return;

    const startsLikeComponent = /^[A-Z]/.test(rootName);
    if (!startsLikeComponent && !isMemberJsxTag(tagName)) return;

    roots.set(rootName, roots.get(rootName) || isMemberJsxTag(tagName));
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      remember(node.tagName);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return roots;
}

function moduleExports(moduleValue: unknown): Record<string, unknown> | null {
  if (!moduleValue || typeof moduleValue !== "object") return null;
  return moduleValue as Record<string, unknown>;
}

function hasExport(moduleValue: unknown, exportName: string): boolean {
  const exports = moduleExports(moduleValue);
  if (!exports) return false;
  return exportName in exports && exports[exportName] !== undefined;
}

function looksLikeReactComponent(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  return Array.from(REACT_COMPONENT_TYPE_KEYS).some((key) => key in value);
}

function pascalCase(value: string): string {
  return value
    .replace(/^react-/, "")
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function namespaceNameForModule(moduleId: string): string {
  const lastSegment = moduleId.split("/").pop() ?? moduleId;
  return pascalCase(lastSegment);
}

function findNamedImport(
  localName: string,
  runtimeScope: RuntimeScope
): ImportRequest | null {
  const candidates = Object.entries(runtimeScope)
    .filter(([moduleId, moduleValue]) => {
      if (moduleId === "react") return false;
      if (!hasExport(moduleValue, localName)) return false;
      return looksLikeReactComponent(moduleExports(moduleValue)?.[localName]);
    })
    .map(([moduleId]) => ({
      kind: "named" as const,
      importedName: localName,
      localName,
      moduleId,
    }));

  return candidates.length === 1 ? candidates[0] : null;
}

function findNamespaceImport(
  localName: string,
  runtimeScope: RuntimeScope
): ImportRequest | null {
  const candidates = Object.entries(runtimeScope)
    .filter(([moduleId]) => namespaceNameForModule(moduleId) === localName)
    .map(([moduleId]) => ({
      kind: "namespace" as const,
      localName,
      moduleId,
    }));

  return candidates.length === 1 ? candidates[0] : null;
}

function buildImportLine(request: ImportRequest): string {
  if (request.kind === "namespace") {
    return `import * as ${request.localName} from "${request.moduleId}";`;
  }

  return `import { ${request.importedName} } from "${request.moduleId}";`;
}

function autoInjectMissingImports(
  code: string,
  runtimeScope: RuntimeScope
): string {
  const sourceFile = ts.createSourceFile(
    "sandbox.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const declaredNames = collectDeclaredNames(sourceFile);
  const jsxRoots = collectJsxRoots(sourceFile);
  const requests: ImportRequest[] = [];
  const requestedNames = new Set<string>();

  for (const [rootName, isMemberTag] of jsxRoots) {
    if (declaredNames.has(rootName) || requestedNames.has(rootName)) continue;

    const namedImport = findNamedImport(rootName, runtimeScope);
    if (namedImport) {
      requests.push(namedImport);
      requestedNames.add(rootName);
      continue;
    }

    if (isMemberTag) {
      const namespaceImport = findNamespaceImport(rootName, runtimeScope);
      if (namespaceImport) {
        requests.push(namespaceImport);
        requestedNames.add(rootName);
      }
    }
  }

  if (requests.length === 0) return code;

  return `${requests.map(buildImportLine).join("\n")}\n${code}`;
}

export function preprocessSandboxSource(
  code: string,
  runtimeScope: RuntimeScope = RUNTIME_SCOPE
): string {
  const withWrappedJsx = autoWrapBareJsx(code);
  return autoInjectMissingImports(withWrappedJsx, runtimeScope);
}
