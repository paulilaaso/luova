const REM_PER_SPACING_UNIT = 0.25;

const spacingFunctionPattern = /--spacing\((-?\d*\.?\d+)\)/g;

export default function normalizeTailwindFunctions() {
  return {
    postcssPlugin: "luova-normalize-tailwind-functions",
    Declaration(decl) {
      if (!decl.value.includes("--spacing(")) return;

      decl.value = decl.value.replace(
        spacingFunctionPattern,
        (match, value) => {
          const units = Number(value);
          if (!Number.isFinite(units)) return match;
          return `${units * REM_PER_SPACING_UNIT}rem`;
        }
      );
    },
  };
}

normalizeTailwindFunctions.postcss = true;
