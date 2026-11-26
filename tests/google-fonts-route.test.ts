// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/google-fonts/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

function search(q: string) {
  return GET(
    new Request(`http://127.0.0.1:3000/api/google-fonts?q=${q}`, {
      headers: { host: "127.0.0.1:3000" },
    }) as never
  );
}

describe("google fonts route", () => {
  it("downloads the font list once and shares it across searches", async () => {
    const metadata = {
      familyMetadataList: [
        { family: "Roboto", category: "Sans Serif", fonts: { "400": {} } },
        { family: "Lora", category: "Serif", fonts: { "400": {} } },
      ],
    };
    const fetchMock = vi.fn(
      async () => new Response(`)]}'\n${JSON.stringify(metadata)}`)
    );
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([search("rob"), search("lo")]);
    const c = await search("");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (await a.json()).fonts.map((f: { family: string }) => f.family)
    ).toEqual(["Roboto"]);
    expect(
      (await b.json()).fonts.map((f: { family: string }) => f.family)
    ).toEqual(["Lora"]);
    // Sorted once at download time.
    expect(
      (await c.json()).fonts.map((f: { family: string }) => f.family)
    ).toEqual(["Lora", "Roboto"]);
  });
});
