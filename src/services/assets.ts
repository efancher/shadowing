import type { AudioAsset } from "../types";
import { db, type ShadowingDatabase } from "../db/schema";
import { getMediaDurationMs, newId, nowIso } from "./shared";

interface UrlLease {
  url: string;
  release: () => void;
}

interface UrlEntry {
  url: string;
  consumers: number;
}

export class AssetService {
  private readonly urls = new Map<string, UrlEntry>();

  constructor(private readonly database: ShadowingDatabase = db) {}

  async createAsset(
    kind: AudioAsset["kind"],
    blob: Blob,
    originalFileName?: string,
    knownDurationMs?: number
  ): Promise<AudioAsset> {
    if (!blob.size) throw new Error("The audio file is empty.");
    return {
      id: newId(),
      kind,
      blob,
      mimeType: blob.type || "application/octet-stream",
      byteLength: blob.size,
      durationMs: knownDurationMs ?? (await getMediaDurationMs(blob)),
      originalFileName,
      createdAt: nowIso()
    };
  }

  async acquireUrl(assetId: string): Promise<UrlLease> {
    let entry = this.urls.get(assetId);
    if (!entry) {
      const asset = await this.database.audioAssets.get(assetId);
      if (!asset) throw new Error("Audio is no longer available.");
      entry = { url: URL.createObjectURL(asset.blob), consumers: 0 };
      this.urls.set(assetId, entry);
    }
    entry.consumers += 1;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        const current = this.urls.get(assetId);
        if (!current) return;
        current.consumers -= 1;
        if (current.consumers <= 0) {
          URL.revokeObjectURL(current.url);
          this.urls.delete(assetId);
        }
      }
    };
  }
}
