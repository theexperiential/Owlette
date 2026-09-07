#!/usr/bin/env node
/**
 * census-site-membership.mjs — Wave 3 task 3.1 of dev/active/per-site-roles.
 *
 * READ-ONLY. This script never writes. It classifies the membership data as it
 * actually is, so the wave 3.2 backfill is written against reality rather than
 * against what the schema implies.
 *
 * Membership currently lives in two legacy fields — `sites/{siteId}.owner` and
 * `users/{uid}.sites[]` — and, since wave 2, a shadow copy at
 * `sites/{siteId}/members/{uid}`. Nothing reads the shadow for decisions yet.
 *
 * Every anomaly below was derived from a code path that creates or tolerates
 * it, not from imagination. The citation is on each bucket.
 *
 * Usage:
 *   node scripts/migrations/census-site-membership.mjs --env dev
 *   node scripts/migrations/census-site-membership.mjs --env prod --out report.json
 *
 * Credentials resolve exactly as backfill-site-owner-membership.mjs does:
 * FIREBASE_{PROJECT_ID,CLIENT_EMAIL,PRIVATE_KEY} with a _PROD/_DEV suffix,
 * falling back to the unsuffixed names with a loud warning.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// firebase-admin lives in web/node_modules — resolve it from there. Modular
// entry points only: the installed root namespace exports neither
// `credential.cert` nor `firestore()`, which is why six of the nine scripts in
// this directory throw on startup.
const webRequire = createRequire(join(repoRoot, 'web', 'package.json'));
const { initializeApp, cert } = webRequire('firebase-admin/app');
const { getFirestore } = webRequire('firebase-admin/firestore');

// --- flags ------------------------------------------------------------------

const argv = process.argv.slice(2);
const KNOWN = new Set(['--env', '--out', '--limit', '--env-file', '--help']);

function flagValue(name, fallback = undefined) {
  const exact = argv.indexOf(name);
  if (exact >= 0) return argv[exact + 1];
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

// Reject unknown flags rather than ignoring them: a mistyped `--enviroment prod`
// would otherwise silently census dev and report a clean bill of health.
for (const arg of argv) {
  const name = arg.startsWith('--') ? arg.split('=')[0] : null;
  if (name && !KNOWN.has(name)) {
    console.error(`❌ unknown flag ${name}`);
    process.exit(1);
  }
}

if (argv.includes('--help')) {
  console.log(
    'usage: census-site-membership.mjs --env <dev|prod> [--out <file>] [--limit <n>] [--env-file <path>]'
  );
  process.exit(0);
}

const env = flagValue('--env');
if (env !== 'dev' && env !== 'prod') {
  console.error('❌ --env must be exactly "dev" or "prod"');
  process.exit(1);
}

// --- credentials ------------------------------------------------------------

// `--env-file` is searched first. A worktree carries no .env.local of its own
// (they are gitignored and never copied), so a script run from one has no
// credentials at all unless it is pointed at the main tree's file explicitly.
const envFile = flagValue('--env-file');
if (envFile && !existsSync(resolve(envFile))) {
  console.error(`❌ --env-file ${resolve(envFile)} does not exist`);
  process.exit(1);
}

const envCandidates = [
  ...(envFile ? [resolve(envFile)] : []),
  ...['web/.env.local', '.claude/.env.local', 'scripts/.env.local'].map((rel) => join(repoRoot, rel)),
];

for (const p of envCandidates) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k]) continue;
    let v = rawV.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const suffix = env === 'prod' ? '_PROD' : '_DEV';
const projectId = process.env[`FIREBASE_PROJECT_ID${suffix}`] || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env[`FIREBASE_CLIENT_EMAIL${suffix}`] || process.env.FIREBASE_CLIENT_EMAIL;
const rawKey = process.env[`FIREBASE_PRIVATE_KEY${suffix}`] || process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !rawKey) {
  console.error(`❌ Missing Firebase credentials for env=${env}.`);
  console.error(`   Set FIREBASE_PROJECT_ID${suffix}, FIREBASE_CLIENT_EMAIL${suffix}, FIREBASE_PRIVATE_KEY${suffix}`);
  process.exit(1);
}

if (!process.env[`FIREBASE_PROJECT_ID${suffix}`]) {
  console.warn(`⚠️  No FIREBASE_PROJECT_ID${suffix} set — falling back to FIREBASE_PROJECT_ID (${projectId}).`);
  console.warn(`   Verify this is the intended ${env} project before trusting the numbers.\n`);
}

initializeApp({ credential: cert({ projectId, clientEmail, privateKey: rawKey.replace(/\\n/g, '\n') }) });
const db = getFirestore();

// --- census -----------------------------------------------------------------

const buckets = {
  /** Site has no usable `owner`. transferSiteOwnership refuses these outright
   *  ("an ownerless site is a repair job — never invent an owner from the
   *  caller"), and no writer creates the state, so any instance is legacy or
   *  hand-edited. The backfill MUST skip, not guess. */
  ownerless: [],
  /** `sites/{id}.owner` names a uid with no user document. Produced by
   *  deleteOwnAccount: its classifier only walks `users/{uid}.sites[]`, so a
   *  site the user owns but is missing from their own sites[] is never
   *  classified, and step 6 hard-deletes the user document anyway. */
  owner_missing_user_doc: [],
  /** Owner is soft-deleted. Sanctioned membership paths refuse these, and the
   *  admin cascade clears `sites[]` — repopulating would reverse a deletion. */
  owner_soft_deleted: [],
  /** `users/{uid}.sites` is not an array. arrayUnion silently REPLACES a
   *  non-array field, destroying whatever was there. Refuse rather than clobber. */
  malformed_sites_field: [],
  /** The bug backfill-site-owner-membership repaired: owner exists, is active,
   *  but the site is absent from their own sites[]. Client lists resolve
   *  membership from sites[], so the creator could not see their own site. */
  owner_not_in_own_sites: [],
  /** `users/{uid}.sites[]` names a site document that does not exist. deleteSite
   *  deliberately leaves these dangling, which is why site ids are tombstoned. */
  member_of_missing_site: [],
  /** Soft-deleted user still holding membership. Harmless server-side today
   *  (resolveSiteAccess refuses on deletedAt BEFORE the membership term), but
   *  once wave 5 makes the member row authoritative these become live grants. */
  soft_deleted_holding_membership: [],
  /** Legacy membership with no shadow member document — the backfill's actual
   *  work list. */
  missing_member_doc: [],
  /** Shadow member document with no corresponding legacy membership. Should be
   *  empty; a non-zero count means the dual-write drifted. */
  orphan_member_doc: [],
};

const sample = (arr, n = 5) => arr.slice(0, n);

async function main() {
  console.log(`\n📊 membership census — project ${projectId} (env=${env})`);
  console.log('   READ-ONLY: this script never writes.\n');

  const [sitesSnap, usersSnap] = await Promise.all([
    db.collection('sites').get(),
    db.collection('users').get(),
  ]);

  const users = new Map();
  for (const d of usersSnap.docs) users.set(d.id, d.data() ?? {});
  const siteIds = new Set(sitesSnap.docs.map((d) => d.id));

  // Legacy membership pairs, from BOTH directions.
  const legacyPairs = new Set();

  for (const doc of sitesSnap.docs) {
    const owner = doc.data()?.owner;
    if (typeof owner !== 'string' || owner.length === 0) {
      buckets.ownerless.push({ siteId: doc.id });
      continue;
    }
    const u = users.get(owner);
    if (u === undefined) {
      buckets.owner_missing_user_doc.push({ siteId: doc.id, owner });
      continue;
    }
    if (typeof u.deletedAt === 'number') {
      buckets.owner_soft_deleted.push({ siteId: doc.id, owner });
      continue;
    }
    if (u.sites !== undefined && !Array.isArray(u.sites)) {
      buckets.malformed_sites_field.push({ siteId: doc.id, owner, actualType: typeof u.sites });
      continue;
    }
    legacyPairs.add(`${doc.id} ${owner}`);
    if (!Array.isArray(u.sites) || !u.sites.includes(doc.id)) {
      buckets.owner_not_in_own_sites.push({ siteId: doc.id, owner });
    }
  }

  for (const [uid, u] of users) {
    if (!Array.isArray(u.sites)) continue;
    const isDeleted = typeof u.deletedAt === 'number';
    for (const siteId of u.sites) {
      if (typeof siteId !== 'string') continue;
      if (!siteIds.has(siteId)) {
        buckets.member_of_missing_site.push({ uid, siteId });
        continue;
      }
      if (isDeleted) {
        buckets.soft_deleted_holding_membership.push({ uid, siteId });
        continue;
      }
      legacyPairs.add(`${siteId} ${uid}`);
    }
  }

  // Shadow documents. One subcollection read per site — fine at this scale, and
  // a collectionGroup query would need an index that does not exist yet.
  const shadowPairs = new Set();
  for (const doc of sitesSnap.docs) {
    const members = await db.collection('sites').doc(doc.id).collection('members').get();
    for (const m of members.docs) shadowPairs.add(`${doc.id} ${m.id}`);
  }

  for (const pair of legacyPairs) {
    if (!shadowPairs.has(pair)) {
      const [siteId, uid] = pair.split(' ');
      buckets.missing_member_doc.push({ siteId, uid });
    }
  }
  for (const pair of shadowPairs) {
    if (!legacyPairs.has(pair)) {
      const [siteId, uid] = pair.split(' ');
      buckets.orphan_member_doc.push({ siteId, uid });
    }
  }

  // --- report ---------------------------------------------------------------

  console.log(`sites: ${sitesSnap.size}   users: ${usersSnap.size}`);
  console.log(`legacy membership pairs: ${legacyPairs.size}`);
  console.log(`shadow member documents:  ${shadowPairs.size}\n`);

  const BLOCKING = ['ownerless', 'owner_missing_user_doc', 'malformed_sites_field'];
  let blocking = 0;

  for (const [name, rows] of Object.entries(buckets)) {
    const mark = rows.length === 0 ? '✅' : BLOCKING.includes(name) ? '⛔' : '⚠️ ';
    console.log(`${mark} ${name}: ${rows.length}`);
    if (rows.length) console.log(`     e.g. ${JSON.stringify(sample(rows, 3))}`);
    if (rows.length && BLOCKING.includes(name)) blocking += rows.length;
  }

  console.log(
    blocking === 0
      ? '\n✅ no blocking anomalies — 3.2 can repair the rest additively.'
      : `\n⛔ ${blocking} blocking anomalies. These are REPAIR JOBS, not backfill input:` +
          '\n   the backfill must skip them and they need a decision each.'
  );

  const out = flagValue('--out');
  if (out) {
    const report = {
      projectId,
      env,
      generatedAt: new Date().toISOString(),
      totals: {
        sites: sitesSnap.size,
        users: usersSnap.size,
        legacyPairs: legacyPairs.size,
        shadowPairs: shadowPairs.size,
      },
      buckets,
    };
    writeFileSync(resolve(out), JSON.stringify(report, null, 2));
    console.log(`\n📝 report written to ${resolve(out)}`);
  }
}

main().catch((err) => {
  console.error('\n❌ census failed:', err.message);
  process.exit(1);
});
