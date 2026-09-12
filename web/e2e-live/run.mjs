/**
 * `npm run smoke:dev` — the live dev smoke suite, end to end (dev/active/live-smoke, Task 3.5).
 *
 *   1. Deploy check  git fetch origin dev, refuse unless this checkout's HEAD is that commit (the
 *                    specs that run must be the ones dev will serve), then poll
 *                    https://dev.owlette.app/api/health until it reports that commit and ok:true
 *                    (10 min). --any-commit skips git and only waits for ok:true.
 *   2. Stub agent    a fresh 8-hex-char nonce; stub-agent.mjs --nonce <n> --log .output/stub-log.jsonl;
 *                    wait for its IPC 'ready', then for sites/smoke-live/machines/smoke-stub-01 to read
 *                    online by the dashboard's rule (the flag plus a heartbeat under 300 s).
 *   3. Playwright    playwright test -c playwright.live.config.ts, stdio inherited, with SMOKE_NONCE,
 *                    STUB_LOG and the hoot LLM key in its environment. Its global setup seeds and signs
 *                    in; its global teardown removes what the run created.
 *   4. finally       stop the stub over IPC ('shutdown': on Windows child.kill('SIGINT') ends it without
 *                    running its handlers — see stub-agent.mjs), kill it by PID after 15 s (never by
 *                    image name). Once a stub that registered is gone, wait for the metrics_history
 *                    samples its last writes set off, then sweep with lib/seed.mjs teardown(). Print
 *                    a summary, exit with Playwright's code.
 *
 * Ctrl-C reaches every process in the console: Playwright stops and runs its global teardown, the
 * stub cleans up after itself, and this runner waits for both. A second Ctrl-C forces an exit and
 * leaves the cleanup to `node e2e-live/lib/seed.mjs --teardown`.
 *
 * The hoot LLM key: SMOKE_LLM_API_KEY from the environment, else from <repo>/.claude/.env.local
 * (SMOKE_LLM_ENV_FILE overrides the path; a worktree has no copy). It is handed to Playwright's
 * environment only — never printed, never written, never given to the stub agent.
 *
 * Exit codes: Playwright's when it ran (0 green, 1 failures, 130 interrupted); otherwise 1 when a
 * step before it failed, 130 when interrupted before it, 2 for bad arguments.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEV_ORIGIN, closeDevAdmin, getDb, getWebApiKey } from './lib/devAdmin.mjs';
import { SITE_ID, STUB_MACHINE_ID, teardown } from './lib/seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** web/e2e-live → web, the directory Playwright runs from. */
const WEB = path.resolve(HERE, '..');
const REPO = path.resolve(WEB, '..');

const CONFIG_FILE = 'playwright.live.config.ts';
const STUB_SCRIPT = path.join(HERE, 'stub-agent.mjs');
/** Beside Playwright's own output (playwright.live.config.ts), never inside results/, which it empties. */
const OUTPUT_DIR = path.join(HERE, '.output');
const STUB_LOG = path.join(OUTPUT_DIR, 'stub-log.jsonl');
/** The config's json reporter file; pinned through PLAYWRIGHT_JSON_OUTPUT_FILE, which outranks the config. */
const REPORT_JSON = path.join(OUTPUT_DIR, 'report.json');
const HEALTH_URL = `${DEV_ORIGIN}/api/health`;
const MACHINE_PATH = `sites/${SITE_ID}/machines/${STUB_MACHINE_ID}`;
const TEARDOWN_HINT = 'run `node e2e-live/lib/seed.mjs --teardown` from web/ to remove what this run left on dev';

const DEPLOY_TIMEOUT_MS = 10 * 60_000;
const HEALTH_POLL_MS = 10_000;
const HEALTH_REQUEST_TIMEOUT_MS = 10_000;
/** Reads of dev's commit after the specs, HEALTH_POLL_MS apart, before a mid-run deploy is unknowable. */
const POST_RUN_HEALTH_ATTEMPTS = 3;
const STUB_READY_TIMEOUT_MS = 60_000;
const STUB_ONLINE_TIMEOUT_MS = 15_000;
const STUB_ONLINE_POLL_MS = 1_000;
/** OFFLINE_HEARTBEAT_AGE_SEC in web/hooks/useFirestore.ts: the dashboard's and the hoot picker's offline rule. */
const OFFLINE_HEARTBEAT_AGE_MS = 300_000;
const STUB_STOP_TIMEOUT_MS = 15_000;
const STUB_KILL_WAIT_MS = 5_000;
/**
 * Every write to the stub's machine doc, down to its closing online:false, makes onMetricsWrite
 * (functions/src/metricsHistory.ts) sample into its metrics_history, and that write can land after
 * any delete. The final sweep waits this long for the ones in flight.
 */
const METRICS_SETTLE_MS = 10_000;
/**
 * Forwarded arguments that would escape the dev-only config or replace the reporter the summary
 * reads: these long options, alone or as --option=value, and any single-dash cluster holding the -c
 * short option (commander reads -c<file> and -xc <file> as --config too).
 */
const REFUSED_LONG_FLAGS = ['--config', '--reporter'];
const REFUSED_SHORT_FLAG = 'c';
/**
 * The suite's own files and the modules its specs import from the app and the emulator suite.
 * Uncommitted changes there mean a run is not testing the commit's specs.
 */
const SUITE_PATHS = [
  'web/e2e-live',
  'web/playwright.live.config.ts',
  'web/lib/mcp-tools.ts',
  'web/lib/hoot/shareTypes.ts',
  'web/e2e/helpers/webauthn.ts',
  'web/e2e/helpers/emulator.ts',
];
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
const EXIT_BAD_ARGS = 2;
const EXIT_INTERRUPTED = 130;
const LOG = '[smoke]';

const USAGE = 'usage: node e2e-live/run.mjs [--any-commit] [-- <playwright test args>]';
const HELP = `${USAGE}
       npm run smoke:dev [-- --any-commit] [-- <playwright test args>]

The live dev smoke suite against ${DEV_ORIGIN}: waits for dev to serve
origin/dev (which this checkout must be at), starts the stub agent
(${MACHINE_PATH}), runs ${CONFIG_FILE}, stops the stub,
sweeps, prints a summary and exits with Playwright's code.

  --any-commit   skip the deploy check (no git): test whatever dev serves
  -h, --help     show this text; reads no credentials and touches no Firestore
  -- <args>      passed to \`playwright test\`, e.g. -- --grep share
                 (${REFUSED_LONG_FLAGS.join(', ')} and any -${REFUSED_SHORT_FLAG} short option are refused)

Environment
  SMOKE_SA_PATH        dev service account
                       (default <repo>/agent/config/firebase-creds-dev.json)
  SMOKE_ENV_FILE       web env file holding the dev web API key
                       (default <repo>/web/.env.local)
  SMOKE_LLM_API_KEY    hoot LLM key; global setup stores it for smoke-siteadmin
                       once, when none is stored
  SMOKE_LLM_PROVIDER   anthropic (default) or openai
  SMOKE_LLM_ENV_FILE   where both are read from when SMOKE_LLM_API_KEY is unset
                       (default <repo>/.claude/.env.local)
  SMOKE_LLM_REPLACE_KEY
                       1: replace the stored key with SMOKE_LLM_API_KEY, through
                       the app (environment only; set it for one run)

Outputs in e2e-live/.output/: report/ (html), report.json, results/ (traces), stub-log.jsonl.`;

/** Aborted by the first Ctrl-C; the waits before Playwright starts give up on it. */
const interrupt = new AbortController();
let signalsSeen = 0;
/** Children to kill by PID on a forced exit. */
const liveChildren = new Set();

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 8) : String(sha);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function minutes(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** Resolves after `ms` with null; the timer is cleared as soon as the race it joins settles. */
function within(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, null);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function onSignal(signal) {
  signalsSeen += 1;
  if (signalsSeen === 1) {
    console.error(
      `\n${LOG} ${signal}: waiting for Playwright's global teardown and the stub agent's cleanup (again to force)`,
    );
    interrupt.abort(new Error(`interrupted (${signal})`));
    return;
  }
  console.error(`\n${LOG} ${signal} again: forcing an exit without cleanup; ${TEARDOWN_HINT}`);
  for (const child of liveChildren) child.kill('SIGKILL');
  process.exit(EXIT_INTERRUPTED);
}

/** `{ code, signal, error }` once the child is gone. An 'error' counts only when it never spawned. */
function trackExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal, error: null }));
    child.on('error', (error) => {
      if (child.pid === undefined) resolve({ code: null, signal: null, error });
    });
  });
}

function describeExit({ code, signal, error }) {
  if (error) return `failed to start (${error.message})`;
  return signal ? `was killed by ${signal}` : `exited with code ${code}`;
}

// ---- arguments ---------------------------------------------------------------------------------

/** Whether a forwarded argument could name another config or reporter. Also refuses a -g<pattern> holding a c. */
function isRefusedForwardedArg(arg) {
  if (REFUSED_LONG_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) return true;
  // -c, -c<file>, -c=<file>, -xc: one dash, then a cluster of short options that includes c.
  return /^-[^-]/.test(arg) && arg.slice(1).includes(REFUSED_SHORT_FLAG);
}

function parseCli(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const forwarded = separator === -1 ? [] : argv.slice(separator + 1);
  const { values } = parseArgs({
    args: own,
    options: {
      'any-commit': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const refused = forwarded.find(isRefusedForwardedArg);
  if (refused) {
    throw new Error(
      `${refused} cannot be passed to playwright test here: it could name another config or reporter ` +
        `(${REFUSED_LONG_FLAGS.join(', ')} and any short-option cluster holding -${REFUSED_SHORT_FLAG} are ` +
        'refused; give a grep pattern as --grep <pattern>)',
    );
  }
  return { anyCommit: values['any-commit'], help: values.help, forwarded };
}

// ---- 1. deploy check ---------------------------------------------------------------------------

function resolveTargetCommit() {
  console.log(`${LOG} git fetch origin dev`);
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'dev'], { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    throw new Error('git fetch origin dev failed (its output is above); fix that, or pass --any-commit');
  }
  const sha = revParse('origin/dev^{commit}');
  if (sha === null) throw new Error('origin/dev does not resolve to a commit after the fetch');
  // The deploy check proves dev serves origin/dev; the specs are this checkout's, so it must be there too.
  const head = revParse('HEAD^{commit}');
  if (head !== sha) {
    throw new Error(
      `this checkout is at ${head === null ? 'no commit' : shortSha(head)} and origin/dev at ${shortSha(sha)}: ` +
        'the specs that run must be the ones dev will serve. Bring it to origin/dev (git pull --ff-only origin dev), ' +
        'or pass --any-commit for a run that never counts for the release gate',
    );
  }
  return sha;
}

/** The full SHA `ref` names in this checkout, or null when it names none. */
function revParse(ref) {
  let sha = '';
  try {
    sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** How many uncommitted changes, untracked files included, git reports under SUITE_PATHS. */
function countSuiteChanges() {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain', '--', ...SUITE_PATHS], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch {
    throw new Error('git status failed (its output is above); fix that, or pass --any-commit');
  }
  return out.split('\n').filter((line) => line.trim() !== '').length;
}

function describeSuiteChanges(count) {
  return (
    `${count} uncommitted change(s) under ${SUITE_PATHS.join(' or ')}: the specs that ran are not the ` +
    "commit's, so this run cannot count for the release gate"
  );
}

/** One read of dev's /api/health: `{ reachable: false, detail }` or what the body says. */
async function readHealth(signal) {
  let res;
  try {
    res = await fetch(HEALTH_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)]),
    });
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    return { reachable: false, detail: errorMessage(err) };
  }
  const body = await res.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { reachable: false, detail: `HTTP ${res.status} with no JSON body` };
  }
  return {
    reachable: true,
    status: res.status,
    healthy: res.ok && body.ok === true,
    hasCommitField: Object.hasOwn(body, 'commit'),
    commit: typeof body.commit === 'string' && body.commit !== '' ? body.commit : null,
  };
}

function deployReady(health, target) {
  return health.reachable && health.healthy && (target === null || health.commit === target);
}

/** Why dev is not ready yet, in words a person can act on. */
function describeNotReady(health, target) {
  if (!health.reachable) return `GET ${HEALTH_URL} failed: ${health.detail}; retrying`;
  if (!health.healthy) return `${HEALTH_URL} answered ${health.status} with ok:false (dev cannot reach Firestore); waiting`;
  if (!health.hasCommitField) {
    return (
      `${HEALTH_URL} has no commit field: Task 1.1 (web/app/api/health/route.ts) is not deployed on dev yet. ` +
      'Waiting in case a deploy that adds it is in flight; Ctrl-C and re-run with --any-commit to skip the check'
    );
  }
  if (health.commit === null) {
    return (
      `${HEALTH_URL} reports commit: null, so the running deploy carries no git SHA (Railway sets ` +
      'RAILWAY_GIT_COMMIT_SHA only for GitHub-triggered deploys). Waiting for one that does; --any-commit skips the check'
    );
  }
  return `dev serves ${shortSha(health.commit)}; waiting for origin/dev ${shortSha(target)} to deploy`;
}

/** Poll until dev is healthy and, unless `target` is null, serves `target`. Returns the last health read. */
async function waitForDeploy(target, signal) {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  let lastNote = null;
  for (;;) {
    const health = await readHealth(signal);
    if (deployReady(health, target)) return health;
    const note = describeNotReady(health, target);
    if (note !== lastNote) console.log(`${LOG} ${note}`);
    lastNote = note;
    if (Date.now() >= deadline) {
      throw new Error(`dev was not ready within ${DEPLOY_TIMEOUT_MS / 60_000} min. Last check: ${note}`);
    }
    await delay(HEALTH_POLL_MS, undefined, { signal });
  }
}

/**
 * The commit dev serves once the specs are done (null when it reports none), read up to
 * POST_RUN_HEALTH_ATTEMPTS times; undefined when dev never answered.
 */
async function readCommitAfterRun(signal) {
  for (let attempt = 1; attempt <= POST_RUN_HEALTH_ATTEMPTS; attempt += 1) {
    const health = await readHealth(AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)).catch(() => null);
    if (health?.reachable) return health.commit ?? null;
    if (attempt < POST_RUN_HEALTH_ATTEMPTS) await delay(HEALTH_POLL_MS, undefined, { signal });
  }
  return undefined;
}

// ---- credentials and the LLM key ---------------------------------------------------------------

/** Fail on a missing or non-dev credential now, not after a ten-minute deploy wait. Reads files only. */
function checkCredentials() {
  getDb();
  getWebApiKey();
}

/** One `NAME=value` line of an env file (an `export ` prefix and surrounding quotes allowed); null when absent. */
function readEnvValue(text, name) {
  const match = text.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`, 'm'));
  if (!match) return null;
  const raw = match[1];
  const value = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  return value || null;
}

/**
 * The hoot LLM variables for Playwright's environment: `{ env, source }`. The environment wins;
 * otherwise the file supplies SMOKE_LLM_API_KEY and, unless the environment sets one, its provider.
 * Nothing read here is printed.
 */
function resolveLlmEnv() {
  if (process.env.SMOKE_LLM_API_KEY?.trim()) return { env: {}, source: 'the environment' };
  const file = path.resolve(process.env.SMOKE_LLM_ENV_FILE || path.join(REPO, '.claude', '.env.local'));
  if (!existsSync(file)) return { env: {}, source: null, file };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`could not read ${file}`);
  }
  const value = readEnvValue(text, 'SMOKE_LLM_API_KEY');
  if (!value) return { env: {}, source: null, file };
  const env = { SMOKE_LLM_API_KEY: value };
  const provider = process.env.SMOKE_LLM_PROVIDER?.trim() ? null : readEnvValue(text, 'SMOKE_LLM_PROVIDER');
  if (provider) env.SMOKE_LLM_PROVIDER = provider;
  return { env, source: file };
}

// ---- 2. stub agent -----------------------------------------------------------------------------

/** 8 hex characters from the CSPRNG: the stub agent's --nonce and the hostname it reports, smoke-<nonce>. */
function newNonce() {
  return randomBytes(4).toString('hex');
}

function startStub(nonce) {
  // The LLM key belongs to Playwright's global setup alone, even when it came in from the environment.
  const env = { ...process.env };
  delete env.SMOKE_LLM_API_KEY;
  const child = spawn(process.execPath, [STUB_SCRIPT, '--nonce', nonce, '--log', STUB_LOG], {
    cwd: WEB,
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  liveChildren.add(child);
  const exited = trackExit(child).then((exit) => {
    liveChildren.delete(child);
    return exit;
  });
  return { child, exited, ready: false };
}

/** Resolves on the stub's `{ type: 'ready' }` IPC message: it has registered the machine and is listening. */
function waitForStubReady(stub, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stub.child.off('message', onMessage);
      signal.removeEventListener('abort', onAbort);
      settle(value);
    };
    const onMessage = (message) => {
      if (message?.type === 'ready') finish(resolve);
    };
    const onAbort = () => finish(reject, signal.reason);
    const timer = setTimeout(
      () => finish(reject, new Error(`the stub agent did not report ready within ${STUB_READY_TIMEOUT_MS / 1000} s`)),
      STUB_READY_TIMEOUT_MS,
    );
    stub.child.on('message', onMessage);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    stub.exited.then((exit) =>
      finish(reject, new Error(`the stub agent ${describeExit(exit)} before it was ready (its output is above)`)),
    );
  });
}

/** The machine doc must read online the way the dashboard and the hoot target picker read it. */
async function waitForStubOnline(signal) {
  const ref = getDb().collection('sites').doc(SITE_ID).collection('machines').doc(STUB_MACHINE_ID);
  const deadline = Date.now() + STUB_ONLINE_TIMEOUT_MS;
  for (;;) {
    const data = (await ref.get()).data();
    const beatMs = typeof data?.lastHeartbeat?.toMillis === 'function' ? data.lastHeartbeat.toMillis() : null;
    const ageMs = beatMs === null ? null : Date.now() - beatMs;
    if (data?.online === true && ageMs !== null && ageMs < OFFLINE_HEARTBEAT_AGE_MS) return;
    if (Date.now() >= deadline) {
      const state = data
        ? `online=${String(data.online)}, heartbeat ${ageMs === null ? 'missing' : `${Math.round(ageMs / 1000)} s old`}`
        : 'no document';
      throw new Error(`${MACHINE_PATH} does not read online after ${STUB_ONLINE_TIMEOUT_MS / 1000} s (${state})`);
    }
    await delay(STUB_ONLINE_POLL_MS, undefined, { signal });
  }
}

/** Ask the stub to stop, wait up to 15 s, then kill it by PID. `{ code, signal, error, forced }`. */
async function stopStub(stub) {
  const { child } = stub;
  if (child.exitCode === null && child.signalCode === null && child.connected) {
    // A failed send means the channel is already gone, and the stub stops on 'disconnect'.
    child.send('shutdown', () => undefined);
  }
  const exit = await within(stub.exited, STUB_STOP_TIMEOUT_MS);
  if (exit) return { ...exit, forced: false };
  console.error(`${LOG} the stub agent did not exit ${STUB_STOP_TIMEOUT_MS / 1000} s after 'shutdown'; killing PID ${child.pid}`);
  child.kill('SIGKILL');
  const killed = await within(stub.exited, STUB_KILL_WAIT_MS);
  return { ...(killed ?? { code: null, signal: null, error: null }), forced: true };
}

/**
 * The run's last pass over dev, once the stub is gone. Playwright's global teardown sweeps while the
 * stub still heartbeats, and the stub's own cleanup ends with a write, so metrics_history samples can
 * land after both. This also covers a stub that did not stop cleanly and a run whose global teardown
 * never ran. Returns the summary's `sweep` text; a clean run finds nothing.
 */
async function finalSweep(stubStop) {
  const clean = !stubStop.forced && stubStop.code === 0;
  console.log(
    `${LOG} ${clean ? 'the stub agent stopped' : 'the stub agent did not stop cleanly'}; ` +
      `sweeping with lib/seed.mjs teardown() in ${METRICS_SETTLE_MS / 1000} s`,
  );
  await delay(METRICS_SETTLE_MS);
  try {
    const { counts, total } = await teardown();
    if (total === 0) return 'teardown() after the stub stopped: nothing left';
    const left = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([label, n]) => `${label} ${n}`)
      .join(', ');
    return `teardown() after the stub stopped removed ${total}: ${left}`;
  } catch (err) {
    return `teardown() failed: ${errorMessage(err)}; ${TEARDOWN_HINT}`;
  }
}

// ---- 3. playwright -----------------------------------------------------------------------------

/** Playwright's CLI under this node, not `npx`: no shell, and the PID is Playwright's own. */
async function runPlaywright(env, forwarded) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [cli, 'test', '-c', CONFIG_FILE, ...forwarded], {
    cwd: WEB,
    env,
    stdio: 'inherit',
  });
  liveChildren.add(child);
  try {
    return await trackExit(child);
  } finally {
    liveChildren.delete(child);
  }
}

// ---- summary -----------------------------------------------------------------------------------

function readReport() {
  try {
    return JSON.parse(readFileSync(REPORT_JSON, 'utf8'));
  } catch {
    return null;
  }
}

/** One row per test and project, titled by its describe blocks; the file suite's own title is the path. */
function reportRows(report) {
  const rows = [];
  const walk = (suite, titles, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        rows.push({
          file: spec.file ?? file,
          title: [...titles, spec.title].join(' > '),
          project: test.projectName,
          status: test.status,
          results: test.results ?? [],
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title], child.file ?? file);
  };
  for (const suite of report.suites ?? []) walk(suite, [], suite.file);
  return rows;
}

function rowLabel(row) {
  if (row.results.at(-1)?.status === 'interrupted') return 'INTERRUPTED';
  if (row.status === 'expected') return 'PASS';
  if (row.status === 'flaky') return 'FLAKY';
  if (row.status === 'unexpected') return 'FAIL';
  if (row.status === 'skipped') return row.results.length === 0 ? 'NOT RUN' : 'SKIP';
  return String(row.status).toUpperCase();
}

function printResults(report) {
  const rows = reportRows(report);
  const projects = new Set(rows.map((row) => row.project));
  let file = null;
  for (const row of rows) {
    if (row.file !== file) {
      file = row.file;
      console.log(`  ${file}`);
    }
    const tookMs = row.results.reduce((sum, result) => sum + (result.duration ?? 0), 0);
    const retry = row.status === 'flaky' ? `, passed on retry ${row.results.at(-1)?.retry ?? '?'}` : '';
    const project = projects.size > 1 ? ` [${row.project}]` : '';
    console.log(`    ${rowLabel(row).padEnd(11)} ${row.title}${project} (${seconds(tookMs)}${retry})`);
  }
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};
  console.log(`  totals     ${expected} passed, ${flaky} flaky, ${unexpected} failed, ${skipped} skipped`);
  const errors = Array.isArray(report.errors) ? report.errors.length : 0;
  if (errors > 0) console.log(`  run errors ${errors} outside any test (global setup or teardown); printed above`);
}

function printSummary(run) {
  const line = (label, text) => console.log(`  ${label.padEnd(10)} ${text}`);
  console.log(`\n${LOG} summary`);
  // servedAtStart: undefined until the deploy check passes, then the commit dev reported (or null).
  if (run.target) {
    const served = run.servedAtStart === run.target ? 'dev served it when the specs started' : 'the run stopped before dev served it';
    line('commit', `${run.target} (origin/dev; ${served})`);
  } else if (run.anyCommit) {
    const served = run.servedAtStart === undefined ? 'dev not checked' : (run.servedAtStart ?? 'dev reports no commit');
    line('commit', `${served} (--any-commit: not compared with origin/dev)`);
  } else {
    line('commit', 'not determined');
  }
  if (run.servedAtEnd !== undefined && run.servedAtEnd !== run.servedAtStart) {
    const change = `dev served ${shortSha(run.servedAtStart)} when the specs started and ${shortSha(run.servedAtEnd)} after`;
    line('WARNING', `${change}: a deploy landed mid-run, so these results mix two builds`);
  }
  if (run.endCommitUnknown) {
    line('WARNING', "dev's commit could not be re-read after the specs, so a mid-run deploy cannot be ruled out");
  }
  if (run.suiteChanges > 0) line('WARNING', describeSuiteChanges(run.suiteChanges));
  if (run.forwarded?.length > 0) {
    line(
      'WARNING',
      `Playwright arguments were forwarded (${run.forwarded.join(' ')}): only a run without them counts for the release gate`,
    );
  }
  if (run.nonce) line('nonce', `${run.nonce} (stub hostname smoke-${run.nonce})`);
  const phases = Object.entries(run.phaseMs).map(([name, ms]) => `${name} ${minutes(ms)}`);
  line('duration', `${minutes(Date.now() - run.startedMs)}${phases.length > 0 ? ` (${phases.join(', ')})` : ''}`);
  if (run.llmKeySource) line('LLM key', `SMOKE_LLM_API_KEY from ${run.llmKeySource}`);

  if (!run.playwright) {
    line('specs', `not run: ${run.failure ?? 'stopped before Playwright'}`);
  } else {
    const report = readReport();
    if (report) printResults(report);
    else line('specs', `no JSON report at ${REPORT_JSON} (Playwright ended before writing one)`);
    line('playwright', describeExit(run.playwright));
  }
  if (run.stubStop) {
    const { forced } = run.stubStop;
    line('stub', forced ? 'killed by PID after it ignored shutdown' : `stub agent ${describeExit(run.stubStop)}`);
  }
  if (run.sweep) line('sweep', run.sweep);
  if (run.failure && run.playwright) line('error', run.failure);
  line('exit', String(run.exitCode));
}

// ---- main --------------------------------------------------------------------------------------

async function main(argv) {
  let options;
  try {
    options = parseCli(argv);
  } catch (err) {
    console.error(`${LOG} ${errorMessage(err)}`);
    console.error(USAGE);
    return EXIT_BAD_ARGS;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  for (const signal of SIGNALS) process.on(signal, () => onSignal(signal));

  const run = {
    anyCommit: options.anyCommit,
    forwarded: options.forwarded,
    startedMs: Date.now(),
    phaseMs: {},
    exitCode: 1,
  };
  const timePhase = async (name, fn) => {
    const startedMs = Date.now();
    try {
      return await fn();
    } finally {
      run.phaseMs[name] = Date.now() - startedMs;
    }
  };
  let stub = null;
  try {
    checkCredentials();
    const llm = resolveLlmEnv();
    run.llmKeySource = llm.source;
    if (!llm.source) {
      console.log(
        `${LOG} SMOKE_LLM_API_KEY is not set (nor in ${llm.file}); the hoot checks need the key already stored for smoke-siteadmin`,
      );
    }

    run.target = options.anyCommit ? null : resolveTargetCommit();
    if (run.target) {
      run.suiteChanges = countSuiteChanges();
      if (run.suiteChanges > 0) console.warn(`${LOG} WARNING: ${describeSuiteChanges(run.suiteChanges)}`);
    }
    console.log(
      run.target
        ? `${LOG} waiting for ${DEV_ORIGIN} to serve origin/dev ${run.target}`
        : `${LOG} --any-commit: waiting only for ${DEV_ORIGIN} to answer healthy`,
    );
    const health = await timePhase('deploy wait', () => waitForDeploy(run.target, interrupt.signal));
    run.servedAtStart = health.commit;
    console.log(`${LOG} dev is healthy and serves ${health.commit ?? '(no commit reported)'}`);

    run.nonce = newNonce();
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const started = startStub(run.nonce);
    stub = started;
    await timePhase('stub start', async () => {
      await waitForStubReady(started, interrupt.signal);
      started.ready = true;
      await waitForStubOnline(interrupt.signal);
    });
    await closeDevAdmin();
    console.log(`${LOG} ${MACHINE_PATH} reads online; starting Playwright`);

    rmSync(REPORT_JSON, { force: true });
    const env = {
      ...process.env,
      ...llm.env,
      SMOKE_NONCE: run.nonce,
      STUB_LOG,
      PLAYWRIGHT_JSON_OUTPUT_FILE: REPORT_JSON,
    };
    run.playwright = await timePhase('playwright', () => runPlaywright(env, options.forwarded));
    if (run.playwright.error) throw new Error(`Playwright ${describeExit(run.playwright)}`);
    run.exitCode = run.playwright.code ?? 1;

    const servedAtEnd = await readCommitAfterRun(interrupt.signal);
    if (servedAtEnd === undefined) run.endCommitUnknown = true;
    else run.servedAtEnd = servedAtEnd;
  } catch (err) {
    run.failure = interrupt.signal.aborted ? 'interrupted' : errorMessage(err);
    // Nothing after Playwright's exit throws, so this only runs when it never produced a code.
    if (typeof run.playwright?.code !== 'number') run.exitCode = interrupt.signal.aborted ? EXIT_INTERRUPTED : 1;
    console.error(`${LOG} ${run.failure}`);
  } finally {
    if (stub) {
      run.stubStop = await stopStub(stub);
      // Only a stub that registered can have left anything; one refused at startup (another run's
      // stub is live) must not trigger a sweep of that run's data.
      if (stub.ready) run.sweep = await finalSweep(run.stubStop);
    }
    await closeDevAdmin().catch(() => undefined);
    printSummary(run);
  }
  return run.exitCode;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`${LOG} ${errorMessage(err)}`);
    process.exitCode = 1;
  },
);
