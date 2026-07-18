export function extractYouTubeId(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined;
    }
    if (url.hostname.includes("youtube.com")) {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery && /^[a-zA-Z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
      const parts = url.pathname.split("/").filter(Boolean);
      const embedIndex = parts.findIndex((part) => part === "embed" || part === "shorts" || part === "live");
      if (embedIndex >= 0) {
        const id = parts[embedIndex + 1];
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function loadYouTubeApi(): Promise<typeof YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-youtube-api]");
    const previous = (window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady;
    (window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API failed to load."));
    };
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.youtubeApi = "true";
      script.onerror = () => reject(new Error("Could not load the YouTube player API."));
      document.head.appendChild(script);
    }
  });
}
