"""Tests for src/services/courses/activities/video_quiz.py."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.video_quiz import CheckpointAnswerIn, EndQuizSubmitIn, VideoQuizOptionIn, VideoQuizQuestionIn, VideoQuizSettings, VideoQuizUpsert
from src.db.trail_steps import TrailStep
from src.services.courses.activities import video_quiz as vq
from src.services.video_progress import service as vps
from src.services.video_progress.service import HeartbeatIn, StartSessionIn, record_heartbeat, start_watch_session

T0 = datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc)


def _q(id, kind="end", type="single", correct=("a",), timestamp=None, required=False, n=3):
    opts = [VideoQuizOptionIn(id=o, text={"en": f"Option {o}", "ko": f"보기 {o}"}, correct=(o in correct)) for o in "abc"[:n]]
    return VideoQuizQuestionIn(id=id, kind=kind, type=type, timestamp=timestamp, prompt={"en": f"Q {id}", "ko": f"문 {id}"}, options=opts, required_correct=required)


@pytest.fixture
async def video(db, org, course, chapter):
    a = Activity(
        id=70, name="Quiz video", activity_type=ActivityTypeEnum.TYPE_VIDEO, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"uri": "https://youtu.be/42M5kFJU804", "type": "youtube"}, details={"durationSeconds": 600, "verifiedWatch": True},
        published=True, org_id=org.id, course_id=course.id, activity_uuid="activity_quiz", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    db.add(ChapterActivity(order=1, chapter_id=chapter.id, activity_id=a.id, course_id=course.id, org_id=org.id, creation_date="x", update_date="x"))
    await db.commit()
    return a


@pytest.fixture
def gate(video, course):
    with patch.object(vq, "verify_activity_reader_access_by_uuid", new=AsyncMock(return_value=(video, course))), patch.object(
        vq, "check_resource_access", new=AsyncMock()
    ), patch.object(vps, "verify_activity_reader_access_by_uuid", new=AsyncMock(return_value=(video, course))):
        yield


async def _create_quiz(request, admin, db, *, with_checkpoint=True, settings=None):
    questions = [_q("e1"), _q("e2", type="multiple", correct=("a", "b"))]
    if with_checkpoint:
        questions.insert(0, _q("c1", kind="checkpoint", timestamp=120, required=True))
    body = VideoQuizUpsert(questions=questions, settings=settings or VideoQuizSettings())
    return await vq.upsert_video_quiz(request, "activity_quiz", body, admin, db)


class TestPure:
    def test_grading(self):
        assert vq.grade_question(["a"], ["a"]) is True
        assert vq.grade_question(["a", "b"], ["a"]) is False
        assert vq.grade_question(["a"], ["a", "b"]) is False
        assert vq.grade_question(["b", "a"], ["a", "b"]) is True
        assert vq.grade_question([], ["a"]) is False
        assert vq.grade_question(["a"], []) is False

    def test_end_quiz_grading_skips_unkeyed_and_rounds(self):
        questions = [{"id": "e1", "kind": "end"}, {"id": "e2", "kind": "end"}, {"id": "e3", "kind": "end"}, {"id": "c1", "kind": "checkpoint"}]
        key = {"e1": ["a"], "e2": ["a", "b"], "e3": [], "c1": ["a"]}
        g = vq.grade_end_quiz(questions, key, {"e1": ["a"], "e2": ["a"]}, 100)
        assert g == {"results": {"e1": True, "e2": False}, "correct": 1, "total": 2, "score": 50.0, "passed": False}
        assert vq.grade_end_quiz(questions, key, {"e1": ["a"], "e2": ["b", "a"]}, 100)["passed"] is True

    def test_public_projection_never_leaks(self):
        qs = [{"id": "q", "kind": "end", "type": "single", "prompt": {"en": "x"}, "explanation": {"en": "why"}, "options": [{"id": "a", "text": {"en": "A"}, "correct": True, "note": "secret"}]}]
        pub = vq.public_questions(qs)
        assert "explanation" not in pub[0]
        assert pub[0]["options"] == [{"id": "a", "text": {"en": "A"}}]

    def test_split_validation(self):
        with pytest.raises(HTTPException):
            vq.split_editor_payload([_q("x", correct=())])
        with pytest.raises(HTTPException):
            vq.split_editor_payload([_q("x", type="multiple", correct=())])
        with pytest.raises(HTTPException):
            vq.split_editor_payload([_q("x"), _q("x")])
        with pytest.raises(HTTPException):
            vq.split_editor_payload([_q("c", kind="checkpoint", timestamp=None)])
        with pytest.raises(HTTPException):
            vq.split_editor_payload([_q("c", kind="checkpoint", timestamp=700)], end_time=600)
        public, key = vq.split_editor_payload([_q("e1"), _q("c1", kind="checkpoint", timestamp=5)])
        assert [q["id"] for q in public] == ["c1", "e1"]
        assert key == {"e1": ["a"], "c1": ["a"]}
        assert all("correct" not in o for q in public for o in q["options"])

    def test_translation_status(self):
        public, _ = vq.split_editor_payload([_q("e1")])
        st = vq.translation_status(public)
        assert st["e1"]["complete"] is False and set(st["e1"]["missing"]) == {"it", "fr", "es", "pt"}


class TestLearnerFlow:
    async def test_learner_payload_has_no_answers(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db)
        data = await vq.get_video_quiz_for_learner(mock_request, "activity_quiz", regular_user, db)
        text = str(data)
        assert "answerKey" not in text and "answer_key" not in text and "explanation" not in text
        assert all("correct" not in o for q in data["questions"] for o in q["options"])
        assert [q["id"] for q in data["questions"]] == ["c1", "e1", "e2"]
        assert data["hasEndQuiz"] is True
        assert data["state"]["end"]["attemptsUsed"] == 0

    async def test_checkpoint_required_blocks_until_correct(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db)
        wrong = await vq.answer_checkpoint(mock_request, "activity_quiz", "c1", CheckpointAnswerIn(attempt_id="attempt-00001", selected=["b"]), regular_user, db)
        assert wrong["correct"] is False and wrong["canContinue"] is False
        right = await vq.answer_checkpoint(mock_request, "activity_quiz", "c1", CheckpointAnswerIn(attempt_id="attempt-00002", selected=["a"]), regular_user, db)
        assert right["correct"] is True and right["canContinue"] is True and right["attempts"] == 2
        state = (await vq.get_video_quiz_for_learner(mock_request, "activity_quiz", regular_user, db))["state"]
        assert state["checkpoints"]["c1"] == {"answered": True, "correct": True, "attempts": 2}
        with pytest.raises(HTTPException) as exc:
            await vq.answer_checkpoint(mock_request, "activity_quiz", "e1", CheckpointAnswerIn(attempt_id="attempt-00003", selected=["a"]), regular_user, db)
        assert exc.value.status_code == 404

    async def test_end_quiz_idempotent_and_attempt_limit(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db, settings=VideoQuizSettings(max_attempts=2, show_wrong_questions=True))
        first = await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-0001", answers={"e1": ["a"], "e2": ["a"]}), regular_user, db)
        assert first["score"] == 50.0 and first["passed"] is False and first["wrongQuestionIds"] == ["e2"]
        again = await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-0001", answers={"e1": ["a"], "e2": ["a"]}), regular_user, db)
        assert again["attemptUuid"] == first["attemptUuid"] and again["attemptsUsed"] == 1
        with patch.object(vps, "complete_activity_for_user", new=AsyncMock(return_value=(None, True))):
            second = await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-0002", answers={"e1": ["a"], "e2": ["a", "b"]}), regular_user, db)
        assert second["passed"] is True and second["attemptsRemaining"] == 0
        with pytest.raises(HTTPException) as exc:
            await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-0003", answers={}), regular_user, db)
        assert exc.value.status_code == 409

    async def test_anonymous_cannot_answer(self, db, mock_request, anonymous_user, admin_user, gate):
        await _create_quiz(mock_request, admin_user, db)
        with pytest.raises(HTTPException) as exc:
            await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-anon-1", answers={}), anonymous_user, db)
        assert exc.value.status_code == 401


class TestCompletionGate:
    async def _watch_to_completion(self, request, user, db):
        sid = (await start_watch_session(request, user, "activity_quiz", StartSessionIn(), db, now=T0))["sessionId"]
        await record_heartbeat(request, user, HeartbeatIn(sessionId=sid, activityUuid="activity_quiz", seq=1, currentTime=0, playerState="playing"), db, now=T0)
        last = None
        for i in range(1, 55):
            last = await record_heartbeat(request, user, HeartbeatIn(sessionId=sid, activityUuid="activity_quiz", seq=i + 1, currentTime=i * 10, playerState="playing"), db, now=T0 + timedelta(seconds=i * 10))
        return last

    async def test_video_first_then_quiz_completes(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db, with_checkpoint=False)
        with patch.object(vps, "complete_activity_for_user", new=AsyncMock(return_value=(None, True))) as complete, patch.object(vps, "track", new=AsyncMock()):
            last = await self._watch_to_completion(mock_request, regular_user, db)
            assert last["completionState"] == "video_complete_quiz_pending"
            complete.assert_not_awaited()
            res = await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-pass-1", answers={"e1": ["a"], "e2": ["a", "b"]}), regular_user, db)
            assert res["passed"] is True and res["activityCompleted"] is True
            complete.assert_awaited_once()
            assert complete.await_args.kwargs["source"] == "video_quiz"
            assert complete.await_args.kwargs["step_data"]["quizPassed"] is True
            assert complete.await_args.kwargs["step_data"]["bestQuizScore"] == 100.0

    async def test_quiz_first_then_video_completes(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db, with_checkpoint=False)
        with patch.object(vps, "complete_activity_for_user", new=AsyncMock(return_value=(None, True))) as complete, patch.object(vps, "track", new=AsyncMock()):
            res = await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="submit-pass-2", answers={"e1": ["a"], "e2": ["a", "b"]}), regular_user, db)
            assert res["passed"] is True and res["activityCompleted"] is False
            last = await self._watch_to_completion(mock_request, regular_user, db)
            assert last["completionState"] == "complete"
            complete.assert_awaited_once()
            assert complete.await_args.kwargs["step_data"]["quizPassed"] is True

    async def test_no_quiz_completes_on_video(self, db, mock_request, regular_user, gate):
        with patch.object(vps, "complete_activity_for_user", new=AsyncMock(return_value=(None, True))) as complete, patch.object(vps, "track", new=AsyncMock()):
            last = await self._watch_to_completion(mock_request, regular_user, db)
        assert last["completionState"] == "complete"
        assert complete.await_args.kwargs["step_data"]["quizPassed"] is None


class TestInstructor:
    async def test_upsert_mirrors_details_and_versions(self, db, mock_request, admin_user, gate, video):
        first = await _create_quiz(mock_request, admin_user, db)
        assert first["version"] == 1 and first["answerKey"]["e2"] == ["a", "b"]
        assert video.details["endQuiz"] == {"enabled": True, "count": 2} and video.details["checkpointCount"] == 1
        second = await _create_quiz(mock_request, admin_user, db, with_checkpoint=False)
        assert second["version"] == 2 and video.details["checkpointCount"] == 0
        admin = await vq.get_video_quiz_admin(mock_request, "activity_quiz", admin_user, db)
        assert admin["translationStatus"]["e1"]["complete"] is False

    async def test_attempts_and_stats(self, db, mock_request, admin_user, regular_user, gate):
        await _create_quiz(mock_request, admin_user, db)
        await vq.answer_checkpoint(mock_request, "activity_quiz", "c1", CheckpointAnswerIn(attempt_id="cp-stats-001", selected=["b"]), regular_user, db)
        await vq.submit_end_quiz(mock_request, "activity_quiz", EndQuizSubmitIn(attempt_id="end-stats-001", answers={"e1": ["a"], "e2": ["c"]}), regular_user, db)
        listing = await vq.list_attempts(mock_request, "activity_quiz", admin_user, db)
        assert listing["total"] == 2
        only_end = await vq.list_attempts(mock_request, "activity_quiz", admin_user, db, kind="end")
        assert only_end["total"] == 1 and only_end["data"][0]["user"]["user_uuid"] == regular_user.user_uuid
        stats = await vq.quiz_stats(mock_request, "activity_quiz", admin_user, db)
        by_id = {q["questionId"]: q for q in stats["questions"]}
        assert by_id["c1"]["accuracy"] == 0.0 and by_id["e1"]["accuracy"] == 1.0 and by_id["e2"]["accuracy"] == 0.0
        assert stats["endQuiz"]["attempts"] == 1 and stats["endQuiz"]["passRate"] == 0.0

    async def test_delete_and_rights(self, db, mock_request, admin_user, regular_user, gate, video):
        await _create_quiz(mock_request, admin_user, db)
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))
        with patch.object(vq, "check_resource_access", new=denied):
            with pytest.raises(HTTPException) as exc:
                await vq.get_video_quiz_admin(mock_request, "activity_quiz", regular_user, db)
            assert exc.value.status_code == 403
        out = await vq.delete_video_quiz(mock_request, "activity_quiz", admin_user, db)
        assert out["deleted"] is True and "endQuiz" not in video.details
        empty = await vq.get_video_quiz_for_learner(mock_request, "activity_quiz", regular_user, db)
        assert empty["questions"] == [] and empty["hasEndQuiz"] is False
        assert TrailStep is not None
