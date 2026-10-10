"""Server-verified video watch progress.

``videoprogress`` is the hot row: one per (user, activity), updated by every
heartbeat (≈ every 10 s while a video plays). ``watchsession`` is the anchor a
browser must open before it can report heartbeats; one active session per
(user, activity) stops two tabs from earning credit twice.

Both are server-written only. Clients never update them directly: the
heartbeat endpoint derives credit from server timestamps (see
``services.video_progress.progress_math``).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class VideoProgressCompletionState:
    IN_PROGRESS = "in_progress"
    VIDEO_COMPLETE_QUIZ_PENDING = "video_complete_quiz_pending"
    COMPLETE = "complete"


class VideoProgress(SQLModel, table=True):
    __tablename__ = "videoprogress"
    __table_args__ = (
        UniqueConstraint("user_id", "activity_id", name="uq_videoprogress_user_activity"),
        Index("ix_videoprogress_course_user", "course_id", "user_id"),
        Index("ix_videoprogress_activity_state", "activity_id", "completion_state"),
        Index("ix_videoprogress_org_updated", "org_id", "updated_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    course_id: int = Field(sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False))
    activity_id: int = Field(sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False))
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False))

    policy_version: int = Field(default=2)
    # Trusted length snapshot taken when the session started; None means the
    # admin has not verified a length yet, so completion can never be judged.
    duration_seconds: Optional[float] = Field(default=None)

    verified_seconds: float = Field(default=0.0)
    furthest_verified_position: float = Field(default=0.0)
    resume_position: float = Field(default=0.0)
    # base64 bitset, one bit per 5-second bucket (portable across Postgres/SQLite).
    coverage_bitmap: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    covered_bucket_count: int = Field(default=0)
    bucket_count: int = Field(default=0)

    last_position: Optional[float] = Field(default=None)
    last_rate: float = Field(default=1.0)
    last_state: str = Field(default="init", max_length=16)
    last_visible: bool = Field(default=True)
    last_heartbeat_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))

    active_session_uuid: Optional[str] = Field(default=None, max_length=64)
    last_seq: int = Field(default=0)
    heartbeat_count: int = Field(default=0)
    rejected_seek_count: int = Field(default=0)
    # Diagnostics only — never used for completion.
    client_reported_duration: Optional[float] = Field(default=None)

    video_completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    completion_state: str = Field(default=VideoProgressCompletionState.IN_PROGRESS, max_length=32)

    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))


class WatchSessionStatus:
    ACTIVE = "active"
    SUPERSEDED = "superseded"
    CLOSED = "closed"
    EXPIRED = "expired"


class WatchSession(SQLModel, table=True):
    __tablename__ = "watchsession"
    __table_args__ = (
        Index("ix_watchsession_user_activity_status", "user_id", "activity_id", "status"),
        Index("ix_watchsession_started", "started_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    session_uuid: str = Field(index=True, unique=True, max_length=64)
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    course_id: int = Field(sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False))
    activity_id: int = Field(sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False))
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False))

    status: str = Field(default=WatchSessionStatus.ACTIVE, max_length=16)
    started_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    last_heartbeat_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    ended_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    start_position: float = Field(default=0.0)
    heartbeats: int = Field(default=0)
    credited_seconds: float = Field(default=0.0)
    # youtube | hosted | vimeo — last provider the client reported (failover diagnostics).
    source_provider: Optional[str] = Field(default=None, max_length=16)
    user_agent_hash: Optional[str] = Field(default=None, max_length=64)
