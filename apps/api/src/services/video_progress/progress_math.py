"""Pure watch-progress policy: no I/O, no clocks, fully unit-testable.

The browser reports a heartbeat roughly every 10 seconds while a video plays
(and immediately on pause / end / tab hidden). The server measures elapsed
time with ITS OWN timestamps between two heartbeats and converts that into
verified watch credit. The policy mirrors the reference learning center:

* credit is real time: a 2x playback still earns at most elapsed × 2, and the
  claimed rate is cross-checked against how far the position actually moved;
* a position jump larger than the time that passed is a seek and earns
  nothing (forward seeks are blocked client-side anyway; this is the server
  re-check);
* coverage is tracked in 5-second buckets so replaying one section cannot
  complete a video;
* completion needs BOTH verified seconds AND unique coverage ≥ 90 % of the
  trusted duration (a 600 s video needs 540 s of each).

This is a deterrent against ordinary skipping, not DRM: a client that forges
plausible telemetry over real time cannot be told apart from a viewer.
"""

from __future__ import annotations

import base64
import math
from dataclasses import dataclass, replace
from typing import Literal

POLICY_VERSION = 2
BUCKET_SECONDS = 5
HEARTBEAT_SECONDS = 10
# Wall-clock cap per interval: 10 s cadence plus network jitter. A client
# that goes quiet for a minute and then reports is credited for 15 s at most.
MAX_ELAPSED_PER_HEARTBEAT_SECONDS = 15.0
MAX_PLAYBACK_RATE = 2.0
MAX_CREDIT_PER_HEARTBEAT_SECONDS = MAX_ELAPSED_PER_HEARTBEAT_SECONDS * MAX_PLAYBACK_RATE
# Position slack before a jump counts as a seek: fixed part + share of the
# expected advance (absorbs rate jitter and timer drift).
SEEK_TOLERANCE_SECONDS = 2.5
SEEK_TOLERANCE_RATIO = 0.05
# Below this the heartbeat is a duplicate/burst: accepted, no credit.
MIN_ELAPSED_SECONDS = 0.25
COMPLETE_RATIO = 0.9
# The client sends an immediate heartbeat when it first crosses this point.
NINETY_PERCENT_EVENT_RATIO = 0.9

PlayerState = Literal["init", "playing", "paused", "ended"]
Interval = Literal["ok", "forward_seek", "backward_seek"]
Reason = Literal[
    "credited",
    "rate_mismatch_clamped",
    "anchor",
    "not_playing",
    "too_short",
    "hidden",
    "seek",
    "stalled",
]


@dataclass(frozen=True)
class ProgressState:
    """Mirror of the persisted per-user, per-activity progress row."""

    verified_seconds: float
    furthest_verified_position: float
    resume_position: float
    coverage: bytes  # bitset, one bit per BUCKET_SECONDS bucket
    bucket_count: int
    last_position: float | None
    last_rate: float
    last_state: PlayerState
    last_visible: bool


@dataclass(frozen=True)
class Heartbeat:
    position: float
    rate: float
    state: PlayerState
    visible: bool = True


@dataclass(frozen=True)
class HeartbeatResult:
    state: ProgressState
    credited_seconds: float
    reason: Reason
    newly_complete: bool


# --------------------------------------------------------------------------
# Buckets / coverage
# --------------------------------------------------------------------------


def bucket_count_for(duration: float) -> int:
    d = max(0.0, float(duration or 0))
    return max(1, math.ceil(d / BUCKET_SECONDS))


def required_seconds(duration: float) -> float:
    return max(0.0, float(duration or 0)) * COMPLETE_RATIO


def _bit_is_set(coverage: bytes, index: int) -> bool:
    byte = index // 8
    return byte < len(coverage) and bool(coverage[byte] & (1 << (index % 8)))


def coverage_bucket_indexes(coverage: bytes) -> list[int]:
    out: list[int] = []
    for byte_index, byte in enumerate(coverage):
        if not byte:
            continue
        for bit in range(8):
            if byte & (1 << bit):
                out.append(byte_index * 8 + bit)
    return out


def coverage_seconds(coverage: bytes, duration: float) -> float:
    """Seconds of unique video covered. The last bucket is clipped to the
    video's real length so a 603 s video cannot report 605 s."""
    d = max(0.0, float(duration or 0))
    total = 0.0
    for index in coverage_bucket_indexes(coverage):
        start = index * BUCKET_SECONDS
        if start >= d:
            break
        total += min(BUCKET_SECONDS, d - start)
    return total


def mark_buckets(coverage: bytes, start: float, end: float, duration: float) -> bytes:
    """Set the buckets touched by the interval [start, end) (clamped to the
    video). Marking an already-set bucket is a no-op, which is what makes a
    replayed section worthless for coverage."""
    d = max(0.0, float(duration or 0))
    lo = min(max(0.0, start), d)
    hi = min(max(lo, end), d)
    if hi <= lo:
        return coverage
    count = bucket_count_for(d)
    first = int(lo // BUCKET_SECONDS)
    last = min(count - 1, math.ceil(hi / BUCKET_SECONDS) - 1)
    if last < first:
        return coverage
    needed = (count + 7) // 8
    buf = bytearray(coverage.ljust(needed, b"\x00")[:needed])
    for index in range(first, last + 1):
        buf[index // 8] |= 1 << (index % 8)
    return bytes(buf)


def resize_coverage(coverage: bytes, new_bucket_count: int) -> bytes:
    """Keep the bits that still exist when the trusted duration changes."""
    needed = (max(1, new_bucket_count) + 7) // 8
    buf = bytearray(coverage.ljust(needed, b"\x00")[:needed])
    extra_bits = needed * 8 - new_bucket_count
    if extra_bits > 0 and needed:
        buf[-1] &= (1 << (8 - extra_bits)) - 1
    return bytes(buf)


def encode_coverage(coverage: bytes) -> str:
    return base64.b64encode(coverage).decode("ascii")


def decode_coverage(encoded: str | None, bucket_count: int) -> bytes:
    needed = (max(1, bucket_count) + 7) // 8
    if not encoded:
        return bytes(needed)
    try:
        raw = base64.b64decode(encoded)
    except Exception:
        raw = b""
    return bytes(raw.ljust(needed, b"\x00")[:needed])


# --------------------------------------------------------------------------
# Completion
# --------------------------------------------------------------------------

_EPS = 1e-6


def is_complete(verified: float, covered: float, duration: float) -> bool:
    d = float(duration or 0)
    if d <= 0:
        return False
    need = required_seconds(d)
    return verified + _EPS >= need and covered + _EPS >= need


def new_state(duration: float) -> ProgressState:
    count = bucket_count_for(duration)
    return ProgressState(
        verified_seconds=0.0,
        furthest_verified_position=0.0,
        resume_position=0.0,
        coverage=bytes((count + 7) // 8),
        bucket_count=count,
        last_position=None,
        last_rate=1.0,
        last_state="init",
        last_visible=True,
    )


# --------------------------------------------------------------------------
# Heartbeat policy
# --------------------------------------------------------------------------


def clamp_rate(rate: float) -> float:
    try:
        r = float(rate)
    except (TypeError, ValueError):
        return 1.0
    if math.isnan(r) or r <= 0:
        return 0.0
    return min(MAX_PLAYBACK_RATE, r)


def effective_rate(claimed: float, prev_pos: float, cur_pos: float, elapsed: float) -> float:
    """The rate we credit: never more than claimed (capped at 2x) and never
    more than the rate the position actually advanced at."""
    r = clamp_rate(claimed)
    if elapsed <= 0:
        return 0.0
    observed = (cur_pos - prev_pos) / elapsed
    if observed <= 0:
        return 0.0
    return min(r, observed * (1.0 + SEEK_TOLERANCE_RATIO))


def seek_tolerance(elapsed: float, rate: float) -> float:
    return SEEK_TOLERANCE_SECONDS + SEEK_TOLERANCE_RATIO * elapsed * rate


def classify_interval(prev_pos: float, cur_pos: float, elapsed: float, rate: float) -> Interval:
    r = clamp_rate(rate)
    tol = seek_tolerance(elapsed, r)
    expected = prev_pos + elapsed * r
    if cur_pos > expected + tol:
        return "forward_seek"
    if cur_pos < prev_pos - tol:
        return "backward_seek"
    return "ok"


def apply_heartbeat(state: ProgressState, hb: Heartbeat, elapsed: float, duration: float) -> HeartbeatResult:
    """Fold one heartbeat into the progress state.

    ``elapsed`` is the server-measured time since the previous heartbeat (or
    session start). Credit is earned for the interval that just ended, so it
    depends on the PREVIOUS state being ``playing``; the heartbeat that pauses
    closes a playing interval and is credited, the one that resumes is not.
    """
    d = max(0.0, float(duration or 0))
    pos = min(max(0.0, float(hb.position or 0)), d) if d > 0 else max(0.0, float(hb.position or 0))
    if hb.state == "ended" and d > 0:
        pos = d
    rate = clamp_rate(hb.rate)
    was_complete = is_complete(state.verified_seconds, coverage_seconds(state.coverage, d), d)

    def finish(next_state: ProgressState, credit: float, reason: Reason) -> HeartbeatResult:
        now_complete = is_complete(next_state.verified_seconds, coverage_seconds(next_state.coverage, d), d)
        return HeartbeatResult(
            state=next_state,
            credited_seconds=credit,
            reason=reason,
            newly_complete=now_complete and not was_complete,
        )

    # Always: record where the learner is and what the player is doing.
    base = replace(
        state,
        resume_position=pos,
        last_position=pos,
        last_rate=rate if rate > 0 else state.last_rate,
        last_state=hb.state,
        last_visible=hb.visible,
    )

    if state.last_position is None:
        return finish(base, 0.0, "anchor")
    if state.last_state != "playing":
        return finish(base, 0.0, "not_playing")
    if elapsed < MIN_ELAPSED_SECONDS:
        return finish(base, 0.0, "too_short")
    if not state.last_visible:
        return finish(base, 0.0, "hidden")

    prev = state.last_position
    e = min(float(elapsed), MAX_ELAPSED_PER_HEARTBEAT_SECONDS)
    claimed = clamp_rate(state.last_rate)
    interval = classify_interval(prev, pos, e, claimed)
    if interval != "ok":
        return finish(base, 0.0, "seek")

    r = effective_rate(claimed, prev, pos, e)
    if r <= 0:
        return finish(base, 0.0, "stalled")

    advance = pos - prev
    credit = min(e * r, advance + seek_tolerance(e, claimed), MAX_CREDIT_PER_HEARTBEAT_SECONDS)
    credit = max(0.0, credit)
    reason: Reason = "rate_mismatch_clamped" if r < claimed - 1e-9 else "credited"

    next_state = replace(
        base,
        verified_seconds=state.verified_seconds + credit,
        coverage=mark_buckets(state.coverage, prev, pos, d),
        furthest_verified_position=max(state.furthest_verified_position, pos),
    )
    return finish(next_state, credit, reason)
