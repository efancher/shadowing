export interface ParsedCue {
  startMs: number;
  endMs: number;
  text: string;
}

const TIMESTAMP =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

function parseTimestamp(value: string): number {
  const match = value.trim().match(TIMESTAMP);
  if (!match) throw new Error(`Invalid subtitle timestamp: ${value}`);
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4].padEnd(3, "0");
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction);
}

function normalizeText(lines: string[]) {
  return lines
    .join("\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function parseWebVtt(content: string): ParsedCue[] {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!/^WEBVTT/m.test(text)) throw new Error("Not a WebVTT file.");
  const blocks = text.split(/\n{2,}/).slice(1);
  const cues: ParsedCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0 && !line.startsWith("NOTE"));
    if (lines.length === 0) continue;
    const timingLine = lines.find((line) => line.includes("-->"));
    if (!timingLine) continue;
    const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const textLines = lines.slice(lines.indexOf(timingLine) + 1);
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (endMs <= startMs) continue;
    const cueText = normalizeText(textLines);
    if (!cueText) continue;
    cues.push({ startMs, endMs, text: cueText });
  }
  return cues;
}

export function parseSrt(content: string): ParsedCue[] {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  const blocks = text.split(/\n{2,}/);
  const cues: ParsedCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 2) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim());
    const startMs = parseTimestamp(startRaw.replace(",", "."));
    const endMs = parseTimestamp(endRaw.replace(",", "."));
    if (endMs <= startMs) continue;
    const cueText = normalizeText(lines.slice(timingIndex + 1));
    if (!cueText) continue;
    cues.push({ startMs, endMs, text: cueText });
  }
  return cues;
}

export function detectSubtitleFormat(fileName: string, content: string): "webvtt" | "srt" {
  if (/\.vtt$/i.test(fileName) || /^WEBVTT/m.test(content)) return "webvtt";
  if (/\.srt$/i.test(fileName)) return "srt";
  if (content.includes("-->") && content.includes(",")) return "srt";
  throw new Error("Unsupported subtitle format. Use WebVTT or SRT.");
}

export function mergeCueTexts(cues: ParsedCue[]) {
  return cues.map((cue) => cue.text).join("").replace(/\n+/g, "").trim();
}
