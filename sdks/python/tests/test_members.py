"""Tests for ``roost.members`` (wave 3B)."""

from __future__ import annotations

import json

import httpx
import pytest

from roost import Roost


def _transport(handler: "callable[[httpx.Request], httpx.Response]") -> httpx.MockTransport:
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_factory_binds_site_id() -> None:
    async with Roost(
        token="owk_live_x",
        transport=_transport(lambda _r: httpx.Response(200, json={"members": []})),
    ) as client:
        h = client.members("s1")
        assert h.site_id == "s1"


@pytest.mark.asyncio
async def test_list_parses_members_and_normalises_role() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "members": [
                    {"uid": "u1", "email": "owner@x", "role": "owner", "displayName": "Owner"},
                    {"uid": "u2", "email": "a@x", "role": "admin"},
                    # Unrecognised roles fall back to 'member'.
                    {"uid": "u3", "email": "x@x", "role": "guest"},
                ]
            },
        )

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        rows = await client.members("s1").list()

    assert captured[0].url.path == "/api/sites/s1/members"
    assert [m.role for m in rows] == ["owner", "admin", "member"]


@pytest.mark.asyncio
async def test_add_emits_post_with_body_and_idempotency_key() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"uid": "u9", "role": "admin"})

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        await client.members("s1").add("u9", role="admin")

    req = captured[0]
    assert req.method == "POST"
    assert req.url.path == "/api/sites/s1/members"
    assert json.loads(req.content) == {"uid": "u9", "role": "admin"}
    assert req.headers["Idempotency-Key"].startswith("py-sdk-")


@pytest.mark.asyncio
async def test_remove_uses_delete_with_explicit_idempotency_key() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"uid": "u9", "alreadyRemoved": False})

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        await client.members("s1").remove("u9")

    req = captured[0]
    assert req.method == "DELETE"
    assert req.url.path == "/api/sites/s1/members/u9"
    assert req.headers["Idempotency-Key"].startswith("py-sdk-members-remove-")


@pytest.mark.asyncio
async def test_add_by_email_sends_email_not_uid() -> None:
    """The affordance an admin actually has: an address, not a uid."""
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"uid": "u9", "roleHonored": True})

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        await client.members("s1").add(email="Alice@Example.com", role="member")

    assert json.loads(captured[0].content) == {
        "email": "Alice@Example.com",
        "role": "member",
    }


@pytest.mark.asyncio
async def test_add_requires_exactly_one_of_uid_or_email() -> None:
    """Both or neither is a client-side error, matching the server's 400."""
    async with Roost(
        token="owk_live_x",
        transport=_transport(lambda _r: httpx.Response(200, json={})),
    ) as client:
        with pytest.raises(ValueError):
            await client.members("s1").add()
        with pytest.raises(ValueError):
            await client.members("s1").add("u9", email="a@b.c")


@pytest.mark.asyncio
async def test_set_role_patches_the_per_site_role_only() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"siteId": "s1", "uid": "u9", "role": "admin"})

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        await client.members("s1").set_role("u9", "admin")

    req = captured[0]
    assert req.method == "PATCH"
    assert req.url.path == "/api/sites/s1/members/u9"
    assert json.loads(req.content) == {"role": "admin"}
    assert req.headers["Idempotency-Key"].startswith("py-sdk-members-setrole-")


@pytest.mark.asyncio
async def test_transfer_ownership_posts_to_the_site_level_endpoint() -> None:
    """Deliberately NOT under /members: ownership belongs to the site."""
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"siteId": "s1", "previousOwnerUid": "u-old", "newOwnerUid": "u-new"},
        )

    async with Roost(token="owk_live_x", transport=_transport(handler)) as client:
        out = await client.members("s1").transfer_ownership("u-new")

    req = captured[0]
    assert req.method == "POST"
    assert req.url.path == "/api/sites/s1/transfer-ownership"
    assert json.loads(req.content) == {"successorUid": "u-new"}
    assert req.headers["Idempotency-Key"].startswith("py-sdk-transfer-owner-")
    assert out["newOwnerUid"] == "u-new"
