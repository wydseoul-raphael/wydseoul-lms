"""Video quizzes: checkpoints (pause-and-answer) and the end-of-video quiz.

Policy (reference learning center): a lesson with a quiz is complete when the
video is verified-watched AND the best end-quiz score reaches ``pass_score``
(100 by default). Answer keys never leave the server; every submission is
recorded (idempotent on a client ``attempt_id``) for per-question analytics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.courses.video_quiz import (
    SUPPORTED_QUIZ_LANGS,
    CheckpointAnswerIn,
    EndQuizSubmitIn,
    VideoQuiz,
    VideoQuizAttempt,
    VideoQuizQuestionIn,
    VideoQuizSettings,
    VideoQuizUpsert,
)
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac.resource_access import AccessAction, check_resource_access
from src.services.courses.activities.access import verify_activity_reader_access_by_uuid
from src.services.courses.activities.quiz_modes import (
    GRADING_MODE_ALL_OR_NOTHING,
    RESPONSE_TYPE_MULTIPLE,
    RESPONSE_TYPE_SINGLE,
    score_question,
)

logger = logging.getLogger(__name__)

PUBLIC_QUESTION_FIELDS = ("id", "kind", "timestamp", "type", "prompt", "required_correct")
PUBLIC_OPTION_FIELDS = ("id", "text")
TRUE_FALSE_IDS = ("true", "false")


# --------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------


def public_questions(questions: list[dict]) -> list[dict]:
    """Whitelist projection of the question document for learners. Anything
    that is not explicitly public (notably ``correct`` and explanations) is
    dropped; the key is never consulted here."""
    out: list[dict] = []
    for q in questions:
        item = {k: q.get(k) for k in PUBLIC_QUESTION_FIELDS if k in q}
        item["options"] = [{k: o.get(k) for k in PUBLIC_OPTION_FIELDS if k in o} for o in q.get("options", [])]
        out.append(item)
    return out


def split_editor_payload(questions_in: list[VideoQuizQuestionIn], *, start_time: float = 0.0, end_time: float | None = None) -> tuple[list[dict], dict]:
    """Validate the editor payload and split it into (public questions, answer key)."""
    public: list[dict] = []
    key: dict[str, list[str]] = {}
    seen: set[str] = set()
    for q in questions_in:
        if q.id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate question id {q.id!r}")
        seen.add(q.id)
        options = [o.model_dump() for o in q.options]
        if q.type == "true_false":
            if len(options) != 2 or {o["id"] for o in options} != set(TRUE_FALSE_IDS):
                raise HTTPException(status_code=400, detail=f"Question {q.id!r}: true/false needs options 'true' and 'false'")
        if len(options) < 2:
            raise HTTPException(status_code=400, detail=f"Question {q.id!r} needs at least two options")
        option_ids = [o["id"] for o in options]
        if len(set(option_ids)) != len(option_ids):
            raise HTTPException(status_code=400, detail=f"Question {q.id!r} has duplicate option ids")
        correct = [o["id"] for o in options if o.get("correct")]
        if q.type in ("single", "true_false") and len(correct) != 1:
            raise HTTPException(status_code=400, detail=f"Question {q.id!r} needs exactly one correct option")
        if q.type == "multiple" and not correct:
            raise HTTPException(status_code=400, detail=f"Question {q.id!r} needs at least one correct option")
        if q.kind == "checkpoint":
            if q.timestamp is None:
                raise HTTPException(status_code=400, detail=f"Checkpoint {q.id!r} needs a timestamp")
            if q.timestamp < start_time or (end_time is not None and q.timestamp >= end_time):
                raise HTTPException(status_code=400, detail=f"Checkpoint {q.id!r} is outside the video range")
        public.append(
            {
                "id": q.id,
                "kind": q.kind,
                "timestamp": q.timestamp if q.kind == "checkpoint" else None,
                "type": q.type,
                "prompt": q.prompt,
                "required_correct": bool(q.required_correct) if q.kind == "checkpoint" else False,
                "explanation": q.explanation or None,
                "options": [{"id": o["id"], "text": o["text"]} for o in options],
            }
        )
        key[q.id] = correct
    public.sort(key=lambda q: (0 if q["kind"] == "checkpoint" else 1, q["timestamp"] or 0))
    return public, key


def grade_question(selected: list[str], key: list[str]) -> bool:
    """All-or-nothing: the selected set must equal the key (via quiz_modes)."""
    if not key:
        return False
    options = set(key) | set(selected)
    pairs = [(o in key, o in selected) for o in options]
    response_type = RESPONSE_TYPE_MULTIPLE if len(key) > 1 else RESPONSE_TYPE_SINGLE
    return score_question(pairs, response_type, GRADING_MODE_ALL_OR_NOTHING) >= 1.0


def grade_end_quiz(questions: list[dict], answer_key: dict, answers: dict[str, list[str]], pass_score: int) -> dict:
    results: dict[str, bool] = {}
    total = 0
    correct = 0
    for q in questions:
        if q.get("kind") != "end":
            continue
        key = answer_key.get(q["id"]) or []
        if not key:
            continue  # unkeyed question: excluded from the denominator
        total += 1
        ok = grade_question([str(a) for a in (answers.get(q["id"]) or [])], [str(k) for k in key])
        results[q["id"]] = ok
        if ok:
            correct += 1
    score = round(correct / total * 100, 1) if total else 0.0
    return {"results": results, "correct": correct, "total": total, "score": score, "passed": total > 0 and score >= pass_score}


def translation_status(questions: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for q in questions:
        texts = [q.get("prompt") or {}] + [o.get("text") or {} for o in q.get("options", [])]
        missing = [lang for lang in SUPPORTED_QUIZ_LANGS if any(not t.get(lang) for t in texts)]
        out[q["id"]] = {"missing": missing, "complete": not missing}
    return out


def checkpoint_ids(questions: list[dict]) -> list[str]:
    return [q["id"] for q in questions if q.get("kind") == "checkpoint"]


def has_required_end_quiz(questions: list[dict], settings: dict) -> bool:
    return bool(settings.get("end_quiz_required", True)) and any(q.get("kind") == "end" for q in questions)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


def _require_user(user) -> PublicUser:
    if user is None or isinstance(user, AnonymousUser):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


async def _quiz_for_activity(activity_id: int, db_session: AsyncSession) -> VideoQuiz | None:
    return (await db_session.execute(select(VideoQuiz).where(VideoQuiz.activity_id == activity_id))).scalars().first()


async def _load_for_edit(request: Request, activity_uuid: str, user, db_session: AsyncSession) -> tuple[Activity, Course]:
    activity = (await db_session.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.activity_type != ActivityTypeEnum.TYPE_VIDEO:
        raise HTTPException(status_code=400, detail="Quizzes attach to video activities")
    course = (await db_session.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.UPDATE)
    return activity, course


async def _learner_state(user_id: int, quiz: VideoQuiz, db_session: AsyncSession) -> dict:
    rows = (
        await db_session.execute(
            select(VideoQuizAttempt).where(VideoQuizAttempt.user_id == user_id, VideoQuizAttempt.video_quiz_id == quiz.id).order_by(VideoQuizAttempt.id)
        )
    ).scalars().all()
    checkpoints: dict[str, dict] = {}
    end_attempts = []
    for a in rows:
        if a.kind == "checkpoint" and a.question_id:
            cp = checkpoints.setdefault(a.question_id, {"answered": False, "correct": False, "attempts": 0})
            cp["attempts"] += 1
            cp["answered"] = True
            cp["correct"] = cp["correct"] or a.passed
        elif a.kind == "end":
            end_attempts.append(a)
    settings = quiz.settings or {}
    max_attempts = int(settings.get("max_attempts") or 0)
    best = max((a.score for a in end_attempts), default=0.0)
    last = end_attempts[-1] if end_attempts else None
    return {
        "checkpoints": checkpoints,
        "end": {
            "attemptsUsed": len(end_attempts),
            "attemptsRemaining": (max(0, max_attempts - len(end_attempts)) if max_attempts else None),
            "bestScore": best,
            "passed": any(a.passed for a in end_attempts),
            "lastAttempt": (
                {
                    "attemptUuid": last.attempt_uuid,
                    "score": last.score,
                    "passed": last.passed,
                    "submittedAt": last.submitted_at.isoformat() if last.submitted_at else None,
                    **({"wrongQuestionIds": [k for k, v in (last.results or {}).items() if not v]} if settings.get("show_wrong_questions") else {}),
                }
                if last
                else None
            ),
        },
    }


# --------------------------------------------------------------------------
# Learner API
# --------------------------------------------------------------------------


async def get_video_quiz_for_learner(request: Request, activity_uuid: str, user, db_session: AsyncSession) -> dict:
    activity, _course = await verify_activity_reader_access_by_uuid(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    if quiz is None or not quiz.questions:
        return {"activityUuid": activity_uuid, "version": 0, "questions": [], "settings": {}, "state": None, "hasEndQuiz": False}
    settings = {**VideoQuizSettings().model_dump(), **(quiz.settings or {})}
    public_settings = {k: settings[k] for k in ("end_quiz_required", "pass_score", "max_attempts", "show_wrong_questions", "shuffle_options")}
    state = None if isinstance(user, AnonymousUser) or user is None else await _learner_state(user.id, quiz, db_session)
    return {
        "activityUuid": activity_uuid,
        "version": quiz.version,
        "questions": public_questions(quiz.questions),
        "settings": public_settings,
        "state": state,
        "hasEndQuiz": has_required_end_quiz(quiz.questions, settings),
    }


async def _record_attempt(db_session: AsyncSession, **fields) -> tuple[VideoQuizAttempt, bool]:
    """Insert an attempt; on a duplicate idempotency key return the stored one."""
    existing = (
        await db_session.execute(
            select(VideoQuizAttempt).where(VideoQuizAttempt.user_id == fields["user_id"], VideoQuizAttempt.idempotency_key == fields["idempotency_key"])
        )
    ).scalars().first()
    if existing:
        return existing, False
    attempt = VideoQuizAttempt(attempt_uuid=f"vqattempt_{uuid4()}", **fields)
    db_session.add(attempt)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        existing = (
            await db_session.execute(
                select(VideoQuizAttempt).where(VideoQuizAttempt.user_id == fields["user_id"], VideoQuizAttempt.idempotency_key == fields["idempotency_key"])
            )
        ).scalars().first()
        if existing:
            return existing, False
        raise
    await db_session.refresh(attempt)
    return attempt, True


def _localized_explanation(question: dict) -> dict | None:
    exp = question.get("explanation")
    return exp if isinstance(exp, dict) and exp else None


async def answer_checkpoint(request: Request, activity_uuid: str, question_id: str, body: CheckpointAnswerIn, user, db_session: AsyncSession) -> dict:
    user = _require_user(user)
    activity, course = await verify_activity_reader_access_by_uuid(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    question = next((q for q in (quiz.questions if quiz else []) if q.get("id") == question_id and q.get("kind") == "checkpoint"), None)
    if quiz is None or question is None:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    key = [str(k) for k in (quiz.answer_key or {}).get(question_id, [])]
    correct = grade_question([str(s) for s in body.selected], key)
    attempt, _new = await _record_attempt(
        db_session,
        org_id=course.org_id,
        course_id=course.id,
        activity_id=activity.id,
        video_quiz_id=quiz.id,
        user_id=user.id,
        kind="checkpoint",
        question_id=question_id,
        quiz_version=quiz.version,
        idempotency_key=f"cp:{question_id}:{body.attempt_id}",
        answers={question_id: body.selected},
        results={question_id: correct},
        score=100.0 if correct else 0.0,
        passed=correct,
        submitted_at=datetime.now(timezone.utc),
    )
    required = bool(question.get("required_correct"))
    state = await _learner_state(user.id, quiz, db_session)
    return {
        "attemptUuid": attempt.attempt_uuid,
        "correct": attempt.passed,
        "canContinue": attempt.passed or not required,
        "requiredCorrect": required,
        "explanation": _localized_explanation(question) if (attempt.passed or not required) else None,
        "attempts": state["checkpoints"].get(question_id, {}).get("attempts", 1),
    }


async def submit_end_quiz(request: Request, activity_uuid: str, body: EndQuizSubmitIn, user, db_session: AsyncSession) -> dict:
    user = _require_user(user)
    activity, course = await verify_activity_reader_access_by_uuid(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    if quiz is None or not any(q.get("kind") == "end" for q in quiz.questions):
        raise HTTPException(status_code=404, detail="This video has no end quiz")
    settings = {**VideoQuizSettings().model_dump(), **(quiz.settings or {})}
    before = await _learner_state(user.id, quiz, db_session)
    max_attempts = int(settings.get("max_attempts") or 0)
    duplicate = (
        await db_session.execute(
            select(VideoQuizAttempt).where(VideoQuizAttempt.user_id == user.id, VideoQuizAttempt.idempotency_key == f"end:{body.attempt_id}")
        )
    ).scalars().first()
    if duplicate is None and max_attempts and before["end"]["attemptsUsed"] >= max_attempts:
        raise HTTPException(status_code=409, detail={"code": "MAX_ATTEMPTS", "message": "No attempts remaining"})

    graded = grade_end_quiz(quiz.questions, quiz.answer_key or {}, {k: [str(x) for x in v] for k, v in body.answers.items()}, int(settings["pass_score"]))
    attempt, is_new = await _record_attempt(
        db_session,
        org_id=course.org_id,
        course_id=course.id,
        activity_id=activity.id,
        video_quiz_id=quiz.id,
        user_id=user.id,
        kind="end",
        question_id=None,
        quiz_version=quiz.version,
        idempotency_key=f"end:{body.attempt_id}",
        answers=body.answers,
        results=graded["results"],
        score=graded["score"],
        passed=graded["passed"],
        submitted_at=datetime.now(timezone.utc),
    )

    activity_completed = False
    if attempt.passed and is_new:
        from src.services.video_progress.service import complete_after_quiz_pass

        try:
            activity_completed = await complete_after_quiz_pass(request, user, activity, course, db_session, best_score=attempt.score)
        except Exception:  # pragma: no cover - completion side effects never fail the submission
            logger.exception("Completion after quiz pass failed for %s", activity_uuid)

    after = await _learner_state(user.id, quiz, db_session)
    return {
        "attemptUuid": attempt.attempt_uuid,
        "score": attempt.score,
        "passed": attempt.passed,
        "correctCount": sum(1 for v in (attempt.results or {}).values() if v),
        "total": len(attempt.results or {}),
        **({"wrongQuestionIds": [k for k, v in (attempt.results or {}).items() if not v]} if settings.get("show_wrong_questions") else {}),
        "attemptsUsed": after["end"]["attemptsUsed"],
        "attemptsRemaining": after["end"]["attemptsRemaining"],
        "bestScore": after["end"]["bestScore"],
        "activityCompleted": activity_completed,
    }


async def get_quiz_gate_state(user_id: int, activity_id: int, db_session: AsyncSession) -> dict:
    """What the completion engine needs: is there a required end quiz, and has
    this learner passed it?"""
    quiz = await _quiz_for_activity(activity_id, db_session)
    if quiz is None:
        return {"hasEndQuiz": False, "required": False, "passed": False, "bestScore": None}
    settings = {**VideoQuizSettings().model_dump(), **(quiz.settings or {})}
    required = has_required_end_quiz(quiz.questions, settings)
    if not required:
        return {"hasEndQuiz": any(q.get("kind") == "end" for q in quiz.questions), "required": False, "passed": True, "bestScore": None}
    best_row = (
        await db_session.execute(
            select(func.max(VideoQuizAttempt.score)).where(
                VideoQuizAttempt.user_id == user_id, VideoQuizAttempt.video_quiz_id == quiz.id, VideoQuizAttempt.kind == "end"
            )
        )
    ).first()
    best = float(best_row[0]) if best_row and best_row[0] is not None else None
    passed_row = (
        await db_session.execute(
            select(VideoQuizAttempt.id).where(
                VideoQuizAttempt.user_id == user_id, VideoQuizAttempt.video_quiz_id == quiz.id, VideoQuizAttempt.kind == "end", VideoQuizAttempt.passed == True  # noqa: E712
            ).limit(1)
        )
    ).first()
    return {"hasEndQuiz": True, "required": True, "passed": passed_row is not None, "bestScore": best}


# --------------------------------------------------------------------------
# Instructor API
# --------------------------------------------------------------------------


async def upsert_video_quiz(request: Request, activity_uuid: str, body: VideoQuizUpsert, user, db_session: AsyncSession) -> dict:
    user = _require_user(user)
    activity, course = await _load_for_edit(request, activity_uuid, user, db_session)
    details = activity.details or {}
    public, key = split_editor_payload(body.questions, start_time=float(details.get("startTime") or 0), end_time=details.get("endTime") or None)
    quiz = await _quiz_for_activity(activity.id, db_session)
    now = str(datetime.now())
    if quiz is None:
        quiz = VideoQuiz(
            video_quiz_uuid=f"videoquiz_{uuid4()}",
            org_id=course.org_id,
            course_id=course.id,
            activity_id=activity.id,
            questions=public,
            answer_key=key,
            settings=body.settings.model_dump(),
            version=1,
            creation_date=now,
            update_date=now,
        )
    else:
        quiz.questions = public
        quiz.answer_key = key
        quiz.settings = body.settings.model_dump()
        quiz.version = (quiz.version or 1) + 1
        quiz.update_date = now
    db_session.add(quiz)
    # Mirror the quiz presence on the activity so the watch engine can gate
    # completion without a join.
    new_details = dict(details)
    new_details["endQuiz"] = {"enabled": has_required_end_quiz(public, quiz.settings), "count": sum(1 for q in public if q["kind"] == "end")}
    new_details["checkpointCount"] = len(checkpoint_ids(public))
    activity.details = new_details
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(activity, "details")
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(quiz)
    return _admin_read(quiz)


def _admin_read(quiz: VideoQuiz) -> dict:
    return {
        "videoQuizUuid": quiz.video_quiz_uuid,
        "version": quiz.version,
        "questions": quiz.questions,
        "answerKey": quiz.answer_key,
        "settings": {**VideoQuizSettings().model_dump(), **(quiz.settings or {})},
        "translationStatus": translation_status(quiz.questions),
        "updatedAt": quiz.update_date,
    }


async def get_video_quiz_admin(request: Request, activity_uuid: str, user, db_session: AsyncSession) -> dict:
    user = _require_user(user)
    activity, _course = await _load_for_edit(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    if quiz is None:
        return {"videoQuizUuid": None, "version": 0, "questions": [], "answerKey": {}, "settings": VideoQuizSettings().model_dump(), "translationStatus": {}, "updatedAt": None}
    return _admin_read(quiz)


async def delete_video_quiz(request: Request, activity_uuid: str, user, db_session: AsyncSession) -> dict:
    user = _require_user(user)
    activity, _course = await _load_for_edit(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    if quiz is None:
        raise HTTPException(status_code=404, detail="No quiz for this video")
    await db_session.delete(quiz)
    details = dict(activity.details or {})
    details.pop("endQuiz", None)
    details.pop("checkpointCount", None)
    activity.details = details
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(activity, "details")
    db_session.add(activity)
    await db_session.commit()
    return {"deleted": True}


async def list_attempts(request: Request, activity_uuid: str, user, db_session: AsyncSession, *, user_uuid: Optional[str] = None, kind: Optional[str] = None, page: int = 1, page_size: int = 50) -> dict:
    user = _require_user(user)
    activity, _course = await _load_for_edit(request, activity_uuid, user, db_session)
    from src.db.users import User

    page = max(1, page)
    page_size = max(1, min(200, page_size))
    stmt = select(VideoQuizAttempt, User).join(User, User.id == VideoQuizAttempt.user_id).where(VideoQuizAttempt.activity_id == activity.id)  # type: ignore[arg-type]
    count_stmt = select(func.count()).select_from(VideoQuizAttempt).join(User, User.id == VideoQuizAttempt.user_id).where(VideoQuizAttempt.activity_id == activity.id)  # type: ignore[arg-type]
    if kind in ("checkpoint", "end"):
        stmt = stmt.where(VideoQuizAttempt.kind == kind)
        count_stmt = count_stmt.where(VideoQuizAttempt.kind == kind)
    if user_uuid:
        stmt = stmt.where(User.user_uuid == user_uuid)
        count_stmt = count_stmt.where(User.user_uuid == user_uuid)
    total = (await db_session.execute(count_stmt)).scalar() or 0
    rows = (await db_session.execute(stmt.order_by(VideoQuizAttempt.id.desc()).offset((page - 1) * page_size).limit(page_size))).all()  # type: ignore[attr-defined]
    data = [
        {
            "attemptUuid": a.attempt_uuid,
            "user": {"user_uuid": u.user_uuid, "username": u.username, "email": u.email},
            "kind": a.kind,
            "questionId": a.question_id,
            "score": a.score,
            "passed": a.passed,
            "results": a.results,
            "quizVersion": a.quiz_version,
            "submittedAt": a.submitted_at.isoformat() if a.submitted_at else None,
        }
        for a, u in rows
    ]
    return {"data": data, "page": page, "page_size": page_size, "total": total}


async def quiz_stats(request: Request, activity_uuid: str, user, db_session: AsyncSession) -> dict:
    """Per-question accuracy and end-quiz pass rate (Python aggregation over
    this activity's attempts; volumes are per video, not per org)."""
    user = _require_user(user)
    activity, _course = await _load_for_edit(request, activity_uuid, user, db_session)
    quiz = await _quiz_for_activity(activity.id, db_session)
    if quiz is None:
        return {"questions": [], "endQuiz": None}
    rows = (await db_session.execute(select(VideoQuizAttempt).where(VideoQuizAttempt.video_quiz_id == quiz.id))).scalars().all()
    per_q: dict[str, dict] = {q["id"]: {"questionId": q["id"], "kind": q.get("kind"), "attempts": 0, "correct": 0} for q in quiz.questions}
    end_total = 0
    end_passed = 0
    passers: dict[int, int] = {}
    histogram = {str(b): 0 for b in range(0, 101, 10)}
    for a in rows:
        for qid, ok in (a.results or {}).items():
            if qid in per_q:
                per_q[qid]["attempts"] += 1
                per_q[qid]["correct"] += 1 if ok else 0
        if a.kind == "end":
            end_total += 1
            end_passed += 1 if a.passed else 0
            bucket = str(min(100, int(a.score // 10) * 10))
            histogram[bucket] = histogram.get(bucket, 0) + 1
            passers.setdefault(a.user_id, 0)
            passers[a.user_id] += 1
    questions = [{**v, "accuracy": round(v["correct"] / v["attempts"], 3) if v["attempts"] else None} for v in per_q.values()]
    return {
        "questions": questions,
        "endQuiz": {
            "attempts": end_total,
            "passed": end_passed,
            "passRate": round(end_passed / end_total, 3) if end_total else None,
            "avgAttemptsPerLearner": round(sum(passers.values()) / len(passers), 2) if passers else None,
            "scoreHistogram": histogram,
        },
    }


__all__ = [
    "answer_checkpoint",
    "checkpoint_ids",
    "delete_video_quiz",
    "get_quiz_gate_state",
    "get_video_quiz_admin",
    "get_video_quiz_for_learner",
    "grade_end_quiz",
    "grade_question",
    "has_required_end_quiz",
    "list_attempts",
    "public_questions",
    "quiz_stats",
    "split_editor_payload",
    "submit_end_quiz",
    "translation_status",
    "upsert_video_quiz",
]
