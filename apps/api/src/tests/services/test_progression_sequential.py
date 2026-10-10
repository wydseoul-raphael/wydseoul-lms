"""Tests for sequential course progression (services/courses/progression.py)
and its wiring into the activity reader gate."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivityRead, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.trail_steps import TrailStep
from src.services.courses import progression
from src.security.rbac.resource_access import AccessAction
from src.services.courses.activities import access
from src.services.courses.progression import (
    completed_activity_ids,
    course_is_sequential,
    first_locked_index,
    locked_activity_ids,
    ordered_activity_ids,
    sequential_lock_state,
)


async def _activity(db, org, course, chapter, *, id, uuid, order, published=True):
    a = Activity(
        id=id, name=f"A{id}", activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE, content={}, details={},
        published=published, org_id=org.id, course_id=course.id, activity_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    db.add(ChapterActivity(order=order, chapter_id=chapter.id, activity_id=a.id, course_id=course.id, org_id=org.id, creation_date="x", update_date="x"))
    await db.commit()
    return a


@pytest.fixture
async def second_chapter(db, org, course):
    ch = Chapter(id=2, name="Chapter 2", description="", org_id=org.id, course_id=course.id, chapter_uuid="chapter_2", creation_date=str(datetime.now()), update_date=str(datetime.now()))
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    db.add(CourseChapter(order=2, course_id=course.id, chapter_id=ch.id, org_id=org.id, creation_date="x", update_date="x"))
    await db.commit()
    return ch


def test_pure_helpers():
    assert course_is_sequential(type("C", (), {"extra_metadata": {"progression": {"mode": "sequential"}}})())
    assert not course_is_sequential(type("C", (), {"extra_metadata": None})())
    assert first_locked_index([1, 2, 3], set()) == 1
    assert first_locked_index([1, 2, 3], {1}) == 2
    assert first_locked_index([1, 2, 3], {1, 2, 3}) == 3
    locked, unlock = locked_activity_ids([1, 2, 3, 4], {1})
    assert locked == {3, 4} and unlock == {3: 2, 4: 2}
    assert locked_activity_ids([], set()) == (set(), {})


class TestOrdering:
    async def test_orders_by_chapter_then_activity_and_skips_drafts(self, db, org, course, chapter, second_chapter):
        # chapter 1 is linked with order 1 by the fixture? ensure a CourseChapter exists.
        existing = (await db.execute(__import__("sqlmodel").select(CourseChapter).where(CourseChapter.chapter_id == chapter.id))).scalars().first()
        if existing is None:
            db.add(CourseChapter(order=1, course_id=course.id, chapter_id=chapter.id, org_id=org.id, creation_date="x", update_date="x"))
            await db.commit()
        b = await _activity(db, org, course, chapter, id=21, uuid="a_b", order=2)
        a = await _activity(db, org, course, chapter, id=20, uuid="a_a", order=1)
        draft = await _activity(db, org, course, chapter, id=22, uuid="a_draft", order=3, published=False)
        c = await _activity(db, org, course, second_chapter, id=23, uuid="a_c", order=1)
        ordered = await ordered_activity_ids(course.id, db)
        assert ordered == [a.id, b.id, c.id]
        assert draft.id not in ordered

    async def test_lock_state_and_completion(self, db, org, course, chapter, regular_user):
        existing = (await db.execute(__import__("sqlmodel").select(CourseChapter).where(CourseChapter.chapter_id == chapter.id))).scalars().first()
        if existing is None:
            db.add(CourseChapter(order=1, course_id=course.id, chapter_id=chapter.id, org_id=org.id, creation_date="x", update_date="x"))
            await db.commit()
        a = await _activity(db, org, course, chapter, id=30, uuid="s_a", order=1)
        b = await _activity(db, org, course, chapter, id=31, uuid="s_b", order=2)
        course.extra_metadata = {"progression": {"mode": "sequential"}}
        db.add(course)
        await db.commit()
        assert await sequential_lock_state(a, course, regular_user.id, db) == (False, None)
        assert await sequential_lock_state(b, course, regular_user.id, db) == (True, "s_a")
        # anonymous: only the first is open
        assert await sequential_lock_state(b, course, None, db) == (True, "s_a")
        db.add(TrailStep(trailrun_id=0, activity_id=a.id, course_id=course.id, trail_id=0, org_id=org.id, complete=True, teacher_verified=False, grade="", user_id=regular_user.id, creation_date="x", update_date="x"))
        await db.commit()
        assert await completed_activity_ids(regular_user.id, course.id, db) == {a.id}
        assert await sequential_lock_state(b, course, regular_user.id, db) == (False, None)
        # Not sequential → never locked.
        course.extra_metadata = {}
        db.add(course)
        await db.commit()
        assert await sequential_lock_state(b, course, None, db) == (False, None)


class TestReaderGate:
    async def test_verify_raises_sequential_lock(self, db, org, course, chapter, regular_user, mock_request):
        existing = (await db.execute(__import__("sqlmodel").select(CourseChapter).where(CourseChapter.chapter_id == chapter.id))).scalars().first()
        if existing is None:
            db.add(CourseChapter(order=1, course_id=course.id, chapter_id=chapter.id, org_id=org.id, creation_date="x", update_date="x"))
            await db.commit()
        await _activity(db, org, course, chapter, id=40, uuid="g_a", order=1)
        b = await _activity(db, org, course, chapter, id=41, uuid="g_b", order=2)
        course.extra_metadata = {"progression": {"mode": "sequential"}}
        db.add(course)
        await db.commit()
        # Learner: may READ the course but is not an editor (UPDATE denied).
        async def _decide(request, db_session, user, uuid, action, *args, **kwargs):
            return type("D", (), {"allowed": action == AccessAction.READ, "reason": ""})()

        allowed = AsyncMock(side_effect=_decide)
        with patch.object(access, "check_resource_access", new=allowed), patch.object(
            access, "check_ee_activity_paid_access", new=AsyncMock(return_value=True)
        ), patch.object(access, "is_org_admin", new=AsyncMock(return_value=False)), patch.object(
            access, "batch_accessible_restricted_uuids", new=AsyncMock(return_value=set())
        ):
            with pytest.raises(HTTPException) as exc:
                await access.verify_activity_reader_access(mock_request, b, course, regular_user, db)
            assert exc.value.status_code == 403
            assert exc.value.detail["code"] == "SEQUENTIAL_LOCK"
            assert exc.value.detail["unlock_activity_uuid"] == "g_a"

            read = await access.redact_activity_for_reader(mock_request, ActivityRead.model_validate(b), b, course, regular_user, db)
            assert read.is_locked is True and read.lock_reason == "sequential" and read.unlock_activity_uuid == "g_a"
            assert read.content == {} and read.details is None

        # Editors are exempt.
        with patch.object(access, "check_resource_access", new=allowed), patch.object(
            access, "check_ee_activity_paid_access", new=AsyncMock(return_value=True)
        ), patch.object(access, "is_org_admin", new=AsyncMock(return_value=True)), patch.object(
            access, "batch_accessible_restricted_uuids", new=AsyncMock(return_value=set())
        ):
            await access.verify_activity_reader_access(mock_request, b, course, regular_user, db)
        assert progression.SEQUENTIAL == "sequential"
