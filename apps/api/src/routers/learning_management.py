"""이수관리 (learning management) endpoints, mounted at /api/v1/learning-management.

Org admins only (same guards as the analytics router). Postgres aggregates,
no warehouse dependency.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, User
from src.routers.analytics import _verify_org_admin
from src.security.auth import get_current_user
from src.services.learning_management import queries
from src.services.learning_management.export import paged_csv
from src.services.learning_management.required_courses import get_lm_courses

router = APIRouter()


async def _admin(user, org_id: int, db_session) -> None:
    if user is None or isinstance(user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await _verify_org_admin(user.id, org_id, db_session)


async def _course(org_id: int, course_uuid: str, db_session) -> Course:
    course = (await db_session.execute(select(Course).where(Course.course_uuid == course_uuid, Course.org_id == org_id))).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get("/{org_id}/overview", summary="Org-level completion overview (funnel, required courses, DAU, at-risk count)")
async def api_overview(request: Request, org_id: int, days_inactive: int = Query(default=14, ge=1, le=365), user=Depends(get_current_user), db_session=Depends(get_db_session)):
    await _admin(user, org_id, db_session)
    return await queries.org_overview(org_id, db_session, days_inactive=days_inactive)


@router.get("/{org_id}/at-risk", summary="Learners inactive or behind pace on required courses")
async def api_at_risk(
    request: Request,
    org_id: int,
    days_inactive: int = Query(default=14, ge=1, le=365),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    await _admin(user, org_id, db_session)
    return await queries.at_risk_learners(org_id, db_session, days_inactive=days_inactive, page=page, page_size=page_size)


@router.get("/{org_id}/courses", summary="Courses with learning-management flags")
async def api_courses(request: Request, org_id: int, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    await _admin(user, org_id, db_session)
    return [
        {"course_uuid": c.course.course_uuid, "name": c.course.name, "required": c.required, "deadline": c.deadline.isoformat() if c.deadline else None, "track": c.track}
        for c in await get_lm_courses(org_id, db_session)
    ]


@router.get("/{org_id}/learners", summary="Learner × required-course status matrix")
async def api_learners(
    request: Request,
    org_id: int,
    usergroup_id: Optional[int] = Query(default=None),
    search: str = Query(default="", max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    await _admin(user, org_id, db_session)
    return await queries.learners_matrix(org_id, db_session, usergroup_id=usergroup_id, search=search, page=page, page_size=page_size)


@router.get("/{org_id}/learners/export", summary="Export the learner matrix as CSV")
async def api_learners_export(
    request: Request,
    org_id: int,
    usergroup_id: Optional[int] = Query(default=None),
    search: str = Query(default="", max_length=120),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    await _admin(user, org_id, db_session)
    first = await queries.learners_matrix(org_id, db_session, usergroup_id=usergroup_id, search=search, page=1, page_size=200)
    course_names = [c["name"] for c in first["courses"]]
    header = ["username", "email", "first_name", "last_name", "completed_required", "total_required", "all_required_completed", "last_active", *course_names]

    async def fetch(page: int) -> dict:
        return first if page == 1 else await queries.learners_matrix(org_id, db_session, usergroup_id=usergroup_id, search=search, page=page, page_size=200)

    def to_rows(result: dict) -> list[list]:
        return [
            [r["user"]["username"], r["user"]["email"], r["user"]["first_name"], r["user"]["last_name"], r["completed_required"], r["total_required"], r["all_required_completed"], r["last_active"], *[c["status"] for c in r["courses"]]]
            for r in result["data"]
        ]

    return StreamingResponse(paged_csv(header, fetch, to_rows), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="lm-learners-{org_id}.csv"'})


@router.get("/{org_id}/learners/{user_uuid}", summary="One learner across all courses")
async def api_learner_detail(request: Request, org_id: int, user_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    await _admin(user, org_id, db_session)
    target = (await db_session.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return await queries.learner_detail(org_id, target, db_session)


@router.get("/{org_id}/courses/{course_uuid}/summary", summary="Course KPIs, per-activity completion and drop-off")
async def api_course_summary(request: Request, org_id: int, course_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    await _admin(user, org_id, db_session)
    course = await _course(org_id, course_uuid, db_session)
    return await queries.course_summary(org_id, course, db_session)


@router.get("/{org_id}/courses/{course_uuid}/learners", summary="Learner × activity matrix for a course")
async def api_course_learners(
    request: Request,
    org_id: int,
    course_uuid: str,
    status: Optional[str] = Query(default=None),
    usergroup_id: Optional[int] = Query(default=None),
    search: str = Query(default="", max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    await _admin(user, org_id, db_session)
    course = await _course(org_id, course_uuid, db_session)
    return await queries.course_learner_rows(org_id, course, db_session, status=status, usergroup_id=usergroup_id, search=search, page=page, page_size=page_size)


@router.get("/{org_id}/courses/{course_uuid}/export", summary="Export the course learner matrix as CSV")
async def api_course_export(
    request: Request,
    org_id: int,
    course_uuid: str,
    status: Optional[str] = Query(default=None),
    usergroup_id: Optional[int] = Query(default=None),
    search: str = Query(default="", max_length=120),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    await _admin(user, org_id, db_session)
    course = await _course(org_id, course_uuid, db_session)
    first = await queries.course_learner_rows(org_id, course, db_session, status=status, usergroup_id=usergroup_id, search=search, page=1, page_size=200)
    act_names = [a["name"] for a in first["activities"]]
    header = ["username", "email", "status", "enrolled_at", "progress_percent", "completed_count", "total_count", "certificate_uuid", "last_active", *[f"{n} (video %)" for n in act_names], *[f"{n} (quiz)" for n in act_names]]

    async def fetch(page: int) -> dict:
        return first if page == 1 else await queries.course_learner_rows(org_id, course, db_session, status=status, usergroup_id=usergroup_id, search=search, page=page, page_size=200)

    def to_rows(result: dict) -> list[list]:
        out = []
        for r in result["data"]:
            out.append(
                [r["user"]["username"], r["user"]["email"], r["status"], r["enrolled_at"], r["progress_percent"], r["completed_count"], r["total_count"], r["certificate_uuid"], r["last_active"],
                 *[c["video_percent"] for c in r["activities"]], *[c["quiz_score"] for c in r["activities"]]]
            )
        return out

    return StreamingResponse(paged_csv(header, fetch, to_rows), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="lm-{course_uuid}.csv"'})
