/**
 * Sites — what each PER-SITE role is offered, end to end (wave 6.5).
 *
 * The suite was a role monoculture: most specs run `roleState('superadmin')`,
 * and superadmin returns true from `hasCapability` before the site is ever
 * considered. That is why two access regressions reached production — neither
 * was reachable by any test in the suite.
 *
 * These run as the two roles that actually have boundaries. `owner` is a global
 * `member` who owns a site, which is what every self-serve customer is
 * (`bootstrapUser.server.ts` creates them as `member`, and `POST /api/sites` has
 * no capability gate). `admin` administers a site it does not own.
 *
 * The line between them is exactly one capability: SITE_DELETE sits on the owner
 * row of `SiteRoleCapabilityMatrix` and nowhere else. Renaming is
 * SITE_MEMBER_MANAGE, which both hold. So an owner sees both controls, a site
 * admin sees only edit, and a plain member sees neither — the last of which is
 * covered by `delete-site-owner.spec.ts`.
 *
 * NON-DESTRUCTIVE by design: these assert what is OFFERED. Actually deleting a
 * site is covered by `delete-site-owner.spec.ts` against a site it seeds itself,
 * so nothing here can strip a baseline site out from under a later spec.
 */

import { test, expect, type Page } from '@playwright/test';
import { roleState } from '../../helpers/roles';
import { grantMembership, revokeMembership, TEST_USERS } from '../../helpers/seed';

/** Owned by the `owner` fixture in the baseline. */
const OWNED_SITE_ID = 'site-C';
const OWNED_SITE_NAME = 'Site C (Owned)';

async function openManageSitesDialog(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('site-switcher-trigger').click();
  await page.getByRole('menuitem', { name: /manage sites/i }).click();
  const dialog = page.getByRole('dialog', { name: /manage sites/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('per-site role — owner', () => {
  test.use(roleState('owner'));

  test('an owner is offered both edit and delete on the site they own', async ({ page }) => {
    const dialog = await openManageSitesDialog(page);

    await expect(dialog.getByRole('button', { name: `edit ${OWNED_SITE_NAME}` })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `delete ${OWNED_SITE_NAME}` })).toBeVisible();
  });

  test('the owner reaches the site despite a global role of member', async ({ page }) => {
    // The membership row is the entire grant. If this ever fails while the row
    // exists, something has started consulting the global role again.
    expect(TEST_USERS.owner.role).toBe('member');

    const dialog = await openManageSitesDialog(page);
    await expect(dialog.getByText(OWNED_SITE_NAME)).toBeVisible();
  });
});

test.describe('per-site role — site admin', () => {
  test.use(roleState('admin'));

  const ADMIN_UID = TEST_USERS.admin.uid;

  // The admin fixture does not hold site-C in the baseline. Borrow it, then hand
  // it back: a grant left behind makes site auto-selection prefer it for every
  // later spec, which is the contamination `releaseFixtureSite` exists for.
  test.beforeAll(async () => {
    await grantMembership(OWNED_SITE_ID, ADMIN_UID, 'admin');
  });

  test.afterAll(async () => {
    await revokeMembership(OWNED_SITE_ID, ADMIN_UID);
  });

  test('a site admin is offered edit but NOT delete', async ({ page }) => {
    const dialog = await openManageSitesDialog(page);

    // Renaming is SITE_MEMBER_MANAGE, which a site admin holds.
    await expect(dialog.getByRole('button', { name: `edit ${OWNED_SITE_NAME}` })).toBeVisible();
    // Destroying the site is not. This is the one capability separating the two
    // rows, and the reason SITE_DELETE is absent from SITE_ADMIN_CAPABILITIES.
    await expect(
      dialog.getByRole('button', { name: `delete ${OWNED_SITE_NAME}` })
    ).toHaveCount(0);
  });

  test('the same holds on every site it administers, not just the borrowed one', async ({
    page,
  }) => {
    // site-A is this fixture's own baseline site, owned by someone else. If the
    // delete gate were keyed on anything but ownership, the two sites would
    // disagree — which is what makes this worth asserting twice.
    const dialog = await openManageSitesDialog(page);

    await expect(dialog.getByRole('button', { name: 'edit Site A (Assigned)' })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'delete Site A (Assigned)' })
    ).toHaveCount(0);
  });
});
