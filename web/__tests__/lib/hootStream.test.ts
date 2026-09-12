/** @jest-environment node */

/**
 * The conversations API surface must not expose the follow-up tools: its chatId
 * is a `chat_conversations` id, and the follow-up sweep resolves `chats/{chatId}`,
 * so a follow-up scheduled there could never fire (fails closed at fire time).
 */
import {
  conversationsToolDefs,
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
