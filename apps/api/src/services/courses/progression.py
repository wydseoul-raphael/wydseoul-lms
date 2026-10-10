"""Sequential course progression ("순차 잠금").

When a course sets ``extra_metadata.progression.mode = "sequential"``, a
learner may only open activity N once every activity before it has a
completed TrailStep. The UI shows the lock on the curriculum; the server
re-checks it in the reader gate and when a watch session starts, so hiding a
link is never the only barrier.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.trail_steps import TrailStep

SEQUENTIAL = "sequential"


def course_is_sequential(course: Any) -> bool:
    meta = getattr(course, "extra_metadata", None) or {}
    progression = meta.get("progression") if isinstance(meta, dict) else None
    return bool(progression) and progression.get("mode") == SEQUENTIAL


async def ordered_activity_ids(course_id: int, db_session: AsyncSession) -> list[int]:
    """Published activity ids in curriculum order (chapter order, then
    activity order inside the chapter)."""
    rows = (
        await db_session.execute(
            select(ChapterActivity.activity_id)
            .join(CourseChapter, CourseChapter.chapter_id == ChapterActivity.chapter_id)  # type: ignore[arg-type]
            .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore[arg-type]
            .where(ChapterActivity.course_id == course_id)
            .where(CourseChapter.course_id == course_id)
            .where(Activity.published == True)  # noqa: E712
            .order_by(CourseChapter.order, ChapterActivity.order, ChapterActivity.id)
        )
    ).all()
    seen: set[int] = set()
    out: list[int] = []
    for (activity_id,) in rows:
        if activity_id not in seen:
            seen.add(activity_id)
            out.append(activity_id)
    return out


async def completed_activity_ids(user_id: int, course_id: int, db_session: AsyncSession) -> set[int]:
    rows = (
        await db_session.execute(
            select(TrailStep.activity_id).where(
                TrailStep.user_id == user_id,
                TrailStep.course_id == course_id,
                TrailStep.complete == True,  # noqa: E712
            )
        )
    ).all()
    return {r[0] for r in rows}


def first_locked_index(ordered: list[int], completed: set[int]) -> int:
    """Index of the first activity that is NOT yet reachable. Everything up to
    and including the first incomplete activity is open; the rest is locked."""
    for i, activity_id in enumerate(ordered):
        if activity_id not in completed:
            return i + 1
    return len(ordered)


def locked_activity_ids(ordered: list[int], completed: set[int]) -> tuple[set[int], dict[int, int]]:
    """(locked ids, locked id → id of the activity that unlocks it)."""
    cut = first_locked_index(ordered, completed)
    locked = set(ordered[cut:])
    unlock_by: dict[int, int] = {}
    if cut > 0 and cut < len(ordered):
        gate = ordered[cut - 1]
        for activity_id in ordered[cut:]:
            unlock_by[activity_id] = gate
    return locked, unlock_by


async def sequential_lock_state(
    activity: Activity,
    course: Any,
    user_id: int | None,
    db_session: AsyncSession,
) -> tuple[bool, str | None]:
    """(locked, unlock_activity_uuid) for one activity. Anonymous users have
    no progress, so only the first activity is open to them."""
    if not course_is_sequential(course) or activity.id is None:
        return False, None
    ordered = await ordered_activity_ids(course.id, db_session)
    if activity.id not in ordered:
        return False, None
    completed = await completed_activity_ids(user_id, course.id, db_session) if user_id else set()
    locked, unlock_by = locked_activity_ids(ordered, completed)
    if activity.id not in locked:
        return False, None
    gate_id = unlock_by.get(activity.id)
    gate_uuid = None
    if gate_id is not None:
        gate = (await db_session.execute(select(Activity.activity_uuid).where(Activity.id == gate_id))).first()
        gate_uuid = gate[0] if gate else None
    return True, gate_uuid
