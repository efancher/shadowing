export type SourceType =
  | "youtube"
  | "uploaded-video"
  | "uploaded-audio"
  | "podcast"
  | "manual"
  | "other";

export type TranscriptStatus =
  | "unverified"
  | "machine-generated"
  | "manually-corrected"
  | "verified";

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  url?: string;
  externalId?: string;
  channelOrCreator?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MinedSentence {
  id: string;
  sourceId: string;
  japanese: string;
  reading?: string;
  english?: string;
  startSeconds?: number;
  endSeconds?: number;
  speakerLabel?: string;
  tags: string[];
  difficulty?: number;
  notes?: string;
  transcriptStatus: TranscriptStatus;
  referenceAudioId?: string;
  createdAt: string;
  updatedAt: string;
}

export type AudioAssetKind = "reference" | "attempt";

export interface AudioAsset {
  id: string;
  kind: AudioAssetKind;
  blob: Blob;
  mimeType: string;
  byteLength: number;
  durationMs: number;
  originalFileName?: string;
  createdAt: string;
}

export type ReferenceSourceType =
  | "local-media-clip"
  | "uploaded-audio"
  | "browser-recording"
  | "generated-tts";

export interface ReferenceAudio {
  id: string;
  sentenceId: string;
  audioAssetId: string;
  sourceType: ReferenceSourceType;
  originalStartSeconds?: number;
  originalEndSeconds?: number;
  createdAt: string;
}

export type ManualRating = "better" | "same" | "worse" | "unsure";

export interface PronunciationAttempt {
  id: string;
  sentenceId: string;
  audioAssetId: string;
  durationMs: number;
  notes?: string;
  manualRating?: ManualRating;
  focusTags?: string[];
  isFavorite?: boolean;
  createdAt: string;
}

export type AnalysisSubjectType = "asset" | "comparison" | "sentence";

export interface DerivedAnalysis {
  id: string;
  /** @deprecated Prefer subjectType/subjectId. Kept for v1 records. */
  attemptId?: string;
  subjectType: AnalysisSubjectType;
  subjectId: string;
  kind: string;
  algorithm: string;
  algorithmVersion: string;
  inputAssetIds?: string[];
  timingGuideRevision?: number;
  payload: unknown;
  createdAt: string;
}

export type SourceMediaKind = "audio" | "video";

export interface SourceMedia {
  id: string;
  sourceId: string;
  kind: SourceMediaKind;
  blob: Blob;
  mimeType: string;
  byteLength: number;
  durationMs: number;
  originalFileName?: string;
  createdAt: string;
}

export type SubtitleFormat = "webvtt" | "srt";

export interface SubtitleTrack {
  id: string;
  sourceId: string;
  language?: string;
  label?: string;
  format: SubtitleFormat;
  transcriptStatus: TranscriptStatus;
  createdAt: string;
}

export interface SubtitleCue {
  id: string;
  trackId: string;
  sourceId: string;
  startMs: number;
  endMs: number;
  text: string;
  order: number;
}

export interface MoraUnit {
  label: string;
  startSeconds: number;
  endSeconds: number;
  kind?: "normal" | "sokuon" | "hatsuon" | "long-vowel" | "pause";
}

export interface TimingGuide {
  id: string;
  sentenceId: string;
  readingSnapshot?: string;
  textSnapshot: string;
  morae: MoraUnit[];
  origin: "heuristic" | "manual";
  confidence: ConfidenceLevel;
  revision: number;
  updatedAt: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PracticeChunk {
  id: string;
  sentenceId: string;
  order: number;
  text: string;
  translation?: string;
  startSeconds?: number;
  endSeconds?: number;
  notes?: string;
}

export type PracticeMode = "full" | "chunk" | "shadowing" | "compare";

export interface PracticeEvent {
  id: string;
  sentenceId: string;
  attemptId?: string;
  chunkId?: string;
  mode: PracticeMode;
  rating?: ManualRating;
  focusTags?: string[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface MetadataExport {
  manifest: {
    format: "japanese-pronunciation-lab";
    version: 1;
    exportedAt: string;
    mediaIncluded: false;
  };
  sources: Source[];
  sentences: Array<Omit<MinedSentence, "referenceAudioId">>;
  practiceSummary: {
    referenceClipCount: number;
    attemptCount: number;
  };
}

export interface MediaArchiveManifest {
  format: "japanese-pronunciation-lab";
  version: 2;
  exportedAt: string;
  mediaIncluded: true;
}

export type AlignmentMode = "original" | "onset-aligned" | "time-normalized";

export interface PitchFrame {
  timeSeconds: number;
  hz: number | null;
  voiced: boolean;
  confidence: number;
  relativeSemitones: number | null;
}

export interface PitchAnalysisPayload {
  frames: PitchFrame[];
  medianHz: number | null;
  voicedRatio: number;
  durationSeconds: number;
}

export interface AlignmentPayload {
  mode: AlignmentMode;
  offsetSeconds: number;
  durationRatio: number;
  confidence: ConfidenceLevel;
}

export interface TimingObservation {
  id: string;
  kind: string;
  message: string;
  confidence: ConfidenceLevel;
  detail?: string;
}
