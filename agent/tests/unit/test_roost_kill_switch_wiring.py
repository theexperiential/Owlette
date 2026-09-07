"""The roost kill switch, exercised through the REAL reader resolution.

Every existing test in test_roost_kill_switch.py injects a double that already
exposes `get_site_doc`, which takes the short-circuit at the top of
`_firestore_reader_for` and never builds the Firebase-backed reader. That is why
this shipped broken: the wrapper called `self._fc.get_document(...)`, a method
FirebaseClient does not have, swallowed the AttributeError into None, and
`check_enabled` read None as "enabled" and CACHED it for the full TTL. An agent
had therefore never once observed the kill switch, while the changelog stated it
was checked before every sync_pull.

These go through `_firestore_reader_for` with a service that exposes only
`firebase_client`, which is the shape the real dispatch hands it.
"""

import pytest

import sync_commands
from sync_commands import _firestore_reader_for


class _FakeFirebaseClient:
    """Only the surface the reader is allowed to use."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    def get_site_metadata(self):
        self.calls += 1
        return self.payload


class _Service:
    """No `get_site_doc` — so the short-circuit cannot hide the wiring."""

    def __init__(self, client):
        self.firebase_client = client


@pytest.fixture(autouse=True)
def _clear_kill_switch_cache():
    from roost_kill_switch import _cache

    _cache.clear() if hasattr(_cache, 'clear') else None
    yield
    _cache.clear() if hasattr(_cache, 'clear') else None


def test_reader_reads_roost_enabled_through_the_site_projection():
    client = _FakeFirebaseClient({'roostEnabled': False})
    reader = _firestore_reader_for(_Service(client))

    doc = reader.get_site_doc('site-a')

    # THE regression. Against the previous body this raised AttributeError
    # (FirebaseClient has no `get_document`), was swallowed, and returned None —
    # which is_enabled_from_doc reads as "enabled". A test asserting only "no
    # exception" would have passed on the broken code.
    assert client.calls == 1, 'reader never called the site projection'
    assert doc == {'roostEnabled': False}


def test_disabled_site_actually_halts_sync_pull():
    client = _FakeFirebaseClient({'roostEnabled': False})
    service = _Service(client)

    result = sync_commands._handle_sync_pull(
        {
            'site_id': 'site-a',
            'roost_id': 'roost-1',
            'version_id': 'v1',
            # Payload validation runs before the gate, so these must be present
            # or the ValueError masks what this test is actually asserting.
            'version_url': 'https://example.invalid/v1.json',
            'extract_root': 'C:\roost\test',
        },
        'cmd-1',
        service,
    )

    assert 'kill-switch engaged' in result


def test_absent_field_still_fails_open():
    # Fail-open is deliberate: a transient API blip must not pause deploys.
    client = _FakeFirebaseClient({})
    reader = _firestore_reader_for(_Service(client))
    assert reader.get_site_doc('site-a') == {}


def test_boot_window_reader_is_not_memoized():
    """A client-less service must re-resolve, or the switch pins open forever."""

    class _Bare:
        pass

    svc = _Bare()
    first = _firestore_reader_for(svc)
    assert first.get_site_doc('site-a') is None
    assert getattr(svc, '_roost_site_reader', None) is None

    svc.firebase_client = _FakeFirebaseClient({'roostEnabled': False})
    second = _firestore_reader_for(svc)
    assert second.get_site_doc('site-a') == {'roostEnabled': False}
