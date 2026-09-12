"""A FAILED display enumeration must never be reported as monitors disappearing.

`build_display_profile` returns `monitors: []` with `enumerationFailed: True` when
CCD could not be read. `display_signature` hashes only the monitor list, so that
placeholder is byte-identical to "every display genuinely went away". Until
2026-09-08 `_check_display_topology` had no gate: it diffed the last good profile
against `[]` and emitted one CRITICAL `display_monitor_removed` per monitor —
naming panels that were still plugged in — and the routing table sends those
immediately instead of digesting them.

It also CACHED the placeholder, so the next successful enumeration diffed against
`[]` and emitted `display_monitor_added` for every monitor: a phantom remove/add
flap on every failure.

Three of the four consumers of this flag already refused the placeholder
(firebase_client skips both uploads; the auto-restore check skips). The alerting
path was the one that did not, which is why the dashboard kept showing monitors
present while the email said they had been removed.

Method mirrors test_cortex_process_command.py: bind the real method onto a
SimpleNamespace via the descriptor protocol so the production body runs without
building a Windows service.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


GOOD_PROFILE = {
    'schemaVersion': 1,
    'monitors': [
        {'edidHash': 'aaaa1111', 'targetId': 1, 'primary': True},
        {'edidHash': 'bbbb2222', 'targetId': 2, 'primary': False},
    ],
    'signatureHash': 'good-hash',
}

FAILED_PROFILE = {
    'schemaVersion': 1,
    'monitors': [],
    'enumerationFailed': True,
    'signatureHash': 'empty-hash',
}


def _service():
    """A fake carrying only what `_check_display_topology` touches.

    Always seeded with GOOD_PROFILE as the previous state — the profile under
    test is what the stubbed enumeration returns, passed to `_run`.
    """
    svc = SimpleNamespace(
        _cached_display_hash='good-hash',
        _cached_display_profile=GOOD_PROFILE,
        firebase_client=MagicMock(),
        emitted=[],
        _drift_pending_tick_count=2,
        _drift_pending_key='some-drift-key',
    )
    svc._emit_display_change_events = lambda prev, new: svc.emitted.append((prev, new))

    # The REAL drift method, bound onto the fake: its failed-enumeration branch
    # is what resets the debounce counters, and stubbing it would let this test
    # pass while the reset silently never ran.
    import owlette_service

    svc._maybe_auto_restore_assigned_drift = (
        owlette_service.OwletteService._maybe_auto_restore_assigned_drift.__get__(
            svc, owlette_service.OwletteService
        )
    )
    return svc


def _run(svc, profile, monkeypatch):
    import owlette_service
    import display_manager

    # The enumeration itself is stubbed; this test is about what the caller does
    # with the RESULT, not about how the result is produced.
    monkeypatch.setattr(display_manager, 'build_display_profile', lambda: profile)
    monkeypatch.setattr(
        display_manager, 'is_within_apply_suppression_window', lambda: False, raising=False
    )
    monkeypatch.setattr(owlette_service.shared_utils, 'read_config', lambda *a, **k: None)

    bound = owlette_service.OwletteService._check_display_topology.__get__(
        svc, owlette_service.OwletteService
    )
    bound()


def test_failed_enumeration_emits_no_events(monkeypatch):
    svc = _service()
    _run(svc, FAILED_PROFILE, monkeypatch)

    # THE regression. Against the ungated code this list held one entry, which
    # became a CRITICAL "display_monitor_removed" email per monitor.
    assert svc.emitted == [], (
        'a failed enumeration was diffed and reported as monitors being removed'
    )


def test_failed_enumeration_does_not_poison_the_cache(monkeypatch):
    svc = _service()
    _run(svc, FAILED_PROFILE, monkeypatch)

    # Caching the placeholder is what produced the phantom ADD on recovery: the
    # next good enumeration would diff against [] and re-announce every monitor.
    assert svc._cached_display_hash == 'good-hash'
    assert svc._cached_display_profile == GOOD_PROFILE


def test_a_real_topology_change_still_emits(monkeypatch):
    """The gate must not silence genuine changes.

    NOTE this is a guard, not a negative control: it passes with the gate
    present or absent, because a successful enumeration never reaches the gate.
    The real controls are the two tests above, which both fail against the
    pre-fix code.
    """
    changed = {
        'schemaVersion': 1,
        'monitors': [{'edidHash': 'aaaa1111', 'targetId': 1, 'primary': True}],
        'signatureHash': 'changed-hash',
    }
    svc = _service()
    _run(svc, changed, monkeypatch)

    assert len(svc.emitted) == 1, 'a real monitor removal must still be reported'
    # The caller re-hashes the profile after merging Mosaic state, so the stored
    # hash is the computed signature, not whatever the fixture carried in. Assert
    # it MOVED rather than asserting a literal.
    assert svc._cached_display_hash != 'good-hash'
    assert svc._cached_display_profile is changed


def test_failed_enumeration_still_resets_the_drift_debounce(monkeypatch):
    """The gate must not skip the auto-restore counter reset.

    `_maybe_auto_restore_assigned_drift` does not merely return on a failed
    enumeration — it RESETS `_drift_pending_tick_count` and `_drift_pending_key`.
    A failed enumeration is what breaks the debounce streak. The first version of
    this gate returned before that call, which would let a streak survive across
    failures on a machine whose enumeration is flaky and fire an unattended
    `apply_topology` — a physical display re-apply — that the reset had been
    suppressing. Those are precisely the machines already in display trouble.
    """
    svc = _service()
    assert svc._drift_pending_tick_count == 2, 'fixture must start with a live streak'

    _run(svc, FAILED_PROFILE, monkeypatch)

    assert svc._drift_pending_tick_count == 0, 'failed enumeration must break the streak'
    assert svc._drift_pending_key is None
