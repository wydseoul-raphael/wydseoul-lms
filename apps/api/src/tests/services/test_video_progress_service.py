"""Tests for src/services/video_progress/service.py (sessions, heartbeats, reads)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.trail_steps import TrailStep
from src.db.video_progress import VideoProgress, VideoProgressCompletionState, WatchSession, WatchSessionStatus
from src.services.video_progress import service as svc
from src.services.video_progress.service import (
    CloseSessionIn,
    HeartbeatIn,
    StartSessionIn,
    close_watch_session,
    get_activity_progress,
    get_course_progress_admin,
    get_course_progress_summary,
    record_heartbeat,
    start_watch_session,
)

T0 = datetime(2026, 12, 1, 9, 0, 0, tzinfo=timezone.utc)


async def _make_video(db, org, course, chapter, *, id, uuid, order, duration=600, details=None, published=True):
    a = Activity(
        id=id,
        name=f"Video {id}",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"uri": "https://www.youtube.com/watch?v=42M5kFJU804", "type": "youtube"},
        details={"durationSeconds": duration, "verifiedWatch": True, **(details or {})},
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    db.add(
        ChapterActivity(
            order=order,
            chapter_id=chapter.id,
            activity_id=a.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return a


@pytest.fixture
async def video(db, org, course, chapter):
    return await _make_video(db, org, course, chapter, id=10, uuid="activity_video_1", order=1)


@pytest.fixture
def pass_gate(video, course):
    """Bypass the reader gate (RBAC/paywall/locks are tested elsewhere)."""
    with patch.object(svc, "verify_activity_reader_access_by_uuid", new=AsyncMock(return_value=(video, course))) as m:
        yield m


@pytest.fixture
def no_side_effects():
    with patch.object(svc, "complete_activity_for_user", new=AsyncMock(return_value=(None, True))) as complete, patch.object(
        svc, "track", new=AsyncMock()
    ) as track:
        yield complete, track


async def _start(request, user, db, *, now=T0, body=None):
    return await start_watch_session(request, user, "activity_video_1", body or StartSessionIn(), db, now=now)


def _hb(session_id, seq, t, state="playing", rate=1.0, visible=True):
    return HeartbeatIn(
        sessionId=session_id, activityUuid="activity_video_1", seq=seq, currentTime=t,
        playbackRate=rate, playerState=state, visible=visible,
    )


class TestStartSession:
    async def test_anonymous_rejected(self, db, mock_request, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await _start(mock_request, anonymous_user, db)
        assert exc.value.status_code == 401

    async def test_creates_progress_and_session(self, db, mock_request, regular_user, pass_gate):
        res = await _start(mock_request, regular_user, db)
        assert res["sessionId"].startswith("ws_")
        assert res["durationSeconds"] == 600 and res["durationTrusted"] is True
        assert res["requiredWatchSeconds"] == pytest.approx(540)
        assert res["resumePosition"] == 0 and res["verifiedWatchSeconds"] == 0
        assert res["policy"]["heartbeatSeconds"] == 10
        row = (await db.execute(__import__("sqlmodel").select(VideoProgress))).scalars().one()
        assert row.active_session_uuid == res["sessionId"]

    async def test_second_start_supersedes_first(self, db, mock_request, regular_user, pass_gate):
        first = await _start(mock_request, regular_user, db)
        second = await _start(mock_request, regular_user, db, now=T0 + timedelta(seconds=30))
        assert first["sessionId"] != second["sessionId"]
        from sqlmodel import select

        sessions = (await db.execute(select(WatchSession).order_by(WatchSession.id))).scalars().all()
        assert [s.status for s in sessions] == [WatchSessionStatus.SUPERSEDED, WatchSessionStatus.ACTIVE]
        # Old tab's heartbeat is refused.
        with pytest.raises(HTTPException) as exc:
            await record_heartbeat(mock_request, regular_user, _hb(first["sessionId"], 1, 5), db, now=T0 + timedelta(seconds=40))
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == "SESSION_SUPERSEDED"

    async def test_non_video_rejected(self, db, mock_request, regular_user, activity, course):
        with patch.object(svc, "verify_activity_reader_access_by_uuid", new=AsyncMock(return_value=(activity, course))):
            with pytest.raises(HTTPException) as exc:
                await start_watch_session(mock_request, regular_user, activity.activity_uuid, StartSessionIn(), db)
        assert exc.value.status_code == 400

    async def test_duration_change_resizes_coverage(self, db, mock_request, regular_user, pass_gate, video):
        res = await _start(mock_request, regular_user, db)
        sid = res["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 10), db, now=T0 + timedelta(seconds=10))
        video.details = {**video.details, "durationSeconds": 300}
        db.add(video)
        await db.commit()
        res2 = await _start(mock_request, regular_user, db, now=T0 + timedelta(seconds=20))
        assert res2["durationSeconds"] == 300
        assert res2["coverageSeconds"] == pytest.approx(10)
        assert res2["verifiedWatchSeconds"] == pytest.approx(10)


class TestHeartbeat:
    async def test_requires_session(self, db, mock_request, regular_user, video):
        with pytest.raises(HTTPException) as exc:
            await record_heartbeat(mock_request, regular_user, _hb("ws_nope", 1, 0), db)
        assert exc.value.status_code == 404

    async def test_stale_seq_is_acknowledged_without_credit(self, db, mock_request, regular_user, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        r2 = await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 10), db, now=T0 + timedelta(seconds=10))
        assert r2["accepted"] and r2["creditedSeconds"] == pytest.approx(10)
        again = await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 10), db, now=T0 + timedelta(seconds=11))
        assert again["accepted"] is False and again["reason"] == "stale_seq"
        assert again["verifiedWatchSeconds"] == pytest.approx(10)

    async def test_forward_seek_is_rejected_and_counted(self, db, mock_request, regular_user, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        r = await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 300), db, now=T0 + timedelta(seconds=10))
        assert r["accepted"] and r["reason"] == "seek" and r["creditedSeconds"] == 0
        assert r["rejectedSeekCount"] == 1 and r["resumePosition"] == 300
        assert r["furthestVerifiedPosition"] == 0

    async def test_hidden_tab_and_forged_rate(self, db, mock_request, regular_user, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0, visible=False), db, now=T0)
        r = await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 10), db, now=T0 + timedelta(seconds=10))
        assert r["reason"] == "hidden" and r["creditedSeconds"] == 0
        # Claims 3x but the position only advanced 10 s in 10 s.
        r = await record_heartbeat(mock_request, regular_user, _hb(sid, 3, 20, rate=3.0), db, now=T0 + timedelta(seconds=20))
        assert r["creditedSeconds"] == pytest.approx(10, abs=0.01)
        r = await record_heartbeat(mock_request, regular_user, _hb(sid, 4, 30, rate=3.0), db, now=T0 + timedelta(seconds=30))
        assert r["reason"] == "rate_mismatch_clamped"
        assert r["creditedSeconds"] <= 10.6

    async def test_full_watch_completes_and_creates_trail_step(self, db, mock_request, regular_user, pass_gate, no_side_effects, video):
        complete, track = no_side_effects
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        last = None
        for i in range(1, 55):
            last = await record_heartbeat(mock_request, regular_user, _hb(sid, i + 1, i * 10), db, now=T0 + timedelta(seconds=i * 10))
        assert last["newlyComplete"] is True and last["isComplete"] is True
        assert last["completionState"] == VideoProgressCompletionState.COMPLETE
        assert last["videoPercent"] == 100
        complete.assert_awaited_once()
        kwargs = complete.await_args.kwargs
        assert kwargs["source"] == "video_engine"
        assert kwargs["step_data"]["videoComplete"] is True
        assert kwargs["step_data"]["verifiedWatchSeconds"] == pytest.approx(540)
        track.assert_awaited_once()
        # One more heartbeat: not "newly" complete again.
        more = await record_heartbeat(mock_request, regular_user, _hb(sid, 60, 560), db, now=T0 + timedelta(seconds=560))
        assert more["newlyComplete"] is False and more["isComplete"] is True
        complete.assert_awaited_once()

    async def test_end_quiz_defers_trail_step(self, db, mock_request, regular_user, pass_gate, no_side_effects, video):
        complete, _ = no_side_effects
        video.details = {**video.details, "endQuiz": {"enabled": True}}
        db.add(video)
        await db.commit()
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        last = None
        for i in range(1, 55):
            last = await record_heartbeat(mock_request, regular_user, _hb(sid, i + 1, i * 10), db, now=T0 + timedelta(seconds=i * 10))
        assert last["completionState"] == VideoProgressCompletionState.VIDEO_COMPLETE_QUIZ_PENDING
        assert last["videoComplete"] is True
        complete.assert_not_awaited()

    async def test_untrusted_duration_never_completes(self, db, mock_request, regular_user, course, org, chapter, no_side_effects):
        complete, _ = no_side_effects
        v = await _make_video(db, org, course, chapter, id=11, uuid="activity_video_1", order=2, duration=None)
        v.details = {"verifiedWatch": True}
        db.add(v)
        await db.commit()
        with patch.object(svc, "verify_activity_reader_access_by_uuid", new=AsyncMock(return_value=(v, course))):
            res = await _start(mock_request, regular_user, db)
            assert res["durationTrusted"] is False and res["requiredWatchSeconds"] is None
            sid = res["sessionId"]
            await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
            last = None
            for i in range(1, 80):
                last = await record_heartbeat(mock_request, regular_user, _hb(sid, i + 1, i * 10), db, now=T0 + timedelta(seconds=i * 10))
        assert last["verifiedWatchSeconds"] > 700
        assert last["isComplete"] is False
        complete.assert_not_awaited()

    async def test_real_completion_core_creates_step(self, db, mock_request, regular_user, pass_gate, video, course, org):
        """Integration: the engine's completion lands a TrailStep with data."""
        from src.db.trails import Trail

        db.add(Trail(org_id=org.id, user_id=regular_user.id, trail_uuid="trail_vp", creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()
        with patch("src.services.trail.trail.track", new=AsyncMock()), patch(
            "src.services.trail.trail.record_audit_event", new=AsyncMock()
        ), patch("src.services.trail.trail.dispatch_webhooks", new=AsyncMock()), patch.object(svc, "track", new=AsyncMock()):
            sid = (await _start(mock_request, regular_user, db))["sessionId"]
            await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
            for i in range(1, 55):
                await record_heartbeat(mock_request, regular_user, _hb(sid, i + 1, i * 10), db, now=T0 + timedelta(seconds=i * 10))
        from sqlmodel import select

        step = (await db.execute(select(TrailStep).where(TrailStep.activity_id == video.id))).scalars().one()
        assert step.complete is True
        assert step.data["videoComplete"] is True and step.data["completedBy"] == "video_engine"


class TestCloseSession:
    async def test_close_credits_last_interval(self, db, mock_request, regular_user, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        res = await close_watch_session(mock_request, regular_user, sid, CloseSessionIn(currentTime=8), db, now=T0 + timedelta(seconds=8))
        assert res["closed"] is True and res["creditedSeconds"] == pytest.approx(8)
        from sqlmodel import select

        s = (await db.execute(select(WatchSession).where(WatchSession.session_uuid == sid))).scalars().one()
        assert s.status == WatchSessionStatus.CLOSED

    async def test_close_other_users_session_404(self, db, mock_request, regular_user, admin_user, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        with pytest.raises(HTTPException) as exc:
            await close_watch_session(mock_request, admin_user, sid, CloseSessionIn(), db)
        assert exc.value.status_code == 404


class TestReads:
    async def test_activity_progress_empty_then_populated(self, db, mock_request, regular_user, pass_gate):
        empty = await get_activity_progress(mock_request, regular_user, "activity_video_1", db)
        assert empty["verifiedWatchSeconds"] == 0 and empty["sessionId"] is None and empty["verifiedWatch"] is True
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        await record_heartbeat(mock_request, regular_user, _hb(sid, 2, 10), db, now=T0 + timedelta(seconds=10))
        populated = await get_activity_progress(mock_request, regular_user, "activity_video_1", db)
        assert populated["verifiedWatchSeconds"] == pytest.approx(10)
        assert populated["coverageBuckets"] == [0, 1]

    async def test_course_summary_orders_and_locks(self, db, mock_request, regular_user, org, course, chapter, video, pass_gate, no_side_effects):
        second = await _make_video(db, org, course, chapter, id=12, uuid="activity_video_2", order=2)
        course.extra_metadata = {"progression": {"mode": "sequential"}}
        db.add(course)
        await db.commit()
        with patch.object(svc, "check_resource_access", new=AsyncMock()):
            summary = await get_course_progress_summary(mock_request, regular_user, course.course_uuid, db)
        assert [a["activityUuid"] for a in summary["activities"]] == ["activity_video_1", "activity_video_2"]
        assert summary["sequential"] is True
        assert summary["activities"][0]["locked"] is False
        assert summary["activities"][1]["locked"] is True
        assert summary["activities"][1]["unlockActivityUuid"] == "activity_video_1"
        assert summary["completedCount"] == 0 and summary["totalCount"] == 2
        # Complete the first video → second unlocks.
        db.add(TrailStep(trailrun_id=0, activity_id=video.id, course_id=course.id, trail_id=0, org_id=org.id, complete=True, teacher_verified=False, grade="", user_id=regular_user.id, creation_date="x", update_date="x"))
        await db.commit()
        with patch.object(svc, "check_resource_access", new=AsyncMock()):
            summary = await get_course_progress_summary(mock_request, regular_user, course.course_uuid, db)
        assert summary["activities"][1]["locked"] is False
        assert summary["percent"] == 50.0
        assert second.id is not None

    async def test_admin_listing_requires_rights(self, db, mock_request, regular_user, admin_user, course, pass_gate):
        sid = (await _start(mock_request, regular_user, db))["sessionId"]
        await record_heartbeat(mock_request, regular_user, _hb(sid, 1, 0), db, now=T0)
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))
        with patch.object(svc, "is_org_admin", new=AsyncMock(return_value=False)), patch.object(svc, "check_resource_access", new=denied):
            with pytest.raises(HTTPException) as exc:
                await get_course_progress_admin(mock_request, regular_user, course.course_uuid, db)
            assert exc.value.status_code == 403
        with patch.object(svc, "is_org_admin", new=AsyncMock(return_value=True)):
            listing = await get_course_progress_admin(mock_request, admin_user, course.course_uuid, db)
        assert listing["total"] == 1
        assert listing["data"][0]["user"]["user_uuid"] == regular_user.user_uuid
        assert listing["data"][0]["activity"]["activity_uuid"] == "activity_video_1"
