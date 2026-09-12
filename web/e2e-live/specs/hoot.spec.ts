/**
 * Live smoke: hoot on dev, answered by the stub agent (dev/active/live-smoke, Task 3.1).
 *
 * Three checks, each as smoke-siteadmin — admin of smoke-live, so tier-3 tools are on offer
 * (resolveHootMaxTier, web/lib/hoot-utils.server.ts) — in a new chat aimed at smoke-stub-01:
 *
 *   tool call  get_system_info relays to the stub, and hoot's answer carries the hostname the
 *              stub reports this run, smoke-<SMOKE_NONCE>. The runner's own record of what the
 *              turn dispatched (stream/current.toolCommands) names the command the stub completed.
 *   cancel     with the stub holding its commands, stop cancels the turn on the server:
 *              chats/{id}/stream/current ends 'cancelled', the composer is usable again, and the
 *              runner itself stops — the held command leaves commands/pending sooner than the
 *              tool's own timeout could take it out.
 *   tier-3     run_powershell pauses for a decision and only the control named deny is
 *              clicked; the call ends denied, neither turn records dispatching it, and no
 *              tier-3 command reaches the stub, which answers a canary to prove it was listening.
 *
 * Every assertion reads machine state — the POST /api/hoot body, the turn's stream doc, the
 * persisted chat, the stub's command log — never the model's wording. Each check opens /hoot
 * in its own page, which starts a new chat: a turn in an older chat can also answer a question
 * left unanswered there (seen on dev 2026-09-10), which would cross-contaminate the checks.
 */
import { randomBytes } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { getToolByName } from '../../lib/mcp-tools';
import { expect, readStubLog, smokeNonce, test, type StubLogEntry } from '../fixtures';
import { getDb } from '../lib/devAdmin.mjs';
import { PERSISTENT_USERS, SITE_ID, STUB_MACHINE_ID, hasLlmKey } from '../lib/seed.mjs';
import { setStubHold } from '../stub-agent.mjs';

const SITE_ADMIN_UID = PERSISTENT_USERS.siteadmin.uid;

// Each prompt names its tool, so the model's choice is not left to chance (plan.md, Risks).
const SYSTEM_INFO_PROMPT = 'Use your get_system_info tool on this machine and tell me its hostname.';
/** Tier 3 in web/lib/mcp-tools.ts and relayed to the agent as an mcp_tool_call. */
const TIER3_TOOL = 'run_powershell';
const TIER3_PROMPT = `Run \`Get-Date\` on this machine with the ${TIER3_TOOL} tool.`;

/** One turn with a tool relay: 15.6 s in the manual run on dev, 2026-09-10. */
const TURN_TIMEOUT_MS = 90_000;
/** The deny check waits on two turns: the one that asks, then the one the denial starts. */
const DENY_TEST_TIMEOUT_MS = 180_000;
/**
 * The page watches chats/{id}/stream/current, but the rules refuse that read until the runner
 * has created the chat doc, and a refused listener retries every 15 s (STREAM_RESUBSCRIBE_MS,
 * web/hooks/useHoot.ts). Two retries.
 */
const STREAM_ATTACH_TIMEOUT_MS = 30_000;
/** The runner marks a turn terminal first and persists the chat after (turnRunner.server.ts). */
const PERSIST_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;
const FIRESTORE_POLL_MS = 1_000;

/**
 * How the runner stops a cancelled turn: its heartbeat (HEARTBEAT_INTERVAL_MS in
 * web/lib/hoot/turnRunner.server.ts) finds the turn no longer running and aborts, and the tool's poll
 * loop then withdraws its command from commands/pending within one 1.5 s tick (executeToolOnAgent,
 * web/lib/hoot-utils.server.ts). Copied, not imported: both are server modules.
 */
const RUNNER_HEARTBEAT_MS = 20_000;
/** From the heartbeat to the withdrawal: the heartbeat's transaction, one poll tick, the delete. */
const ABORT_SLACK_MS = 4_000;
/** A relay's timeout when the tool names none (COMMAND_TIMEOUT_MS), and what executeToolOnAgent adds to it. */
const DEFAULT_TOOL_TIMEOUT_S = 30;
const TOOL_POLL_BUFFER_MS = 10_000;
/**
 * The tool's own timeout withdraws a command no sooner than its timeout plus the buffer after the
 * relay was written, which is before the stub logged it. Anything this much earlier is the abort:
 * the margin covers the stub's latency and clock skew between this machine and dev.
 */
const TIMEOUT_MARGIN_MS = 4_000;
const PENDING_POLL_MS = 500;
/** How long the stub may take to answer the canary command. */
const CANARY_TIMEOUT_MS = 15_000;

/** Set once this worker's cancel check has put the stub on hold; afterEach lifts the hold. */
let stubHeld = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function firestore(): Firestore {
  return getDb();
}

/** What the checks read off chats/{chatId}/stream/current (TurnStreamDoc, web/lib/hoot/turnStore.server.ts). */
interface TurnState {
  turnId: string;
  /** 'running', then 'complete', 'error' or 'cancelled'. */
  status: string;
  error: string | null;
}

async function readTurn(chatId: string): Promise<TurnState | null> {
  const data = (await firestore().doc(`chats/${chatId}/stream/current`).get()).data();
  if (!data) return null;
  return {
    turnId: typeof data.turnId === 'string' ? data.turnId : '(no turnId)',
    status: typeof data.status === 'string' ? data.status : '(no status)',
    error: typeof data.error === 'string' ? data.error : null,
  };
}

/**
 * A turn's status, with its error. The stored error is the provider's own message (errorText in
 * turnRunner.server.ts), and a provider can quote part of a rejected key, so anything
 * key-shaped is masked before it is printed.
 */
function describeTurn(turn: TurnState): string {
  return turn.error ? `${turn.status} (${turn.error.replace(/\bsk-[\w*.-]+/g, '<redacted>')})` : turn.status;
}

function expectCompleted(turn: TurnState, which: string): void {
  expect(turn.status, `the ${which} turn ended ${describeTurn(turn)}`).toBe('complete');
}

/** The chat's turn once it is terminal; `after` skips that turn, to reach the one a denial starts. */
async function waitForTurnEnd(chatId: string, after?: string): Promise<TurnState> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const turn = await readTurn(chatId);
    if (turn && turn.status !== 'running' && turn.turnId !== after) return turn;
    if (Date.now() >= deadline) {
      const seen = turn ? `last seen ${turn.turnId} ${describeTurn(turn)}` : 'no stream doc';
      throw new Error(
        `chats/${chatId}/stream/current: no ${after ? 'further ' : ''}turn ended within ${TURN_TIMEOUT_MS / 1000} s (${seen})`,
      );
    }
    await sleep(FIRESTORE_POLL_MS);
  }
}

/** A message part as the runner persists it into chats/{chatId}.messages (AI SDK UIMessage parts). */
interface PersistedPart {
  type?: unknown;
  text?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  state?: unknown;
  approval?: { approved?: unknown } | null;
}

interface PersistedToolPart extends PersistedPart {
  toolCallId: string;
}

interface PersistedMessage {
  role?: unknown;
  parts?: unknown;
}

async function readChatMessages(chatId: string): Promise<PersistedMessage[]> {
  const messages: unknown = (await firestore().doc(`chats/${chatId}`).get()).data()?.messages;
  return Array.isArray(messages) ? messages : [];
}

function partsOf(message: PersistedMessage): PersistedPart[] {
  return Array.isArray(message.parts) ? message.parts : [];
}

/** The text of the chat's last assistant message: hoot's answer. */
function lastAnswer(messages: PersistedMessage[]): string {
  const answer = messages.filter((message) => message.role === 'assistant').at(-1);
  if (!answer) return '';
  return partsOf(answer)
    .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    .join('\n');
}

/**
 * `hostname` as a whole token, case-insensitive as hostnames are. A bare substring match could
 * pass on a longer name holding it: SMOKE_NONCE=stub gives smoke-stub, which the machine id
 * smoke-stub-01 contains. Embedded unescaped: smokeNonce() allows only letters and digits.
 */
function hostnameToken(hostname: string): RegExp {
  return new RegExp(`(?<![\\w-])${hostname}(?![\\w-])`, 'i');
}

/** The chat's calls of one tool: static `tool-<name>` parts, or dynamic-tool parts naming it. */
function toolCalls(messages: PersistedMessage[], toolName: string): PersistedToolPart[] {
  return messages
    .flatMap(partsOf)
    .filter(
      (part): part is PersistedToolPart =>
        typeof part.toolCallId === 'string' &&
        (part.type === `tool-${toolName}` || (part.type === 'dynamic-tool' && part.toolName === toolName)),
    );
}

/** Denied as ChatWindow reads it: output-denied, or approval-responded with the request declined. */
function isDenied(part: PersistedPart): boolean {
  return part.state === 'output-denied' || (part.state === 'approval-responded' && part.approval?.approved === false);
}

/** The stub's log after its first `baseline` entries: the commands this check sent. */
function stubCommandsSince(baseline: number): StubLogEntry[] {
  return readStubLog().slice(baseline);
}

/**
 * A command for a tier-3 tool: a relay naming one, or a command whose type is one —
 * reboot_machine, shutdown_machine and cancel_reboot go out as their own command types
 * (EXISTING_COMMAND_MAPPINGS, web/lib/mcp-tools.ts).
 */
function isTier3Command(entry: StubLogEntry): boolean {
  const name = entry.tool ?? entry.type;
  return name !== null && getToolByName(name)?.tier === 3;
}

function stubPendingRef(): DocumentReference {
  return firestore().doc(`sites/${SITE_ID}/machines/${STUB_MACHINE_ID}/commands/pending`);
}

/** What the runner recorded dispatching in the chat's current turn: stream/current.toolCommands (turnStore.server.ts). */
interface DispatchRecord {
  turnId: string | null;
  commands: Array<{ toolCallId: string; machineId: string; commandId: string }>;
}

async function readDispatched(chatId: string): Promise<DispatchRecord> {
  const data = (await firestore().doc(`chats/${chatId}/stream/current`).get()).data();
  const commands: DispatchRecord['commands'] = [];
  // toolCallId → machineId → { commandId }, reset for every turn (acquireTurnLock).
  const byCall: unknown = data?.toolCommands;
  if (typeof byCall === 'object' && byCall !== null) {
    for (const [toolCallId, byMachine] of Object.entries(byCall)) {
      if (typeof byMachine !== 'object' || byMachine === null) continue;
      for (const [machineId, entry] of Object.entries(byMachine)) {
        const commandId: unknown = (entry as { commandId?: unknown } | null)?.commandId;
        if (typeof commandId === 'string') commands.push({ toolCallId, machineId, commandId });
      }
    }
  }
  return { turnId: typeof data?.turnId === 'string' ? data.turnId : null, commands };
}

/** Recorded dispatches of the given calls, or of the tier-3 tool by its command id (mcp_<ms>_<tool>). */
function tier3Dispatches(record: DispatchRecord, toolCallIds: string[]): DispatchRecord['commands'] {
  return record.commands.filter(
    (command) => toolCallIds.includes(command.toolCallId) || command.commandId.endsWith(`_${TIER3_TOOL}`),
  );
}

/**
 * "No tier-3 command in the stub log" only means something while the stub is listening. Send it a
 * command of a type it does not support, which it logs and fails like any other, and wait for it.
 */
async function expectStubListening(): Promise<void> {
  const commandId = `smoke_canary_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await stubPendingRef().set(
    { [commandId]: { type: 'smoke_canary', status: 'pending', timestamp: Date.now() } },
    { merge: true },
  );
  await expect
    .poll(() => readStubLog().some((entry) => entry.commandId === commandId && entry.action === 'fail'), {
      timeout: CANARY_TIMEOUT_MS,
      message: `${STUB_MACHINE_ID} failing a canary command, as it fails every command it does not support`,
    })
    .toBe(true);
}

/** A command the stub is holding, with the earliest moment the tool's own timeout could withdraw it. */
interface HeldCommand {
  commandId: string;
  /** When the stub logged it, on this machine's clock. */
  heldAtMs: number;
  /** Its timeout plus the poll buffer after it was held, less TIMEOUT_MARGIN_MS. */
  timeoutFloorMs: number;
}

/** Each held command's timeout, read off its relay, which is still in commands/pending. */
async function describeHeld(entries: StubLogEntry[]): Promise<HeldCommand[]> {
  const pending = (await stubPendingRef().get()).data() ?? {};
  return entries.map((entry) => {
    const relay = pending[entry.commandId] as { timeout_seconds?: unknown } | undefined;
    if (!relay) throw new Error(`the held command ${entry.commandId} left commands/pending before the stop`);
    const timeoutS = typeof relay.timeout_seconds === 'number' ? relay.timeout_seconds : DEFAULT_TOOL_TIMEOUT_S;
    const heldAtMs = Date.parse(entry.receivedAt);
    return {
      commandId: entry.commandId,
      heldAtMs,
      timeoutFloorMs: heldAtMs + timeoutS * 1000 + TOOL_POLL_BUFFER_MS - TIMEOUT_MARGIN_MS,
    };
  });
}

/**
 * Poll commands/pending until none of `commandIds` is left, resolving with a moment by which they
 * were gone, or with null once `deadlineMs` passes first — including a first read that finds them
 * gone only after it.
 */
async function watchWithdrawal(commandIds: string[], deadlineMs: number): Promise<number | null> {
  for (;;) {
    const pending = (await stubPendingRef().get()).data() ?? {};
    const readAtMs = Date.now();
    if (commandIds.every((id) => !Object.hasOwn(pending, id))) return readAtMs <= deadlineMs ? readAtMs : null;
    if (readAtMs >= deadlineMs) return null;
    await sleep(PENDING_POLL_MS);
  }
}

function isPostTo(pathname: string): (request: Request) => boolean {
  return (request) => request.method() === 'POST' && new URL(request.url()).pathname === pathname;
}

/** /hoot in a fresh page is a new chat. Aim it at the stub, which the picker must list online. */
async function openChatOnStub(page: Page): Promise<void> {
  await page.goto('/hoot');
  const target = page.getByRole('main').getByRole('button', { name: 'hoot target' });
  await target.click();
  const row = page.getByRole('menuitemcheckbox', { name: new RegExp(`^${STUB_MACHINE_ID}`) });
  await expect(row, `${STUB_MACHINE_ID} is not a hoot target; is the stub agent running?`).toBeVisible();
  // The picker's online rule is the dashboard's: the flag plus a heartbeat younger than 300 s.
  await expect(row, `${STUB_MACHINE_ID} is listed offline; its heartbeat stopped`).not.toContainText('offline');
  // D-A: a machine with hoot switched off is skipped at dispatch, so a turn aimed at one would
  // never reach the stub.
  await expect(row, `hoot is switched off on ${STUB_MACHINE_ID}`).not.toContainText('hoot off');
  // A row has two targets: its checkbox column toggles that machine within the set, its NAME
  // selects only it. Playwright clicks an element's centre, which lands on the name — so this is
  // one click and needs no starting state. That matters here: the ticked set is stored as this
  // user's site preference the moment it changes, this helper runs several times per run, and a
  // recipe that assumed the picker opened full aimed the second chat at a machine stranded by an
  // earlier run. AIMED_AT_STUB says what a single click leaves.
  await row.click();
  await page.keyboard.press('Escape');
  await expect(target).toContainText(new RegExp(`${STUB_MACHINE_ID}|all machines`));
}

/** The body POST /api/hoot carries (buildHootRequestBody, web/lib/hoot/requestBody.ts). */
interface HootRequestBody {
  chatId?: unknown;
  siteId?: unknown;
  machineId?: unknown;
  target?: { machineIds?: unknown; mentions?: unknown };
  messages?: unknown;
}

/**
 * The two shapes a chat aimed at the stub can send: the new target field, plus the legacy single
 * `machineId` an instance still running the old route would read.
 *
 * smoke-live holds exactly one machine, so ticking it IS "all machines" — a set covering the site
 * collapses back to the dynamic null (`normalizeSelection`), which the server resolves to that one
 * machine (`effectiveFanOut`, web/lib/hoot/target.ts). A site left holding a machine stranded by an
 * earlier run yields the explicit subset instead. Neither can reach anything but the stub — a
 * stranded machine has no agent, so it is offline and skipped — and neither widens: the legacy
 * field carries the sentinel only when the target really is every machine, and otherwise narrows
 * to one id.
 */
const AIMED_AT_STUB = [
  { machineIds: null, machineId: '__site__' },
  { machineIds: [STUB_MACHINE_ID], machineId: STUB_MACHINE_ID },
];

/**
 * Send `prompt` from the composer and return the id of the chat it went to. The request the
 * page made must target the stub in smoke-live and carry this prompt as the chat's only
 * question, so the turn has nothing older to answer as well.
 */
async function sendPrompt(page: Page, prompt: string): Promise<string> {
  const chat = page.getByRole('main');
  await chat.getByLabel('chat message').fill(prompt);
  const sent = page.waitForRequest(isPostTo('/api/hoot'));
  // Pending until awaited below: a click that throws first must not leave it to reject unhandled.
  sent.catch(() => undefined);
  await chat.getByRole('button', { name: 'send message' }).click();
  const request = await sent;

  const body = request.postDataJSON() as HootRequestBody;
  const questions = Array.isArray(body.messages)
    ? body.messages.filter((message: { role?: unknown } | null) => message?.role === 'user').length
    : 0;
  expect({ siteId: body.siteId, questions }, 'POST /api/hoot').toEqual({
    siteId: SITE_ID,
    questions: 1,
  });
  // A missing `target.machineIds` fails this rather than reading as "all machines": toEqual
  // treats an absent property as undefined, which matches neither shape.
  expect(AIMED_AT_STUB, 'POST /api/hoot target').toContainEqual({
    machineIds: body.target?.machineIds,
    machineId: body.machineId,
  });
  if (typeof body.chatId !== 'string' || body.chatId === '') {
    throw new Error('POST /api/hoot carried no chatId');
  }

  const response = await request.response();
  if (response?.status() !== 200) {
    // A refusal is a short JSON body ({ error }); a 200 is the turn's live stream, never read here.
    const detail = response ? (await response.text().catch(() => '')).slice(0, 300) : 'no response';
    throw new Error(`POST /api/hoot answered ${response?.status() ?? 'nothing'}: ${detail}`);
  }
  test.info().annotations.push({ type: 'hoot chat', description: body.chatId });
  return body.chatId;
}

test.describe('hoot on the stub machine', () => {
  test.beforeAll(async () => {
    if (!(await hasLlmKey(SITE_ADMIN_UID))) {
      throw new Error(
        `${SITE_ADMIN_UID} has no hoot LLM key (users/${SITE_ADMIN_UID}/settings/llm is missing), ` +
          'so none of the hoot checks can pass. Set SMOKE_LLM_API_KEY (plus SMOKE_LLM_PROVIDER=openai ' +
          'for an OpenAI key) and re-run: global setup stores it once, through POST /api/settings/llm-key.',
      );
    }
    // What run.mjs hands the run; fail here rather than halfway through a check.
    smokeNonce();
    readStubLog();
    // A worker that died mid-check can have left the stub holding.
    await setStubHold(false);
  });

  test.afterEach(async () => {
    if (!stubHeld) return;
    await setStubHold(false);
    stubHeld = false;
  });

  test('get_system_info relays to the stub and its hostname comes back in the answer', async ({
    siteAdminPage: page,
  }) => {
    const hostname = `smoke-${smokeNonce()}`;
    const hostnamePattern = hostnameToken(hostname);
    const chat = page.getByRole('main');
    const stop = chat.getByRole('button', { name: 'stop response' });

    await openChatOnStub(page);
    const baseline = readStubLog().length;
    const chatId = await sendPrompt(page, SYSTEM_INFO_PROMPT);
    await expect(stop).toBeVisible();
    expectCompleted(await waitForTurnEnd(chatId), 'tool-call');
    await expect(stop).toBeHidden();

    const commands = stubCommandsSince(baseline);
    expect(commands, `commands ${STUB_MACHINE_ID} logged`).toContainEqual(
      expect.objectContaining({ type: 'mcp_tool_call', tool: 'get_system_info', action: 'complete', chatId }),
    );
    // The runner's own record of what the turn dispatched names the command the stub completed: the
    // positive control for the deny check, which reads the same record for what must be absent.
    const relayed = commands
      .filter((entry) => entry.chatId === chatId && entry.tool === 'get_system_info' && entry.action === 'complete')
      .map((entry) => entry.commandId);
    const dispatched = await readDispatched(chatId);
    expect(
      dispatched.commands.filter((command) => command.machineId === STUB_MACHINE_ID).map((command) => command.commandId),
      `the turn's dispatches in chats/${chatId}/stream/current.toolCommands`,
    ).toEqual(expect.arrayContaining(relayed));
    await expect
      .poll(async () => lastAnswer(await readChatMessages(chatId)), {
        timeout: PERSIST_TIMEOUT_MS,
        intervals: [FIRESTORE_POLL_MS],
        message: `hoot's saved answer names the stub's hostname ${hostname}`,
      })
      .toMatch(hostnamePattern);
    await expect(chat.getByText(hostnamePattern).first(), 'the answer on screen').toBeVisible();
  });

  test('stop cancels a turn while the stub holds its tool call', async ({ siteAdminPage: page }) => {
    const chat = page.getByRole('main');
    const stop = chat.getByRole('button', { name: 'stop response' });

    await openChatOnStub(page);
    // The stub logs held commands and never answers them, so the turn stays in its tool poll.
    stubHeld = true;
    await setStubHold(true);
    const baseline = readStubLog().length;
    const chatId = await sendPrompt(page, SYSTEM_INFO_PROMPT);
    await expect(stop).toBeVisible();

    const holds = () =>
      stubCommandsSince(baseline).filter((entry) => entry.chatId === chatId && entry.action === 'hold');
    await expect
      .poll(() => holds().length, {
        timeout: TURN_TIMEOUT_MS,
        message: `a command from chat ${chatId} that ${STUB_MACHINE_ID} is holding`,
      })
      .toBeGreaterThan(0);
    const held = await readTurn(chatId);
    expect(held?.status, 'the turn while the stub holds its command').toBe('running');

    // stop() cancels on the server only once the page's stream listener has seen the turn
    // running (useHoot.ts); before that, the click just drops the page's own stream. The tool
    // card's cancel control renders from that same snapshot, so it marks the page ready.
    await expect(chat.getByTitle('cancel this tool call').first()).toBeVisible({
      timeout: STREAM_ATTACH_TIMEOUT_MS,
    });

    // Until this moment only the runner's abort can withdraw a held command: the stub never answers
    // one, and the tool's own timeout comes later.
    const heldCommands = await describeHeld(holds());
    const abortDeadlineMs = Math.min(...heldCommands.map((command) => command.timeoutFloorMs));

    const stopped = page.waitForResponse((response) => isPostTo('/api/hoot/stop')(response.request()));
    // Awaited after the checks below: one that fails first must not leave it to reject unhandled.
    stopped.catch(() => undefined);
    const stoppedAtMs = Date.now();
    await stop.click();
    // Watched from the click, so the page checks below cannot use up the window.
    const withdrawal = watchWithdrawal(
      heldCommands.map((command) => command.commandId),
      abortDeadlineMs,
    );
    withdrawal.catch(() => undefined);
    await expect(stop).toBeHidden({ timeout: STOP_TIMEOUT_MS });
    expect((await stopped).status(), 'POST /api/hoot/stop').toBe(200);
    await expect(chat.getByLabel('chat message')).toBeEditable();
    // Only the stop route writes 'cancelled' (app/api/hoot/stop/route.ts), for the turn it names.
    await expect
      .poll(() => readTurn(chatId), {
        timeout: STOP_TIMEOUT_MS,
        intervals: [FIRESTORE_POLL_MS],
        message: `chats/${chatId}/stream/current after stop`,
      })
      .toMatchObject({ turnId: held?.turnId, status: 'cancelled' });

    // That write, the 200 and the page's own state prove the route and the browser, not the server
    // turn: the page drops its stream whatever the route did. The runner stops at its next heartbeat,
    // and its tool poll then withdraws the held command.
    const withdrawnAtMs = await withdrawal;
    if (withdrawnAtMs === null) {
      const heldForS = ((stoppedAtMs - Math.min(...heldCommands.map((command) => command.heldAtMs))) / 1000).toFixed(1);
      const fairChance = abortDeadlineMs - stoppedAtMs >= RUNNER_HEARTBEAT_MS + ABORT_SLACK_MS;
      throw new Error(
        fairChance
          ? `the held command was still in ${STUB_MACHINE_ID}'s commands/pending ` +
              `${((abortDeadlineMs - stoppedAtMs) / 1000).toFixed(1)} s after the stop, more than a runner heartbeat: ` +
              'the cancelled turn never aborted its tool poll (turnRunner heartbeat → abort → executeToolOnAgent)'
          : `inconclusive: the stop landed ${heldForS} s into the hold, too late for the runner's next heartbeat ` +
              "to beat the tool's own timeout, so the abort could not be told apart from it (usually the page's " +
              'stream listener was slow to attach); nothing was proven either way',
      );
    }
    test.info().annotations.push({
      type: 'cancel',
      description: `held command withdrawn within ${((withdrawnAtMs - stoppedAtMs) / 1000).toFixed(1)} s of the stop`,
    });
    expect(
      stubCommandsSince(baseline).filter(
        (entry) => entry.chatId === chatId && Date.parse(entry.receivedAt) > stoppedAtMs,
      ),
      `commands chat ${chatId} sent ${STUB_MACHINE_ID} after the stop`,
    ).toEqual([]);
  });

  test('a denied run_powershell call never reaches the machine', async ({ siteAdminPage: page }) => {
    test.setTimeout(DENY_TEST_TIMEOUT_MS);
    expect(getToolByName(TIER3_TOOL)?.tier, `${TIER3_TOOL}'s tier in web/lib/mcp-tools.ts`).toBe(3);
    // Absent means a decision is required (getHootRequireTier3Approval); only an explicit false lifts it.
    const cortex = (await firestore().doc(`sites/${SITE_ID}/settings/cortex`).get()).data();
    expect(cortex?.requireTier3Approval, `sites/${SITE_ID}/settings/cortex switches the tier-3 gate off`).not.toBe(
      false,
    );

    const chat = page.getByRole('main');
    await openChatOnStub(page);
    const baseline = readStubLog().length;
    const chatId = await sendPrompt(page, TIER3_PROMPT);

    // A tier-3 call ends the turn that asks for it, with the call waiting for a decision.
    const asking = await waitForTurnEnd(chatId);
    expectCompleted(asking, 'asking');
    let askedIds: string[] = [];
    await expect
      .poll(
        async () => {
          askedIds = toolCalls(await readChatMessages(chatId), TIER3_TOOL)
            .filter((part) => part.state === 'approval-requested')
            .map((part) => part.toolCallId);
          return askedIds.length;
        },
        {
          timeout: PERSIST_TIMEOUT_MS,
          intervals: [FIRESTORE_POLL_MS],
          message: `a saved ${TIER3_TOOL} call waiting for a decision`,
        },
      )
      .toBeGreaterThan(0);
    // needsApproval pauses a tier-3 call before it runs: the asking turn's record of what it
    // dispatched must not hold one (the tool-call check proves the record is live).
    const askingDispatches = await readDispatched(chatId);
    expect(askingDispatches.turnId, 'the turn chats/{id}/stream/current holds after the asking turn').toBe(
      asking.turnId,
    );
    expect(tier3Dispatches(askingDispatches, askedIds), `${TIER3_TOOL} dispatches the asking turn recorded`).toEqual(
      [],
    );

    // A card's header button is named for its tool, tier and status.
    const cards = chat.getByRole('button', { name: TIER3_TOOL });
    await expect(cards.filter({ hasText: 'awaiting approval' })).toHaveCount(askedIds.length, {
      timeout: STREAM_ATTACH_TIMEOUT_MS,
    });

    // Deny every call waiting for a decision; the page sends the answers once none is left.
    const deny = chat.getByRole('button', { name: 'deny', exact: true });
    for (let waiting = await deny.count(); waiting > 0; waiting -= 1) {
      await deny.first().click();
      await expect(deny).toHaveCount(waiting - 1);
    }
    await expect(cards.filter({ hasText: 'denied' })).toHaveCount(askedIds.length);

    const resumed = await waitForTurnEnd(chatId, asking.turnId);
    expectCompleted(resumed, 'resumed');
    await expect
      .poll(
        async () => {
          const calls = toolCalls(await readChatMessages(chatId), TIER3_TOOL);
          return askedIds.map((id) => {
            const call = calls.find((part) => part.toolCallId === id);
            return call && isDenied(call) ? 'denied' : String(call?.state ?? 'missing');
          });
        },
        {
          timeout: PERSIST_TIMEOUT_MS,
          intervals: [FIRESTORE_POLL_MS],
          message: `the saved state of each denied ${TIER3_TOOL} call`,
        },
      )
      .toEqual(askedIds.map(() => 'denied'));

    // The turn the denial started is the one an approval would have run the call in.
    const resumedDispatches = await readDispatched(chatId);
    expect(resumedDispatches.turnId, 'the turn chats/{id}/stream/current holds after the resumed turn').toBe(
      resumed.turnId,
    );
    expect(tier3Dispatches(resumedDispatches, askedIds), `${TIER3_TOOL} dispatches the resumed turn recorded`).toEqual(
      [],
    );

    // The resumed turn has ended, so anything it dispatched is already in the log — provided the stub
    // was listening throughout.
    await expectStubListening();
    const commands = stubCommandsSince(baseline);
    expect(
      commands.filter((entry) => entry.tool === TIER3_TOOL),
      `${TIER3_TOOL} commands that reached ${STUB_MACHINE_ID}`,
    ).toEqual([]);
    expect(commands.filter(isTier3Command), `tier-3 commands that reached ${STUB_MACHINE_ID}`).toEqual([]);
  });
});
