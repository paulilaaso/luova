const ALLOWED_IMAGE_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];

const ALLOWED_FONT_TYPES = [
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
  "application/font-woff2",
  "application/font-woff",
  "application/x-font-ttf",
  "application/vnd.ms-fontobject",
];

/**
 * Reads an image File and returns it as a Base64 data URI.
 * Throws if the file type is not an allowed image mime type.
 */
export function readImageAsBase64(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return Promise.reject(
      new Error(
        `Unsupported image type: ${file.type}. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Returns true if the given file is a supported image type.
 */
export function isValidImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type);
}

const ALLOWED_FONT_EXTENSIONS = ["woff2", "woff", "ttf", "otf"];

/**
 * Returns true if the given file is a supported font type.
 */
export function isValidFontFile(file: File): boolean {
  if (ALLOWED_FONT_TYPES.includes(file.type)) {
    return true;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? ALLOWED_FONT_EXTENSIONS.includes(extension) : false;
}

/**
 * Reads a font File and returns it as a Base64 data URI.
 * Throws if the file type is not an allowed font mime type.
 */
export function readFontAsBase64(file: File): Promise<string> {
  const isValid = isValidFontFile(file);
  if (!isValid) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "unknown";
    return Promise.reject(
      new Error(
        `Unsupported font type/extension: ${file.type || extension}. Allowed: ${ALLOWED_FONT_TYPES.join(", ")}`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read font file"));
    reader.readAsDataURL(file);
  });
}

export interface ImageAdjustments {
  brightness?: number;
  contrast?: number;
  blur?: number;
  hueRotate?: number;
  rotation?: number;
  opacity?: number;
  svgFill?: string;
  svgFillLight?: string;
  svgFillDark?: string;
  /** Original filename (e.g. "hero-banner.png") — used to derive component name + alt */
  fileName?: string;
  /** Accessible description; defaults to cleaned filename when omitted */
  alt?: string;
  /** Optional title attribute */
  title?: string;
}

/**
 * Derives a PascalCase React component name from an image filename.
 * Strips extension, splits on non-alphanumerics, capitalizes segments.
 * Falls back to "ImageComponent" when nothing usable remains.
 *
 * e.g. "hero-banner.png" → "HeroBanner"
 *      "user_avatar.svg" → "UserAvatar"
 *      "123-team photo (final).webp" → "TeamPhotoFinal" (leading digits dropped)
 */
export function componentNameFromFileName(
  fileName?: string,
  fallback = "ImageComponent"
): string {
  if (!fileName) return fallback;
  const base = fileName.split("/").pop()?.split("\\").pop() ?? fileName;
  const withoutExt = base.replace(/\.[a-zA-Z0-9]+$/, "");
  const parts = withoutExt.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  let name = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("")
    .replace(/^[^a-zA-Z]+/, "");
  if (!name) return fallback;
  // Ensure valid identifier + avoid overly long names
  if (name.length > 48) name = name.slice(0, 48);
  // Avoid collision with the generic fallback casing confusion — keep as-is
  return name || fallback;
}

/**
 * Derives an alt-text default from a filename when the user hasn't supplied one.
 * Keeps the full filename (including extension) so AI + devs retain semantic context,
 * e.g. "company-logo.svg".
 */
export function altTextFromFileName(
  fileName?: string,
  explicitAlt?: string
): string {
  if (explicitAlt?.trim()) return explicitAlt.trim();
  if (fileName?.trim()) return fileName.trim();
  return "";
}

/** Escapes a string for safe embedding inside a double-quoted JS string literal. */
function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const IMAGE_DEFAULTS: Required<
  Omit<
    ImageAdjustments,
    "svgFill" | "svgFillLight" | "svgFillDark" | "fileName" | "alt" | "title"
  >
> = {
  brightness: 1,
  contrast: 1,
  blur: 0,
  hueRotate: 0,
  rotation: 0,
  opacity: 1,
};

/**
 * Returns true if any filter/transform adjustment differs from its default value.
 */
function _hasNonDefaultAdjustments(adj: ImageAdjustments): boolean {
  return (
    (adj.brightness !== undefined &&
      adj.brightness !== IMAGE_DEFAULTS.brightness) ||
    (adj.contrast !== undefined && adj.contrast !== IMAGE_DEFAULTS.contrast) ||
    (adj.blur !== undefined && adj.blur !== IMAGE_DEFAULTS.blur) ||
    (adj.hueRotate !== undefined &&
      adj.hueRotate !== IMAGE_DEFAULTS.hueRotate) ||
    (adj.rotation !== undefined && adj.rotation !== IMAGE_DEFAULTS.rotation) ||
    (adj.opacity !== undefined && adj.opacity !== IMAGE_DEFAULTS.opacity)
  );
}

/**
 * Builds the JSX code string for an Image node.
 * All images are generated with full adjustment props support
 * (brightness, contrast, blur, hueRotate, rotation, opacity).
 * This ensures that sliders always work without needing code regeneration.
 */
/**
 * Extracts the native dimensions of an image from a base64 data URI.
 * Returns a Promise that resolves with { width, height } in pixels.
 */
export function getImageDimensions(
  base64: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      reject(new Error("Failed to load image dimensions"));
    };
    img.src = base64;
  });
}

export function buildImageCode(
  src: string,
  adj: ImageAdjustments = {},
  opts?: { fileName?: string; alt?: string }
): string {
  const svgFill = adj.svgFill;
  const svgFillLight = adj.svgFillLight;
  const svgFillDark = adj.svgFillDark;
  const hasSvgFill = svgFill || svgFillLight || svgFillDark;

  // Always use full parameterized form
  const b = adj.brightness ?? IMAGE_DEFAULTS.brightness;
  const c = adj.contrast ?? IMAGE_DEFAULTS.contrast;
  const bl = adj.blur ?? IMAGE_DEFAULTS.blur;
  const hr = adj.hueRotate ?? IMAGE_DEFAULTS.hueRotate;
  const rot = adj.rotation ?? IMAGE_DEFAULTS.rotation;
  const op = adj.opacity ?? IMAGE_DEFAULTS.opacity;

  const fileName = opts?.fileName ?? adj.fileName;
  const explicitAlt = opts?.alt ?? adj.alt;
  const componentName = componentNameFromFileName(fileName);
  const altDefault = altTextFromFileName(fileName, explicitAlt);
  const safeAltDefault = escapeForDoubleQuotes(altDefault);

  if (hasSvgFill) {
    // Full form: adjustable props + svgFill(s)
    const fillParam =
      svgFillLight || svgFillDark
        ? `svgFillLight = "${svgFillLight || ""}",\n   svgFillDark = "${svgFillDark || ""}",`
        : `svgFill = "${svgFill || ""}",`;

    const fillLogic =
      svgFillLight || svgFillDark
        ? `const resolvedFill = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? (svgFillDark || svgFillLight) : (svgFillLight || svgFillDark);`
        : `const resolvedFill = svgFill;`;

    return `export default function ${componentName}({
   brightness = ${b},
   contrast = ${c},
   blur = ${bl},
   hueRotate = ${hr},
   rotation = ${rot},
   opacity = ${op},
   src = "${src}",
   alt = "${safeAltDefault}",
   ${fillParam}
   }) {
   ${fillLogic}
   const filter = \`brightness(\${brightness}) contrast(\${contrast}) blur(\${blur}px) hue-rotate(\${hueRotate}deg)\`;
   return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          visibility: "hidden",
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage: "url(" + src + ")",
          maskImage: "url(" + src + ")",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          background: resolvedFill,
          filter,
          opacity,
          transform: \`rotate(\${rotation}deg)\`,
        }}
      />
    </div>
   );
   }`;
  }

  // Standard form: adjustable props, no svgFill
  return `export default function ${componentName}({
   brightness = ${b},
   contrast = ${c},
   blur = ${bl},
   hueRotate = ${hr},
   rotation = ${rot},
   opacity = ${op},
   alt = "${safeAltDefault}",
 }) {
   const filter = \`brightness(\${brightness}) contrast(\${contrast}) blur(\${blur}px) hue-rotate(\${hueRotate}deg)\`;
   return (
     <img
       src="${src}"
       alt={alt}
       className="w-full h-full object-cover"
       style={{ filter, opacity, transform: \`rotate(\${rotation}deg)\` }}
     />
   );
 }`;
}
