/**
 * Stub agent for the live dev smoke suite: a fake online machine `smoke-stub-01` in site
 * `smoke-live` that answers hoot's tool relays with canned data. It never executes
 * anything — a tier-3 command can only ever be failed — and it never touches a real
 * machine. owlette-dev-3838a only: every Firestore handle comes from lib/devAdmin.mjs,
 * which pins the project before the first read or write.
 *
 * Lifecycle
 *   start    Refuse if another stub is heartbeating on the machine doc. Truncate --log,
 *            clear command/control docs a crashed run left behind, register the machine,
 *            subscribe to commands/pending, heartbeat every 30 s.
 *   command  Append one JSON line to --log, then:
 *              hold      smoke/control has `hold: true` (the hoot cancel check): log only.
 *                        A held command is never completed, not even after the hold
 *                        lifts — hoot deletes its own pending entry when the turn is
 *                        cancelled or the tool times out, and a late result would linger.
 *              complete  an mcp_tool_call for a canned tier-1 read tool: canned result,
 *                        get_system_info reporting hostname `smoke-<nonce>`.
 *              fail      anything else: status 'failed', error `stub: unsupported command …`.
 *   stop     SIGINT / SIGTERM / SIGBREAK / SIGHUP, or the IPC message 'shutdown':
 *            unsubscribe, let in-flight completions land, mark the machine offline,
 *            delete it with its commands/* and smoke/* docs, exit 0. A second signal
 *            exits 1 at once and leaves the cleanup to `lib/seed.mjs --teardown`, which
 *            also sweeps the metrics_history buckets onMetricsWrite writes per heartbeat.
 *
 * Completion write order is the real agent's — _mark_command_terminal,
 * agent/src/firebase_client.py:1864-1876, mirrored by web/e2e/helpers/stubAgent.ts:54-59:
 * merge into commands/completed FIRST, then field-delete the id from commands/pending.
 *
 * A parent process must stop it over IPC, not with a signal: on Windows
 * `child.kill('SIGINT')` terminates the child without running its handlers (measured on
 * Node 22.20, 2026-09-11), which would strand the machine doc. Spawn it with an 'ipc'
 * stdio slot, wait for the `{ type: 'ready' }` message, send 'shutdown'. The channel
 * closing (the parent died) stops it too.
 *
 * Log line: { commandId, type, tool, chatId, receivedAt, action[, error] }, appended as the
 * command arrives. `action` is what the stub decided: 'complete', 'fail', 'hold', or 'error'
 * (the hold flag could not be read; the command was left in pending). It records receipt,
 * not delivery: a result that fails to write is reported on stderr, and the hoot checks prove
 * delivery by the answer itself. `tool` is null for anything but an mcp_tool_call; `chatId` is
 * the relay's chat_id, null for a command that carries none.
 *
 * Exit codes: 0 stopped cleanly, 1 fatal error or cleanup failed, 2 bad arguments.
 *
 * CLI: node web/e2e-live/stub-agent.mjs --nonce <n> --log <path> [--dry-run]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { closeDevAdmin, getDb } from './lib/devAdmin.mjs';
import { SITE_ID, STUB_MACHINE_ID } from './lib/seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** web/e2e-live → repository root. */
const REPO = path.resolve(HERE, '..', '..');

const MACHINE_PATH = `sites/${SITE_ID}/machines/${STUB_MACHINE_ID}`;
const TEARDOWN_HINT = 'run node web/e2e-live/lib/seed.mjs --teardown';

/**
 * The real agent beats every 30 s while processes run (agent/src/firebase_client.py:761-766);
 * the dashboard and the /hoot target picker call a machine offline at 300 s
 * (web/hooks/useFirestore.ts:944-964).
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** A machine doc that beat more recently than this belongs to a stub that is still running. */
const LIVE_PEER_WINDOW_MS = 3 * HEARTBEAT_INTERVAL_MS;
/** Consecutive failed heartbeats before giving up, rather than sit online with a frozen heartbeat. */
const MAX_HEARTBEAT_FAILURES = 4;
/** Cleanup budget: inside Windows' ~10 s console-close window and run.mjs's 15 s kill (Task 3.5). */
const SHUTDOWN_TIMEOUT_MS = 8_000;
const DELETE_ATTEMPTS = 3;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
/** gRPC NOT_FOUND, as @google-cloud/firestore reports it on `error.code`. */
const GRPC_NOT_FOUND = 5;
const NONCE_PATTERN = /^[A-Za-z0-9]{4,32}$/;
const UNSUPPORTED_PREFIX = 'stub: unsupported command';

const USAGE = 'usage: node web/e2e-live/stub-agent.mjs --nonce <n> --log <path> [--dry-run]';
const HELP = `${USAGE}

  --nonce <n>   4-32 letters or digits; get_system_info reports hostname smoke-<n>
  --log <path>  JSON-lines command log, truncated at start
  --dry-run     self-check the command handling offline: reads no credentials, touches no Firestore
  -h, --help    show this text

Registers ${MACHINE_PATH} on owlette-dev-3838a until stopped with Ctrl-C (SIGINT, SIGTERM,
SIGBREAK, SIGHUP) or, from a parent process, the IPC message 'shutdown'. The machine doc and
its commands/* and smoke/* docs are deleted on the way out.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stubHostname(nonce) {
  return `smoke-${nonce}`;
}

function stubRefs(db) {
  const machine = db.collection('sites').doc(SITE_ID).collection('machines').doc(STUB_MACHINE_ID);
  const commands = machine.collection('commands');
  const smoke = machine.collection('smoke');
  return {
    machine,
    commands,
    pending: commands.doc('pending'),
    completed: commands.doc('completed'),
    smoke,
    control: smoke.doc('control'),
  };
}

/** The repo version, so the dashboard shows a current agent (SITE_TIME_MIN_AGENT_VERSION, web/lib/versionUtils.ts:158). */
function readAgentVersion() {
  const file = path.join(REPO, 'VERSION');
  const version = readFileSync(file, 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${file} does not hold a semver version`);
  return version;
}

/**
 * The machine document at registration. "Online" is `online: true` plus a lastHeartbeat
 * younger than 300 s on the dashboard and the /hoot target picker (isMachineOnline,
 * web/hooks/useFirestore.ts:956-964, reached through useMachines in
 * web/app/hoot/components/HootChatView.tsx:131); hoot's server gate reads the flag alone
 * (web/lib/hoot-utils.server.ts:424-441). Both stamps must be Timestamps: the health-check
 * cron (web/app/api/cron/health-check/route.ts:51-53) and onMetricsWrite read them with
 * toMillis() and take anything else as infinitely stale. The rest are the agent's presence
 * and heartbeat fields (agent/src/firebase_client.py:1052-1057, 1527-1541) trimmed to the
 * minimal shape the emulator suite renders (web/e2e/helpers/seed.ts:413-424). No
 * cortexEnabled or capabilities: absent is the wanted default (hoot on; no display remote
 * apply for a machine without displays).
 */
function machineDoc(agentVersion) {
  return {
    online: true,
    lastHeartbeat: FieldValue.serverTimestamp(),
    agent_version: agentVersion,
    machine_timezone_iana: 'UTC',
    machineId: STUB_MACHINE_ID,
    siteId: SITE_ID,
    metrics: { schemaVersion: 2, timestamp: FieldValue.serverTimestamp() },
  };
}

function cannedSystemInfo({ nonce, agentVersion, startedAtMs, nowMs }) {
  const uptimeSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return {
    hostname: stubHostname(nonce),
    os: 'Windows 11',
    os_version: '10.0.22631',
    architecture: 'AMD64',
    cpu_model: 'smoke stub (no hardware)',
    cpu_percent: 2.5,
    cpu_cores: 4,
    cpu_threads: 8,
    memory_used_gb: 6.4,
    memory_total_gb: 16,
    memory_percent: 40,
    disk_used_gb: 120,
    disk_total_gb: 480,
    disk_percent: 25,
    gpu_model: 'N/A',
    gpu_driver_version: 'N/A',
    gpu_usage_percent: 0,
    gpu_vram_used_gb: 0,
    gpu_vram_total_gb: 0,
    uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
    uptime_seconds: uptimeSeconds,
    agent_version: agentVersion,
    python_version: '3.11.8',
  };
}

const CANNED_PROCESSES = Object.freeze([
  Object.freeze({ pid: 5120, name: 'TouchDesigner.exe', cpu_percent: 12.5, memory_mb: 2048, status: 'running' }),
  Object.freeze({ pid: 3312, name: 'explorer.exe', cpu_percent: 0.4, memory_mb: 180.2, status: 'running' }),
  Object.freeze({ pid: 2204, name: 'owlette-host.exe', cpu_percent: 0.1, memory_mb: 12.3, status: 'running' }),
  Object.freeze({ pid: 4, name: 'System', cpu_percent: 0.2, memory_mb: 0.1, status: 'running' }),
]);

function cannedRunningProcesses(params) {
  const filter = typeof params.name_filter === 'string' ? params.name_filter.toLowerCase() : '';
  const limit = Math.min(Number.isInteger(params.limit) ? params.limit : 50, 200);
  const processes = CANNED_PROCESSES.filter((proc) => !filter || proc.name.toLowerCase().includes(filter))
    .sort((a, b) => b.memory_mb - a.memory_mb)
    .slice(0, Math.max(limit, 0))
    .map((proc) => ({ ...proc }));
  return { processes, count: processes.length, total_running: CANNED_PROCESSES.length };
}

/**
 * Canned answers by tool name. Tier-1 read tools only (web/lib/mcp-tools.ts:61-63
 * get_system_info, :79-81 get_running_processes); a tool of any other tier must stay
 * unsupported. Shapes follow the real agent (agent/src/mcp_tools.py:297-321, 376-403).
 */
const CANNED_TOOLS = Object.freeze({
  get_system_info: (_params, ctx) => cannedSystemInfo(ctx),
  get_running_processes: (params) => cannedRunningProcesses(params),
});

/** `type` and, for a hoot relay, `tool` of a pending entry (shape: web/lib/hoot-utils.server.ts:541-554). */
function commandFields(cmd) {
  const type = typeof cmd?.type === 'string' ? cmd.type : null;
  const tool = type === 'mcp_tool_call' && typeof cmd.tool_name === 'string' ? cmd.tool_name : null;
  return { type, tool };
}

function commandLabel(cmd) {
  const { type, tool } = commandFields(cmd);
  return tool ? `${type}/${tool}` : (type ?? '(no type)');
}

/**
 * What the stub does with one pending command. Pure — the caller reads the hold flag —
 * so --dry-run can drive every branch without Firestore.
 */
function decide(cmd, { hold, ...ctx }) {
  if (hold) return { action: 'hold' };
  const { type, tool } = commandFields(cmd);
  if (tool !== null && Object.hasOwn(CANNED_TOOLS, tool)) {
    const params = isPlainObject(cmd.tool_params) ? cmd.tool_params : {};
    // A JSON string, as the real agent sends (agent/src/owlette_service.py:5204-5205);
    // hoot JSON.parses it (web/lib/hoot-utils.server.ts:607-614).
    return { action: 'complete', result: JSON.stringify(CANNED_TOOLS[tool](params, ctx)) };
  }
  const detail = tool ? `type=${type}, tool=${tool}` : `type=${type ?? '(none)'}`;
  return {
    action: 'fail',
    error:
      `${UNSUPPORTED_PREFIX} (${detail}): ${STUB_MACHINE_ID} is the live-smoke stub agent; ` +
      `it answers only ${Object.keys(CANNED_TOOLS).join(', ')} and never executes anything`,
  };
}

/**
 * The commands/completed entry for a decided command, in _mark_command_terminal's shape
 * (agent/src/firebase_client.py:1852-1862): `result` with status 'completed' or `error`
 * with status 'failed', plus completedAt and the command's own deployment_id and type.
 */
function terminalEntry(cmd, decision) {
  const entry =
    decision.action === 'complete'
      ? { result: decision.result, status: 'completed' }
      : { error: decision.error, status: 'failed' };
  entry.completedAt = FieldValue.serverTimestamp();
  if (cmd?.deployment_id) entry.deployment_id = cmd.deployment_id;
  const { type } = commandFields(cmd);
  if (type) entry.type = type;
  return entry;
}

/**
 * Record a terminal status the way the real agent does (agent/src/firebase_client.py:1864-1876,
 * mirrored by web/e2e/helpers/stubAgent.ts:54-59). completed FIRST: a failure between the
 * two writes leaves the command pending (retryable); the reverse order can lose it. Then a
 * per-field delete — never the pending doc, which other in-flight commands share.
 */
async function writeTerminal(refs, commandId, entry) {
  await refs.completed.set({ [commandId]: entry }, { merge: true });
  // FieldPath, not a string key: update() would split a dotted id into nested fields.
  await refs.pending.update(new FieldPath(commandId), FieldValue.delete());
}

function logEntry(commandId, cmd, receivedAt, action, error) {
  const { type, tool } = commandFields(cmd);
  const chatId = typeof cmd?.chat_id === 'string' && cmd.chat_id !== '' ? cmd.chat_id : null;
  const entry = { commandId, type, tool, chatId, receivedAt: receivedAt.toISOString(), action };
  if (error) entry.error = error;
  return entry;
}

/**
 * Delete the stub's command and control documents — plus the machine doc when
 * `includeMachine` — in one atomic batch, retrying transient failures. Scoped to this one
 * machine's own subcollections; listDocuments also returns ids that only hold
 * subcollections, and deleting a missing doc is a no-op. Returns how many command/control
 * documents were listed.
 */
async function deleteStubDocs(refs, { includeMachine }) {
  const docs = [...(await refs.commands.listDocuments()), ...(await refs.smoke.listDocuments())];
  if (docs.length === 0 && !includeMachine) return 0;
  for (let attempt = 1; ; attempt += 1) {
    const batch = refs.machine.firestore.batch();
    for (const ref of docs) batch.delete(ref);
    if (includeMachine) batch.delete(refs.machine);
    try {
      await batch.commit();
      return docs.length;
    } catch (err) {
      if (attempt >= DELETE_ATTEMPTS) throw err;
      await sleep(1000 * attempt);
    }
  }
}

class StubAgent {
  constructor({ nonce, logPath, agentVersion }) {
    this.nonce = nonce;
    this.logPath = logPath;
    this.agentVersion = agentVersion;
    this.startedAtMs = Date.now();
    this.refs = null;
    /** Ids already handled, pruned as they leave pending — the agent's _seen_commands (firebase_client.py:909-918). */
    this.seen = new Set();
    this.inFlight = new Set();
    this.stopping = false;
    /** Set once this process first writes the stub's documents; only then does stop() delete them. */
    this.claimed = false;
    this.unsubscribe = null;
    this.heartbeatTimer = null;
    this.heartbeatFailures = 0;
    this.startup = null;
    this.shutdown = null;
  }

  async start() {
    this.refs = stubRefs(getDb());
    await this.assertNoLivePeer();
    if (this.stopping) return;

    mkdirSync(path.dirname(this.logPath), { recursive: true });
    writeFileSync(this.logPath, '');

    this.claimed = true;
    const stale = await deleteStubDocs(this.refs, { includeMachine: false });
    if (stale > 0) console.log(`[stub] cleared ${stale} command/control doc(s) an earlier run left`);
    if (this.stopping) return;

    // set(), not merge: a fresh doc every run, free of anything an earlier run or the
    // health-check cron (health.*) left on it.
    await this.refs.machine.set(machineDoc(this.agentVersion));
    if (this.stopping) return;

    this.unsubscribe = this.refs.pending.onSnapshot(
      (snap) => this.onPending(snap),
      (err) => void this.stop(`commands/pending listener failed: ${errorMessage(err)}`, 1),
    );
    this.scheduleHeartbeat();
    console.log(`[stub] ${MACHINE_PATH} online as ${stubHostname(this.nonce)}; commands log to ${this.logPath}`);
    process.send?.({ type: 'ready', siteId: SITE_ID, machineId: STUB_MACHINE_ID });
  }

  /** Two stubs on one machine doc would both answer every command; refuse to be the second. */
  async assertNoLivePeer() {
    const snap = await this.refs.machine.get();
    if (!snap.exists) return;
    const { online, lastHeartbeat } = snap.data();
    const beatMs = typeof lastHeartbeat?.toMillis === 'function' ? lastHeartbeat.toMillis() : null;
    if (online === true && beatMs !== null && Date.now() - beatMs < LIVE_PEER_WINDOW_MS) {
      throw new Error(
        `${MACHINE_PATH} heartbeat is ${Math.round((Date.now() - beatMs) / 1000)} s old: another stub agent is ` +
          `running. Stop it; if none is, wait ${LIVE_PEER_WINDOW_MS / 1000} s or ${TEARDOWN_HINT}`,
      );
    }
  }

  onPending(snap) {
    if (this.stopping) return;
    const commands = snap.exists ? snap.data() : {};
    const receivedAt = new Date();
    for (const [commandId, cmd] of Object.entries(commands)) {
      if (this.seen.has(commandId)) continue;
      this.seen.add(commandId);
      const task = this.handle(commandId, cmd, receivedAt).catch((err) =>
        console.error(`[stub] ${commandId}: ${errorMessage(err)}`),
      );
      this.inFlight.add(task);
      task.finally(() => this.inFlight.delete(task));
    }
    // Forget ids that left pending (answered here, or deleted by hoot on cancel/timeout).
    for (const commandId of this.seen) {
      if (!Object.hasOwn(commands, commandId)) this.seen.delete(commandId);
    }
  }

  async handle(commandId, cmd, receivedAt) {
    const label = commandLabel(cmd);
    let decision;
    try {
      const hold = await this.readHold();
      decision = decide(cmd, {
        hold,
        nonce: this.nonce,
        agentVersion: this.agentVersion,
        startedAtMs: this.startedAtMs,
        nowMs: Date.now(),
      });
    } catch (err) {
      this.appendLog(logEntry(commandId, cmd, receivedAt, 'error', errorMessage(err)));
      console.error(`[stub] ${commandId} ${label}: could not read the hold flag (${errorMessage(err)}); left pending`);
      return;
    }
    this.appendLog(logEntry(commandId, cmd, receivedAt, decision.action));
    if (decision.action === 'hold') {
      console.log(`[stub] ${commandId} ${label}: held`);
      return;
    }
    if (this.stopping) return;
    try {
      await writeTerminal(this.refs, commandId, terminalEntry(cmd, decision));
      console.log(`[stub] ${commandId} ${label}: ${decision.action === 'complete' ? 'completed' : 'failed (unsupported)'}`);
    } catch (err) {
      console.error(`[stub] ${commandId} ${label}: writing the result failed: ${errorMessage(err)}`);
    }
  }

  async readHold() {
    const snap = await this.refs.control.get();
    return snap.exists && snap.data()?.hold === true;
  }

  appendLog(entry) {
    try {
      appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
    } catch (err) {
      console.error(`[stub] could not append to ${this.logPath}: ${errorMessage(err)}`);
    }
  }

  scheduleHeartbeat() {
    this.heartbeatTimer = setTimeout(() => {
      this.beat().finally(() => {
        if (!this.stopping) this.scheduleHeartbeat();
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  async beat() {
    try {
      // update(), as _upload_metrics does (firebase_client.py:1527): it can never
      // recreate a machine doc that teardown removed.
      await this.refs.machine.update({
        online: true,
        lastHeartbeat: FieldValue.serverTimestamp(),
        'metrics.timestamp': FieldValue.serverTimestamp(),
      });
      this.heartbeatFailures = 0;
    } catch (err) {
      if (this.stopping) return;
      if (err?.code === GRPC_NOT_FOUND) {
        void this.stop(`${MACHINE_PATH} was deleted elsewhere (teardown); not recreating it`, 0);
        return;
      }
      this.heartbeatFailures += 1;
      console.error(`[stub] heartbeat failed (${this.heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}): ${errorMessage(err)}`);
      if (this.heartbeatFailures >= MAX_HEARTBEAT_FAILURES) void this.stop('heartbeat keeps failing', 1);
    }
  }

  /** Idempotent. Never returns: exits the process once cleanup finishes or times out. */
  stop(reason, exitCode) {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    this.shutdown = (async () => {
      console.log(`[stub] stopping: ${reason}`);
      clearTimeout(this.heartbeatTimer);
      this.unsubscribe?.();
      const deadline = setTimeout(() => {
        console.error(`[stub] cleanup did not finish in ${SHUTDOWN_TIMEOUT_MS / 1000} s; ${TEARDOWN_HINT}`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      let code = exitCode;
      try {
        await this.startup?.catch(() => {});
        await Promise.allSettled(this.inFlight);
        if (this.claimed) await this.removeMachine();
      } catch (err) {
        console.error(`[stub] cleanup failed: ${errorMessage(err)}; ${TEARDOWN_HINT}`);
        code = 1;
      }
      await closeDevAdmin().catch(() => {});
      clearTimeout(deadline);
      process.exit(code);
    })();
    return this.shutdown;
  }

  async removeMachine() {
    // Offline first, like FirebaseClient.stop (agent/src/firebase_client.py:707-738): should
    // the delete below fail, the health-check cron ignores an offline machine instead of
    // alerting on a stale online one. update(), so it cannot recreate a deleted doc.
    try {
      await this.refs.machine.update({ online: false, lastHeartbeat: FieldValue.serverTimestamp() });
    } catch (err) {
      if (err?.code !== GRPC_NOT_FOUND) console.error(`[stub] could not mark ${MACHINE_PATH} offline: ${errorMessage(err)}`);
    }
    const listed = await deleteStubDocs(this.refs, { includeMachine: true });
    console.log(`[stub] deleted ${MACHINE_PATH} and ${listed} command/control doc(s)`);
  }
}

/**
 * Turn hold mode on or off, for the hoot cancel check. Commands that arrive while it is on
 * are logged and never completed.
 */
export async function setStubHold(hold, { db = getDb() } = {}) {
  if (typeof hold !== 'boolean') throw new TypeError('setStubHold: hold must be a boolean');
  await stubRefs(db).control.set({ hold }, { merge: true });
}

/**
 * The entries of a stub log. Only newline-terminated lines count, so a line still being
 * appended is never half-read. A missing file throws rather than reading as "no commands":
 * the stub creates the file at start, so absence means no stub ran, and an empty result
 * would let a "no command reached the machine" assertion pass vacuously.
 */
export function readStubLog(logPath) {
  const lines = readFileSync(logPath, 'utf8').split('\n');
  lines.pop();
  return lines.filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
}

/** A hoot relay exactly as executeToolOnAgent writes it (web/lib/hoot-utils.server.ts:543-551). */
function sampleRelay(toolName, toolParams = {}) {
  return {
    type: 'mcp_tool_call',
    tool_name: toolName,
    tool_params: toolParams,
    chat_id: 'chat_dry_run',
    timestamp: Date.now(),
    status: 'pending',
    timeout_seconds: 30,
  };
}

function renderDoc(doc) {
  return JSON.stringify(doc, (_key, value) => (value instanceof FieldValue ? '<server timestamp>' : value));
}

/** --dry-run: drive every branch of the command handling offline. Returns the exit code. */
function selfCheck({ nonce, logPath, agentVersion }) {
  const nowMs = Date.now();
  const ctx = { hold: false, nonce, agentVersion, startedAtMs: nowMs - 3_720_000, nowMs };
  const hostname = stubHostname(nonce);
  const isUnsupported = (d) => d.action === 'fail' && d.error.startsWith(UNSUPPORTED_PREFIX);
  const cases = [
    {
      name: `get_system_info completes with hostname ${hostname}`,
      cmd: sampleRelay('get_system_info'),
      expect: (d) => d.action === 'complete' && JSON.parse(d.result).hostname === hostname,
    },
    {
      name: 'get_running_processes completes and honours name_filter',
      cmd: sampleRelay('get_running_processes', { name_filter: 'OWLETTE' }),
      expect: (d) => {
        const result = d.action === 'complete' ? JSON.parse(d.result) : null;
        return result?.count === 1 && result.processes[0].name === 'owlette-host.exe';
      },
    },
    { name: 'run_powershell (tier 3) fails', cmd: sampleRelay('run_powershell', { script: 'Get-Date' }), expect: isUnsupported },
    { name: 'execute_script (tier 3) fails', cmd: sampleRelay('execute_script'), expect: isUnsupported },
    { name: 'get_agent_health (tier 1, not canned) fails', cmd: sampleRelay('get_agent_health'), expect: isUnsupported },
    { name: 'a prototype key is not a canned tool', cmd: sampleRelay('toString'), expect: isUnsupported },
    { name: 'relay without tool_name fails', cmd: { type: 'mcp_tool_call' }, expect: isUnsupported },
    { name: 'reboot_machine (legacy command type) fails', cmd: { type: 'reboot_machine', status: 'pending' }, expect: isUnsupported },
    { name: 'cancel_mcp_tool fails', cmd: { type: 'cancel_mcp_tool', target_command_id: 'mcp_1_get_system_info' }, expect: isUnsupported },
    { name: 'malformed entry fails', cmd: null, expect: isUnsupported },
    { name: 'hold wins over a canned tool', cmd: sampleRelay('get_system_info'), hold: true, expect: (d) => d.action === 'hold' },
  ];

  let failures = 0;
  const check = (name, ok) => {
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  };

  console.log('[stub] dry run: no credentials read, nothing read from or written to Firestore');
  console.log(`  machine    ${MACHINE_PATH}`);
  console.log(`  hostname   ${hostname}`);
  console.log(`  log        ${logPath} (not touched)`);
  console.log(`  heartbeat  every ${HEARTBEAT_INTERVAL_MS / 1000} s`);
  console.log(`  doc        ${renderDoc(machineDoc(agentVersion))}`);

  for (const { name, cmd, hold = false, expect } of cases) {
    let ok;
    try {
      ok = expect(decide(cmd, { ...ctx, hold }));
    } catch {
      ok = false;
    }
    check(name, ok);
  }

  const completed = terminalEntry(sampleRelay('get_system_info'), decide(sampleRelay('get_system_info'), ctx));
  check(
    'completed entry: result string, status completed, completedAt, type',
    typeof completed.result === 'string' &&
      completed.status === 'completed' &&
      completed.completedAt instanceof FieldValue &&
      completed.type === 'mcp_tool_call' &&
      !('error' in completed),
  );
  const failed = terminalEntry(sampleRelay('run_powershell'), decide(sampleRelay('run_powershell'), ctx));
  check(
    'failed entry: error string, status failed, no result',
    typeof failed.error === 'string' && failed.status === 'failed' && !('result' in failed),
  );
  const line = logEntry('mcp_1_get_system_info', sampleRelay('get_system_info'), new Date(nowMs), 'complete');
  check(
    'log line: commandId, type, tool, chatId, receivedAt, action',
    JSON.stringify(Object.keys(line)) ===
      JSON.stringify(['commandId', 'type', 'tool', 'chatId', 'receivedAt', 'action']) &&
      line.tool === 'get_system_info' &&
      line.chatId === 'chat_dry_run',
  );

  const total = cases.length + 3;
  console.log(`[stub] self-check: ${total - failures}/${total} passed`);
  return failures === 0 ? 0 : 1;
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      nonce: { type: 'string' },
      log: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (!values.nonce || !NONCE_PATTERN.test(values.nonce)) throw new Error('--nonce must be 4-32 letters or digits');
  if (!values.log) throw new Error('--log <path> is required');
  return { nonce: values.nonce, logPath: path.resolve(values.log), dryRun: values['dry-run'] };
}

/** Resolves to an exit code for a run that ends by itself; a live stub exits from stop(). */
async function main(argv) {
  let options;
  try {
    options = parseCli(argv);
  } catch (err) {
    console.error(`[stub] ${errorMessage(err)}`);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  let agentVersion;
  try {
    agentVersion = readAgentVersion();
  } catch (err) {
    console.error(`[stub] ${errorMessage(err)}`);
    return 1;
  }
  if (options.dryRun) return selfCheck({ ...options, agentVersion });

  const stub = new StubAgent({ ...options, agentVersion });
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      if (stub.shutdown) {
        console.error(`[stub] ${signal} again: exiting without cleanup; ${TEARDOWN_HINT}`);
        process.exit(1);
      }
      void stub.stop(`received ${signal}`, 0);
    });
  }
  if (typeof process.send === 'function') {
    process.on('message', (message) => {
      if (message === 'shutdown') void stub.stop('shutdown requested over IPC', 0);
    });
    process.on('disconnect', () => void stub.stop('IPC channel closed', 0));
  }
  // Crashing out would strand an online machine doc; clean up like any other stop.
  process.on('uncaughtException', (err) => void stub.stop(`uncaught exception: ${errorMessage(err)}`, 1));
  process.on('unhandledRejection', (err) => void stub.stop(`unhandled rejection: ${errorMessage(err)}`, 1));

  stub.startup = stub.start();
  try {
    await stub.startup;
  } catch (err) {
    await stub.stop(`startup failed: ${errorMessage(err)}`, 1);
  }
  return null;
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  const normalize = (file) => {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(fileURLToPath(import.meta.url)) === normalize(process.argv[1]);
}

// No top-level await: it would make this an async module, which require() refuses
// (ERR_REQUIRE_ASYNC_MODULE), and Playwright loads TypeScript specs as CommonJS.
if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== null) process.exitCode = code;
    },
    (err) => {
      console.error(`[stub] ${errorMessage(err)}`);
      process.exitCode = 1;
    },
  );
}
