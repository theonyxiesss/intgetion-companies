import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  convertLogo,
  LOGO_MAX_BYTES,
  MemoryLogoStorage,
  storeLogo,
} from "../service";

const png = () =>
  sharp({
    create: { width: 24, height: 16, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();

describe("company logo validation and conversion", () => {
  it("accepts a PNG signature and converts it to a 256px WebP with a random name", async () => {
    const source = await png();
    const first = await convertLogo(source, "image/png");
    const second = await convertLogo(source, "image/png");
    expect(first.path).toMatch(/^[0-9a-f-]+\.webp$/);
    expect(first.path).not.toBe(second.path);
    expect(await sharp(first.bytes).metadata()).toMatchObject({
      format: "webp",
      width: 256,
      height: 256,
    });
  });
  it("rejects a MIME value that does not match the file signature", async () => {
    await expect(convertLogo(await png(), "image/jpeg")).rejects.toMatchObject({
      status: 400,
    });
  });
  it("rejects unsupported types and data larger than 2 MB", async () => {
    await expect(
      convertLogo(Buffer.from("x"), "image/gif"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      convertLogo(Buffer.alloc(LOGO_MAX_BYTES + 1), "image/png"),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("uploads through the storage interface test double", async () => {
    const storage = new MemoryLogoStorage();
    const result = await storeLogo(await png(), "image/png", storage);
    expect(storage.objects.get(result.logoPath)?.contentType).toBe(
      "image/webp",
    );
  });
});
