import { afterEach, expect, it, vi } from "vitest";
import { prepareRecreateImage } from "@/lib/ai/recreate-image";
import { idbGetAsset } from "@/lib/asset-idb";

vi.mock("@/lib/asset-idb", () => ({ idbGetAsset: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves color pixels at bounded resolution without using the output frame", async () => {
  vi.mocked(idbGetAsset).mockResolvedValue("data:image/png;base64,source");
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 3200;
      naturalHeight = 1600;
      onload?: () => void;
      set src(_: string) {
        this.onload?.();
      }
    }
  );
  const pixels = {
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
  };
  const ctx = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => pixels),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as any
  );
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,color");
  expect(await prepareRecreateImage("asset:image-abc123")).toEqual({
    type: "file",
    mediaType: "image/png",
    url: "data:image/png;base64,color",
  });
  expect(ctx.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    0,
    1600,
    800
  );
  expect(ctx.getImageData).not.toHaveBeenCalled();
  expect(ctx.putImageData).not.toHaveBeenCalled();
  expect(encode).toHaveBeenCalledWith("image/png");
});

it("reports missing images before sending a model request", async () => {
  vi.mocked(idbGetAsset).mockResolvedValue(undefined);
  await expect(prepareRecreateImage("asset:image-missing")).rejects.toThrow(
    "source image is missing"
  );
});
