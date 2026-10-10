"""Video quizzes: in-video checkpoints and the end-of-video quiz.

One ``video_quiz`` row per video activity. The question document is PUBLIC
(what learners receive) and the answer key is PRIVATE (a separate column the
learner API never projects), mirroring the reference ``quizzes`` /
``quizKeys`` split. Every answer is recorded in ``video_quiz_attempt`` so
per-question accuracy can be analysed and submissions are idempotent.

Question/option texts are maps keyed by the six official UI languages and are
translated by volunteers (never by AI).
"""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field as PField, field_validator
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

SUPPORTED_QUIZ_LANGS = ("en", "ko", "it", "fr", "es", "pt")
QuestionKind = Literal["checkpoint", "end"]
QuestionType = Literal["single", "multiple", "true_false"]


class VideoQuiz(SQLModel, table=True):
    __tablename__ = "video_quiz"
    __table_args__ = (
        UniqueConstraint("activity_id", name="uq_video_quiz_activity"),
        Index("ix_video_quiz_org_course", "org_id", "course_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    video_quiz_uuid: str = Field(index=True, max_length=64)
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    course_id: int = Field(sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False))
    activity_id: int = Field(sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False))
    # Public document: never contains correctness.
    questions: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    # Private: {question_id: [option_id, ...]}
    answer_key: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    settings: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    version: int = Field(default=1)
    creation_date: str = Field(default="")
    update_date: str = Field(default="")


class VideoQuizAttempt(SQLModel, table=True):
    __tablename__ = "video_quiz_attempt"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_vq_attempt_user_idem"),
        Index("ix_vq_attempt_activity_user", "activity_id", "user_id"),
        Index("ix_vq_attempt_activity_kind", "activity_id", "kind", "submitted_at"),
        Index("ix_vq_attempt_course_kind", "course_id", "kind"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    attempt_uuid: str = Field(index=True, max_length=64)
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    course_id: int = Field(sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False))
    activity_id: int = Field(sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False))
    video_quiz_id: int = Field(sa_column=Column(Integer, ForeignKey("video_quiz.id", ondelete="CASCADE"), nullable=False))
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False))
    kind: str = Field(max_length=16)  # checkpoint | end
    question_id: Optional[str] = Field(default=None, max_length=64)
    quiz_version: int = Field(default=1)
    idempotency_key: str = Field(max_length=128)
    answers: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    results: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    score: float = Field(default=0.0)
    passed: bool = Field(default=False)
    submitted_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))


# --------------------------------------------------------------------------
# Pydantic payloads
# --------------------------------------------------------------------------

LocalizedText = dict[str, str]


def _validate_localized(value: dict | None, *, required: bool = True) -> dict:
    if value is None:
        if required:
            raise ValueError("text is required")
        return {}
    if not isinstance(value, dict):
        raise ValueError("text must be a language map")
    out: dict[str, str] = {}
    for lang, text in value.items():
        if lang not in SUPPORTED_QUIZ_LANGS:
            raise ValueError(f"unsupported language {lang!r}")
        if text is None:
            continue
        s = str(text).strip()
        if s:
            out[lang] = s[:2000]
    if required and not out:
        raise ValueError("text needs at least one language")
    return out


class VideoQuizOptionIn(BaseModel):
    id: str = PField(min_length=1, max_length=64)
    text: LocalizedText
    correct: bool = False

    @field_validator("text")
    @classmethod
    def _text(cls, v):
        return _validate_localized(v)


class VideoQuizQuestionIn(BaseModel):
    id: str = PField(min_length=1, max_length=64)
    kind: QuestionKind = "end"
    timestamp: Optional[float] = PField(default=None, ge=0)
    type: QuestionType = "single"
    prompt: LocalizedText
    options: list[VideoQuizOptionIn] = PField(default_factory=list, max_length=12)
    # Checkpoint only: must the learner answer correctly before continuing?
    required_correct: bool = False
    explanation: Optional[LocalizedText] = None

    @field_validator("prompt")
    @classmethod
    def _prompt(cls, v):
        return _validate_localized(v)

    @field_validator("explanation")
    @classmethod
    def _explanation(cls, v):
        return _validate_localized(v, required=False) if v is not None else None


class VideoQuizSettings(BaseModel):
    end_quiz_required: bool = True
    pass_score: int = PField(default=100, ge=1, le=100)
    max_attempts: int = PField(default=0, ge=0, le=100)  # 0 = unlimited
    show_wrong_questions: bool = False
    shuffle_options: bool = False


class VideoQuizUpsert(BaseModel):
    questions: list[VideoQuizQuestionIn] = PField(default_factory=list, max_length=100)
    settings: VideoQuizSettings = PField(default_factory=VideoQuizSettings)


class CheckpointAnswerIn(BaseModel):
    attempt_id: str = PField(min_length=8, max_length=128)
    selected: list[str] = PField(default_factory=list, max_length=12)


class EndQuizSubmitIn(BaseModel):
    attempt_id: str = PField(min_length=8, max_length=128)
    answers: dict[str, list[str]] = PField(default_factory=dict)
