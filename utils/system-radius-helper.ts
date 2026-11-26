import {
  extractJsxClassNamesByAstIndex,
  extractJsxStyleByAstIndex,
  updateJsxClassNameByAstIndex,
  updateJsxStyleByAstIndex,
} from "./ast-modifier-v2";

export function detectSystemRadius(
  _classes: string[],
  inlineStyle: string
): boolean {
  return (
    (inlineStyle.includes("var(--radius)") ||
      inlineStyle.includes("var(--radius-dark)")) &&
    !inlineStyle.includes("--smoothing")
  );
}

export function injectSystemRadius(
  liveCode: string,
  astIndexNum: number
): string {
  // Get current classes and remove conflicting rounded classes
  const liveClasses = extractJsxClassNamesByAstIndex(liveCode, astIndexNum);
  const roundedClasses = [
    "rounded",
    "rounded-sm",
    "rounded-md",
    "rounded-lg",
    "rounded-xl",
    "rounded-2xl",
    "rounded-3xl",
    "rounded-full",
  ];

  // Find all rounded classes to remove (standard + arbitrary rounded-[*])
  const classesToRemove = liveClasses.filter(
    (cls) => roundedClasses.includes(cls) || /^rounded-\[.*\]$/.test(cls)
  );

  let updatedCode = liveCode;

  // Remove conflicting rounded classes
  if (classesToRemove.length > 0) {
    updatedCode = updateJsxClassNameByAstIndex(
      updatedCode,
      astIndexNum,
      [],
      classesToRemove
    );
  }

  // Add system radius style
  const radiusValue = "var(--radius)";
  updatedCode = updateJsxStyleByAstIndex(
    updatedCode,
    astIndexNum,
    "borderRadius",
    radiusValue
  );
  updatedCode = updateJsxStyleByAstIndex(
    updatedCode,
    astIndexNum,
    "--smoothing",
    null
  );

  return updatedCode;
}

export function removeSystemRadius(
  liveCode: string,
  astIndexNum: number
): string {
  const existingStyle = extractJsxStyleByAstIndex(liveCode, astIndexNum);
  if (
    !existingStyle.includes("--radius") &&
    !existingStyle.includes("var(--radius)")
  ) {
    return liveCode;
  }

  const roundedClasses = [
    "rounded",
    "rounded-sm",
    "rounded-md",
    "rounded-lg",
    "rounded-xl",
    "rounded-2xl",
    "rounded-3xl",
    "rounded-full",
  ];
  const liveClasses = extractJsxClassNamesByAstIndex(liveCode, astIndexNum);
  const hasRoundedClass = roundedClasses.some((cls) =>
    liveClasses.includes(cls)
  );

  let updatedCode = liveCode;

  // Use camelCase 'borderRadius' for the style property
  if (hasRoundedClass) {
    updatedCode = updateJsxStyleByAstIndex(
      liveCode,
      astIndexNum,
      "borderRadius",
      "0px"
    );
  } else {
    updatedCode = updateJsxStyleByAstIndex(
      liveCode,
      astIndexNum,
      "borderRadius",
      null as any
    );
  }
  updatedCode = updateJsxStyleByAstIndex(
    updatedCode,
    astIndexNum,
    "--smoothing",
    "0"
  );

  return updatedCode;
}
