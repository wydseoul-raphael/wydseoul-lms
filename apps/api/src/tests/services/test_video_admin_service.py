"""Tests for src/services/courses/activities/video_admin.py and the v2 content helpers."""

import io
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.courses.activities import video_admin as va
from src.services.courses.activities.video import CaptionsConfigIn, CaptionLanguageIn, configure_captions
from src.services.video_progress.video_content import (
    VideoPlaybackConfigIn,
    extract_vimeo,
    extract_youtube_id,
    normalize_video_content,
    resolve_trusted_duration,
)


@pytest.fixture
async def yt_video(db, org, course):
    a = Activity(
        id=50, name="YT", activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"uri": "https://youtu.be/42M5kFJU804", "type": "youtube", "activity_uuid": "activity_yt"},
        details={"startTime": 0}, published=True, org_id=org.id, course_id=course.id,
        activity_uuid="activity_yt", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


@pytest.fixture
async def hosted_video(db, org, course):
    a = Activity(
        id=51, name="Hosted", activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": "video_abc.mp4", "activity_uuid": "activity_hosted"},
        details={}, extra_metadata={"hls": {"status": "ready", "duration": 612.4}},
        published=True, org_id=org.id, course_id=course.id,
        activity_uuid="activity_hosted", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


class TestPureHelpers:
    def test_extract_ids(self):
        assert extract_youtube_id("https://www.youtube.com/watch?v=42M5kFJU804&t=3") == "42M5kFJU804"
        assert extract_youtube_id("https://youtu.be/42M5kFJU804") == "42M5kFJU804"
        assert extract_youtube_id("https://www.youtube.com/shorts/42M5kFJU804") == "42M5kFJU804"
        assert extract_youtube_id("42M5kFJU804") == "42M5kFJU804"
        assert extract_youtube_id("not a video") == ""
        assert extract_vimeo("https://vimeo.com/123456789") == ("123456789", None)
        assert extract_vimeo("https://vimeo.com/123456789/abcdef12") == ("123456789", "abcdef12")
        assert extract_vimeo("https://player.vimeo.com/video/123456789?h=abcdef12") == ("123456789", "abcdef12")
        assert extract_vimeo("nope") == ("", None)

    def test_normalize_legacy_youtube_and_hosted(self):
        n = normalize_video_content({"uri": "https://youtu.be/42M5kFJU804", "type": "youtube"})
        assert n["schemaVersion"] == 2
        assert n["sources"] == [{"provider": "youtube", "videoId": "42M5kFJU804"}]
        assert n["signVideo"] is None
        h = normalize_video_content({"filename": "video_x.mp4"}, "SUBTYPE_VIDEO_HOSTED")
        assert h["sources"] == [{"provider": "hosted", "filename": "video_x.mp4"}]
        v = normalize_video_content({"uri": "https://vimeo.com/123456789/abcdef12", "type": "vimeo"})
        assert v["sources"] == [{"provider": "vimeo", "videoId": "123456789", "hash": "abcdef12"}]
        # v2 input passes through and legacy mirrors are filled in.
        again = normalize_video_content({"sources": [{"provider": "youtube", "videoId": "42M5kFJU804"}]})
        assert again["uri"].endswith("42M5kFJU804") and again["type"] == "youtube"

    def test_trusted_duration_order(self):
        a = type("A", (), {"details": {"durationSeconds": 600}, "extra_metadata": {"hls": {"duration": 500}}})()
        assert resolve_trusted_duration(a) == (600, "admin")
        b = type("A", (), {"details": {}, "extra_metadata": {"hls": {"duration": 500}}})()
        assert resolve_trusted_duration(b) == (500, "probe:hls")
        c = type("A", (), {"details": {"durationSeconds": "bad"}, "extra_metadata": None})()
        assert resolve_trusted_duration(c) == (None, None)

    def test_srt_to_vtt(self):
        srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\nHello\r\n\r\n2\r\n00:00:04,2 --> 00:00:05,000\r\nWorld\r\n"
        vtt = va.srt_to_vtt(srt)
        assert vtt.startswith("WEBVTT\n\n")
        assert "00:00:01.000 --> 00:00:03.500" in vtt
        assert "00:00:04.200 --> 00:00:05.000" in vtt
        assert va.srt_to_vtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n").startswith("WEBVTT")
        with pytest.raises(HTTPException):
            va.validate_vtt("not captions")
        with pytest.raises(HTTPException):
            va.validate_vtt("WEBVTT\n\nno cues here")

    def test_merge_manual_languages(self):
        existing = [{"code": "ko", "source": "manual", "status": "ready"}, {"code": "en", "status": "ready"}]
        regenerated = [{"code": "ko", "status": "queued"}, {"code": "fr", "status": "queued"}]
        merged = va.merge_manual_languages(existing, regenerated)
        assert merged == [{"code": "ko", "source": "manual", "status": "ready"}, {"code": "fr", "status": "queued"}]

    def test_playback_config_validation(self):
        with pytest.raises(ValueError):
            VideoPlaybackConfigIn(sources=[{"provider": "youtube", "videoId": "short"}])
        with pytest.raises(ValueError):
            VideoPlaybackConfigIn(sources=[{"provider": "hosted", "filename": "../x.mp4"}])
        with pytest.raises(ValueError):
            VideoPlaybackConfigIn(durationSeconds=0)
        ok = VideoPlaybackConfigIn(sources=[{"provider": "vimeo", "videoId": "123456789", "hash": "abcdef12"}], durationSeconds=300, verifiedWatch=True)
        assert ok.sources[0].provider == "vimeo"


class TestPlaybackConfig:
    async def test_update_sources_duration_and_switch(self, db, mock_request, admin_user, yt_video):
        cfg = VideoPlaybackConfigIn(
            sources=[{"provider": "youtube", "videoId": "42M5kFJU804"}, {"provider": "vimeo", "videoId": "123456789"}],
            signVideo={"provider": "youtube", "videoId": "https://youtu.be/AAAAAAAAAAA"},
            durationSeconds=600, durationSource="probe:youtube", verifiedWatch=True, captionsDefault="ko",
        )
        with patch.object(va, "check_resource_access", new=AsyncMock()):
            out = await va.update_playback_config(mock_request, "activity_yt", admin_user, db, cfg)
        assert [s["provider"] for s in out["content"]["sources"]] == ["youtube", "vimeo"]
        assert out["content"]["signVideo"] == {"provider": "youtube", "videoId": "AAAAAAAAAAA"}
        assert out["details"]["durationSeconds"] == 600 and out["details"]["durationSource"] == "probe:youtube"
        assert out["details"]["verifiedWatch"] is True and out["details"]["captions"]["default"] == "ko"
        assert out["details"]["startTime"] == 0  # untouched
        assert resolve_trusted_duration(yt_video) == (600, "probe:youtube")

    async def test_hosted_source_must_match_own_file(self, db, mock_request, admin_user, hosted_video):
        cfg = VideoPlaybackConfigIn(sources=[{"provider": "hosted", "filename": "other.mp4"}])
        with patch.object(va, "check_resource_access", new=AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await va.update_playback_config(mock_request, "activity_hosted", admin_user, db, cfg)
        assert exc.value.status_code == 400

    async def test_requires_update_rights(self, db, mock_request, regular_user, yt_video):
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))
        with patch.object(va, "check_resource_access", new=denied):
            with pytest.raises(HTTPException) as exc:
                await va.update_playback_config(mock_request, "activity_yt", regular_user, db, VideoPlaybackConfigIn(verifiedWatch=True))
        assert exc.value.status_code == 403

    async def test_non_video_rejected(self, db, mock_request, admin_user, activity):
        with patch.object(va, "check_resource_access", new=AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await va.update_playback_config(mock_request, activity.activity_uuid, admin_user, db, VideoPlaybackConfigIn())
        assert exc.value.status_code == 400


class TestManualCaptions:
    def _upload(self, text: str, name="ko.srt"):
        return UploadFile(filename=name, file=io.BytesIO(text.encode("utf-8")))

    async def test_upload_converts_and_records(self, db, mock_request, admin_user, hosted_video):
        srt = "1\n00:00:01,000 --> 00:00:03,000\n안녕하세요\n"
        with patch.object(va, "check_resource_access", new=AsyncMock()), patch.object(va, "upload_content", new=AsyncMock()) as up:
            captions = await va.upload_manual_caption(mock_request, "activity_hosted", "ko", "한국어", self._upload(srt), admin_user, db)
        kwargs = up.await_args.kwargs
        assert kwargs["file_and_format"] == "ko.vtt" and kwargs["directory"].endswith("/video/captions")
        assert kwargs["file_binary"].decode("utf-8").startswith("WEBVTT")
        assert captions["enabled"] is True
        assert captions["languages"] == [pytest.approx({"code": "ko", "label": "한국어", "status": "ready", "source": "manual", "updated_at": captions["languages"][0]["updated_at"]})]
        assert hosted_video.extra_metadata["hls"]["duration"] == 612.4  # untouched

    async def test_invalid_language_and_file(self, db, mock_request, admin_user, hosted_video):
        with patch.object(va, "check_resource_access", new=AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await va.upload_manual_caption(mock_request, "activity_hosted", "k", None, self._upload("x"), admin_user, db)
            assert exc.value.status_code == 400
            with pytest.raises(HTTPException) as exc:
                await va.upload_manual_caption(mock_request, "activity_hosted", "ko", None, self._upload("garbage"), admin_user, db)
            assert exc.value.status_code == 400

    async def test_ai_reconfigure_keeps_manual_tracks(self, db, mock_request, admin_user, hosted_video):
        with patch.object(va, "check_resource_access", new=AsyncMock()), patch.object(va, "upload_content", new=AsyncMock()):
            await va.upload_manual_caption(mock_request, "activity_hosted", "ko", "한국어", self._upload("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n", "ko.vtt"), admin_user, db)
        with patch("src.services.courses.activities.video.check_resource_access", new=AsyncMock()), patch(
            "src.security.features_utils.usage.check_feature_enabled", new=AsyncMock()
        ), patch("src.security.features_utils.usage.get_ai_credits_summary", new=AsyncMock(return_value={"remaining_credits": -1})), patch(
            "src.services.utils.caption_jobs.enqueue"
        ):
            captions = await configure_captions(mock_request, "activity_hosted", admin_user, db, CaptionsConfigIn(enabled=True, languages=[CaptionLanguageIn(code="ko"), CaptionLanguageIn(code="fr")]))
        codes = [(l["code"], l.get("source")) for l in captions["languages"]]
        assert codes == [("ko", "manual"), ("fr", None)]

    async def test_delete_manual(self, db, mock_request, admin_user, hosted_video):
        with patch.object(va, "check_resource_access", new=AsyncMock()), patch.object(va, "upload_content", new=AsyncMock()):
            await va.upload_manual_caption(mock_request, "activity_hosted", "ko", None, self._upload("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n", "ko.vtt"), admin_user, db)
            out = await va.delete_manual_caption(mock_request, "activity_hosted", "ko", admin_user, db)
            assert out["languages"] == [] and out["enabled"] is False
            with pytest.raises(HTTPException) as exc:
                await va.delete_manual_caption(mock_request, "activity_hosted", "ko", admin_user, db)
            assert exc.value.status_code == 404


class TestProbe:
    async def test_youtube_and_invalid(self):
        assert await va.probe_video_url("https://youtu.be/42M5kFJU804") == {"provider": "youtube", "videoId": "42M5kFJU804", "durationSeconds": None}
        with pytest.raises(HTTPException):
            await va.probe_video_url("https://example.com/video")

    async def test_vimeo_oembed(self):
        class Resp:
            status_code = 200

            def json(self):
                return {"title": "Intro", "duration": 613}

        class Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url, params=None):
                assert params["url"] == "https://vimeo.com/123456789/abcdef12"
                return Resp()

        with patch.object(va.httpx, "AsyncClient", Client):
            out = await va.probe_video_url("https://vimeo.com/123456789/abcdef12")
        assert out == {"provider": "vimeo", "videoId": "123456789", "hash": "abcdef12", "title": "Intro", "durationSeconds": 613.0}
