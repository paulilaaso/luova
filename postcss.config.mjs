import normalizeTailwindFunctions from "./scripts/postcss-normalize-tailwind-functions.mjs";

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: ["@tailwindcss/postcss", normalizeTailwindFunctions()],
};

export default config;
