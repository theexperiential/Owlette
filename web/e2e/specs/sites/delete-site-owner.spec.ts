/**
 * Sites — delete as the role a real self-serve customer actually has.
 *
 * Every signup is born `role: 'member'` (`lib/actions/bootstrapUser.server.ts`) and
 * `POST /api/sites` has no capability gate, so the person who creates a site is a
 * member who owns it. The global role holds no site-scoped capability, so
 * authorization has to come from ownership.
 *
 * Since wave 5.1 that is a plain matrix lookup: SITE_DELETE sits on the `owner`
 * row of `SiteRoleCapabilityMatrix` and nowhere else, resolved from
 * `sites/{siteId}/members/{uid}`. It used to be an ownership SHORT-CIRCUIT that
 * read `sites/{id}.owner` and bypassed the matrix; without it, deletion failed
 * with "capability not granted" (reported on production by Davor, 2026-09-04).
 * `delete-site.spec.ts` could never catch that: it runs `roleState('superadmin')`,
 * and superadmin returns true from `hasCapability` before the site is considered.
 *
 * The second test is the negative control, and wave 6.4 changed what it asserts.
 * The delete control is now gated on the same predicate the server uses, so a
 * member of a site they do not own is never OFFERED the action — previously it
 * rendered for everyone and answered with a refusal toast.
 */

import { test, expect } from '@playwright/test';
import { FieldValue } from 'firebase-admin/firestore';
import { roleState } from '../../helpers/roles';
import { getAdminDb } from '../../helpers/emulator';
import { seedSite, TEST_USERS } from '../../helpers/seed';

test.use(roleState('member'));

const MEMBER_UID = TEST_USERS.member.uid;
const OWNED_SITE_ID = 'site-owned-by-member';
const OWNED_SITE_NAME = 'Member Owned Site';
/** Seeded baseline site: assigned to the member, owned by someone else. */
const ASSIGNED_SITE_NAME = 'Site A (Assigned)';

test.beforeEach(async () => {
  await seedSite({
    id: OWNED_SITE_ID,
    name: OWNED_SITE_NAME,
    owner: MEMBER_UID,
    timezone: 'UTC',
  });
  // Membership as well as ownership: `useSites` lists from `users/{uid}.sites[]`,
  // so an owned-but-unlisted site never reaches the dialog to be clicked.
  await getAdminDb()
    .collection('users')
    .doc(MEMBER_UID)
    .update({ sites: FieldValue.arrayUnion(OWNED_SITE_ID) });
});

test.afterEach(async () => {
  // Restore the shared baseline — later specs assert against the member's own sites.
  await getAdminDb()
    .collection('users')
    .doc(MEMBER_UID)
    .update({ sites: FieldValue.arrayRemove(OWNED_SITE_ID) });
  await getAdminDb().collection('sites').doc(OWNED_SITE_ID).delete();
});

async function openManageSitesDialog(page: import('@playwright/test').Page) {
  await page.goto('/dashboard');
  await page.getByTestId('site-switcher-trigger').click();
  await page.getByRole('menuitem', { name: /manage sites/i }).click();
  const dialog = page.getByRole('dialog', { name: /manage sites/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmDeleteOf(page: import('@playwright/test').Page, siteName: string) {
  const manageDialog = await openManageSitesDialog(page);
  await manageDialog.getByRole('button', { name: `delete ${siteName}` }).click();

  // Scope by title: the manage-sites dialog is still open behind this one.
  const confirmDialog = page.getByRole('dialog', { name: /^delete site$/i });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText(siteName);

  // Exact match: the "delete {site name}" row buttons behind would match the substring.
  await confirmDialog.getByRole('button', { name: 'delete site', exact: true }).click();
}

test('a member can delete a site they own', async ({ page }) => {
  await confirmDeleteOf(page, OWNED_SITE_NAME);

  await expect(page.getByText(/deleted successfully/i)).toBeVisible();

  const snap = await getAdminDb().collection('sites').doc(OWNED_SITE_ID).get();
  expect(snap.exists).toBe(false);
});

test('a member is offered neither delete nor edit on a site they only belong to', async ({ page }) => {
  const manageDialog = await openManageSitesDialog(page);

  // Owned: both controls, because owner sits above admin in the matrix.
  await expect(
    manageDialog.getByRole('button', { name: `delete ${OWNED_SITE_NAME}` })
  ).toBeVisible();
  await expect(
    manageDialog.getByRole('button', { name: `edit ${OWNED_SITE_NAME}` })
  ).toBeVisible();

  // Merely a member: neither. Delete is owner-only (SITE_DELETE) and rename is
  // site-admin (SITE_MEMBER_MANAGE); both would be refused server-side.
  await expect(
    manageDialog.getByRole('button', { name: `delete ${ASSIGNED_SITE_NAME}` })
  ).toHaveCount(0);
  await expect(
    manageDialog.getByRole('button', { name: `edit ${ASSIGNED_SITE_NAME}` })
  ).toHaveCount(0);

  const snap = await getAdminDb().collection('sites').doc('site-A').get();
  expect(snap.exists).toBe(true);
});
