"""Logistics hand-off: tell the external system when a volunteer has finished
ALL required courses. Reuses the org webhook pipeline (HMAC-signed, retried,
logged); idempotent through a durable audit marker."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.certifications import Certifications, CertificateUser
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.user_audit_events import UserAuditEvent, UserAuditEventType
from src.services.audit.audit import record_audit_event
from src.services.learning_management.required_courses import get_required_courses
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)

ALL_REQUIRED_COURSES_COMPLETED = "all_required_courses_completed"


async def certificate_uuid_for(user_id: int, course_id: int, db_session: AsyncSession) -> str | None:
    row = (
        await db_session.execute(
            select(CertificateUser.user_certification_uuid)
            .join(Certifications, Certifications.id == CertificateUser.certification_id)  # type: ignore[arg-type]
            .where(Certifications.course_id == course_id, CertificateUser.user_id == user_id)
        )
    ).first()
    return row[0] if row else None


async def _already_emitted(user_id: int, org_id: int, db_session: AsyncSession) -> bool:
    row = (
        await db_session.execute(
            select(UserAuditEvent.id).where(
                UserAuditEvent.user_id == user_id,
                UserAuditEvent.org_id == org_id,
                UserAuditEvent.event_type == UserAuditEventType.ALL_REQUIRED_COURSES_COMPLETED,
            ).limit(1)
        )
    ).first()
    return row is not None


async def maybe_emit_all_required_courses_completed(user, org_id: int, db_session: AsyncSession) -> bool:
    """Emit once per learner when every required course is completed."""
    required = await get_required_courses(org_id, db_session)
    if not required:
        return False
    course_ids = [c.course.id for c in required]
    rows = (
        await db_session.execute(
            select(TrailRun.course_id).where(TrailRun.user_id == user.id, TrailRun.course_id.in_(course_ids), TrailRun.status == StatusEnum.STATUS_COMPLETED)  # type: ignore[attr-defined]
        )
    ).all()
    done = {r[0] for r in rows}
    if not set(course_ids) <= done:
        return False
    if await _already_emitted(user.id, org_id, db_session):
        return False

    completed_at = datetime.now(timezone.utc).isoformat()
    certificates = []
    courses_payload = []
    for lc in required:
        cert = await certificate_uuid_for(user.id, lc.course.id, db_session)
        if cert:
            certificates.append(cert)
        courses_payload.append({"course_uuid": lc.course.course_uuid, "name": lc.course.name, "certificate_uuid": cert})

    # The audit row is the idempotency marker; write it before dispatching.
    await record_audit_event(
        event_type=UserAuditEventType.ALL_REQUIRED_COURSES_COMPLETED,
        user_id=user.id,
        org_id=org_id,
        metadata={"courses": [c["course_uuid"] for c in courses_payload], "completed_at": completed_at},
    )
    try:
        await dispatch_webhooks(
            event_name=ALL_REQUIRED_COURSES_COMPLETED,
            org_id=org_id,
            data={
                "user": {"user_uuid": user.user_uuid, "email": user.email, "username": user.username},
                "courses": courses_payload,
                "certificates": certificates,
                "completed_at": completed_at,
            },
        )
    except Exception:  # pragma: no cover
        logger.exception("all_required_courses_completed dispatch failed for user %s", user.id)
    return True
