import { useEffect, useRef, useState } from "react";
import { FINE_ADJUST_STEPS, formatClock, loadYouTubeApi } from "../services";

interface YouTubeMinerProps {
  videoId: string;
  japanese: string;
  reading: string;
  english: string;
  onJapaneseChange: (value: string) => void;
  onReadingChange: (value: string) => void;
  onEnglishChange: (value: string) => void;
  onSave: (startSeconds: number, endSeconds: number) => Promise<void> | void;
  busy?: boolean;
}

export function YouTubeMiner({
  videoId,
  japanese,
  reading,
  english,
  onJapaneseChange,
  onReadingChange,
  onEnglishChange,
  onSave,
  busy
}: YouTubeMinerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const [current, setCurrent] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(2);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const loopRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YTApi) => {
        if (cancelled || !hostRef.current) return;
        playerRef.current = new YTApi.Player(hostRef.current, {
          videoId,
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1
          },
          events: {
            onReady: () => setReady(true),
            onError: () => setError("YouTube playback failed. Check the URL or network connection.")
          }
        });
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not load YouTube.");
      });
    const timer = window.setInterval(() => {
      const time = playerRef.current?.getCurrentTime?.();
      if (typeof time === "number") setCurrent(time);
    }, 200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (loopRef.current) window.clearInterval(loopRef.current);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId]);

  function setFromPlayback(which: "start" | "end") {
    const time = playerRef.current?.getCurrentTime?.() ?? current;
    if (which === "start") setStart(Math.max(0, time));
    else setEnd(Math.max(time, start + 0.05));
  }

  function nudge(which: "start" | "end", delta: number) {
    if (which === "start") setStart((value) => Math.max(0, value + delta));
    else setEnd((value) => Math.max(start + 0.05, value + delta));
  }

  function replaySelection() {
    const player = playerRef.current;
    if (!player) return;
    if (loopRef.current) window.clearInterval(loopRef.current);
    player.seekTo(start, true);
    player.playVideo();
    loopRef.current = window.setInterval(() => {
      const time = player.getCurrentTime();
      if (time >= end) {
        player.seekTo(start, true);
      }
    }, 150);
  }

  function stopLoop() {
    if (loopRef.current) window.clearInterval(loopRef.current);
    playerRef.current?.pauseVideo?.();
  }

  return (
    <div className="youtube-miner card form-card">
      <h2>YouTube sentence miner</h2>
      <p className="muted">
        Playback and timestamps only. Pitch and waveform analysis require a local reference clip.
      </p>
      <div className="youtube-host" ref={hostRef} />
      {error && <p className="notice error">{error}</p>}
      <p className="muted">Current: {formatClock(current)} · Selection {formatClock(start)}–{formatClock(end)}</p>
      <div className="button-row">
        <button className="secondary" type="button" disabled={!ready} onClick={() => setFromPlayback("start")}>
          Set start
        </button>
        <button className="secondary" type="button" disabled={!ready} onClick={() => setFromPlayback("end")}>
          Set end
        </button>
        <button className="secondary" type="button" disabled={!ready} onClick={replaySelection}>
          Replay selection
        </button>
        <button className="secondary" type="button" onClick={stopLoop}>
          Stop loop
        </button>
      </div>
      <div className="nudge-grid">
        <div>
          <span className="player-label">Start adjust</span>
          <div className="button-row">
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`ys-${step}`} className="secondary compact" type="button" onClick={() => nudge("start", -step)}>
                -{step}
              </button>
            ))}
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`ys+${step}`} className="secondary compact" type="button" onClick={() => nudge("start", step)}>
                +{step}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="player-label">End adjust</span>
          <div className="button-row">
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`ye-${step}`} className="secondary compact" type="button" onClick={() => nudge("end", -step)}>
                -{step}
              </button>
            ))}
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`ye+${step}`} className="secondary compact" type="button" onClick={() => nudge("end", step)}>
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label>
        Japanese sentence
        <textarea rows={3} lang="ja" value={japanese} onChange={(event) => onJapaneseChange(event.target.value)} />
      </label>
      <label>
        Reading <span className="optional">optional</span>
        <input lang="ja" value={reading} onChange={(event) => onReadingChange(event.target.value)} />
      </label>
      <label>
        English <span className="optional">optional</span>
        <input value={english} onChange={(event) => onEnglishChange(event.target.value)} />
      </label>
      <button
        className="primary"
        type="button"
        disabled={busy || !japanese.trim()}
        onClick={() => void onSave(start, end)}
      >
        Save sentence
      </button>
    </div>
  );
}
