"""``roost.members`` — site membership.

Drives:

  GET    /api/sites/{siteId}/members
  POST   /api/sites/{siteId}/members             { uid | email, role }
  PATCH  /api/sites/{siteId}/members/{uid}       { role }
  DELETE /api/sites/{siteId}/members/{uid}
  POST   /api/sites/{siteId}/transfer-ownership  { successorUid }

Construct via ``roost.members(site_id)`` — each instance is bound to one
site. The per-site role is reported server-side (owner / superadmin /
admin / member) and surfaced on each ``Member.role``.

PER-SITE ROLES. ``set_role`` changes someone's standing on THIS site only,
leaving their global role untouched. Before it existed the per-site role was
derived from the global one, so "make them an admin here" meant promoting them
everywhere they belonged — the leak per-site roles close.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from roost.client import RoostClient


#: Roles that can be ASSIGNED. ``owner`` is deliberately absent — ownership
#: moves only through :meth:`Members.transfer_ownership`, which is transactional
#: and re-reads the owner inside it, so an admin can neither promote themselves
#: into ownership nor demote the owner out of it.
AddRole = Literal["member", "admin"]

#: Role as REPORTED by the API. ``owner`` and ``superadmin`` are derived
#: standings, not settings.
PerSiteRole = Literal["owner", "superadmin", "admin", "member"]


@dataclass(slots=True)
class Member:
    uid: str
    email: str | None
    role: PerSiteRole
    display_name: str | None


def _parse_member(raw: dict[str, Any]) -> Member:
    role = raw.get("role")
    if role not in ("owner", "superadmin", "admin", "member"):
        role = "member"
    return Member(
        uid=str(raw.get("uid", "")),
        email=raw.get("email"),
        role=role,  # type: ignore[arg-type]
        display_name=raw.get("displayName"),
    )


class Members:
    """Site-membership management bound to one site."""

    def __init__(self, client: "RoostClient", site_id: str) -> None:
        self._client = client
        self._site_id = site_id

    @property
    def site_id(self) -> str:
        return self._site_id

    def _base(self) -> str:
        return f"/api/sites/{self._site_id}/members"

    async def list(self) -> list[Member]:
        resp = await self._client.request(self._base())
        data = resp.data if isinstance(resp.data, dict) else {}
        return [
            _parse_member(m)
            for m in (data.get("members") or [])
            if isinstance(m, dict)
        ]

    async def add(
        self,
        uid: str | None = None,
        *,
        email: str | None = None,
        role: AddRole = "member",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Add a member by ``uid`` OR ``email`` — exactly one, never both.

        ``email`` is the affordance an admin actually has (they know a
        colleague's address, not their uid); the server trims and lowercases it
        and resolves it through Firebase Auth to the same uid path.

        ``role="admin"`` is honoured only when the target's GLOBAL role is
        already admin/superadmin; otherwise membership is extended and the
        response carries ``roleHonored: False``. Promotion is a separate,
        explicit endpoint — never a side-effect of adding someone to a site.
        """
        if (uid is None) == (email is None):
            raise ValueError("provide exactly one of uid or email")
        body: dict[str, Any] = {"role": role}
        if uid is not None:
            body["uid"] = uid
        else:
            body["email"] = email
        resp = await self._client.request(
            self._base(),
            method="POST",
            body=body,
            idempotency_key=idempotency_key,
        )
        return resp.data if isinstance(resp.data, dict) else {}

    async def set_role(
        self,
        uid: str,
        role: AddRole,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Change a member's role on THIS site; their global role is untouched.

        Refuses the site owner with 409 ``cannot_change_owner_role`` — the
        owner's role is set by ownership, so use
        :meth:`transfer_ownership` instead.
        """
        idem = idempotency_key or f"py-sdk-members-setrole-{uuid.uuid4()}"
        resp = await self._client.request(
            f"{self._base()}/{uid}",
            method="PATCH",
            body={"role": role},
            headers={"Idempotency-Key": idem},
        )
        return resp.data if isinstance(resp.data, dict) else {}

    async def remove(
        self,
        uid: str,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        # Preserve a resource-specific prefix rather than the core client's
        # generic py-sdk DELETE key.
        idem = idempotency_key or f"py-sdk-members-remove-{uuid.uuid4()}"
        resp = await self._client.request(
            f"{self._base()}/{uid}",
            method="DELETE",
            headers={"Idempotency-Key": idem},
        )
        return resp.data if isinstance(resp.data, dict) else {}


    async def transfer_ownership(
        self,
        successor_uid: str,
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Hand this site to another user, atomically.

        Only the current owner or a superadmin may do this — a site admin is
        refused with 403 ``not_owner``. The successor need not already be a
        member; they are made one by the same transaction. The outgoing owner is
        demoted to ``admin`` and KEEPS their membership: handing a site over is
        not eviction.
        """
        idem = idempotency_key or f"py-sdk-transfer-owner-{uuid.uuid4()}"
        resp = await self._client.request(
            f"/api/sites/{self._site_id}/transfer-ownership",
            method="POST",
            body={"successorUid": successor_uid},
            headers={"Idempotency-Key": idem},
        )
        return resp.data if isinstance(resp.data, dict) else {}


__all__ = ["AddRole", "Member", "Members", "PerSiteRole"]
