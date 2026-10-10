"""Instructor-side video configuration for the watch-verification engine.

* playback config: ordered sources (hosted / YouTube / Vimeo) for failover,
  sign-language companion, admin-verified duration, the ``verifiedWatch``
  switch;
* manual captions: volunteers upload a VTT/SRT per language (no AI), stored
  next to the AI tracks and served by the same ``/stream/captions`` route;
* sign-language video upload;
* duration probe for Vimeo (oEmbed) so admins do not have to type lengths.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Optional

import httpx
from fastapi import HTTPException, Request, UploadFile, status
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac.resource_access import AccessAction, check_resource_access
from src.services.utils.upload_content import upload_content, upload_file
from src.services.video_progress.video_content import (
    VideoPlaybackConfigIn,
    extract_vimeo,
    extract_youtube_id,
    normalize_video_content,
)

logger = logging.getLogger(__name__)

_LANG_RE = re.compile(r"^[A-Za-z0-9-]{2,20}$")
MAX_CAPTION_BYTES = 2 * 1024 * 1024
MAX_SIGN_VIDEO_BYTES = 2 * 1024 * 1024 * 1024


# --------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------

_SRT_TIME = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")


def srt_to_vtt(text: str) -> str:
    """Convert SubRip to WebVTT: header, ``,`` → ``.`` in timestamps, cue
    numbers kept (valid in VTT). Already-VTT input is returned untouched."""
    body = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    if body.lstrip().startswith("WEBVTT"):
        return body
    converted = _SRT_TIME.sub(lambda m: f"{m.group(1).zfill(2)}:{m.group(2)}:{m.group(3)}.{m.group(4).ljust(3, '0')}", body)
    return "WEBVTT\n\n" + converted.strip() + "\n"


def validate_vtt(text: str) -> None:
    if not text.lstrip().startswith("WEBVTT"):
        raise HTTPException(status_code=400, detail="Caption file must be WebVTT or SubRip")
    if "-->" not in text:
        raise HTTPException(status_code=400, detail="Caption file has no cues")


# --------------------------------------------------------------------------
# Shared loading
# --------------------------------------------------------------------------


async def _load_video_for_edit(
    request: Request, activity_uuid: str, current_user: PublicUser | AnonymousUser, db_session: AsyncSession
) -> tuple[Activity, Course, Organization]:
    activity = (await db_session.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.activity_type != ActivityTypeEnum.TYPE_VIDEO:
        raise HTTPException(status_code=400, detail="Not a video activity")
    course = (await db_session.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    org = (await db_session.execute(select(Organization).where(Organization.id == activity.org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return activity, course, org


def _video_dir(course: Course, activity: Activity) -> str:
    return f"courses/{course.course_uuid}/activities/{activity.activity_uuid}/video"


# --------------------------------------------------------------------------
# Playback config
# --------------------------------------------------------------------------


async def update_playback_config(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
    config: VideoPlaybackConfigIn,
) -> dict:
    activity, course, _org = await _load_video_for_edit(request, activity_uuid, current_user, db_session)

    content = normalize_video_content(activity.content, activity.activity_sub_type)
    if config.sources:
        sources = [s.model_dump(exclude_none=True) for s in config.sources]
        # Hosted sources must point at this activity's own file.
        own_file = (activity.content or {}).get("filename")
        for s in sources:
            if s["provider"] == "hosted" and own_file and s.get("filename") != own_file:
                raise HTTPException(status_code=400, detail="Hosted source must be this activity's uploaded video")
        content["sources"] = sources
        # Keep legacy mirrors in sync with the new primary.
        primary = sources[0]
        if primary["provider"] == "youtube":
            content["uri"] = f"https://www.youtube.com/watch?v={primary['videoId']}"
            content["type"] = "youtube"
        elif primary["provider"] == "vimeo":
            content["uri"] = f"https://vimeo.com/{primary['videoId']}" + (f"/{primary['hash']}" if primary.get("hash") else "")
            content["type"] = "vimeo"
    if config.signVideo is not None:
        sv = config.signVideo.model_dump(exclude_none=True)
        if sv["provider"] == "youtube":
            vid = extract_youtube_id(sv.get("videoId"))
            if not vid:
                raise HTTPException(status_code=400, detail="Sign video needs a valid YouTube id")
            sv["videoId"] = vid
        elif not sv.get("filename"):
            raise HTTPException(status_code=400, detail="Sign video needs an uploaded file")
        content["signVideo"] = sv
    elif "signVideo" in (activity.content or {}) and config.signVideo is None and config.model_fields_set and "signVideo" in config.model_fields_set:
        content["signVideo"] = None

    details = dict(activity.details or {})
    if config.durationSeconds is not None:
        details["durationSeconds"] = float(config.durationSeconds)
        details["durationSource"] = config.durationSource or "admin"
        details["durationVerifiedAt"] = str(datetime.now())
    if config.verifiedWatch is not None:
        details["verifiedWatch"] = bool(config.verifiedWatch)
    if config.captionsDefault is not None:
        captions = dict(details.get("captions") or {})
        captions["default"] = config.captionsDefault
        details["captions"] = captions
    details["policyVersion"] = 2

    activity.content = content
    activity.details = details
    activity.update_date = str(datetime.now())
    flag_modified(activity, "content")
    flag_modified(activity, "details")
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(activity)
    return {"content": activity.content, "details": activity.details}


# --------------------------------------------------------------------------
# Manual captions
# --------------------------------------------------------------------------


def _caption_languages(meta: dict) -> list[dict]:
    return list((meta.get("captions") or {}).get("languages") or [])


async def upload_manual_caption(
    request: Request,
    activity_uuid: str,
    lang: str,
    label: Optional[str],
    file: UploadFile,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    activity, course, org = await _load_video_for_edit(request, activity_uuid, current_user, db_session)
    code = (lang or "").strip()
    if not _LANG_RE.match(code):
        raise HTTPException(status_code=400, detail=f"Invalid language code: {lang!r}")
    raw = await file.read()
    if len(raw) > MAX_CAPTION_BYTES:
        raise HTTPException(status_code=413, detail="Caption file too large")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-16")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Caption file must be UTF-8 text")
    vtt = srt_to_vtt(text)
    validate_vtt(vtt)

    await upload_content(
        directory=f"{_video_dir(course, activity)}/captions",
        type_of_dir="orgs",
        uuid=org.org_uuid,
        file_binary=vtt.encode("utf-8"),
        file_and_format=f"{code}.vtt",
        allowed_formats=["vtt"],
    )

    meta = dict(activity.extra_metadata or {})
    captions = dict(meta.get("captions") or {})
    languages = [l for l in _caption_languages(meta) if l.get("code") != code]
    languages.append({"code": code, "label": (label or code).strip(), "status": "ready", "source": "manual", "updated_at": str(datetime.now())})
    captions.update({"enabled": True, "languages": languages, "status": captions.get("status") or "ready", "error": None, "updated_at": str(datetime.now())})
    meta["captions"] = captions
    activity.extra_metadata = meta
    flag_modified(activity, "extra_metadata")
    activity.update_date = str(datetime.now())
    db_session.add(activity)
    await db_session.commit()
    return captions


async def delete_manual_caption(
    request: Request,
    activity_uuid: str,
    lang: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    activity, _course, _org = await _load_video_for_edit(request, activity_uuid, current_user, db_session)
    code = (lang or "").strip()
    meta = dict(activity.extra_metadata or {})
    captions = dict(meta.get("captions") or {})
    languages = _caption_languages(meta)
    remaining = [l for l in languages if not (l.get("code") == code and l.get("source") == "manual")]
    if len(remaining) == len(languages):
        raise HTTPException(status_code=404, detail="Manual caption track not found")
    captions["languages"] = remaining
    captions["enabled"] = bool(remaining)
    captions["updated_at"] = str(datetime.now())
    meta["captions"] = captions
    activity.extra_metadata = meta
    flag_modified(activity, "extra_metadata")
    db_session.add(activity)
    await db_session.commit()
    # The stored file is left in place (harmless; overwritten on re-upload).
    return captions


def merge_manual_languages(existing: list[dict], regenerated: list[dict]) -> list[dict]:
    """Keep volunteer-uploaded tracks when the AI pipeline rebuilds its list;
    an AI entry for the same code never replaces a manual one."""
    manual = [l for l in existing if l.get("source") == "manual"]
    manual_codes = {l.get("code") for l in manual}
    return manual + [l for l in regenerated if l.get("code") not in manual_codes]


# --------------------------------------------------------------------------
# Sign-language companion upload
# --------------------------------------------------------------------------


async def upload_sign_video(
    request: Request,
    activity_uuid: str,
    file: UploadFile,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    activity, course, org = await _load_video_for_edit(request, activity_uuid, current_user, db_session)
    if file.content_type not in ("video/mp4", "video/webm"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sign video must be MP4 or WebM")
    saved = await upload_file(
        file=file,
        directory=_video_dir(course, activity),
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["video"],
        filename_prefix="sign",
        max_size=MAX_SIGN_VIDEO_BYTES,
    )
    content = normalize_video_content(activity.content, activity.activity_sub_type)
    content["signVideo"] = {"provider": "hosted", "filename": saved}
    activity.content = content
    flag_modified(activity, "content")
    activity.update_date = str(datetime.now())
    db_session.add(activity)
    await db_session.commit()
    return {"signVideo": content["signVideo"]}


# --------------------------------------------------------------------------
# Duration probe
# --------------------------------------------------------------------------


async def probe_video_url(url: str) -> dict:
    """Identify a pasted URL and, for Vimeo, fetch its duration via oEmbed.
    YouTube durations are probed in the browser (IFrame API); the server only
    extracts the id."""
    raw = (url or "").strip()
    if not raw or len(raw) > 2048:
        raise HTTPException(status_code=400, detail="Invalid URL")
    yid = extract_youtube_id(raw)
    if yid:
        return {"provider": "youtube", "videoId": yid, "durationSeconds": None}
    vid, vhash = extract_vimeo(raw)
    if vid:
        oembed = "https://vimeo.com/api/oembed.json"
        params = {"url": f"https://vimeo.com/{vid}" + (f"/{vhash}" if vhash else "")}
        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
                resp = await client.get(oembed, params=params)
        except httpx.HTTPError as e:
            logger.warning("Vimeo oEmbed failed: %s", e)
            raise HTTPException(status_code=502, detail="Vimeo did not answer")
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Vimeo video not found or not embeddable")
        try:
            data = resp.json()
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="Vimeo answered with invalid data")
        return {
            "provider": "vimeo",
            "videoId": vid,
            "hash": vhash,
            "title": data.get("title"),
            "durationSeconds": float(data.get("duration") or 0) or None,
        }
    raise HTTPException(status_code=400, detail="Unsupported video URL")


__all__ = [
    "ActivitySubTypeEnum",
    "VideoPlaybackConfigIn",
    "delete_manual_caption",
    "merge_manual_languages",
    "probe_video_url",
    "srt_to_vtt",
    "update_playback_config",
    "upload_manual_caption",
    "upload_sign_video",
    "validate_vtt",
]
