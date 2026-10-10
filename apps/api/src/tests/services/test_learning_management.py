"""Tests for the 이수관리 aggregates, the logistics hand-off event and the router."""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.user_activity import UserActivityDay
from src.db.user_audit_events import UserAuditEventType
from src.db.video_progress import VideoProgress
from src.services.learning_management import events as lm_events
from src.services.learning_management import queries
from src.services.learning_management.export import rows_to_csv, _csv_safe
from src.services.learning_management.required_courses import get_required_courses, is_required_course

TODAY = date(2027, 1, 15)


async def _course(db, org, *, id, uuid, name, required=True, deadline="2027-05-31"):
    c = Course(
        id=id, name=name, description="", public=True, published=True, open_to_contributors=False, org_id=org.id, course_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
        extra_metadata={"learning_management": {"required": required, "deadline": deadline}},
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _activity(db, org, course, chapter, *, id, uuid, order, duration=600):
    a = Activity(
        id=id, name=f"A{id}", activity_type=ActivityTypeEnum.TYPE_VIDEO, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE, content={},
        details={"durationSeconds": duration, "verifiedWatch": True}, published=True, org_id=org.id, course_id=course.id, activity_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    db.add(ChapterActivity(order=order, chapter_id=chapter.id, activity_id=a.id, course_id=course.id, org_id=org.id, creation_date="x", update_date="x"))
    await db.commit()
    return a


async def _run(db, org, user, course, *, completed=False, created="2026-12-01 10:00:00"):
    trail = (await db.execute(select(Trail).where(Trail.user_id == user.id, Trail.org_id == org.id))).scalars().first()
    if trail is None:
        trail = Trail(org_id=org.id, user_id=user.id, trail_uuid=f"trail_{user.id}", creation_date="x", update_date="x")
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
    run = TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user.id, status=StatusEnum.STATUS_COMPLETED if completed else StatusEnum.STATUS_IN_PROGRESS, creation_date=created, update_date=created)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


@pytest.fixture
async def world(db, org, course, chapter, admin_user, regular_user):
    """course (fixture) = required course A with two activities; course B required; course C optional."""
    course.extra_metadata = {"learning_management": {"required": True, "deadline": "2027-05-31"}}
    db.add(course)
    await db.commit()
    a1 = await _activity(db, org, course, chapter, id=201, uuid="lm_a1", order=1)
    a2 = await _activity(db, org, course, chapter, id=202, uuid="lm_a2", order=2)
    course_b = await _course(db, org, id=301, uuid="course_lm_b", name="Required B")
    course_c = await _course(db, org, id=302, uuid="course_lm_c", name="Optional C", required=False, deadline=None)
    # regular_user: enrolled in A, finished a1 only, inactive for 30 days
    run = await _run(db, org, regular_user, course)
    db.add(TrailStep(trailrun_id=run.id, activity_id=a1.id, course_id=course.id, trail_id=run.trail_id, org_id=org.id, complete=True, teacher_verified=False, grade="", user_id=regular_user.id, creation_date="2026-12-02", update_date="2026-12-02"))
    db.add(VideoProgress(org_id=org.id, course_id=course.id, activity_id=a1.id, user_id=regular_user.id, duration_seconds=600, verified_seconds=560, furthest_verified_position=600, resume_position=600, coverage_bitmap="", bucket_count=120, completion_state="complete", created_at=datetime(2026, 12, 2, tzinfo=timezone.utc), updated_at=datetime(2026, 12, 2, tzinfo=timezone.utc)))
    db.add(VideoProgress(org_id=org.id, course_id=course.id, activity_id=a2.id, user_id=regular_user.id, duration_seconds=600, verified_seconds=120, furthest_verified_position=130, resume_position=130, coverage_bitmap="", bucket_count=120, created_at=datetime(2026, 12, 3, tzinfo=timezone.utc), updated_at=datetime(2026, 12, 3, tzinfo=timezone.utc)))
    db.add(UserActivityDay(org_id=org.id, user_id=regular_user.id, activity_date=TODAY - timedelta(days=30)))
    # admin_user: completed A and B (all required), active today
    await _run(db, org, admin_user, course, completed=True)
    await _run(db, org, admin_user, course_b, completed=True)
    db.add(UserActivityDay(org_id=org.id, user_id=admin_user.id, activity_date=TODAY))
    await db.commit()
    return {"course": course, "course_b": course_b, "course_c": course_c, "a1": a1, "a2": a2}


class TestRequiredCourses:
    async def test_flags(self, db, org, world):
        req = await get_required_courses(org.id, db)
        assert {c.course.course_uuid for c in req} == {world["course"].course_uuid, "course_lm_b"}
        assert req[0].deadline == date(2027, 5, 31)
        assert is_required_course(world["course_c"]) is False


class TestCourseQueries:
    async def test_learner_matrix_statuses_and_cells(self, db, org, world, regular_user, admin_user):
        res = await queries.course_learner_rows(org.id, world["course"], db)
        assert res["total"] == 2
        by_user = {r["user"]["user_uuid"]: r for r in res["data"]}
        reg = by_user[regular_user.user_uuid]
        assert reg["status"] == "in_progress" and reg["completed_count"] == 1 and reg["total_count"] == 2
        assert reg["activities"][0]["complete"] is True and reg["activities"][0]["video_percent"] == 100.0
        assert reg["activities"][1]["video_percent"] == pytest.approx(22.2, abs=0.1)
        assert reg["last_active"] == (TODAY - timedelta(days=30)).isoformat()
        assert by_user[admin_user.user_uuid]["status"] == "completed"

    async def test_status_filter_and_search(self, db, org, world, regular_user):
        done = await queries.course_learner_rows(org.id, world["course"], db, status="completed")
        assert [r["user"]["user_uuid"] for r in done["data"]] != [regular_user.user_uuid] and done["total"] == 1
        prog = await queries.course_learner_rows(org.id, world["course"], db, status="in_progress")
        assert [r["user"]["user_uuid"] for r in prog["data"]] == [regular_user.user_uuid]
        none = await queries.course_learner_rows(org.id, world["course_b"], db, status="not_started")
        assert none["total"] == 1 and none["data"][0]["user"]["user_uuid"] == regular_user.user_uuid
        search = await queries.course_learner_rows(org.id, world["course"], db, search="regular")
        assert search["total"] == 1

    async def test_course_summary(self, db, org, world):
        s = await queries.course_summary(org.id, world["course"], db)
        assert s["members"] == 2 and s["enrolled"] == 2 and s["completed"] == 1 and s["completion_rate"] == 0.5
        assert s["avg_verified_watch_seconds"] == pytest.approx(340.0)
        acts = {a["activity_uuid"]: a for a in s["activities"]}
        assert acts["lm_a1"]["completed"] == 1 and acts["lm_a1"]["dropoff_deciles"][9] == 1
        assert acts["lm_a2"]["dropoff_deciles"][2] == 1


class TestOrgQueries:
    async def test_overview_funnel_and_dau(self, db, org, world):
        o = await queries.org_overview(org.id, db, today=TODAY)
        assert o["members"] == 2 and o["required_courses"] == 2
        assert o["funnel"] == {"members": 2, "enrolled_any_required": 2, "completed_any_required": 1, "completed_all_required": 1}
        assert o["daily_active"] == [{"date": TODAY.isoformat(), "users": 1}]
        courses = {c["course_uuid"]: c for c in o["courses"]}
        assert courses["course_lm_b"]["days_left"] == (date(2027, 5, 31) - TODAY).days
        assert courses["course_lm_c"]["required"] is False
        assert o["at_risk_count"] == 1

    async def test_at_risk_reasons(self, db, org, world, regular_user):
        r = await queries.at_risk_learners(org.id, db, today=TODAY)
        assert r["total"] == 1
        row = r["data"][0]
        assert row["user"]["user_uuid"] == regular_user.user_uuid
        assert "inactive" in row["reasons"]
        assert row["completed_required"] == 0 and row["total_required"] == 2

    async def test_learners_matrix_and_detail(self, db, org, world, regular_user, admin_user):
        m = await queries.learners_matrix(org.id, db)
        assert m["total"] == 2 and [c["course_uuid"] for c in m["courses"]] == [world["course"].course_uuid, "course_lm_b"]
        rows = {r["user"]["user_uuid"]: r for r in m["data"]}
        assert rows[admin_user.user_uuid]["all_required_completed"] is True
        assert rows[regular_user.user_uuid]["courses"][0]["status"] == "in_progress"
        d = await queries.learner_detail(org.id, regular_user, db, today=TODAY)
        assert d["required_total"] == 2 and d["required_completed"] == 0
        first = next(c for c in d["courses"] if c["course_uuid"] == world["course"].course_uuid)
        assert first["progress_percent"] == 50.0 and first["status"] == "in_progress"


class TestExport:
    def test_csv_safe_and_rows(self):
        assert _csv_safe("=SUM(A1)") == "'=SUM(A1)"
        assert _csv_safe(None) == ""
        out = rows_to_csv(["a", "b"], [["x", 1], ["+y", None]])
        assert out.splitlines() == ["a,b", "x,1", "'+y,"]


class TestHandoff:
    async def test_emits_once_when_all_required_done(self, db, org, world, admin_user, regular_user):
        with patch.object(lm_events, "dispatch_webhooks", new=AsyncMock()) as dispatch, patch.object(lm_events, "record_audit_event", new=AsyncMock()) as audit:
            # regular_user has not finished → nothing
            assert await lm_events.maybe_emit_all_required_courses_completed(regular_user, org.id, db) is False
            assert await lm_events.maybe_emit_all_required_courses_completed(admin_user, org.id, db) is True
            dispatch.assert_awaited_once()
            kwargs = dispatch.await_args.kwargs
            assert kwargs["event_name"] == "all_required_courses_completed"
            assert {c["course_uuid"] for c in kwargs["data"]["courses"]} == {world["course"].course_uuid, "course_lm_b"}
            audit.assert_awaited_once()
            assert audit.await_args.kwargs["event_type"] == UserAuditEventType.ALL_REQUIRED_COURSES_COMPLETED
        # Second call: the audit marker exists in the real table → no re-emit.
        from src.db.user_audit_events import UserAuditEvent

        db.add(UserAuditEvent(user_id=admin_user.id, org_id=org.id, event_type=UserAuditEventType.ALL_REQUIRED_COURSES_COMPLETED, created_at=datetime.now(timezone.utc)))
        await db.commit()
        with patch.object(lm_events, "dispatch_webhooks", new=AsyncMock()) as dispatch:
            assert await lm_events.maybe_emit_all_required_courses_completed(admin_user, org.id, db) is False
            dispatch.assert_not_awaited()

    def test_webhook_registry(self):
        from src.services.webhooks.events import WEBHOOK_EVENTS, validate_event_data

        assert "all_required_courses_completed" in WEBHOOK_EVENTS
        assert "certificate" in WEBHOOK_EVENTS["course_completed"]["data_schema"]
        validate_event_data("all_required_courses_completed", {"user": {}, "courses": [], "certificates": [], "completed_at": "x"})


class TestRouter:
    @pytest.fixture
    def app(self, db, admin_user):
        from src.core.events.database import get_db_session
        from src.routers.learning_management import router
        from src.security.auth import get_current_user

        app = FastAPI()
        app.include_router(router, prefix="/api/v1/learning-management")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: admin_user
        yield app
        app.dependency_overrides.clear()

    async def test_routes(self, app, db, org, world, regular_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            with patch("src.routers.learning_management._verify_org_admin", new=AsyncMock()):
                r = await client.get(f"/api/v1/learning-management/{org.id}/overview")
                assert r.status_code == 200 and r.json()["members"] == 2
                r = await client.get(f"/api/v1/learning-management/{org.id}/courses")
                assert r.status_code == 200 and len(r.json()) == 3
                r = await client.get(f"/api/v1/learning-management/{org.id}/learners?page_size=1")
                assert r.status_code == 200 and r.json()["total"] == 2 and len(r.json()["data"]) == 1
                r = await client.get(f"/api/v1/learning-management/{org.id}/learners/{regular_user.user_uuid}")
                assert r.status_code == 200 and r.json()["required_total"] == 2
                r = await client.get(f"/api/v1/learning-management/{org.id}/courses/{world['course'].course_uuid}/summary")
                assert r.status_code == 200 and r.json()["completed"] == 1
                r = await client.get(f"/api/v1/learning-management/{org.id}/courses/{world['course'].course_uuid}/learners?status=in_progress")
                assert r.status_code == 200 and r.json()["total"] == 1
                r = await client.get(f"/api/v1/learning-management/{org.id}/courses/{world['course'].course_uuid}/export")
                assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
                body = r.text
                assert body.startswith("﻿") and "regular" in body and "A201 (video %)" in body
                r = await client.get(f"/api/v1/learning-management/{org.id}/learners/export")
                assert r.status_code == 200 and "Required B" in r.text
                r = await client.get(f"/api/v1/learning-management/{org.id}/courses/nope/summary")
                assert r.status_code == 404
            denied = AsyncMock(side_effect=__import__("fastapi").HTTPException(status_code=403, detail="no"))
            with patch("src.routers.learning_management._verify_org_admin", new=denied):
                r = await client.get(f"/api/v1/learning-management/{org.id}/overview")
                assert r.status_code == 403
