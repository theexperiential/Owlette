import { test, expect, type Page } from '@playwright/test';
import { roleState } from '../../helpers/roles';
import { TEST_USERS } from '../../helpers/seed';
import {
  clearHootFixture,
  seedHootFixture,
} from '../../helpers/coverageSeed';

/**
 * Leave exactly one machine ticked, from whatever the picker started on, and
 * close the menu again.
 *
 * A row has two targets: its checkbox column toggles that machine within the
 * set, its NAME selects only it. Playwright clicks an element's centre, which
 * lands on the name, so ONE click gets there and needs no starting state — which
 * matters, because the ticked set persists as the user's site preference the
 * moment it changes, so the picker does not open on "all machines" a second
 * time (not on a CI retry, and not in a later test on the same account).
 *
 * Opening is conditional because selecting does NOT close the menu (picking a
 * set takes several clicks, so `onSelect` preventDefaults) — a second
 * unconditional click on the trigger would toggle an already-open menu shut.
 */
async function aimAtOnly(page: Page, machine: RegExp): Promise<void> {
  const row = page.getByRole('menuitemcheckbox', { name: machine });
  if (!(await row.isVisible())) {
    await page.getByLabel(/hoot target/i).click();
    await expect(row).toBeVisible();
  }
  await row.click();
  await page.keyboard.press('Escape');
  await expect(row).toBeHidden();
}

test.describe('hoot key guard', () => {
  test.use(roleState('member'));

  test('shows the no-key overlay and account-settings path', async ({ page }) => {
    await clearHootFixture(TEST_USERS.member.uid);
    await page.goto('/hoot');
    await expect(page.getByText(/hoot requires an LLM API key/i)).toBeVisible();
    await page.getByRole('button', { name: /open account settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('hoot conversations and controls', () => {
  test.use(roleState('admin'));

  test.beforeEach(async () => {
    await seedHootFixture({ userId: TEST_USERS.admin.uid });
  });

  test('loads, searches, renames, and deletes seeded conversations', async ({ page }) => {
    await page.goto('/hoot');
    await expect(page.getByText('Deployment triage')).toBeVisible();
    await expect(page.getByText('Nightly auto investigation')).toBeVisible();

    await page.getByText('Deployment triage').click();
    await expect(page.getByText(/installer exited with a retryable warning/i)).toBeVisible();
    await expect(page.getByText(/checkLogs/i)).toBeVisible();

    await page.getByRole('button', { name: /search conversations/i }).click();
    await page.getByPlaceholder(/search/i).fill('auto');
    await expect(page.getByText('Nightly auto investigation')).toBeVisible();
    await expect(page.getByText('Deployment triage')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByText('Deployment triage').hover();
    await page.getByRole('button', { name: /rename Deployment triage/i }).click();
    await page.locator('input').last().fill('Deployment RCA');
    await page.getByRole('button', { name: /save rename Deployment triage/i }).click();
    await expect(page.getByText('Deployment RCA')).toBeVisible();

    await page.getByText('Deployment RCA').hover();
    await page.getByRole('button', { name: /delete Deployment RCA/i }).click();
    await page.getByRole('button', { name: /confirm delete Deployment RCA/i }).click();
    await expect(page.getByText('Deployment RCA')).toHaveCount(0);
  });

  test('narrows the target to one machine and surfaces offline warnings', async ({ page }) => {
    await page.goto('/hoot');
    const target = page.getByLabel(/hoot target/i);
    await expect(target).toBeVisible();

    // One machine is what the per-machine controls — the power toggle, the
    // single-machine offline copy — render for, and a row's NAME is the way to
    // ask for exactly one.
    await aimAtOnly(page, /^e2e-cortex-machine/i);
    await expect(page.getByText(/hoot active/i)).toBeVisible();

    await aimAtOnly(page, /^e2e-cortex-offline/i);
    await expect(page.getByText(/machine is offline/i)).toBeVisible();
  });

  test('resizes the conversation sidebar and remembers the width and the collapsed state', async ({ page }) => {
    await page.goto('/hoot');

    const panel = page.getByTestId('hoot-conversation-panel');
    const handle = page.getByRole('separator', { name: /resize conversation list/i });
    const toggle = page.getByRole('button', { name: /hoot sidebar$/ });
    const hideSidebar = page.getByRole('button', { name: 'hide hoot sidebar' });
    const showSidebar = page.getByRole('button', { name: 'show hoot sidebar' });

    // Both prefs live on one per-user doc that outlives the page, so normalise
    // rather than assume the default — a retry would otherwise inherit the
    // previous attempt's state. Probing first would race the hydrating read
    // (which lands after the markup, carrying whatever the last attempt stored);
    // toggling first settles it, because a pref the user has set wins over that
    // read for the rest of the session.
    await toggle.click();
    await expect(async () => {
      if (await showSidebar.isVisible()) await toggle.click();
      await expect(handle).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await handle.dblclick();
    await expect(panel).toHaveCSS('width', '300px');

    // Drag the right edge 120px wider.
    const grip = await handle.boundingBox();
    if (!grip) throw new Error('resize handle has no bounding box');

    const startX = Math.round(grip.x + grip.width / 2);

    // Grab from the gutter beside the panel, never from inside it: on the panel's
    // inner edge the strip would cover the conversation list's scrollbar and take
    // the thumb's clicks.
    const panelBox = await panel.boundingBox();
    if (!panelBox) throw new Error('conversation panel has no bounding box');
    expect(startX).toBeGreaterThan(panelBox.x + panelBox.width);

    const y = Math.round(grip.y + grip.height / 2);
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 120, y, { steps: 8 });
    await page.mouse.up();

    await expect(panel).toHaveCSS('width', '420px');
    await expect(handle).toHaveAttribute('aria-valuenow', '420');

    // The pref write is debounced 400ms past the drag; reload once it has landed.
    await page.waitForTimeout(1_000);
    await page.reload();
    await expect(panel).toHaveCSS('width', '420px');

    // Collapsed state rides the same doc and survives a reload too — with no
    // edge to grab while the column is folded away.
    await hideSidebar.click();
    await expect(panel).toHaveCSS('width', '0px');
    await expect(handle).toHaveCount(0);

    await page.waitForTimeout(1_000);
    await page.reload();
    await expect(panel).toHaveCSS('width', '0px');
    await expect(handle).toHaveCount(0);

    // Leave the shared prefs doc as we found it for the specs that follow.
    await showSidebar.click();
    await expect(handle).toBeVisible();
    await handle.dblclick();
    await expect(panel).toHaveCSS('width', '300px');
    await page.waitForTimeout(1_000);
  });

  test('shows send error state when the Hoot API rejects a message', async ({ page }) => {
    await page.route('**/api/hoot', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'LLM unavailable in e2e' }),
      });
    });

    await page.goto('/hoot');
    // By accessible name: the placeholder names the chat's current target, so
    // it moves with the picker.
    await page.getByLabel('chat message').fill('summarize the latest issue');
    await page.getByRole('button', { name: /send message/i }).click();
    await expect(page.getByText(/LLM unavailable in e2e/i)).toBeVisible();
  });
});
