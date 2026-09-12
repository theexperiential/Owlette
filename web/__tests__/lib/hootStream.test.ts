/** @jest-environment node */

/**
 * The conversations API surface must not expose the follow-up tools: its chatId
 * is a `chat_conversations` id, and the follow-up sweep resolves `chats/{chatId}`,
 * so a follow-up scheduled there could never fire (fails closed at fire time).
 *
 * The site-mode suite below mocks the module boundary only — Firestore reads,
 * the llm and the AI SDK — so the dispatch decision this file owns (which
 * machines a site-wide turn relays tools to) runs for real.
 */

const mockVerifyUserSiteAccess = jest.fn();
const mockListSiteMachines = jest.fn();
const mockBuildExecutableTools = jest.fn();
const mockResolveLlmConfig = jest.fn();
const mockGetHootRequireTier3Approval = jest.fn();

jest.mock('@/lib/hoot-utils.server', () => ({
  __esModule: true,
  verifyUserSiteAccess: (...args: unknown[]) => mockVerifyUserSiteAccess(...args),
  resolveHootMaxTier: () => 3,
  listSiteMachines: (...args: unknown[]) => mockListSiteMachines(...args),
  isMachineOnline: jest.fn(),
  isHootEnabled: jest.fn(),
  getHootRequireTier3Approval: (...args: unknown[]) => mockGetHootRequireTier3Approval(...args),
  buildExecutableTools: (...args: unknown[]) => mockBuildExecutableTools(...args),
  resolveLlmConfig: (...args: unknown[]) => mockResolveLlmConfig(...args),
}));

jest.mock('@/lib/llm', () => ({
  __esModule: true,
  createModel: jest.fn(() => ({ modelId: 'stub' })),
  buildSystemPrompt: jest.fn(() => 'system prompt'),
}));

jest.mock('@/lib/hoot/advisor', () => ({
  __esModule: true,
  withAdvisor: jest.fn(() => ({ tools: {} })),
}));

jest.mock('ai', () => ({
  __esModule: true,
  streamText: jest.fn(() => ({ toUIMessageStreamResponse: () => new Response('') })),
  stepCountIs: jest.fn((count: number) => count),
}));

import type { Firestore } from 'firebase-admin/firestore';
import {
  conversationsToolDefs,
  runHootStream,
  SITE_TARGET_ID as REEXPORTED_SITE_TARGET_ID,
} from '@/lib/hootStream.server';
import { SITE_TARGET_ID } from '@/lib/hoot/target';
import { getToolsByTier } from '@/lib/mcp-tools';

const FOLLOWUP_TOOLS = ['schedule_followup', 'cancel_followup'];

describe('conversationsToolDefs', () => {
  it.each([1, 2, 3] as const)('withholds the follow-up tools at tier %d', (tier) => {
    const names = conversationsToolDefs(tier).map((def) => def.name);
    for (const tool of FOLLOWUP_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it('negative control: the unfiltered tier-1 list DOES carry both tools', () => {
    // If a rename ever empties the filter set, this fails before the filter
    // silently becomes a no-op.
    const names = getToolsByTier(1).map((def) => def.name);
    for (const tool of FOLLOWUP_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it('withholds ONLY the follow-up tools — everything else passes through', () => {
    const filtered = conversationsToolDefs(3).map((def) => def.name);
    const unfiltered = getToolsByTier(3).map((def) => def.name);
    expect(new Set([...filtered, ...FOLLOWUP_TOOLS])).toEqual(new Set(unfiltered));
    expect(unfiltered.length - filtered.length).toBe(FOLLOWUP_TOOLS.length);
  });
});

/**
 * The sentinel's VALUE is data at rest, not a free-floating constant: it is
 * already written into `chats/{id}.targetMachineId`, into `cortex-followups`
 * `machineId` and onto stream records. Editing the literal would strand every
 * document holding the old string, so the string itself is pinned here — every
 * other suite spells it `SITE_TARGET_ID` and stays green through a rename.
 */
describe('SITE_TARGET_ID', () => {
  it('is exactly the stored sentinel string', () => {
    expect(SITE_TARGET_ID).toBe('__site__');
  });

  it("hootStream.server's re-export is the same value, not a second copy", () => {
    // Both conversation routes import the sentinel from `hootStream.server`, so a
    // local redefinition there would split the site target in two.
    expect(REEXPORTED_SITE_TARGET_ID).toBe(SITE_TARGET_ID);
    expect(REEXPORTED_SITE_TARGET_ID).toBe('__site__');
  });
});

/**
 * The one carve-out from the public-API freeze (D-A, confirmed 2026-09-11): a
 * site-wide turn no longer relays tool calls to machines whose hoot kill switch
 * is off. The response shape is untouched — only which machines are dispatched
 * to — and `buildExecutableTools`' fan-out list is where that decision lands.
 */
describe('runHootStream site mode', () => {
  /** The tools builder's 7th positional argument: the fan-out machine list. */
  const FANOUT_ARG = 6;

  function machine(id: string, online: boolean, hootEnabled: boolean) {
    return { id, online, hootEnabled };
  }

  /**
   * `runSiteWideMode` reaches the tools builder a couple of awaits after
   * `runHootStream` resolves (the stream body is pumped lazily), so the
   * assertion has to let the microtask queue drain first.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  function send() {
    return runHootStream({
      db: {} as unknown as Firestore,
      userId: 'u1',
      siteId: 'site-a',
      machineId: SITE_TARGET_ID,
      machineName: 'site',
      messages: [],
      chatId: 'conv-1',
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyUserSiteAccess.mockResolvedValue({
      role: 'admin',
      siteRole: 'admin',
      isSuperadmin: false,
      isSiteAdmin: true,
      isSiteOwner: false,
    });
    mockResolveLlmConfig.mockResolvedValue({ provider: 'anthropic', apiKey: 'k', model: 'm' });
    mockGetHootRequireTier3Approval.mockResolvedValue(true);
    mockBuildExecutableTools.mockReturnValue({});
  });

  it('fans out only to machines that are online AND have hoot enabled', async () => {
    mockListSiteMachines.mockResolvedValue([
      machine('m1', true, true),
      machine('m2', true, false),
      machine('m3', false, true),
      machine('m4', true, true),
    ]);

    const result = await send();
    await settle();

    expect(result.ok).toBe(true);
    expect(mockBuildExecutableTools).toHaveBeenCalledTimes(1);
    expect(mockBuildExecutableTools.mock.calls[0][FANOUT_ARG]).toEqual(['m1', 'm4']);
  });

  it('refuses with 423 when every online machine has hoot switched off', async () => {
    // Not the 503 "nothing is online" copy: these machines ARE online, and the
    // fix is to turn hoot back on — which that message would hide. 423 is
    // already this operation's documented hoot-disabled status.
    mockListSiteMachines.mockResolvedValue([
      machine('m1', true, false),
      machine('m2', false, true),
    ]);

    const result = await send();

    expect(result).toEqual({
      ok: false,
      status: 423,
      error:
        'hoot is disabled on every online machine in this site. re-enable it from the hoot header to deliver tool calls.',
    });
    expect(mockBuildExecutableTools).not.toHaveBeenCalled();
  });

  it('still refuses with the unchanged 503 when nothing in the site is online', async () => {
    // Offline is classified first, so a sleeping site keeps the exact message
    // (and status) the public API has always returned.
    mockListSiteMachines.mockResolvedValue([
      machine('m1', false, true),
      machine('m2', false, false),
    ]);

    const result = await send();

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'no machines are currently online in this site.',
    });
    expect(mockBuildExecutableTools).not.toHaveBeenCalled();
  });

  it('reads the site once, not twice per machine', async () => {
    // The kill switch comes off the same listing as `online`; a per-machine
    // `isHootEnabled` pass would cost a document read per machine on a path
    // that already fans out one command each.
    mockListSiteMachines.mockResolvedValue([machine('m1', true, true)]);

    await send();
    await settle();

    expect(mockListSiteMachines).toHaveBeenCalledTimes(1);
  });
});
