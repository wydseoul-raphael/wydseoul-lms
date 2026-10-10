"""Add videoprogress and watchsession tables (server-verified video watch engine)

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-10-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if 'videoprogress' not in existing:
        op.create_table(
            'videoprogress',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('policy_version', sa.Integer(), nullable=False, server_default='2'),
            sa.Column('duration_seconds', sa.Float(), nullable=True),
            sa.Column('verified_seconds', sa.Float(), nullable=False, server_default='0'),
            sa.Column('furthest_verified_position', sa.Float(), nullable=False, server_default='0'),
            sa.Column('resume_position', sa.Float(), nullable=False, server_default='0'),
            sa.Column('coverage_bitmap', sa.Text(), nullable=False, server_default=''),
            sa.Column('covered_bucket_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('bucket_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_position', sa.Float(), nullable=True),
            sa.Column('last_rate', sa.Float(), nullable=False, server_default='1'),
            sa.Column('last_state', sa.String(length=16), nullable=False, server_default='init'),
            sa.Column('last_visible', sa.Boolean(), nullable=False, server_default=sa.text('true')),
            sa.Column('last_heartbeat_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('active_session_uuid', sa.String(length=64), nullable=True),
            sa.Column('last_seq', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('heartbeat_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('rejected_seek_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('client_reported_duration', sa.Float(), nullable=True),
            sa.Column('video_completed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('completion_state', sa.String(length=32), nullable=False, server_default='in_progress'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint('user_id', 'activity_id', name='uq_videoprogress_user_activity'),
        )
        op.create_index('ix_videoprogress_course_user', 'videoprogress', ['course_id', 'user_id'])
        op.create_index('ix_videoprogress_activity_state', 'videoprogress', ['activity_id', 'completion_state'])
        op.create_index('ix_videoprogress_org_updated', 'videoprogress', ['org_id', 'updated_at'])

    if 'watchsession' not in existing:
        op.create_table(
            'watchsession',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('session_uuid', sa.String(length=64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
            sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('last_heartbeat_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('start_position', sa.Float(), nullable=False, server_default='0'),
            sa.Column('heartbeats', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('credited_seconds', sa.Float(), nullable=False, server_default='0'),
            sa.Column('source_provider', sa.String(length=16), nullable=True),
            sa.Column('user_agent_hash', sa.String(length=64), nullable=True),
        )
        op.create_index('ix_watchsession_session_uuid', 'watchsession', ['session_uuid'], unique=True)
        op.create_index('ix_watchsession_user_activity_status', 'watchsession', ['user_id', 'activity_id', 'status'])
        op.create_index('ix_watchsession_started', 'watchsession', ['started_at'])


def downgrade() -> None:
    op.drop_index('ix_watchsession_started', table_name='watchsession')
    op.drop_index('ix_watchsession_user_activity_status', table_name='watchsession')
    op.drop_index('ix_watchsession_session_uuid', table_name='watchsession')
    op.drop_table('watchsession')
    op.drop_index('ix_videoprogress_org_updated', table_name='videoprogress')
    op.drop_index('ix_videoprogress_activity_state', table_name='videoprogress')
    op.drop_index('ix_videoprogress_course_user', table_name='videoprogress')
    op.drop_table('videoprogress')
