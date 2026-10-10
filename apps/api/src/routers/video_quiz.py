"""Video quiz endpoints (checkpoints + end quiz), mounted at /api/v1/video-quiz."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from src.core.events.database import get_db_session
from src.db.courses.video_quiz import CheckpointAnswerIn, EndQuizSubmitIn, VideoQuizUpsert
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses.activities.video_quiz import (
    answer_checkpoint,
    delete_video_quiz,
    get_video_quiz_admin,
    get_video_quiz_for_learner,
    list_attempts,
    quiz_stats,
    submit_end_quiz,
    upsert_video_quiz,
)

router = APIRouter(dependencies=[Depends(require_courses_feature)])


@router.get("/{activity_uuid}", summary="Get the quiz for a video (questions without answers + my state)")
async def api_get_video_quiz(request: Request, activity_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await get_video_quiz_for_learner(request, activity_uuid, user, db_session)


@router.post("/{activity_uuid}/checkpoint/{question_id}/answer", summary="Answer an in-video checkpoint")
async def api_answer_checkpoint(request: Request, activity_uuid: str, question_id: str, body: CheckpointAnswerIn, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await answer_checkpoint(request, activity_uuid, question_id, body, user, db_session)


@router.post("/{activity_uuid}/submit", summary="Submit the end-of-video quiz")
async def api_submit_end_quiz(request: Request, activity_uuid: str, body: EndQuizSubmitIn, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await submit_end_quiz(request, activity_uuid, body, user, db_session)


@router.put("/{activity_uuid}", summary="Create or replace the quiz for a video (instructor)")
async def api_upsert_video_quiz(request: Request, activity_uuid: str, body: VideoQuizUpsert, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await upsert_video_quiz(request, activity_uuid, body, user, db_session)


@router.get("/{activity_uuid}/admin", summary="Get the quiz with answer key (instructor)")
async def api_get_video_quiz_admin(request: Request, activity_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await get_video_quiz_admin(request, activity_uuid, user, db_session)


@router.delete("/{activity_uuid}", summary="Delete the quiz for a video (instructor)")
async def api_delete_video_quiz(request: Request, activity_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await delete_video_quiz(request, activity_uuid, user, db_session)


@router.get("/{activity_uuid}/attempts", summary="List quiz attempts (instructor)")
async def api_list_attempts(
    request: Request,
    activity_uuid: str,
    user_uuid: Optional[str] = Query(default=None),
    kind: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    return await list_attempts(request, activity_uuid, user, db_session, user_uuid=user_uuid, kind=kind, page=page, page_size=page_size)


@router.get("/{activity_uuid}/stats", summary="Per-question accuracy and pass rate (instructor)")
async def api_quiz_stats(request: Request, activity_uuid: str, user=Depends(get_current_user), db_session=Depends(get_db_session)):
    return await quiz_stats(request, activity_uuid, user, db_session)
