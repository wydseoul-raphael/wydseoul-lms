"""Add video_quiz and video_quiz_attempt tables (checkpoint + end quizzes)

Revision ID: d3e4f5a6b7c9
Revises: c2d3e4f5a6b7
Create Date: 2026-10-10 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c9'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if 'video_quiz' not in existing:
        op.create_table(
            'video_quiz',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('video_quiz_uuid', sa.String(length=64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('questions', sa.JSON(), nullable=False),
            sa.Column('answer_key', sa.JSON(), nullable=False),
            sa.Column('settings', sa.JSON(), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('activity_id', name='uq_video_quiz_activity'),
        )
        op.create_index('ix_video_quiz_video_quiz_uuid', 'video_quiz', ['video_quiz_uuid'])
        op.create_index('ix_video_quiz_org_course', 'video_quiz', ['org_id', 'course_id'])

    if 'video_quiz_attempt' not in existing:
        op.create_table(
            'video_quiz_attempt',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('attempt_uuid', sa.String(length=64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('video_quiz_id', sa.Integer(), sa.ForeignKey('video_quiz.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', sa.String(length=16), nullable=False),
            sa.Column('question_id', sa.String(length=64), nullable=True),
            sa.Column('quiz_version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('idempotency_key', sa.String(length=128), nullable=False),
            sa.Column('answers', sa.JSON(), nullable=False),
            sa.Column('results', sa.JSON(), nullable=False),
            sa.Column('score', sa.Float(), nullable=False, server_default='0'),
            sa.Column('passed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
            sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_vq_attempt_user_idem'),
        )
        op.create_index('ix_video_quiz_attempt_attempt_uuid', 'video_quiz_attempt', ['attempt_uuid'])
        op.create_index('ix_vq_attempt_activity_user', 'video_quiz_attempt', ['activity_id', 'user_id'])
        op.create_index('ix_vq_attempt_activity_kind', 'video_quiz_attempt', ['activity_id', 'kind', 'submitted_at'])
        op.create_index('ix_vq_attempt_course_kind', 'video_quiz_attempt', ['course_id', 'kind'])


def downgrade() -> None:
    for name in ('ix_vq_attempt_course_kind', 'ix_vq_attempt_activity_kind', 'ix_vq_attempt_activity_user', 'ix_video_quiz_attempt_attempt_uuid'):
        op.drop_index(name, table_name='video_quiz_attempt')
    op.drop_table('video_quiz_attempt')
    op.drop_index('ix_video_quiz_org_course', table_name='video_quiz')
    op.drop_index('ix_video_quiz_video_quiz_uuid', table_name='video_quiz')
    op.drop_table('video_quiz')
