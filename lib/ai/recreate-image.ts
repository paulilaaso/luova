import { idbGetAsset } from "@/lib/asset-idb";

/** Keep image pixels out of the context snapshot and preserve color for semantic theme-token mapping. */
export async function prepareRecreateImage(assetId: string): Promise<{
  type: "file";
  mediaType: "image/png";
  url: string;
}> {
  const source = await idbGetAsset(assetId);
  if (!source) {
    throw new Error(
      "The source image is missing. Upload it again to recreate it."
    );
  }
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error("The source image could not be read."));
    image.src = source;
  });
  // Attachment resolution affects vision cost only, never the output frame.
  const scale = Math.min(
    1,
    1600 / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is unavailable in this browser.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    type: "file",
    mediaType: "image/png",
    url: canvas.toDataURL("image/png"),
  };
}
