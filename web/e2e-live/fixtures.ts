/**
 * Fixtures for the live smoke specs (playwright.live.config.ts). Import `test` and `expect` from
 * here, not from @playwright/test.
 *
 *   siteAdminPage  signed in as smoke-siteadmin (site admin of smoke-live), in its own context
 *   memberPage     signed in as smoke-member (member of smoke-live), in its own context
 *   page, context  Playwright's built-ins, signed out
 *
 * Each of those contexts is watched: a top-level navigation to any origin but DEV_ORIGIN closes
 * the page and fails the test. A context a spec builds itself with browser.newContext() is not
 * watched, so use `page` for a signed-out one.
 *
 * smokeNonce() and readStubLog() read what e2e-live/run.mjs hands the run: the nonce the stub
 * agent reports as hostname `smoke-<nonce>` (SMOKE_NONCE) and the stub's command log (STUB_LOG).
 */
import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { DEV_ORIGIN } from './lib/devAdmin.mjs';
import { authStatePath, describeUrl, type LoginRole } from './lib/harness';
import { readStubLog as parseStubLog } from './stub-agent.mjs';

export { expect } from '@playwright/test';

/** One line of the stub agent's command log (e2e-live/stub-agent.mjs). */
export interface StubLogEntry {
  commandId: string;
  type: string | null;
  /** The relayed tool of an mcp_tool_call; null for every other command type. */
  tool: string | null;
  /** The hoot chat a relay came from (its chat_id); null for a command that carries none. */
  chatId: string | null;
  /** ISO 8601, on this machine's clock. */
  receivedAt: string;
  /**
   * What the stub decided as the command arrived — receipt, not delivery. 'error': the stub could
   * not read its hold flag and left the command pending.
   */
  action: 'complete' | 'fail' | 'hold' | 'error';
  error?: string;
}

/** The stub agent's --nonce rule (NONCE_PATTERN in stub-agent.mjs). */
const NONCE_PATTERN = /^[A-Za-z0-9]{4,32}$/;

/**
 * Pages start at about:blank; a failed load commits chrome-error://, and its request was already
 * checked when it left.
 */
function isDevTopLevelUrl(url: string): boolean {
  if (url === 'about:blank' || url.startsWith('chrome-error://')) return true;
  try {
    return new URL(url).origin === DEV_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Watches every page of a context, present and future. A top-level navigation off DEV_ORIGIN is
 * recorded and its page closed, so the test cannot go on driving a foreign site; the fixture that
 * owns the context then fails the test through assertStayedOnDev().
 */
class NavigationGuard {
  private readonly departures = new Set<string>();

  constructor(context: BrowserContext) {
    for (const page of context.pages()) this.watch(page);
    context.on('page', (page) => this.watch(page));
  }

  assertStayedOnDev(): void {
    if (this.departures.size === 0) return;
    throw new Error(
      `navigation guard: a top-level navigation left ${DEV_ORIGIN} for ${[...this.departures].join(', ')} ` +
        'and the page was closed; the live smoke suite may only drive dev',
    );
  }

  private watch(page: Page): void {
    // The request is the first sighting and covers every redirect hop; framenavigated covers
    // navigations that make no request, such as data: URLs.
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) this.check(page, request.url());
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.check(page, frame.url());
    });
  }

  private check(page: Page, url: string): void {
    if (isDevTopLevelUrl(url)) return;
    this.departures.add(describeUrl(url));
    void page.close().catch(() => undefined);
  }
}

/**
 * A page in a fresh context restored from the role's saved state. A context created inside a test
 * takes the config's `use` options (baseURL, device, timeouts) and its trace and screenshot
 * recording, as the built-in one does.
 */
async function provideSignedInPage(
  browser: Browser,
  role: LoginRole,
  provide: (page: Page) => Promise<void>,
): Promise<void> {
  const statePath = authStatePath(role);
  if (!existsSync(statePath)) {
    throw new Error(`no signed-in state for ${role} at ${statePath}; global setup writes it before any spec runs`);
  }
  const context = await browser.newContext({ storageState: statePath });
  const guard = new NavigationGuard(context);
  try {
    await provide(await context.newPage());
  } finally {
    await context.close();
  }
  guard.assertStayedOnDev();
}

// The fixture callback is `provide`, not Playwright's usual `use`: react-hooks/rules-of-hooks
// takes any `use(...)` call for React's hook (as in e2e/desktop-sync/fixtures.ts).
export const test = base.extend<{ siteAdminPage: Page; memberPage: Page }>({
  context: async ({ context }, provide) => {
    const guard = new NavigationGuard(context);
    await provide(context);
    guard.assertStayedOnDev();
  },
  siteAdminPage: async ({ browser }, provide) => {
    await provideSignedInPage(browser, 'siteadmin', provide);
  },
  memberPage: async ({ browser }, provide) => {
    await provideSignedInPage(browser, 'member', provide);
  },
});

/** This run's nonce: the stub agent's get_system_info reports hostname `smoke-<nonce>`. */
export function smokeNonce(): string {
  const nonce = process.env.SMOKE_NONCE;
  if (!nonce) {
    throw new Error('SMOKE_NONCE is not set; e2e-live/run.mjs sets it when it starts the stub agent');
  }
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('SMOKE_NONCE must be 4-32 letters or digits, the stub agent --nonce rule');
  }
  return nonce;
}

/**
 * Every command the stub agent has logged this run, oldest first. Throws, rather than reading as
 * "no commands", when STUB_LOG is unset or its file is missing: either means no stub ran, and an
 * empty log would let a "nothing reached the machine" assertion pass vacuously.
 */
export function readStubLog(): StubLogEntry[] {
  const logPath = process.env.STUB_LOG;
  if (!logPath) {
    throw new Error('STUB_LOG is not set; e2e-live/run.mjs sets it when it starts the stub agent');
  }
  return parseStubLog(logPath);
}
