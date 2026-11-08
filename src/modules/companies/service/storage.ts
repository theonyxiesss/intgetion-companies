import { companiesPorts } from "../../../ports";
import type { LogoStorage } from "./logo-service";

/** Logos live in the platform's storage; this service holds no storage key. */
export class PortLogoStorage implements LogoStorage {
  async upload(path: string, bytes: Buffer, contentType: "image/webp") {
    return companiesPorts().uploadLogo(path, bytes, contentType);
  }

  async download(path: string): Promise<Buffer | null> {
    return companiesPorts().downloadLogo(path);
  }
}
