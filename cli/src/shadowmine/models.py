from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


SourceType = Literal["youtube", "uploaded-video", "uploaded-audio", "podcast", "manual", "other"]
TranscriptStatus = Literal["unverified", "auto-caption", "manually-corrected", "verified"]


class GeneratorInfo(BaseModel):
    name: str
    version: str


class PackageManifest(BaseModel):
    format: Literal["japanese-shadowing-package"] = "japanese-shadowing-package"
    version: Literal[1] = 1
    createdAt: str
    generator: GeneratorInfo


class PackageSource(BaseModel):
    id: str
    type: SourceType = "youtube"
    url: str | None = None
    videoId: str | None = None
    title: str
    channel: str | None = None
    durationMs: int | None = None


class PackageAudio(BaseModel):
    path: str
    mimeType: Literal["audio/mp4", "audio/aac", "audio/wav", "audio/x-m4a"] = "audio/mp4"
    durationMs: int = Field(ge=1)


class PackageSentence(BaseModel):
    id: str
    japanese: str
    reading: str | None = None
    english: str | None = None
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=1)
    subtitleStartMs: int | None = None
    subtitleEndMs: int | None = None
    adjustedStartMs: int | None = None
    adjustedEndMs: int | None = None
    speaker: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    transcriptStatus: TranscriptStatus = "unverified"
    audio: PackageAudio

    @field_validator("japanese")
    @classmethod
    def japanese_nonempty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("japanese text is required")
        return cleaned


class ProjectSource(BaseModel):
    id: str
    type: SourceType = "youtube"
    url: str
    videoId: str
    title: str
    channel: str | None = None
    durationMs: int | None = None
    webpageUrl: str | None = None


class ProjectSentence(BaseModel):
    id: str
    japanese: str
    english: str | None = None
    reading: str | None = None
    startMs: int
    endMs: int
    subtitleStartMs: int | None = None
    subtitleEndMs: int | None = None
    adjustedStartMs: int | None = None
    adjustedEndMs: int | None = None
    speaker: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    transcriptStatus: TranscriptStatus = "manually-corrected"
    clipPath: str
    audioDurationMs: int
    mimeType: Literal["audio/mp4", "audio/aac", "audio/wav", "audio/x-m4a"] = "audio/mp4"


class Cue(BaseModel):
    index: int
    startMs: int
    endMs: int
    text: str
    isAuto: bool = False
