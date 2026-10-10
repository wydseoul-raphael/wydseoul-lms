"""Router tests for src/routers/video_progress.py (wiring + error propagation)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.video_progress import router as vp_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(vp_router, prefix="/api/v1/video-progress")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


SNAPSHOT = {"sessionId": "ws_1", "verifiedWatchSeconds": 0, "isComplete": False}


class TestVideoProgressRouter:
    async def test_start_session(self, client):
        with patch("src.routers.video_progress.start_watch_session", new_callable=AsyncMock, return_value=SNAPSHOT) as m:
            r = await client.post("/api/v1/video-progress/sessions/activity_x", json={"sourceProvider": "youtube"})
        assert r.status_code == 200 and r.json()["sessionId"] == "ws_1"
        assert m.await_args.args[2] == "activity_x"
        assert m.await_args.args[3].sourceProvider == "youtube"

    async def test_start_session_without_body(self, client):
        with patch("src.routers.video_progress.start_watch_session", new_callable=AsyncMock, return_value=SNAPSHOT):
            r = await client.post("/api/v1/video-progress/sessions/activity_x")
        assert r.status_code == 200

    async def test_heartbeat_validation_and_conflict(self, client):
        # Missing fields → 422 before the service is reached.
        r = await client.post("/api/v1/video-progress/heartbeat", json={"sessionId": "ws_1"})
        assert r.status_code == 422
        bad_state = {"sessionId": "ws_1", "activityUuid": "a", "seq": 1, "currentTime": 1, "playerState": "seeking"}
        r = await client.post("/api/v1/video-progress/heartbeat", json=bad_state)
        assert r.status_code == 422
        superseded = AsyncMock(side_effect=HTTPException(status_code=409, detail={"code": "SESSION_SUPERSEDED"}))
        with patch("src.routers.video_progress.record_heartbeat", new=superseded):
            r = await client.post(
                "/api/v1/video-progress/heartbeat",
                json={"sessionId": "ws_1", "activityUuid": "a", "seq": 1, "currentTime": 1, "playerState": "playing"},
            )
        assert r.status_code == 409 and r.json()["detail"]["code"] == "SESSION_SUPERSEDED"

    async def test_heartbeat_ok(self, client):
        with patch("src.routers.video_progress.record_heartbeat", new_callable=AsyncMock, return_value={**SNAPSHOT, "accepted": True}) as m:
            r = await client.post(
                "/api/v1/video-progress/heartbeat",
                json={"sessionId": "ws_1", "activityUuid": "a", "seq": 7, "currentTime": 12.5, "playbackRate": 1.5, "playerState": "paused", "visible": False},
            )
        assert r.status_code == 200 and r.json()["accepted"] is True
        body = m.await_args.args[2]
        assert body.seq == 7 and body.playbackRate == 1.5 and body.playerState == "paused" and body.visible is False

    async def test_close_and_reads(self, client):
        with patch("src.routers.video_progress.close_watch_session", new_callable=AsyncMock, return_value={"closed": True}):
            r = await client.post("/api/v1/video-progress/sessions/ws_1/close", json={"currentTime": 3})
        assert r.status_code == 200 and r.json()["closed"] is True
        with patch("src.routers.video_progress.get_activity_progress", new_callable=AsyncMock, return_value=SNAPSHOT):
            r = await client.get("/api/v1/video-progress/activity/activity_x")
        assert r.status_code == 200
        with patch("src.routers.video_progress.get_course_progress_summary", new_callable=AsyncMock, return_value={"activities": []}):
            r = await client.get("/api/v1/video-progress/course/course_x")
        assert r.status_code == 200
        with patch("src.routers.video_progress.get_course_progress_admin", new_callable=AsyncMock, return_value={"data": [], "total": 0}) as m:
            r = await client.get("/api/v1/video-progress/course/course_x/admin?page=2&limit=10&user_uuid=user_a")
        assert r.status_code == 200
        assert m.await_args.kwargs == {"user_uuid": "user_a", "page": 2, "limit": 10}
        r = await client.get("/api/v1/video-progress/course/course_x/admin?limit=999")
        assert r.status_code == 422
