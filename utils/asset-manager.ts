/**
 * Asset Manager
 *
 * Manages conversion of IndexedDB-stored Base64 asset data to browser-native
 * Blob URLs. Caches Blob URLs so we don't recreate them on every render cycle.
 *
 * Asset IDs use the format: asset:image-[random] / asset:font-[random]
 * These short IDs are what live in component source code — never the raw Base64.
 *
 * Large binary data (base64) lives in IndexedDB (lib/asset-idb.ts).
 * Zustand/localStorage only holds lightweight AssetMeta (mimeType, size).
 */

import { idbGetAsset } from "@/lib/asset-idb";

const blobCache = new Map<string, string>();

/**
 * Resolves an asset ID to a Blob URL.
 * Fetches the base64 from IndexedDB on first access, then caches the Blob URL.
 */
export async function resolveAssetToBlobUrl(assetId: string): Promise<string> {
  const cached = blobCache.get(assetId);
  if (cached) return cached;

  const data = await idbGetAsset(assetId);
  if (!data) {
    throw new Error(`Asset not found in IndexedDB: ${assetId}`);
  }

  const blob = await fetch(data).then((r) => r.blob());
  const url = URL.createObjectURL(blob);
  blobCache.set(assetId, url);
  return url;
}

/**
 * Revokes a cached Blob URL and removes it from the cache.
 * Call this when an asset is deleted to free memory.
 */
export function revokeAssetBlobUrl(assetId: string): void {
  const url = blobCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    blobCache.delete(assetId);
  }
}

/**
 * Generates a short unique asset ID.
 */
export function generateAssetId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `asset:image-${rand}`;
}

/**
 * Generates a short unique font asset ID.
 */
export function generateFontId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `asset:font-${rand}`;
}

/** Regex to find all image asset IDs embedded in source code. */
export const ASSET_ID_REGEX = /asset:image-[a-zA-Z0-9]+/g;

/** Regex to find all font asset IDs embedded in source code. */
export const ASSET_FONT_ID_REGEX = /asset:font-[a-zA-Z0-9]+/g;

/**
 * Extracts the MIME type from a base64 data URI.
 * e.g. "data:image/png;base64,..." → "image/png"
 */
export function mimeTypeFromBase64(base64: string): string {
  const match = base64.match(/^data:([^;]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}
