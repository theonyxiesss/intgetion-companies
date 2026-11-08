import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { HttpError } from "@intgetion/kit";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const acceptedMime = new Set(["image/png", "image/jpeg", "image/webp"]);

function signatureMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

export async function convertLogo(input: Buffer, declaredMime: string) {
  if (
    !input.length ||
    input.length > LOGO_MAX_BYTES ||
    !acceptedMime.has(declaredMime)
  ) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid logo file");
  }
  const actualMime = signatureMime(input);
  if (!actualMime || actualMime !== declaredMime)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Logo MIME does not match its file signature",
    );
  let output: Buffer;
  try {
    const image = sharp(input, {
      limitInputPixels: 40_000_000,
      failOn: "error",
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 10_000 ||
      metadata.height > 10_000
    )
      throw new Error("Invalid dimensions");
    output = await image
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid image data");
  }
  return {
    path: `${randomUUID()}.webp`,
    bytes: output,
    contentType: "image/webp" as const,
  };
}

export interface LogoStorage {
  upload(
    path: string,
    bytes: Buffer,
    contentType: "image/webp",
  ): Promise<string>;
}

export async function storeLogo(
  input: Buffer,
  declaredMime: string,
  storage: LogoStorage,
) {
  const converted = await convertLogo(input, declaredMime);
  const path = await storage.upload(
    converted.path,
    converted.bytes,
    converted.contentType,
  );
  return { logoPath: path };
}

export class MemoryLogoStorage implements LogoStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  async upload(path: string, bytes: Buffer, contentType: "image/webp") {
    this.objects.set(path, { bytes, contentType });
    return path;
  }
}
