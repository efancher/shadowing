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

export interface DerivedAnalysis {
  id: string;
  attemptId: string;
  kind: string;
  algorithm: string;
  algorithmVersion: string;
  payload: unknown;
  createdAt: string;
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
