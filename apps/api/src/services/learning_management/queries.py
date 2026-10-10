"""Aggregate queries for the 이수관리 dashboard (Postgres and SQLite compatible).

Everything here is GROUP BY / batched-by-page SQL; the dashboard must stay
fast for ~10k learners × ~10 courses without a warehouse.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import case, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.certifications import Certifications, CertificateUser
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_activity import UserActivityDay
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.users import User
from src.db.video_progress import VideoProgress
from src.services.learning_management.required_courses import LmCourse, get_lm_courses, get_required_courses

STATUS_COMPLETED = "completed"
STATUS_IN_PROGRESS = "in_progress"
STATUS_NOT_STARTED = "not_started"


def _status(run_status: Optional[str], steps: int) -> str:
    if run_status == StatusEnum.STATUS_COMPLETED or run_status == "STATUS_COMPLETED":
        return STATUS_COMPLETED
    if run_status is not None or steps > 0:
        return STATUS_IN_PROGRESS
    return STATUS_NOT_STARTED


def _user_row(u: User) -> dict:
    return {
        "user_uuid": u.user_uuid,
        "username": u.username,
        "email": u.email,
        "first_name": getattr(u, "first_name", "") or "",
        "last_name": getattr(u, "last_name", "") or "",
    }


async def published_activity_ids(course_id: int, db_session: AsyncSession) -> list[int]:
    rows = (
        await db_session.execute(
            select(ChapterActivity.activity_id)
            .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore[arg-type]
            .where(ChapterActivity.course_id == course_id, Activity.published == True)  # noqa: E712
            .order_by(ChapterActivity.order, ChapterActivity.id)
        )
    ).all()
    seen: set[int] = set()
    out: list[int] = []
    for (aid,) in rows:
        if aid not in seen:
            seen.add(aid)
            out.append(aid)
    return out


async def _member_page(
    org_id: int,
    db_session: AsyncSession,
    *,
    usergroup_id: Optional[int],
    search: str,
    page: int,
    page_size: int,
    user_ids_filter: Optional[Iterable[int]] = None,
) -> tuple[list[User], int]:
    stmt = select(User).join(UserOrganization, UserOrganization.user_id == User.id).where(UserOrganization.org_id == org_id)  # type: ignore[arg-type]
    count = select(func.count(func.distinct(User.id))).select_from(User).join(UserOrganization, UserOrganization.user_id == User.id).where(UserOrganization.org_id == org_id)  # type: ignore[arg-type]
    if usergroup_id:
        stmt = stmt.join(UserGroupUser, UserGroupUser.user_id == User.id).where(UserGroupUser.usergroup_id == usergroup_id)  # type: ignore[arg-type]
        count = count.join(UserGroupUser, UserGroupUser.user_id == User.id).where(UserGroupUser.usergroup_id == usergroup_id)  # type: ignore[arg-type]
    if search:
        like = f"%{search.strip().lower()}%"
        cond = func.lower(User.username).like(like) | func.lower(User.email).like(like) | func.lower(User.first_name).like(like) | func.lower(User.last_name).like(like)
        stmt = stmt.where(cond)
        count = count.where(cond)
    if user_ids_filter is not None:
        ids = list(user_ids_filter)
        if not ids:
            return [], 0
        stmt = stmt.where(User.id.in_(ids))  # type: ignore[attr-defined]
        count = count.where(User.id.in_(ids))  # type: ignore[attr-defined]
    total = (await db_session.execute(count)).scalar() or 0
    users = (await db_session.execute(stmt.order_by(User.id).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return list(users), total


async def _run_status_by_user(course_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, tuple[Optional[str], Optional[str]]]:
    if not user_ids:
        return {}
    rows = (await db_session.execute(select(TrailRun.user_id, TrailRun.status, TrailRun.creation_date).where(TrailRun.course_id == course_id, TrailRun.user_id.in_(user_ids)))).all()  # type: ignore[attr-defined]
    return {uid: (str(st.value if hasattr(st, "value") else st), created) for uid, st, created in rows}


async def _steps_by_user(course_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, dict[int, str]]:
    if not user_ids:
        return {}
    rows = (await db_session.execute(select(TrailStep.user_id, TrailStep.activity_id, TrailStep.creation_date).where(TrailStep.course_id == course_id, TrailStep.user_id.in_(user_ids), TrailStep.complete == True))).all()  # type: ignore[attr-defined]  # noqa: E712
    out: dict[int, dict[int, str]] = {}
    for uid, aid, created in rows:
        out.setdefault(uid, {})[aid] = created
    return out


async def _video_by_user(course_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, dict[int, VideoProgress]]:
    if not user_ids:
        return {}
    rows = (await db_session.execute(select(VideoProgress).where(VideoProgress.course_id == course_id, VideoProgress.user_id.in_(user_ids)))).scalars().all()  # type: ignore[attr-defined]
    out: dict[int, dict[int, VideoProgress]] = {}
    for p in rows:
        out.setdefault(p.user_id, {})[p.activity_id] = p
    return out


async def _quiz_best_by_user(course_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, dict[int, float]]:
    if not user_ids:
        return {}
    from src.db.courses.video_quiz import VideoQuizAttempt

    rows = (
        await db_session.execute(
            select(VideoQuizAttempt.user_id, VideoQuizAttempt.activity_id, func.max(VideoQuizAttempt.score))
            .where(VideoQuizAttempt.course_id == course_id, VideoQuizAttempt.kind == "end", VideoQuizAttempt.user_id.in_(user_ids))  # type: ignore[attr-defined]
            .group_by(VideoQuizAttempt.user_id, VideoQuizAttempt.activity_id)
        )
    ).all()
    out: dict[int, dict[int, float]] = {}
    for uid, aid, best in rows:
        out.setdefault(uid, {})[aid] = float(best or 0)
    return out


async def _certificates_by_user(course_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = (
        await db_session.execute(
            select(CertificateUser.user_id, CertificateUser.user_certification_uuid)
            .join(Certifications, Certifications.id == CertificateUser.certification_id)  # type: ignore[arg-type]
            .where(Certifications.course_id == course_id, CertificateUser.user_id.in_(user_ids))  # type: ignore[attr-defined]
        )
    ).all()
    return {uid: cert for uid, cert in rows}


async def _last_active_by_user(org_id: int, user_ids: list[int], db_session: AsyncSession) -> dict[int, date]:
    if not user_ids:
        return {}
    rows = (
        await db_session.execute(
            select(UserActivityDay.user_id, func.max(UserActivityDay.activity_date)).where(UserActivityDay.org_id == org_id, UserActivityDay.user_id.in_(user_ids)).group_by(UserActivityDay.user_id)  # type: ignore[attr-defined]
        )
    ).all()
    out: dict[int, date] = {}
    for uid, d in rows:
        if d is not None:
            out[uid] = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
    return out


# --------------------------------------------------------------------------
# Course level
# --------------------------------------------------------------------------


async def course_learner_rows(
    org_id: int,
    course: Course,
    db_session: AsyncSession,
    *,
    status: Optional[str] = None,
    usergroup_id: Optional[int] = None,
    search: str = "",
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """Learner × activity matrix for one course. Members are paged first,
    then progress is fetched in three batched queries for that page."""
    activity_ids = await published_activity_ids(course.id, db_session)
    activities = (await db_session.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars().all() if activity_ids else []  # type: ignore[attr-defined]
    act_by_id = {a.id: a for a in activities}
    ordered_activities = [act_by_id[i] for i in activity_ids if i in act_by_id]

    user_filter: Optional[set[int]] = None
    if status in (STATUS_COMPLETED, STATUS_IN_PROGRESS, STATUS_NOT_STARTED):
        # Resolve the status filter to user ids first (run/step based).
        run_rows = (await db_session.execute(select(TrailRun.user_id, TrailRun.status).where(TrailRun.course_id == course.id))).all()
        step_users = {r[0] for r in (await db_session.execute(select(TrailStep.user_id).where(TrailStep.course_id == course.id, TrailStep.complete == True))).all()}  # noqa: E712
        completed_users = {uid for uid, st in run_rows if str(getattr(st, "value", st)) == "STATUS_COMPLETED"}
        started_users = {uid for uid, _ in run_rows} | step_users
        members = {r[0] for r in (await db_session.execute(select(UserOrganization.user_id).where(UserOrganization.org_id == org_id))).all()}
        if status == STATUS_COMPLETED:
            user_filter = completed_users & members
        elif status == STATUS_IN_PROGRESS:
            user_filter = (started_users - completed_users) & members
        else:
            user_filter = members - started_users

    users, total = await _member_page(org_id, db_session, usergroup_id=usergroup_id, search=search, page=page, page_size=page_size, user_ids_filter=user_filter)
    user_ids = [u.id for u in users]
    runs = await _run_status_by_user(course.id, user_ids, db_session)
    steps = await _steps_by_user(course.id, user_ids, db_session)
    videos = await _video_by_user(course.id, user_ids, db_session)
    quiz_best = await _quiz_best_by_user(course.id, user_ids, db_session)
    certs = await _certificates_by_user(course.id, user_ids, db_session)
    last_active = await _last_active_by_user(org_id, user_ids, db_session)

    data = []
    for u in users:
        run_status, enrolled_at = runs.get(u.id, (None, None))
        done = steps.get(u.id, {})
        cells = []
        for a in ordered_activities:
            vp = videos.get(u.id, {}).get(a.id)
            required = float(vp.duration_seconds or 0) * 0.9 if vp and vp.duration_seconds else None
            cells.append(
                {
                    "activity_uuid": a.activity_uuid,
                    "complete": a.id in done,
                    "completed_at": done.get(a.id),
                    "video_percent": round(min(100.0, float(vp.verified_seconds) / required * 100), 1) if vp and required else (100.0 if a.id in done else None),
                    "quiz_score": quiz_best.get(u.id, {}).get(a.id),
                }
            )
        completed_count = sum(1 for c in cells if c["complete"])
        total_count = len(cells)
        data.append(
            {
                "user": _user_row(u),
                "status": _status(run_status, completed_count),
                "enrolled_at": enrolled_at,
                "progress_percent": round(completed_count / total_count * 100, 1) if total_count else 0.0,
                "completed_count": completed_count,
                "total_count": total_count,
                "certificate_uuid": certs.get(u.id),
                "last_active": last_active.get(u.id).isoformat() if last_active.get(u.id) else None,
                "activities": cells,
            }
        )
    return {
        "course": {"course_uuid": course.course_uuid, "name": course.name},
        "activities": [{"activity_uuid": a.activity_uuid, "name": a.name, "activity_type": a.activity_type} for a in ordered_activities],
        "data": data,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


async def course_summary(org_id: int, course: Course, db_session: AsyncSession) -> dict:
    members = (await db_session.execute(select(func.count()).select_from(UserOrganization).where(UserOrganization.org_id == org_id))).scalar() or 0
    enrolled = (await db_session.execute(select(func.count()).select_from(TrailRun).where(TrailRun.course_id == course.id))).scalar() or 0
    completed = (await db_session.execute(select(func.count()).select_from(TrailRun).where(TrailRun.course_id == course.id, TrailRun.status == StatusEnum.STATUS_COMPLETED))).scalar() or 0
    started_users = (await db_session.execute(select(func.count(func.distinct(TrailStep.user_id))).where(TrailStep.course_id == course.id))).scalar() or 0
    avg_watch = (await db_session.execute(select(func.avg(VideoProgress.verified_seconds)).where(VideoProgress.course_id == course.id))).scalar()

    activity_ids = await published_activity_ids(course.id, db_session)
    activities = (await db_session.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars().all() if activity_ids else []  # type: ignore[attr-defined]
    act_by_id = {a.id: a for a in activities}
    completion_rows = (await db_session.execute(select(TrailStep.activity_id, func.count()).where(TrailStep.course_id == course.id, TrailStep.complete == True).group_by(TrailStep.activity_id))).all()  # noqa: E712
    completion_by_activity = {aid: n for aid, n in completion_rows}

    # Drop-off: where learners stop (decile of furthest verified position).
    drop_rows = (await db_session.execute(select(VideoProgress.activity_id, VideoProgress.furthest_verified_position, VideoProgress.duration_seconds).where(VideoProgress.course_id == course.id))).all()
    dropoff: dict[int, list[int]] = {}
    for aid, furthest, duration in drop_rows:
        if not duration:
            continue
        decile = min(9, int((float(furthest or 0) / float(duration)) * 10))
        dropoff.setdefault(aid, [0] * 10)[decile] += 1

    return {
        "course": {"course_uuid": course.course_uuid, "name": course.name},
        "members": members,
        "enrolled": enrolled,
        "started": started_users,
        "completed": completed,
        "completion_rate": round(completed / enrolled, 3) if enrolled else 0.0,
        "avg_verified_watch_seconds": round(float(avg_watch), 1) if avg_watch is not None else None,
        "activities": [
            {
                "activity_uuid": act_by_id[i].activity_uuid,
                "name": act_by_id[i].name,
                "activity_type": act_by_id[i].activity_type,
                "completed": completion_by_activity.get(i, 0),
                "dropoff_deciles": dropoff.get(i, [0] * 10),
            }
            for i in activity_ids
            if i in act_by_id
        ],
    }


# --------------------------------------------------------------------------
# Org level
# --------------------------------------------------------------------------


async def _completed_required_by_user(required: list[LmCourse], db_session: AsyncSession) -> dict[int, set[int]]:
    course_ids = [c.course.id for c in required]
    if not course_ids:
        return {}
    rows = (await db_session.execute(select(TrailRun.user_id, TrailRun.course_id).where(TrailRun.course_id.in_(course_ids), TrailRun.status == StatusEnum.STATUS_COMPLETED))).all()  # type: ignore[attr-defined]
    out: dict[int, set[int]] = {}
    for uid, cid in rows:
        out.setdefault(uid, set()).add(cid)
    return out


async def org_overview(org_id: int, db_session: AsyncSession, *, today: Optional[date] = None, days_inactive: int = 14) -> dict:
    today = today or datetime.now(timezone.utc).date()
    lm_courses = await get_lm_courses(org_id, db_session)
    required = [c for c in lm_courses if c.required]
    members = (await db_session.execute(select(func.count()).select_from(UserOrganization).where(UserOrganization.org_id == org_id))).scalar() or 0

    per_course = []
    for lc in lm_courses:
        enrolled = (await db_session.execute(select(func.count()).select_from(TrailRun).where(TrailRun.course_id == lc.course.id))).scalar() or 0
        completed = (await db_session.execute(select(func.count()).select_from(TrailRun).where(TrailRun.course_id == lc.course.id, TrailRun.status == StatusEnum.STATUS_COMPLETED))).scalar() or 0
        per_course.append(
            {
                "course_uuid": lc.course.course_uuid,
                "name": lc.course.name,
                "required": lc.required,
                "deadline": lc.deadline.isoformat() if lc.deadline else None,
                "days_left": (lc.deadline - today).days if lc.deadline else None,
                "enrolled": enrolled,
                "completed": completed,
                "completion_rate": round(completed / enrolled, 3) if enrolled else 0.0,
            }
        )

    completed_by_user = await _completed_required_by_user(required, db_session)
    required_ids = {c.course.id for c in required}
    enrolled_any = (await db_session.execute(select(func.count(func.distinct(TrailRun.user_id))).where(TrailRun.course_id.in_(list(required_ids))))).scalar() if required_ids else 0  # type: ignore[attr-defined]
    completed_any = len(completed_by_user)
    completed_all = sum(1 for done in completed_by_user.values() if required_ids and required_ids <= done)

    since = today - timedelta(days=29)
    dau_rows = (await db_session.execute(select(UserActivityDay.activity_date, func.count()).where(UserActivityDay.org_id == org_id, UserActivityDay.activity_date >= since).group_by(UserActivityDay.activity_date).order_by(UserActivityDay.activity_date))).all()
    dau = [{"date": (d if isinstance(d, date) else date.fromisoformat(str(d)[:10])).isoformat(), "users": n} for d, n in dau_rows]

    at_risk = await at_risk_learners(org_id, db_session, today=today, days_inactive=days_inactive, page=1, page_size=1)

    return {
        "members": members,
        "required_courses": len(required),
        "funnel": {"members": members, "enrolled_any_required": enrolled_any or 0, "completed_any_required": completed_any, "completed_all_required": completed_all},
        "courses": per_course,
        "daily_active": dau,
        "at_risk_count": at_risk["total"],
    }


async def at_risk_learners(org_id: int, db_session: AsyncSession, *, today: Optional[date] = None, days_inactive: int = 14, page: int = 1, page_size: int = 50) -> dict:
    """Members who have not finished every required course and are either
    inactive for ``days_inactive`` days or behind the pace their deadline
    implies (actual < expected − 20 points)."""
    today = today or datetime.now(timezone.utc).date()
    required = await get_required_courses(org_id, db_session)
    required_ids = {c.course.id for c in required}
    if not required_ids:
        return {"data": [], "page": page, "page_size": page_size, "total": 0}
    members = (await db_session.execute(select(User).join(UserOrganization, UserOrganization.user_id == User.id).where(UserOrganization.org_id == org_id).order_by(User.id))).scalars().all()  # type: ignore[arg-type]
    user_ids = [u.id for u in members]
    completed_by_user = await _completed_required_by_user(required, db_session)
    last_active = await _last_active_by_user(org_id, user_ids, db_session)
    run_rows = (await db_session.execute(select(TrailRun.user_id, TrailRun.course_id, TrailRun.creation_date).where(TrailRun.course_id.in_(list(required_ids)), TrailRun.user_id.in_(user_ids)))).all() if user_ids else []  # type: ignore[attr-defined]
    enrolled_at: dict[int, Optional[date]] = {}
    for uid, _cid, created in run_rows:
        try:
            d = date.fromisoformat(str(created)[:10])
        except ValueError:
            d = None
        if d and (uid not in enrolled_at or (enrolled_at[uid] and d < enrolled_at[uid])):  # type: ignore[operator]
            enrolled_at[uid] = d
    nearest_deadline = min((c.deadline for c in required if c.deadline), default=None)

    rows = []
    for u in members:
        done = completed_by_user.get(u.id, set())
        if required_ids <= done:
            continue
        reasons = []
        la = last_active.get(u.id)
        if la is None or (today - la).days >= days_inactive:
            reasons.append("inactive")
        actual = len(done & required_ids) / len(required_ids)
        expected = None
        if nearest_deadline and enrolled_at.get(u.id):
            span = (nearest_deadline - enrolled_at[u.id]).days  # type: ignore[operator]
            elapsed = (today - enrolled_at[u.id]).days  # type: ignore[operator]
            if span > 0:
                expected = min(1.0, max(0.0, elapsed / span))
                if actual < expected - 0.2:
                    reasons.append("behind_pace")
        if not reasons:
            continue
        rows.append(
            {
                "user": _user_row(u),
                "reasons": reasons,
                "last_active": la.isoformat() if la else None,
                "completed_required": len(done & required_ids),
                "total_required": len(required_ids),
                "expected_progress": round(expected, 3) if expected is not None else None,
                "actual_progress": round(actual, 3),
            }
        )
    total = len(rows)
    start = (page - 1) * page_size
    return {"data": rows[start : start + page_size], "page": page, "page_size": page_size, "total": total}


async def learners_matrix(org_id: int, db_session: AsyncSession, *, usergroup_id: Optional[int] = None, search: str = "", page: int = 1, page_size: int = 50) -> dict:
    """One row per learner × required course status (org-level table/export)."""
    required = await get_required_courses(org_id, db_session)
    users, total = await _member_page(org_id, db_session, usergroup_id=usergroup_id, search=search, page=page, page_size=page_size)
    user_ids = [u.id for u in users]
    course_ids = [c.course.id for c in required]
    run_rows = (await db_session.execute(select(TrailRun.user_id, TrailRun.course_id, TrailRun.status).where(TrailRun.course_id.in_(course_ids), TrailRun.user_id.in_(user_ids)))).all() if course_ids and user_ids else []  # type: ignore[attr-defined]
    status_by = {(uid, cid): str(getattr(st, "value", st)) for uid, cid, st in run_rows}
    last_active = await _last_active_by_user(org_id, user_ids, db_session)
    data = []
    for u in users:
        statuses = []
        done = 0
        for lc in required:
            st = status_by.get((u.id, lc.course.id))
            s = STATUS_COMPLETED if st == "STATUS_COMPLETED" else (STATUS_IN_PROGRESS if st else STATUS_NOT_STARTED)
            done += 1 if s == STATUS_COMPLETED else 0
            statuses.append({"course_uuid": lc.course.course_uuid, "status": s})
        data.append(
            {
                "user": _user_row(u),
                "courses": statuses,
                "completed_required": done,
                "total_required": len(required),
                "all_required_completed": bool(required) and done == len(required),
                "last_active": last_active.get(u.id).isoformat() if last_active.get(u.id) else None,
            }
        )
    return {"courses": [{"course_uuid": c.course.course_uuid, "name": c.course.name, "deadline": c.deadline.isoformat() if c.deadline else None} for c in required], "data": data, "page": page, "page_size": page_size, "total": total}


async def learner_detail(org_id: int, user: User, db_session: AsyncSession, *, today: Optional[date] = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    lm_courses = await get_lm_courses(org_id, db_session)
    course_ids = [c.course.id for c in lm_courses]
    run_rows = (await db_session.execute(select(TrailRun.course_id, TrailRun.status, TrailRun.creation_date).where(TrailRun.user_id == user.id, TrailRun.course_id.in_(course_ids)))).all() if course_ids else []  # type: ignore[attr-defined]
    runs = {cid: (str(getattr(st, "value", st)), created) for cid, st, created in run_rows}
    step_rows = (await db_session.execute(select(TrailStep.course_id, func.count()).where(TrailStep.user_id == user.id, TrailStep.complete == True).group_by(TrailStep.course_id))).all()  # noqa: E712
    steps = {cid: n for cid, n in step_rows}
    cert_rows = (await db_session.execute(select(Certifications.course_id, CertificateUser.user_certification_uuid).join(CertificateUser, CertificateUser.certification_id == Certifications.id).where(CertificateUser.user_id == user.id))).all()  # type: ignore[arg-type]
    certs = {cid: cert for cid, cert in cert_rows}
    last_active = await _last_active_by_user(org_id, [user.id], db_session)
    courses = []
    for lc in lm_courses:
        total = len(await published_activity_ids(lc.course.id, db_session))
        st, enrolled_at = runs.get(lc.course.id, (None, None))
        done = steps.get(lc.course.id, 0)
        courses.append(
            {
                "course_uuid": lc.course.course_uuid,
                "name": lc.course.name,
                "required": lc.required,
                "deadline": lc.deadline.isoformat() if lc.deadline else None,
                "days_left": (lc.deadline - today).days if lc.deadline else None,
                "status": _status(st, done),
                "enrolled_at": enrolled_at,
                "completed_count": done,
                "total_count": total,
                "progress_percent": round(done / total * 100, 1) if total else 0.0,
                "certificate_uuid": certs.get(lc.course.id),
            }
        )
    required = [c for c in courses if c["required"]]
    return {
        "user": _user_row(user),
        "last_active": last_active.get(user.id).isoformat() if last_active.get(user.id) else None,
        "courses": courses,
        "required_completed": sum(1 for c in required if c["status"] == STATUS_COMPLETED),
        "required_total": len(required),
        "all_required_completed": bool(required) and all(c["status"] == STATUS_COMPLETED for c in required),
    }
