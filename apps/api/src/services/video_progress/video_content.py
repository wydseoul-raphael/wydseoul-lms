"""Video activity content/details helpers (schema v2, read-time normalisation).

Legacy activities store ``content = {"uri", "type"}`` (YouTube) or
``{"filename"}`` (hosted). Schema v2 adds an ordered ``sources`` list for
disaster-recovery failover (hosted HLS first, YouTube/Vimeo backups), an
optional sign-language companion video and, in ``details``, the admin-verified
duration and the ``verifiedWatch`` switch. Nothing is migrated: every reader
goes through :func:`normalize_video_content`.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Provider = Literal["hosted", "youtube", "vimeo"]

YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
VIMEO_ID_RE = re.compile(r"^\d{5,15}$")
VIMEO_HASH_RE = re.compile(r"^[A-Za-z0-9]{6,32}$")
MAX_SOURCES = 5


def extract_youtube_id(value: str | None) -> str:
    """YouTube id from an id, watch/short/embed URL, or ``youtu.be`` link."""
    raw = (value or "").strip()
    if not raw:
        return ""
    if YOUTUBE_ID_RE.match(raw):
        return raw
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})", raw)
    return m.group(1) if m else ""


def extract_vimeo(value: str | None) -> tuple[str, str | None]:
    """(video_id, unlisted_hash) from a Vimeo id or URL."""
    raw = (value or "").strip()
    if not raw:
        return "", None
    if VIMEO_ID_RE.match(raw):
        return raw, None
    m = re.search(r"vimeo\.com/(?:video/)?(\d{5,15})(?:/([A-Za-z0-9]{6,32}))?", raw)
    if not m:
        return "", None
    hash_part = m.group(2)
    if not hash_part:
        h = re.search(r"[?&]h=([A-Za-z0-9]{6,32})", raw)
        hash_part = h.group(1) if h else None
    return m.group(1), hash_part


class VideoSource(BaseModel):
    provider: Provider
    # hosted
    filename: Optional[str] = None
    # youtube / vimeo
    videoId: Optional[str] = None
    hash: Optional[str] = None
    label: Optional[str] = None

    @field_validator("videoId")
    @classmethod
    def _validate_video_id(cls, v, info):
        return v

    def validate_for_provider(self) -> None:
        if self.provider == "hosted":
            if not self.filename or "/" in self.filename or ".." in self.filename:
                raise ValueError("hosted source needs a plain filename")
        elif self.provider == "youtube":
            if not self.videoId or not YOUTUBE_ID_RE.match(self.videoId):
                raise ValueError("youtube source needs an 11-character video id")
        elif self.provider == "vimeo":
            if not self.videoId or not VIMEO_ID_RE.match(self.videoId):
                raise ValueError("vimeo source needs a numeric video id")
            if self.hash and not VIMEO_HASH_RE.match(self.hash):
                raise ValueError("vimeo hash is malformed")


class SignVideo(BaseModel):
    provider: Literal["hosted", "youtube"]
    filename: Optional[str] = None
    videoId: Optional[str] = None


class VideoPlaybackConfigIn(BaseModel):
    """Admin payload for ``PUT /activities/video/{uuid}/playback-config``."""

    sources: list[VideoSource] = Field(default_factory=list, max_length=MAX_SOURCES)
    signVideo: Optional[SignVideo] = None
    durationSeconds: Optional[float] = Field(default=None, ge=1, le=24 * 3600)
    durationSource: Optional[Literal["admin", "probe:hls", "probe:youtube", "probe:vimeo", "probe:file"]] = None
    verifiedWatch: Optional[bool] = None
    captionsDefault: Optional[str] = Field(default=None, max_length=8)

    @field_validator("sources")
    @classmethod
    def _validate_sources(cls, sources: list[VideoSource]):
        for s in sources:
            s.validate_for_provider()
        return sources


def normalize_video_content(content: dict | None, sub_type: str | None = None) -> dict:
    """Upgrade any stored ``content`` to the v2 shape without mutating it."""
    content = dict(content or {})
    sources: list[dict] = []
    for raw in content.get("sources") or []:
        if isinstance(raw, dict) and raw.get("provider") in ("hosted", "youtube", "vimeo"):
            sources.append(dict(raw))
    if not sources:
        if content.get("filename") or sub_type == "SUBTYPE_VIDEO_HOSTED":
            if content.get("filename"):
                sources.append({"provider": "hosted", "filename": content["filename"]})
        if content.get("uri"):
            if (content.get("type") or "youtube") == "vimeo":
                vid, h = extract_vimeo(content["uri"])
                if vid:
                    sources.append({"provider": "vimeo", "videoId": vid, **({"hash": h} if h else {})})
            else:
                yid = extract_youtube_id(content["uri"])
                if yid:
                    sources.append({"provider": "youtube", "videoId": yid})
    sign = content.get("signVideo") if isinstance(content.get("signVideo"), dict) else None
    out = {
        **content,
        "schemaVersion": 2,
        "sources": sources,
        "signVideo": sign,
    }
    # Keep legacy mirrors so old clients keep working.
    primary = sources[0] if sources else None
    if primary:
        if primary["provider"] == "hosted":
            out.setdefault("filename", primary.get("filename"))
        elif primary["provider"] == "youtube":
            out.setdefault("uri", f"https://www.youtube.com/watch?v={primary.get('videoId')}")
            out.setdefault("type", "youtube")
        elif primary["provider"] == "vimeo":
            out.setdefault("uri", f"https://vimeo.com/{primary.get('videoId')}")
            out.setdefault("type", "vimeo")
    return out


def is_verified_watch(details: dict | None) -> bool:
    return bool((details or {}).get("verifiedWatch"))


def has_end_quiz(details: dict | None) -> bool:
    quiz = (details or {}).get("endQuiz")
    return bool(quiz) and bool((quiz or {}).get("enabled", True)) if isinstance(quiz, dict) else bool(quiz)


def details_duration(details: dict | None) -> float | None:
    try:
        d = float((details or {}).get("durationSeconds") or 0)
    except (TypeError, ValueError):
        return None
    return d if d > 0 else None


def hls_duration(extra_metadata: dict | None) -> float | None:
    try:
        d = float(((extra_metadata or {}).get("hls") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        return None
    return d if d > 0 else None


def resolve_trusted_duration(activity: Any) -> tuple[float | None, str | None]:
    """(seconds, source) — admin-entered first, then the ffprobe value saved
    by the HLS transcode. ``(None, None)`` when nothing trustworthy exists;
    the client's own duration is never used for completion."""
    d = details_duration(getattr(activity, "details", None))
    if d:
        src = (getattr(activity, "details", None) or {}).get("durationSource") or "admin"
        return d, str(src)
    d = hls_duration(getattr(activity, "extra_metadata", None))
    if d:
        return d, "probe:hls"
    return None, None
