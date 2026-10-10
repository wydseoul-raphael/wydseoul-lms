"""Which courses count toward mandatory volunteer training.

Stored on the course itself (``course.extra_metadata.learning_management``)
so no schema change is needed:

    {"required": true, "deadline": "2027-05-31", "track": "general"}
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course


@dataclass(frozen=True)
class LmCourse:
    course: Course
    required: bool
    deadline: Optional[date]
    track: Optional[str]


def lm_settings(course: Any) -> dict:
    meta = getattr(course, "extra_metadata", None) or {}
    lm = meta.get("learning_management") if isinstance(meta, dict) else None
    return lm if isinstance(lm, dict) else {}


def parse_deadline(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def is_required_course(course: Any) -> bool:
    return bool(lm_settings(course).get("required"))


async def get_lm_courses(org_id: int, db_session: AsyncSession, *, published_only: bool = True) -> list[LmCourse]:
    """All org courses with their learning-management flags (orgs have a
    handful of courses, so the JSON filter happens in Python)."""
    stmt = select(Course).where(Course.org_id == org_id)
    if published_only:
        stmt = stmt.where(Course.published == True)  # noqa: E712
    courses = (await db_session.execute(stmt.order_by(Course.id))).scalars().all()
    out = []
    for c in courses:
        lm = lm_settings(c)
        out.append(LmCourse(course=c, required=bool(lm.get("required")), deadline=parse_deadline(lm.get("deadline")), track=lm.get("track") or None))
    return out


async def get_required_courses(org_id: int, db_session: AsyncSession) -> list[LmCourse]:
    return [c for c in await get_lm_courses(org_id, db_session) if c.required]
