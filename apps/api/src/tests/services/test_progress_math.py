"""Unit tests for the pure watch-progress policy."""

import pytest

from src.services.video_progress import progress_math as pm
from src.services.video_progress.progress_math import Heartbeat, apply_heartbeat, new_state

DURATION = 600.0


def _play_through(state, start=0.0, end=DURATION, step=10.0, rate=1.0, duration=DURATION):
    """Honest playback: heartbeats every `step` seconds, position advancing by
    step × rate. Returns the final state and total credit."""
    credit = 0.0
    # Anchor heartbeat (session start, no credit).
    res = apply_heartbeat(state, Heartbeat(position=start, rate=rate, state="playing"), elapsed=0.0, duration=duration)
    state = res.state
    pos = start
    while pos < end - 1e-9:
        pos = min(end, pos + step * rate)
        res = apply_heartbeat(state, Heartbeat(position=pos, rate=rate, state="playing"), elapsed=step, duration=duration)
        state, credit = res.state, credit + res.credited_seconds
    return state, credit


class TestBuckets:
    def test_bucket_count(self):
        assert pm.bucket_count_for(600) == 120
        assert pm.bucket_count_for(603) == 121
        assert pm.bucket_count_for(0) == 1

    def test_last_partial_bucket_is_clipped(self):
        cov = pm.mark_buckets(bytes(16), 598, 603, 603)
        assert pm.coverage_bucket_indexes(cov) == [119, 120]
        assert pm.coverage_seconds(cov, 603) == pytest.approx(5 + 3)

    def test_mark_interval_boundaries(self):
        cov = pm.mark_buckets(bytes(15), 0, 10, 600)
        assert pm.coverage_bucket_indexes(cov) == [0, 1]
        cov = pm.mark_buckets(cov, 10, 17, 600)
        assert pm.coverage_bucket_indexes(cov) == [0, 1, 2, 3]
        # Empty / reversed intervals are no-ops.
        assert pm.mark_buckets(cov, 50, 50, 600) == cov
        assert pm.mark_buckets(cov, 50, 40, 600) == cov

    def test_replay_does_not_grow_coverage(self):
        cov = pm.mark_buckets(bytes(15), 0, 60, 600)
        again = pm.mark_buckets(cov, 0, 60, 600)
        assert again == cov
        assert pm.coverage_seconds(again, 600) == 60

    def test_encode_decode_roundtrip_and_resize(self):
        cov = pm.mark_buckets(bytes(15), 100, 130, 600)
        assert pm.decode_coverage(pm.encode_coverage(cov), 120) == cov
        assert pm.decode_coverage(None, 120) == bytes(15)
        assert pm.decode_coverage("not base64!!", 120) == bytes(15)
        smaller = pm.resize_coverage(cov, 4)  # 4 buckets → 1 byte, bits 4-7 cleared
        assert len(smaller) == 1 and smaller[0] & 0xF0 == 0


class TestCompletion:
    def test_boundary_540_of_600(self):
        cov = pm.mark_buckets(bytes(15), 0, 540, 600)
        assert pm.is_complete(540, pm.coverage_seconds(cov, 600), 600)
        assert not pm.is_complete(539.9, 540, 600)
        assert not pm.is_complete(540, 500, 600)
        assert not pm.is_complete(540, 540, 0)

    def test_honest_playback_completes_at_90_percent(self):
        state, credit = _play_through(new_state(DURATION), end=540)
        assert credit == pytest.approx(540)
        assert pm.coverage_seconds(state.coverage, DURATION) == pytest.approx(540)
        assert pm.is_complete(state.verified_seconds, pm.coverage_seconds(state.coverage, DURATION), DURATION)

    def test_verified_time_without_coverage_is_not_enough(self):
        # Watch the first minute nine times: 540 s of real time, 60 s of coverage.
        state = new_state(DURATION)
        total = 0.0
        for _ in range(9):
            state, credit = _play_through(state, start=0, end=60)
            total += credit
            # Rewind (backward seek) → no credit, resume updated.
            res = apply_heartbeat(state, Heartbeat(position=0, rate=1, state="paused"), elapsed=1.0, duration=DURATION)
            state = res.state
        assert total == pytest.approx(540)
        assert pm.coverage_seconds(state.coverage, DURATION) == pytest.approx(60)
        assert not pm.is_complete(state.verified_seconds, pm.coverage_seconds(state.coverage, DURATION), DURATION)

    def test_newly_complete_fires_once(self):
        state = new_state(DURATION)
        res = apply_heartbeat(state, Heartbeat(position=0, rate=1, state="playing"), 0.0, DURATION)
        state = res.state
        seen = []
        pos = 0.0
        while pos < 560:
            pos += 10
            res = apply_heartbeat(state, Heartbeat(position=pos, rate=1, state="playing"), 10.0, DURATION)
            state = res.state
            seen.append(res.newly_complete)
        assert seen.count(True) == 1
        assert seen.index(True) == 53  # the heartbeat that reached 540 s


class TestHeartbeatPolicy:
    def _anchored(self, pos=100.0, state="playing", visible=True, rate=1.0):
        s = new_state(DURATION)
        return apply_heartbeat(s, Heartbeat(position=pos, rate=rate, state=state, visible=visible), 0.0, DURATION).state

    def test_first_heartbeat_is_an_anchor(self):
        res = apply_heartbeat(new_state(DURATION), Heartbeat(position=42, rate=1, state="playing"), 5.0, DURATION)
        assert res.reason == "anchor" and res.credited_seconds == 0
        assert res.state.resume_position == 42 and res.state.last_position == 42

    def test_forward_seek_earns_nothing(self):
        s = self._anchored(100)
        res = apply_heartbeat(s, Heartbeat(position=300, rate=1, state="playing"), 10.0, DURATION)
        assert res.reason == "seek" and res.credited_seconds == 0
        assert res.state.verified_seconds == 0
        assert res.state.furthest_verified_position == 0
        assert res.state.resume_position == 300
        assert pm.coverage_seconds(res.state.coverage, DURATION) == 0

    def test_backward_seek_earns_nothing_then_replay_counts_time_only(self):
        s, _ = _play_through(new_state(DURATION), 0, 100)
        res = apply_heartbeat(s, Heartbeat(position=20, rate=1, state="playing"), 10.0, DURATION)
        assert res.reason == "seek" and res.credited_seconds == 0
        res2 = apply_heartbeat(res.state, Heartbeat(position=30, rate=1, state="playing"), 10.0, DURATION)
        assert res2.reason == "credited" and res2.credited_seconds == pytest.approx(10)
        assert pm.coverage_seconds(res2.state.coverage, DURATION) == pytest.approx(100)  # unchanged
        assert res2.state.furthest_verified_position == 100

    def test_honest_2x_is_credited_at_2x(self):
        s = self._anchored(0, rate=2.0)
        res = apply_heartbeat(s, Heartbeat(position=20, rate=2.0, state="playing"), 10.0, DURATION)
        assert res.reason == "credited" and res.credited_seconds == pytest.approx(20)

    def test_claimed_2x_but_advanced_1x_is_clamped(self):
        s = self._anchored(0, rate=2.0)
        res = apply_heartbeat(s, Heartbeat(position=10, rate=2.0, state="playing"), 10.0, DURATION)
        assert res.reason == "rate_mismatch_clamped"
        assert res.credited_seconds == pytest.approx(10.5, abs=0.01)  # 10 s × (1 + 5 % slack)

    def test_rate_above_2x_is_capped(self):
        s = self._anchored(0, rate=3.0)
        assert s.last_rate == 2.0
        res = apply_heartbeat(s, Heartbeat(position=30, rate=3.0, state="playing"), 10.0, DURATION)
        # expected advance at the capped 2x is 20 s; 30 s is beyond tolerance → seek.
        assert res.reason == "seek"

    def test_long_gap_is_bounded_by_position(self):
        s = self._anchored(100)
        res = apply_heartbeat(s, Heartbeat(position=110, rate=1, state="playing"), 600.0, DURATION)
        assert res.reason in ("credited", "rate_mismatch_clamped")
        assert res.credited_seconds <= 10 + pm.seek_tolerance(15, 1)
        assert res.credited_seconds <= pm.MAX_CREDIT_PER_HEARTBEAT_SECONDS

    def test_stalled_client_catching_up_is_a_seek(self):
        s = self._anchored(0)
        res = apply_heartbeat(s, Heartbeat(position=600, rate=1, state="playing"), 600.0, DURATION)
        assert res.reason == "seek" and res.credited_seconds == 0

    def test_pause_closes_a_playing_interval(self):
        s = self._anchored(0)
        res = apply_heartbeat(s, Heartbeat(position=10, rate=1, state="paused"), 10.0, DURATION)
        assert res.reason == "credited" and res.credited_seconds == pytest.approx(10)
        # paused → paused: nothing.
        res2 = apply_heartbeat(res.state, Heartbeat(position=10, rate=1, state="paused"), 30.0, DURATION)
        assert res2.reason == "not_playing" and res2.credited_seconds == 0
        # paused → playing: the resume heartbeat itself is not credited…
        res3 = apply_heartbeat(res2.state, Heartbeat(position=10, rate=1, state="playing"), 1.0, DURATION)
        assert res3.reason == "not_playing"
        # …but the next interval is.
        res4 = apply_heartbeat(res3.state, Heartbeat(position=20, rate=1, state="playing"), 10.0, DURATION)
        assert res4.reason == "credited" and res4.credited_seconds == pytest.approx(10)

    def test_hidden_tab_earns_nothing(self):
        s = self._anchored(0, visible=False)
        res = apply_heartbeat(s, Heartbeat(position=10, rate=1, state="playing"), 10.0, DURATION)
        assert res.reason == "hidden" and res.credited_seconds == 0

    def test_too_short_interval(self):
        s = self._anchored(0)
        res = apply_heartbeat(s, Heartbeat(position=0.1, rate=1, state="playing"), 0.1, DURATION)
        assert res.reason == "too_short" and res.credited_seconds == 0
        assert res.state.last_position == pytest.approx(0.1)

    def test_ended_credits_to_the_end_and_marks_last_bucket(self):
        s, _ = _play_through(new_state(DURATION), 0, 592)
        res = apply_heartbeat(s, Heartbeat(position=599, rate=1, state="ended"), 8.0, DURATION)
        assert res.state.resume_position == DURATION
        assert res.credited_seconds == pytest.approx(8, abs=0.01)
        assert 119 in pm.coverage_bucket_indexes(res.state.coverage)
        assert res.state.furthest_verified_position == DURATION

    def test_position_is_clamped_to_duration(self):
        res = apply_heartbeat(new_state(DURATION), Heartbeat(position=5000, rate=1, state="playing"), 0.0, DURATION)
        assert res.state.resume_position == DURATION

    def test_zero_duration_never_completes(self):
        state, credit = _play_through(new_state(0), 0, 100, duration=0)
        assert credit > 0
        assert not pm.is_complete(state.verified_seconds, pm.coverage_seconds(state.coverage, 0), 0)
