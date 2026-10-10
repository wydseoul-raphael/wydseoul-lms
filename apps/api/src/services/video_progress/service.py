"""Watch sessions, heartbeats and progress reads.

Flow (mirrors the reference learning center):

    startWatchSession → recordWatchHeartbeat ×N → (server) complete

* ``start_watch_session`` runs the reader gate (published / paid / usergroup
  lock / sequential lock), snapshots the trusted duration, supersedes any
  other active session of the same learner on the same video and returns the
  resume point.
* ``record_heartbeat`` is the hot path: one progress row + one session row,
  idempotent on an increasing ``seq``. Credit comes from server timestamps
  (``progress_math``); a client cannot earn more than real time.
* When the policy says the video is complete the TrailStep is created through
  the same completion core the manual button uses, unless the activity has an
  end quiz (then the quiz service finishes the job).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.trail_steps import TrailStep
from src.db.users import AnonymousUser, PublicUser, User
from src.db.video_progress import (
    VideoProgress,
    VideoProgressCompletionState,
    WatchSession,
    WatchSessionStatus,
)
from src.security.rbac.resource_access import AccessAction, check_resource_access
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.courses.activities.access import (
    verify_activity_reader_access,
    verify_activity_reader_access_by_uuid,
)
from src.services.courses.locks import is_org_admin
from src.services.courses.progression import (
    completed_activity_ids,
    course_is_sequential,
    locked_activity_ids,
    ordered_activity_ids,
)
from src.services.trail.trail import complete_activity_for_user
from src.services.video_progress import progress_math as pm
from src.services.video_progress.video_content import (
    has_end_quiz,
    is_verified_watch,
    resolve_trusted_duration,
)

logger = logging.getLogger(__name__)

PlayerState = Literal["playing", "paused", "ended"]
Provider = Literal["hosted", "youtube", "vimeo"]


# --------------------------------------------------------------------------
# Payloads
# --------------------------------------------------------------------------


class StartSessionIn(BaseModel):
    sourceProvider: Optional[Provider] = None
    clientReportedDuration: Optional[float] = Field(default=None, ge=0, le=24 * 3600)


class HeartbeatIn(BaseModel):
    sessionId: str = Field(max_length=64)
    activityUuid: str = Field(max_length=128)
    seq: int = Field(ge=1, le=10_000_000)
    currentTime: float = Field(ge=0, le=24 * 3600)
    playbackRate: float = Field(default=1.0, ge=0, le=16)
    playerState: PlayerState
    visible: bool = True
    sourceProvider: Optional[Provider] = None


class CloseSessionIn(BaseModel):
    currentTime: Optional[float] = Field(default=None, ge=0, le=24 * 3600)


POLICY = {
    "version": pm.POLICY_VERSION,
    "heartbeatSeconds": pm.HEARTBEAT_SECONDS,
    "bucketSeconds": pm.BUCKET_SECONDS,
    "completeRatio": pm.COMPLETE_RATIO,
    "maxPlaybackRate": pm.MAX_PLAYBACK_RATE,
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _now(now: Optional[datetime]) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    return now if now.tzinfo else now.replace(tzinfo=timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Timestamps come back naive from SQLite (and from some drivers); they
    were written as UTC, so re-attach the zone before doing arithmetic."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _elapsed_since(ts: datetime, last: Optional[datetime]) -> float:
    last_utc = _as_utc(last)
    return max(0.0, (ts - last_utc).total_seconds()) if last_utc else 0.0


def _require_user(user) -> PublicUser:
    if isinstance(user, AnonymousUser) or user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


def _state_from_row(row: VideoProgress) -> pm.ProgressState:
    bucket_count = row.bucket_count or pm.bucket_count_for(row.duration_seconds or 0)
    return pm.ProgressState(
        verified_seconds=float(row.verified_seconds or 0),
        furthest_verified_position=float(row.furthest_verified_position or 0),
        resume_position=float(row.resume_position or 0),
        coverage=pm.decode_coverage(row.coverage_bitmap, bucket_count),
        bucket_count=bucket_count,
        last_position=row.last_position,
        last_rate=float(row.last_rate or 1.0),
        last_state=row.last_state or "init",  # type: ignore[arg-type]
        last_visible=bool(row.last_visible),
    )


def _write_state(row: VideoProgress, state: pm.ProgressState) -> None:
    row.verified_seconds = state.verified_seconds
    row.furthest_verified_position = state.furthest_verified_position
    row.resume_position = state.resume_position
    row.coverage_bitmap = pm.encode_coverage(state.coverage)
    row.covered_bucket_count = len(pm.coverage_bucket_indexes(state.coverage))
    row.bucket_count = state.bucket_count
    row.last_position = state.last_position
    row.last_rate = state.last_rate
    row.last_state = state.last_state
    row.last_visible = state.last_visible


def _snapshot(row: VideoProgress, *, extra: dict | None = None) -> dict:
    duration = float(row.duration_seconds or 0)
    state = _state_from_row(row)
    covered = pm.coverage_seconds(state.coverage, duration) if duration else 0.0
    required = pm.required_seconds(duration) if duration else None
    complete = pm.is_complete(state.verified_seconds, covered, duration) if duration else False
    percent = min(100.0, (state.verified_seconds / required) * 100.0) if required else 0.0
    out = {
        "activityId": row.activity_id,
        "policy": POLICY,
        "durationSeconds": duration or None,
        "durationTrusted": bool(duration),
        "requiredWatchSeconds": required,
        "verifiedWatchSeconds": round(state.verified_seconds, 2),
        "videoPercent": round(percent, 1),
        "furthestVerifiedPosition": round(state.furthest_verified_position, 2),
        "resumePosition": round(state.resume_position, 2),
        "coverageSeconds": round(covered, 2),
        "coverageRatio": round(covered / duration, 4) if duration else 0.0,
        "coverageBuckets": pm.coverage_bucket_indexes(state.coverage),
        "isComplete": complete,
        "videoComplete": complete,
        "completionState": row.completion_state,
        "sessionId": row.active_session_uuid,
        "seq": row.last_seq,
        "heartbeatCount": row.heartbeat_count,
        "rejectedSeekCount": row.rejected_seek_count,
        "videoCompletedAt": _as_utc(row.video_completed_at).isoformat() if row.video_completed_at else None,
    }
    if extra:
        out.update(extra)
    return out


async def _load_progress(user_id: int, activity_id: int, db_session: AsyncSession, *, for_update: bool = False) -> VideoProgress | None:
    stmt = select(VideoProgress).where(VideoProgress.user_id == user_id, VideoProgress.activity_id == activity_id)
    if for_update and db_session.bind is not None and db_session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    return (await db_session.execute(stmt)).scalars().first()


def _ensure_video(activity: Activity) -> None:
    if activity.activity_type != ActivityTypeEnum.TYPE_VIDEO:
        raise HTTPException(status_code=400, detail="Watch verification only applies to video activities")


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


async def start_watch_session(
    request: Request,
    user,
    activity_uuid: str,
    body: StartSessionIn,
    db_session: AsyncSession,
    *,
    now: Optional[datetime] = None,
) -> dict:
    user = _require_user(user)
    ts = _now(now)
    activity, course = await verify_activity_reader_access_by_uuid(request, activity_uuid, user, db_session)
    _ensure_video(activity)

    duration, duration_source = resolve_trusted_duration(activity)
    progress = await _load_progress(user.id, activity.id, db_session, for_update=True)
    if progress is None:
        progress = VideoProgress(
            org_id=course.org_id,
            course_id=course.id,
            activity_id=activity.id,
            user_id=user.id,
            duration_seconds=duration,
            bucket_count=pm.bucket_count_for(duration or 0),
            coverage_bitmap=pm.encode_coverage(pm.new_state(duration or 0).coverage),
            created_at=ts,
            updated_at=ts,
        )
    elif duration and (progress.duration_seconds or 0) != duration:
        # Admin corrected the length: keep what was watched, re-size the bitset.
        new_count = pm.bucket_count_for(duration)
        progress.coverage_bitmap = pm.encode_coverage(
            pm.resize_coverage(pm.decode_coverage(progress.coverage_bitmap, progress.bucket_count or new_count), new_count)
        )
        progress.bucket_count = new_count
        progress.duration_seconds = duration
    if body.clientReportedDuration:
        progress.client_reported_duration = body.clientReportedDuration

    # One active session per learner and video: any other tab loses its anchor.
    stale = (
        await db_session.execute(
            select(WatchSession).where(
                WatchSession.user_id == user.id,
                WatchSession.activity_id == activity.id,
                WatchSession.status == WatchSessionStatus.ACTIVE,
            )
        )
    ).scalars().all()
    for s in stale:
        s.status = WatchSessionStatus.SUPERSEDED
        s.ended_at = ts
        db_session.add(s)

    ua = request.headers.get("user-agent", "") if request is not None and hasattr(request, "headers") else ""
    session = WatchSession(
        session_uuid=f"ws_{uuid4()}",
        org_id=course.org_id,
        course_id=course.id,
        activity_id=activity.id,
        user_id=user.id,
        status=WatchSessionStatus.ACTIVE,
        started_at=ts,
        last_heartbeat_at=ts,
        start_position=float(progress.resume_position or 0),
        source_provider=body.sourceProvider,
        user_agent_hash=hashlib.sha256(ua.encode("utf-8")).hexdigest()[:32] if ua else None,
    )
    db_session.add(session)

    progress.active_session_uuid = session.session_uuid
    progress.last_seq = 0
    progress.last_state = "init"
    progress.last_position = None
    progress.last_heartbeat_at = ts
    progress.updated_at = ts
    db_session.add(progress)
    await db_session.commit()
    await db_session.refresh(progress)

    return _snapshot(
        progress,
        extra={
            "sessionId": session.session_uuid,
            "durationSource": duration_source,
            "hasEndQuiz": has_end_quiz(activity.details),
            "verifiedWatch": is_verified_watch(activity.details),
            "serverTime": ts.isoformat(),
        },
    )


async def close_watch_session(
    request: Request,
    user,
    session_uuid: str,
    body: CloseSessionIn,
    db_session: AsyncSession,
    *,
    now: Optional[datetime] = None,
) -> dict:
    """Explicit close (pagehide). Equivalent to a paused heartbeat on the
    session's last known position, then the session is marked closed."""
    user = _require_user(user)
    ts = _now(now)
    session = (
        await db_session.execute(select(WatchSession).where(WatchSession.session_uuid == session_uuid))
    ).scalars().first()
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    progress = await _load_progress(user.id, session.activity_id, db_session, for_update=True)
    result: dict = {"closed": True}
    if progress and progress.active_session_uuid == session.session_uuid and session.status == WatchSessionStatus.ACTIVE:
        position = body.currentTime if body.currentTime is not None else (progress.last_position or progress.resume_position or 0.0)
        elapsed = _elapsed_since(ts, progress.last_heartbeat_at)
        hb = pm.Heartbeat(position=float(position), rate=float(progress.last_rate or 1.0), state="paused", visible=progress.last_visible)
        res = pm.apply_heartbeat(_state_from_row(progress), hb, elapsed, float(progress.duration_seconds or 0))
        _write_state(progress, res.state)
        progress.last_heartbeat_at = ts
        progress.updated_at = ts
        session.credited_seconds += res.credited_seconds
        await _maybe_complete(request, user, progress, res, db_session, ts)
        result = _snapshot(progress, extra={"closed": True, "creditedSeconds": round(res.credited_seconds, 2)})
    session.status = WatchSessionStatus.CLOSED
    session.ended_at = ts
    session.last_heartbeat_at = ts
    db_session.add(session)
    if progress:
        db_session.add(progress)
    await db_session.commit()
    return result


# --------------------------------------------------------------------------
# Heartbeat
# --------------------------------------------------------------------------


async def _maybe_complete(
    request: Request,
    user: PublicUser,
    progress: VideoProgress,
    res: pm.HeartbeatResult,
    db_session: AsyncSession,
    ts: datetime,
) -> bool:
    """Flip the row to complete and create the TrailStep when the policy is
    satisfied. Side effects (webhooks, certificate) never fail the heartbeat:
    the progress itself is already durable."""
    if not res.newly_complete or progress.video_completed_at is not None:
        return False
    progress.video_completed_at = ts
    activity = (await db_session.execute(select(Activity).where(Activity.id == progress.activity_id))).scalars().first()
    course = (await db_session.execute(select(Course).where(Course.id == progress.course_id))).scalars().first()
    if activity is None or course is None:
        return False
    duration = float(progress.duration_seconds or 0)
    covered = pm.coverage_seconds(res.state.coverage, duration)
    step_data = {
        "videoComplete": True,
        "verifiedWatchSeconds": round(res.state.verified_seconds, 2),
        "coverageSeconds": round(covered, 2),
        "coverageRatio": round(covered / duration, 4) if duration else 0.0,
        "durationSeconds": duration,
        "policyVersion": pm.POLICY_VERSION,
        "bestQuizScore": None,
        "quizPassed": None,
        "completedAt": ts.isoformat(),
        "completedBy": "video_engine",
    }
    from src.services.courses.activities.video_quiz import get_quiz_gate_state

    gate = await get_quiz_gate_state(user.id, activity.id, db_session)
    if gate["required"] and not gate["passed"]:
        progress.completion_state = VideoProgressCompletionState.VIDEO_COMPLETE_QUIZ_PENDING
    else:
        step_data["bestQuizScore"] = gate.get("bestScore")
        step_data["quizPassed"] = gate["passed"] if gate["hasEndQuiz"] else None
        progress.completion_state = VideoProgressCompletionState.COMPLETE
        db_session.add(progress)
        await db_session.commit()
        try:
            await complete_activity_for_user(request, user, activity, course, db_session, step_data=step_data, source="video_engine")
        except Exception:  # pragma: no cover - side effects must not break the heartbeat
            logger.exception("Completion side effects failed for activity %s", activity.activity_uuid)
    try:
        await track(
            event_name=analytics_events.VIDEO_COMPLETED,
            org_id=course.org_id,
            user_id=user.id,
            properties={
                "activity_uuid": activity.activity_uuid,
                "course_uuid": course.course_uuid,
                "verified_watch_seconds": step_data["verifiedWatchSeconds"],
                "coverage_ratio": step_data["coverageRatio"],
            },
        )
    except Exception:  # pragma: no cover
        logger.exception("Analytics track failed for video completion")
    return True


async def record_heartbeat(
    request: Request,
    user,
    body: HeartbeatIn,
    db_session: AsyncSession,
    *,
    now: Optional[datetime] = None,
) -> dict:
    user = _require_user(user)
    ts = _now(now)
    activity = (await db_session.execute(select(Activity).where(Activity.activity_uuid == body.activityUuid))).scalars().first()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    progress = await _load_progress(user.id, activity.id, db_session, for_update=True)
    if progress is None or not progress.active_session_uuid:
        raise HTTPException(status_code=404, detail={"code": "NO_SESSION", "message": "Start a watch session first"})
    if body.sessionId != progress.active_session_uuid:
        raise HTTPException(
            status_code=409,
            detail={"code": "SESSION_SUPERSEDED", "message": "Another session is active for this video"},
        )
    if body.seq <= (progress.last_seq or 0):
        # Retry or out-of-order delivery: harmless, report the current state.
        return _snapshot(progress, extra={"accepted": False, "reason": "stale_seq", "creditedSeconds": 0.0, "newlyComplete": False, "serverTime": ts.isoformat()})

    elapsed = _elapsed_since(ts, progress.last_heartbeat_at)
    duration = float(progress.duration_seconds or 0)
    hb = pm.Heartbeat(position=body.currentTime, rate=body.playbackRate, state=body.playerState, visible=body.visible)
    res = pm.apply_heartbeat(_state_from_row(progress), hb, elapsed, duration)

    _write_state(progress, res.state)
    progress.last_seq = body.seq
    progress.heartbeat_count = (progress.heartbeat_count or 0) + 1
    if res.reason == "seek":
        progress.rejected_seek_count = (progress.rejected_seek_count or 0) + 1
    progress.last_heartbeat_at = ts
    progress.updated_at = ts

    session = (await db_session.execute(select(WatchSession).where(WatchSession.session_uuid == body.sessionId))).scalars().first()
    if session is not None:
        session.heartbeats = (session.heartbeats or 0) + 1
        session.credited_seconds = float(session.credited_seconds or 0) + res.credited_seconds
        session.last_heartbeat_at = ts
        if body.sourceProvider:
            session.source_provider = body.sourceProvider
        if body.playerState == "ended":
            session.status = WatchSessionStatus.CLOSED
            session.ended_at = ts
        db_session.add(session)
    db_session.add(progress)
    await db_session.commit()

    newly_complete = await _maybe_complete(request, user, progress, res, db_session, ts)
    if newly_complete:
        db_session.add(progress)
        await db_session.commit()
    await db_session.refresh(progress)

    return _snapshot(
        progress,
        extra={
            "accepted": True,
            "reason": res.reason,
            "creditedSeconds": round(res.credited_seconds, 2),
            "newlyComplete": newly_complete,
            "serverTime": ts.isoformat(),
        },
    )


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------


async def get_activity_progress(request: Request, user, activity_uuid: str, db_session: AsyncSession) -> dict:
    """The learner's own progress on one video (empty state when never started)."""
    user = _require_user(user)
    activity, course = await verify_activity_reader_access_by_uuid(request, activity_uuid, user, db_session)
    duration, duration_source = resolve_trusted_duration(activity)
    progress = await _load_progress(user.id, activity.id, db_session)
    if progress is None:
        return {
            "activityId": activity.id,
            "policy": POLICY,
            "durationSeconds": duration,
            "durationTrusted": bool(duration),
            "durationSource": duration_source,
            "requiredWatchSeconds": pm.required_seconds(duration) if duration else None,
            "verifiedWatchSeconds": 0.0,
            "videoPercent": 0.0,
            "furthestVerifiedPosition": 0.0,
            "resumePosition": 0.0,
            "coverageSeconds": 0.0,
            "coverageRatio": 0.0,
            "coverageBuckets": [],
            "isComplete": False,
            "videoComplete": False,
            "completionState": VideoProgressCompletionState.IN_PROGRESS,
            "sessionId": None,
            "seq": 0,
            "hasEndQuiz": has_end_quiz(activity.details),
            "verifiedWatch": is_verified_watch(activity.details),
        }
    return _snapshot(progress, extra={"durationSource": duration_source, "hasEndQuiz": has_end_quiz(activity.details), "verifiedWatch": is_verified_watch(activity.details)})


async def get_course_progress_summary(request: Request, user, course_uuid: str, db_session: AsyncSession) -> dict:
    """Per-activity progress for the learner across one course, in curriculum
    order, with lock state — what the curriculum rail and 나의 학습 render."""
    user = _require_user(user)
    course = (await db_session.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.READ)

    ordered = await ordered_activity_ids(course.id, db_session)
    activities = (await db_session.execute(select(Activity).where(Activity.id.in_(ordered)))).scalars().all() if ordered else []  # type: ignore[attr-defined]
    by_id = {a.id: a for a in activities}
    completed = await completed_activity_ids(user.id, course.id, db_session)
    locked_ids, unlock_by = locked_activity_ids(ordered, completed) if course_is_sequential(course) else (set(), {})
    rows = (await db_session.execute(select(VideoProgress).where(VideoProgress.user_id == user.id, VideoProgress.course_id == course.id))).scalars().all()
    progress_by_activity = {r.activity_id: r for r in rows}

    items = []
    for activity_id in ordered:
        a = by_id.get(activity_id)
        if a is None:
            continue
        p = progress_by_activity.get(activity_id)
        duration, _ = resolve_trusted_duration(a)
        is_video = a.activity_type == ActivityTypeEnum.TYPE_VIDEO
        verified = float(p.verified_seconds) if p else 0.0
        required = pm.required_seconds(duration) if duration else None
        gate = unlock_by.get(activity_id)
        items.append(
            {
                "activityUuid": a.activity_uuid,
                "name": a.name,
                "activityType": a.activity_type,
                "activitySubType": a.activity_sub_type,
                "isVideo": is_video,
                "verifiedWatch": is_verified_watch(a.details) if is_video else False,
                "durationSeconds": duration,
                "verifiedWatchSeconds": round(verified, 2),
                "videoPercent": round(min(100.0, verified / required * 100.0), 1) if required else (100.0 if activity_id in completed else 0.0),
                "videoComplete": bool(p and p.video_completed_at),
                "completionState": p.completion_state if p else VideoProgressCompletionState.IN_PROGRESS,
                "complete": activity_id in completed,
                "locked": activity_id in locked_ids,
                "lockReason": "sequential" if activity_id in locked_ids else None,
                "unlockActivityUuid": by_id[gate].activity_uuid if gate in by_id else None,
                "resumePosition": round(float(p.resume_position), 2) if p else 0.0,
            }
        )
    total = len(items)
    done = sum(1 for i in items if i["complete"])
    return {
        "courseUuid": course.course_uuid,
        "sequential": course_is_sequential(course),
        "activities": items,
        "completedCount": done,
        "totalCount": total,
        "percent": round(done / total * 100.0, 1) if total else 0.0,
        "verifiedWatchSeconds": round(sum(i["verifiedWatchSeconds"] for i in items), 2),
    }


async def get_course_progress_admin(
    request: Request,
    user,
    course_uuid: str,
    db_session: AsyncSession,
    *,
    user_uuid: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    """Learner × video rows for one course (course UPDATE right or org admin)."""
    user = _require_user(user)
    course = (await db_session.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if not await is_org_admin(user.id, course.org_id, db_session):
        await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.UPDATE)

    page = max(1, page)
    limit = max(1, min(200, limit))
    stmt = (
        select(VideoProgress, User, Activity)
        .join(User, User.id == VideoProgress.user_id)  # type: ignore[arg-type]
        .join(Activity, Activity.id == VideoProgress.activity_id)  # type: ignore[arg-type]
        .where(VideoProgress.course_id == course.id)
    )
    count_stmt = select(func.count()).select_from(VideoProgress).where(VideoProgress.course_id == course.id)
    if user_uuid:
        stmt = stmt.where(User.user_uuid == user_uuid)
        count_stmt = count_stmt.join(User, User.id == VideoProgress.user_id).where(User.user_uuid == user_uuid)  # type: ignore[arg-type]
    total = (await db_session.execute(count_stmt)).scalar() or 0
    rows = (await db_session.execute(stmt.order_by(VideoProgress.updated_at.desc()).offset((page - 1) * limit).limit(limit))).all()  # type: ignore[attr-defined]

    data = []
    for progress, u, a in rows:
        snap = _snapshot(progress)
        data.append(
            {
                "user": {"user_uuid": u.user_uuid, "username": u.username, "email": u.email},
                "activity": {"activity_uuid": a.activity_uuid, "name": a.name},
                "verifiedWatchSeconds": snap["verifiedWatchSeconds"],
                "videoPercent": snap["videoPercent"],
                "coverageRatio": snap["coverageRatio"],
                "furthestVerifiedPosition": snap["furthestVerifiedPosition"],
                "completionState": progress.completion_state,
                "videoCompletedAt": snap["videoCompletedAt"],
                "heartbeatCount": progress.heartbeat_count,
                "rejectedSeekCount": progress.rejected_seek_count,
                "updatedAt": _as_utc(progress.updated_at).isoformat() if progress.updated_at else None,
            }
        )
    return {"data": data, "page": page, "page_size": limit, "total": total}


__all__ = [
    "StartSessionIn",
    "HeartbeatIn",
    "CloseSessionIn",
    "start_watch_session",
    "record_heartbeat",
    "close_watch_session",
    "get_activity_progress",
    "get_course_progress_summary",
    "get_course_progress_admin",
    "complete_after_quiz_pass",
    "verify_activity_reader_access",
    "TrailStep",
]


async def complete_after_quiz_pass(
    request: Request,
    user: PublicUser,
    activity: Activity,
    course: Course,
    db_session: AsyncSession,
    *,
    best_score: float,
) -> bool:
    """Called by the quiz service when the end quiz is passed. If the video is
    already verified-complete the lesson finishes now; otherwise the pass is
    remembered and the heartbeat engine finishes it when the video completes."""
    progress = await _load_progress(user.id, activity.id, db_session, for_update=True)
    if progress is None or progress.video_completed_at is None:
        return False
    if progress.completion_state == VideoProgressCompletionState.COMPLETE:
        return True
    ts = datetime.now(timezone.utc)
    duration = float(progress.duration_seconds or 0)
    state = _state_from_row(progress)
    covered = pm.coverage_seconds(state.coverage, duration)
    step_data = {
        "videoComplete": True,
        "verifiedWatchSeconds": round(state.verified_seconds, 2),
        "coverageSeconds": round(covered, 2),
        "coverageRatio": round(covered / duration, 4) if duration else 0.0,
        "durationSeconds": duration,
        "policyVersion": pm.POLICY_VERSION,
        "bestQuizScore": best_score,
        "quizPassed": True,
        "completedAt": ts.isoformat(),
        "completedBy": "video_quiz",
    }
    progress.completion_state = VideoProgressCompletionState.COMPLETE
    progress.updated_at = ts
    db_session.add(progress)
    await db_session.commit()
    try:
        await complete_activity_for_user(request, user, activity, course, db_session, step_data=step_data, source="video_quiz")
    except Exception:  # pragma: no cover
        logger.exception("Completion side effects failed after quiz pass for %s", activity.activity_uuid)
    return True
