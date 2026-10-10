"""Router tests for src/routers/video_quiz.py (wiring + validation)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.video_quiz import router as vq_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(vq_router, prefix="/api/v1/video-quiz")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestVideoQuizRouter:
    async def test_learner_routes(self, client):
        with patch("src.routers.video_quiz.get_video_quiz_for_learner", new_callable=AsyncMock, return_value={"questions": []}):
            r = await client.get("/api/v1/video-quiz/activity_x")
        assert r.status_code == 200
        with patch("src.routers.video_quiz.answer_checkpoint", new_callable=AsyncMock, return_value={"correct": True}) as m:
            r = await client.post("/api/v1/video-quiz/activity_x/checkpoint/c1/answer", json={"attempt_id": "attempt-0001", "selected": ["a"]})
        assert r.status_code == 200 and m.await_args.args[2] == "c1"
        r = await client.post("/api/v1/video-quiz/activity_x/checkpoint/c1/answer", json={"attempt_id": "x", "selected": ["a"]})
        assert r.status_code == 422  # attempt_id too short
        with patch("src.routers.video_quiz.submit_end_quiz", new_callable=AsyncMock, return_value={"passed": True}) as m:
            r = await client.post("/api/v1/video-quiz/activity_x/submit", json={"attempt_id": "submit-0001", "answers": {"e1": ["a"]}})
        assert r.status_code == 200 and m.await_args.args[2].answers == {"e1": ["a"]}

    async def test_instructor_routes(self, client):
        body = {
            "questions": [{"id": "e1", "kind": "end", "type": "single", "prompt": {"en": "Q"}, "options": [{"id": "a", "text": {"en": "A"}, "correct": True}, {"id": "b", "text": {"en": "B"}}]}],
            "settings": {"pass_score": 100},
        }
        with patch("src.routers.video_quiz.upsert_video_quiz", new_callable=AsyncMock, return_value={"version": 1}) as m:
            r = await client.put("/api/v1/video-quiz/activity_x", json=body)
        assert r.status_code == 200 and m.await_args.args[2].questions[0].options[0].correct is True
        bad = {"questions": [{"id": "e1", "prompt": {"xx": "nope"}, "options": []}]}
        r = await client.put("/api/v1/video-quiz/activity_x", json=bad)
        assert r.status_code == 422
        with patch("src.routers.video_quiz.get_video_quiz_admin", new_callable=AsyncMock, return_value={"answerKey": {}}):
            assert (await client.get("/api/v1/video-quiz/activity_x/admin")).status_code == 200
        with patch("src.routers.video_quiz.delete_video_quiz", new_callable=AsyncMock, return_value={"deleted": True}):
            assert (await client.delete("/api/v1/video-quiz/activity_x")).status_code == 200
        with patch("src.routers.video_quiz.list_attempts", new_callable=AsyncMock, return_value={"data": [], "total": 0}) as m:
            r = await client.get("/api/v1/video-quiz/activity_x/attempts?kind=end&page=2&page_size=10")
        assert r.status_code == 200 and m.await_args.kwargs == {"user_uuid": None, "kind": "end", "page": 2, "page_size": 10}
        with patch("src.routers.video_quiz.quiz_stats", new_callable=AsyncMock, return_value={"questions": []}):
            assert (await client.get("/api/v1/video-quiz/activity_x/stats")).status_code == 200
