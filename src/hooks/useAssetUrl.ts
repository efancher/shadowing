import { useEffect, useState } from "react";
import { AssetService } from "../services";

const assetService = new AssetService();

export function useAssetUrl(assetId?: string) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!assetId) {
      setUrl(undefined);
      return;
    }
    let active = true;
    let release: (() => void) | undefined;
    assetService
      .acquireUrl(assetId)
      .then((lease) => {
        if (!active) {
          lease.release();
          return;
        }
        release = lease.release;
        setUrl(lease.url);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Audio could not be loaded.");
      });
    return () => {
      active = false;
      release?.();
    };
  }, [assetId]);

  return { url, error };
}
