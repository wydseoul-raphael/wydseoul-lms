"""Server-verified video watch progress endpoints.

Mounted at ``/api/v1/video-progress`` for authenticated users (see
``src/router.py``). The heartbeat endpoint is the hot path; it never raises for
a lying client (rejections are data), only for auth, missing sessions and
superseded sessions.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
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

router = APIRouter(dependencies=[Depends(require_courses_feature)])


@router.post(
    "/sessions/{activity_uuid}",
    summary="Start a watch session",
    description="Opens (or replaces) the learner's watch session on a video activity and returns the resume point, trusted duration and current verified progress.",
    responses={
        200: {"description": "Session started"},
        401: {"description": "Authentication required"},
        402: {"description": "Paid course not purchased"},
        403: {"description": "Activity locked (usergroup or sequential progression)"},
        404: {"description": "Activity not found"},
    },
)
async def api_start_watch_session(
    request: Request,
    activity_uuid: str,
    body: StartSessionIn | None = None,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await start_watch_session(request, user, activity_uuid, body or StartSessionIn(), db_session)


@router.post(
    "/heartbeat",
    summary="Record a watch heartbeat",
    description="Reports the player position/state for the active session. Credit is computed from server time; stale sequence numbers are acknowledged without credit.",
    responses={
        200: {"description": "Heartbeat processed (accepted or acknowledged as stale)"},
        401: {"description": "Authentication required"},
        404: {"description": "No session for this activity"},
        409: {"description": "Session superseded by another tab/device"},
    },
)
async def api_record_heartbeat(
    request: Request,
    body: HeartbeatIn,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await record_heartbeat(request, user, body, db_session)


@router.post(
    "/sessions/{session_uuid}/close",
    summary="Close a watch session",
    description="Closes the session (page hide / navigation). Behaves like a final paused heartbeat.",
    responses={200: {"description": "Session closed"}, 401: {"description": "Authentication required"}, 404: {"description": "Session not found"}},
)
async def api_close_watch_session(
    request: Request,
    session_uuid: str,
    body: CloseSessionIn | None = None,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await close_watch_session(request, user, session_uuid, body or CloseSessionIn(), db_session)


@router.get(
    "/activity/{activity_uuid}",
    summary="Get my progress on a video",
    responses={200: {"description": "Progress snapshot"}, 401: {"description": "Authentication required"}, 404: {"description": "Activity not found"}},
)
async def api_get_activity_progress(
    request: Request,
    activity_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await get_activity_progress(request, user, activity_uuid, db_session)


@router.get(
    "/course/{course_uuid}",
    summary="Get my progress across a course",
    description="Per-activity verified progress, completion and (sequential) lock state in curriculum order.",
    responses={200: {"description": "Course progress summary"}, 401: {"description": "Authentication required"}, 404: {"description": "Course not found"}},
)
async def api_get_course_progress(
    request: Request,
    course_uuid: str,
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await get_course_progress_summary(request, user, course_uuid, db_session)


@router.get(
    "/course/{course_uuid}/admin",
    summary="List learners' video progress for a course (admin)",
    responses={200: {"description": "Paginated learner × video rows"}, 401: {"description": "Authentication required"}, 403: {"description": "Not allowed"}, 404: {"description": "Course not found"}},
)
async def api_get_course_progress_admin(
    request: Request,
    course_uuid: str,
    user_uuid: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await get_course_progress_admin(request, user, course_uuid, db_session, user_uuid=user_uuid, page=page, limit=limit)
