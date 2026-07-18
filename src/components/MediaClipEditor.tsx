import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { FINE_ADJUST_STEPS, formatClock } from "../services";

interface MediaClipEditorProps {
  url: string;
  mimeType?: string;
  initialStart?: number;
  initialEnd?: number;
  onSave: (startSeconds: number, endSeconds: number) => Promise<void> | void;
  busy?: boolean;
}

export function MediaClipEditor({
  url,
  mimeType,
  initialStart = 0,
  initialEnd,
  onSave,
  busy
}: MediaClipEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<{ start: number; end: number; setOptions: (options: { start: number; end: number }) => void } | null>(null);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd ?? initialStart + 2);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const wave = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 96,
      waveColor: "#9db5ad",
      progressColor: "#17352f",
      cursorColor: "#eeb655",
      normalize: true,
      plugins: [regions]
    });
    waveRef.current = wave;
    wave.on("ready", () => {
      const total = wave.getDuration();
      setDuration(total);
      const regionEnd = Math.min(total, initialEnd ?? Math.min(total, initialStart + 2));
      const regionStart = Math.min(initialStart, Math.max(0, regionEnd - 0.2));
      const region = regions.addRegion({
        start: regionStart,
        end: regionEnd,
        color: "rgba(238, 182, 85, 0.28)",
        drag: true,
        resize: true
      });
      regionRef.current = region;
      setStart(region.start);
      setEnd(region.end);
      region.on("update-end", () => {
        setStart(region.start);
        setEnd(region.end);
      });
    });
    wave.on("error", () => setError("Could not render this media waveform."));
    return () => {
      wave.destroy();
      waveRef.current = null;
      regionRef.current = null;
    };
  }, [url, initialStart, initialEnd]);

  function nudge(which: "start" | "end", delta: number) {
    const region = regionRef.current;
    if (!region) return;
    const nextStart = which === "start" ? Math.max(0, region.start + delta) : region.start;
    const nextEnd = which === "end" ? Math.min(duration || region.end + delta, region.end + delta) : region.end;
    if (nextEnd - nextStart < 0.05) return;
    region.setOptions({ start: nextStart, end: nextEnd });
    setStart(nextStart);
    setEnd(nextEnd);
  }

  async function loopSelection() {
    const wave = waveRef.current;
    if (!wave) return;
    await wave.play(start, end);
  }

  return (
    <div className="clip-editor">
      <div ref={containerRef} className="waveform-host" />
      {error && <p className="notice error">{error}</p>}
      <div className="form-grid">
        <label>
          Start
          <input
            type="number"
            step="0.01"
            min={0}
            value={start.toFixed(2)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value) || !regionRef.current) return;
              const next = Math.min(value, end - 0.05);
              regionRef.current.setOptions({ start: next, end });
              setStart(next);
            }}
          />
        </label>
        <label>
          End
          <input
            type="number"
            step="0.01"
            min={0}
            value={end.toFixed(2)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value) || !regionRef.current) return;
              const next = Math.max(value, start + 0.05);
              regionRef.current.setOptions({ start, end: next });
              setEnd(next);
            }}
          />
        </label>
      </div>
      <p className="muted">
        Selection {formatClock(start)} – {formatClock(end)}
        {mimeType ? ` · ${mimeType}` : ""}
      </p>
      <div className="nudge-grid">
        <div>
          <span className="player-label">Start</span>
          <div className="button-row">
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`start-${step}`} className="secondary compact" type="button" onClick={() => nudge("start", -step)}>
                -{step}
              </button>
            ))}
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`start+${step}`} className="secondary compact" type="button" onClick={() => nudge("start", step)}>
                +{step}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="player-label">End</span>
          <div className="button-row">
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`end-${step}`} className="secondary compact" type="button" onClick={() => nudge("end", -step)}>
                -{step}
              </button>
            ))}
            {FINE_ADJUST_STEPS.map((step) => (
              <button key={`end+${step}`} className="secondary compact" type="button" onClick={() => nudge("end", step)}>
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="button-row">
        <button className="secondary" type="button" onClick={() => void loopSelection()}>
          Replay selection
        </button>
        <button className="primary" type="button" disabled={busy} onClick={() => void onSave(start, end)}>
          Save as reference clip
        </button>
      </div>
    </div>
  );
}
