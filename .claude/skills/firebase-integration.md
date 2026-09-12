# Firebase Integration Guidelines

**Applies To**: Both web dashboard and Python agent

---

## Firestore Data Structure

This is the source of truth for all data paths:

```
firestore/
├── sites/{siteId}/
│   ├── name, createdAt, timezone
│   ├── members/{uid}/             # THE site-access grant. { uid, role, status, addedAt, addedBy }
│   │   # role: 'owner' | 'admin' | 'member'. Written ONLY by lib/membership.server.ts.
│   │   # `uid` is duplicated as a field so the client can run
│   │   # collectionGroup('members').where('uid','==',me) — rules cannot prove a doc id.
│   └── machines/{machineId}/
│       ├── presence/              # Agent heartbeat every 30s
│       │   ├── online: boolean
│       │   ├── lastHeartbeat: timestamp
│       │   ├── rebooting: boolean          # Set before remote reboot
│       │   ├── shuttingDown: boolean       # Set before remote shutdown
│       │   └── rebootPending: { active, processName, reason, timestamp }  # When relaunch limit exceeded
│       ├── status/                # Agent metrics every 60s
│       │   ├── cpu, memory, disk, gpu: number
│       │   └── processes: map
│       ├── lastScreenshot/           # Most recent screenshot (overwritten each capture)
│       │   ├── url: string           # Firebase Storage public URL (with cache-buster)
│       │   ├── timestamp: number     # Capture time (Date.now())
│       │   └── sizeKB: number        # Image size in KB
│       └── commands/
│           ├── pending/{commandId}   # Web → Agent
│           └── completed/{commandId} # Agent → Web (result + completedAt)
│   └── webhooks/{webhookId}/          # Webhook notification endpoints
│       ├── url: string                # Target URL (https required)
│       ├── name: string               # User-friendly label
│       ├── events: string[]           # ["machine.offline", "process.crashed", ...]
│       ├── enabled: boolean           # Can be toggled without deleting
│       ├── secret: string             # HMAC-SHA256 signing secret
│       ├── createdAt, createdBy, lastTriggered, lastStatus, failCount
│       └── (auto-disables after 10 consecutive failures)
├── config/{siteId}/
│   └── machines/{machineId}/      # Process configuration (version, processes[])
│       # Each process has: name, exe_path, launch_mode ("off"/"always"/"scheduled"),
│       #   schedules?: [{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }],
│       #   autolaunch (derived, backward compat), check_responsive, relaunch_attempts, ...
├── users/{userId}/                # email, role (GLOBAL), createdAt, preferences {healthAlerts, processAlerts, temperatureUnit}
│   # `role` is GLOBAL and grants nothing on a site: only 'superadmin' carries authority.
│   # `sites[]` still exists but is LEGACY and read by nothing — it is unioned into the
│   # client's site list for one release and stripped in wave 6.1. Never gate on it.
│   └── api_keys/{keyId}/          # API key metadata (name, keyHash, keyPrefix, createdAt, lastUsedAt)
├── api_keys/{keyHash}/            # Top-level API key lookup (userId, keyId) — O(1) resolution
└── deployments/{deploymentId}/    # Remote installer deployments
    ├── installerUrl, silentFlags, targetMachines[], status, createdBy
    └── results: map
```

---

## Two Different Firebase Clients

This is the most important architectural distinction:

| | Web Dashboard | Python Agent |
|---|---|---|
| **SDK** | Firebase Client SDK (`firebase/firestore`) | Custom REST client (`firestore_rest_client.py`) |
| **Auth** | Firebase Auth (email/password, Google OAuth) | OAuth two-token system (`auth_manager.py`) |
| **Real-time** | `onSnapshot` listeners | Polling + Firestore listener thread |
| **Timestamps** | `serverTimestamp()` | `{"timestampValue": "..."}` REST format |

### Agent: Do NOT

- Do NOT import `firebase_admin` — the agent uses a custom REST client
- Do NOT use `google.cloud.firestore` client libraries
- Do NOT use `firestore.SERVER_TIMESTAMP` — REST API uses different format
- Do NOT bypass `ConnectionManager` for reconnection logic
- Do NOT log OAuth tokens, even in DEBUG mode

### Web: Key Patterns

- Firebase init is in `web/lib/firebase.ts` (singleton)
- Auth state lives in `web/contexts/AuthContext.tsx`
- All Firestore reads go through hooks in `web/hooks/` (not direct calls from components)
- Always scope queries to user's site: `sites/{siteId}/...`

---

## Command Flow (Web → Agent)

```
Web Dashboard writes to:  sites/{siteId}/machines/{machineId}/commands/pending/{commandId}
Agent listener picks up → executes → moves to commands/completed/{commandId}
Web listener sees completion → updates UI
```

Command types: `restart_process`, `kill_process`, `set_launch_mode`, `update_config`, `install_software`

---

## Alert Flow (Agent → Web API → Email)

```
Agent detects crash → firebase_client.send_process_alert()
  → daemon thread POSTs to /api/agent/alert with bearer token
  → API validates agent token, checks per-process rate limit (3/hr per machineId:processName)
  → queries users with processAlerts !== false for the site
  → sends email via Resend
```

Two alert types flow through `/api/agent/alert`:
- **Connection failure** (`eventType: 'connection_failure'`): existing health alerts, filtered by `healthAlerts` preference
- **Process events** (`eventType: 'process_crash' | 'process_start_failed'`): filtered by `processAlerts` preference

User preferences (`users/{userId}/preferences`):
- `healthAlerts` (default: true) — machine offline email alerts
- `processAlerts` (default: true) — process crash/start failure email alerts
- `temperatureUnit` ('C' | 'F') — dashboard display preference

---

## Webhook Flow (Agent/Cron → Web API → External URLs)

```
Alert endpoint or cron detects event
  → calls fireWebhooks(siteId, siteName, eventType, data) (fire-and-forget)
  → queries sites/{siteId}/webhooks where enabled==true AND events array-contains eventType
  → POSTs JSON payload to each webhook URL with HMAC-SHA256 signature
  → updates lastTriggered, lastStatus, failCount on each webhook doc
  → auto-disables webhook after 10 consecutive failures
```

Supported event types: `machine.offline`, `process.crashed`, `process.restarted`, `machine.online`, `deployment.completed`, `deployment.failed`

Currently integrated: `machine.offline` (health-check cron + agent alert), `process.crashed` / `process.restarted` (agent alert), plus the simulate endpoint.

Webhook payloads always include: `{ event, timestamp, site: { id, name }, data: { machine, process?, ... } }`

Headers: `X-Owlette-Signature: sha256=<hmac>`, `X-Owlette-Event: <type>`, `User-Agent: Owlette-Webhooks/1.0`

---

## Security Rules

Site access is MEMBERSHIP, resolved from `sites/{siteId}/members/{uid}` — not from
`users/{uid}.sites[]` and not from `sites/{siteId}.owner`. Neither legacy field is read by
any rule or any server path.

- `canAccessSite(siteId)` — superadmin, or an ACTIVE membership row.
- `isSiteAdmin(siteId)` — superadmin, or a membership role of `owner` / `admin`.
- A GLOBAL `users/{uid}.role == 'admin'` grants **nothing** on a site it holds no row for.
  This is the escalation the per-site-roles migration closed; do not reintroduce it.
- `isActiveMember` + `siteMemberRole` share one document read, and `isNotDeletedUser` +
  `isSuperadmin` share another, so the auth path costs 2 document reads.
  `get(sites/{siteId})` is deliberately absent from it.
- The recursive `match /{path=**}/members/{memberUid}` block is what makes the client's
  `collectionGroup('members')` query legal — a rule nested under `match /sites/{siteId}`
  does not authorize a collection-group query, however permissive.

That query ALSO needs a single-field index exemption (`members.uid`, COLLECTION_GROUP scope)
in `firestore.indexes.json`. Automatic single-field indexing does NOT extend to
collection-group scope, and neither the emulator nor the Admin SDK will tell you —
`scripts/check-membership-read-path.mjs` is the only check that catches it.

Server-side the same decision lives in `lib/sitePolicy.server.ts` (`resolveSiteAccess`), with
the capability matrix in `lib/capabilities.ts` keyed on the PER-SITE role.

Deployments are user-scoped (only creator can update/delete).

Rules file: `firestore.rules` (version managed independently from product version).

---

## When This Skill Activates

Working on files with Firebase imports, Firestore operations, or auth flows.
