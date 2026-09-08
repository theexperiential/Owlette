#!/usr/bin/env node
/**
 * Wave 6.1 — strip the legacy membership fields.
 *
 * Deletes `users/{uid}.sites` and `sites/{siteId}.owner`. After the per-site-roles
 * migration neither is consulted by any access decision: firestore.rules resolves
 * from `sites/{siteId}/members/{uid}`, and as of 2026-09-07 no server route, Cloud
 * Function or client component reads either field for authorization.
 *
 * THE GATE. The plan says to gate on the `membership_fallback` counter holding at
 * zero. That counter is a CLIENT runtime metric (web/lib/membershipMetrics.ts, to
 * console and Sentry), so it only ever sees users who have loaded the app. This
 * script computes the same question directly from the data, which is strictly
 * stronger: for every user, does the legacy array grant a site the member rows do
 * not? One such user is a person who loses access the moment this runs, so --apply
 * refuses while any exist. Check Sentry for `membership_fallback` as well — the two
 * answer the same question from opposite ends.
 *
 * ROLLBACK. Every value is written to a log file BEFORE any delete lands, and
 * `--rollback --log-file=<path>` restores exactly those documents. That log is the
 * only copy: Firestore has no undelete.
 *
 * Usage:
 *   node scripts/migrations/strip-legacy-membership.mjs --env=dev --dry-run
 *   node scripts/migrations/strip-legacy-membership.mjs --env=dev --apply
 *   node scripts/migrations/strip-legacy-membership.mjs --env=dev --verify
 *   node scripts/migrations/strip-legacy-membership.mjs --env=dev --rollback --log-file=<path>
 *
 * Exit codes: 0 ok - 1 usage/credentials - 2 bad flags - 3 refused (gate) -
 * 4 partial write (see log) - 5 verify mismatch.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Modular entry points from web/node_modules — the installed firebase-admin root
// namespace exports neither credential.cert nor firestore().
const require = createRequire(join(ROOT, 'web', 'package.json'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const args = process.argv.slice(2);

function getFlag(name) {
  const match = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!match) return undefined;
  const eq = match.indexOf('=');
  return eq === -1 ? true : match.slice(eq + 1);
}

/** A bare `=== true` check would read `--apply=false` as ON. */
function getBooleanFlag(name) {
  const raw = getFlag(name);
  if (raw === undefined) return false;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  console.error(`--${name} expects no value or true/false, got: ${raw}`);
  process.exit(2);
}

const KNOWN_FLAGS = new Set([
  'env', 'dry-run', 'apply', 'verify', 'rollback', 'log-file', 'confirm-project', 'env-file',
]);
for (const arg of args) {
  const name = arg.replace(/^--/, '').split('=')[0];
  if (!arg.startsWith('--') || !KNOWN_FLAGS.has(name)) {
    console.error(`unknown argument: ${arg}`);
    console.error(`known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(', ')}`);
    process.exit(2);
  }
}

const dryRun = getBooleanFlag('dry-run');
const apply = getBooleanFlag('apply');
const verify = getBooleanFlag('verify');
const rollback = getBooleanFlag('rollback');
const env = getFlag('env');
const logFileArg = getFlag('log-file');
const confirmProject = getFlag('confirm-project');
const envFileArg = getFlag('env-file');

if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: strip-legacy-membership.mjs --env=dev|prod [--dry-run|--apply|--verify]');
  console.error('       strip-legacy-membership.mjs --env=dev|prod --rollback --log-file=<path>');
  process.exit(1);
}

const modes = [dryRun, apply, verify, rollback].filter(Boolean).length;
if (modes > 1) {
  console.error('--dry-run, --apply, --verify and --rollback are mutually exclusive.');
  process.exit(2);
}
// No mode at all means report only. Destroying data is an explicit choice.
const reportOnly = modes === 0 || dryRun;
if (rollback && !logFileArg) {
  console.error('--rollback requires --log-file=<path> from the original run.');
  process.exit(2);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

if (typeof envFileArg === 'string') {
  if (!existsSync(resolve(envFileArg))) {
    console.error(`--env-file ${resolve(envFileArg)} does not exist`);
    process.exit(2);
  }
  loadEnvFile(resolve(envFileArg));
}
loadEnvFile(join(ROOT, 'web', '.env.local'));
loadEnvFile(join(ROOT, '.claude', '.env.local'));
loadEnvFile(join(ROOT, 'scripts', '.env.local'));

const suffix = env === 'prod' ? '_PROD' : '_DEV';
const projectId = process.env[`FIREBASE_PROJECT_ID${suffix}`] || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env[`FIREBASE_CLIENT_EMAIL${suffix}`] || process.env.FIREBASE_CLIENT_EMAIL;
const rawPrivateKey = process.env[`FIREBASE_PRIVATE_KEY${suffix}`] || process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !rawPrivateKey) {
  console.error(`Missing Firebase credentials for env=${env}.`);
  console.error(`Set FIREBASE_PROJECT_ID${suffix}, FIREBASE_CLIENT_EMAIL${suffix}, FIREBASE_PRIVATE_KEY${suffix}.`);
  process.exit(1);
}
if (!process.env[`FIREBASE_PROJECT_ID${suffix}`]) {
  console.warn(`No FIREBASE_PROJECT_ID${suffix} set - falling back to FIREBASE_PROJECT_ID (${projectId}).`);
}

/** Gate on the credentials that actually resolved, never on the --env argument. */
const PROTECTED_PROJECT_IDS = new Set(['owlette-prod-90a12']);
const BATCH_LIMIT = 400;

initializeApp({
  credential: cert({
    projectId,
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore();

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

/** uid -> Set(siteId) for ACTIVE member rows: the rows that actually grant. */
async function readMembership() {
  const snap = await db.collectionGroup('members').get();
  const byUid = new Map();
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    if (data.status !== 'active') continue;
    const siteId = doc.ref.parent.parent?.id;
    if (!siteId) continue;
    const uid = typeof data.uid === 'string' && data.uid ? data.uid : doc.id;
    if (!byUid.has(uid)) byUid.set(uid, new Set());
    byUid.get(uid).add(siteId);
  }
  return byUid;
}

async function survey() {
  const [usersSnap, sitesSnap, membership] = await Promise.all([
    db.collection('users').get(),
    db.collection('sites').get(),
    readMembership(),
  ]);

  const userTargets = [];
  const orphanedUsers = [];
  for (const doc of usersSnap.docs) {
    const data = doc.data() ?? {};
    if (!Object.prototype.hasOwnProperty.call(data, 'sites')) continue;
    const legacy = Array.isArray(data.sites)
      ? data.sites.filter((s) => typeof s === 'string')
      : [];
    userTargets.push({ uid: doc.id, sites: legacy });

    // Superadmins deliberately hold no member rows — they reach every site by
    // global role — so their array granting nothing extra is expected.
    if (data.role === 'superadmin') continue;
    const held = membership.get(doc.id) ?? new Set();
    const lost = legacy.filter((siteId) => !held.has(siteId));
    if (lost.length) orphanedUsers.push({ uid: doc.id, email: data.email ?? null, lost });
  }

  // Every user doc that exists, so an owner pointing at a deleted account can be
  // told apart from a live person who would lose their site.
  const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data() ?? {}]));

  const siteTargets = [];
  const ownerlessSites = [];
  const orphanedSites = [];
  for (const doc of sitesSnap.docs) {
    const data = doc.data() ?? {};
    if (!Object.prototype.hasOwnProperty.call(data, 'owner')) continue;
    siteTargets.push({ siteId: doc.id, owner: data.owner ?? null });

    const ownerUid = typeof data.owner === 'string' ? data.owner : null;
    if (!ownerUid) continue;
    const held = membership.get(ownerUid) ?? new Set();
    if (held.has(doc.id)) continue;

    const ownerDoc = usersById.get(ownerUid);
    if (!ownerDoc) {
      // The owner's user document is gone, so nobody can reach this site today
      // and nobody can lose it. Reported for cleanup, not as a blocker.
      orphanedSites.push({ siteId: doc.id, owner: ownerUid, name: data.name ?? null });
      continue;
    }
    if (ownerDoc.role === 'superadmin') {
      // Superadmins deliberately hold no member rows — they reach every site by
      // global role — so an owner field with no row is expected here.
      continue;
    }
    ownerlessSites.push({ siteId: doc.id, owner: ownerUid, email: ownerDoc.email ?? null });
  }

  return { userTargets, siteTargets, orphanedUsers, ownerlessSites, orphanedSites };
}

function report(s) {
  console.log(`\nproject ${projectId} (env=${env})\n`);
  console.log(`  users carrying a legacy 'sites' field:  ${s.userTargets.length}`);
  console.log(`  sites carrying a legacy 'owner' field:  ${s.siteTargets.length}`);
  console.log('');
  console.log(`  BLOCKER - users who would LOSE a site:  ${s.orphanedUsers.length}`);
  for (const u of s.orphanedUsers) {
    console.log(`    ${u.uid} (${u.email ?? 'no email'}) loses: ${u.lost.join(', ')}`);
  }
  console.log(`  BLOCKER - live owners with no member row: ${s.ownerlessSites.length}`);
  for (const o of s.ownerlessSites) {
    console.log(`    site ${o.siteId} owner ${o.owner} (${o.email ?? 'no email'}) holds no active member row`);
  }
  console.log('');
  console.log(`  note - sites owned by a DELETED account:  ${s.orphanedSites.length}`);
  for (const o of s.orphanedSites) {
    console.log(`    site ${o.siteId} ${JSON.stringify(o.name)} owner ${o.owner} no longer exists`);
  }
  if (s.orphanedSites.length) {
    console.log('    (already unreachable — not a blocker, but worth deleting)');
  }
  console.log('');
}

async function commitInChunks(ops, label) {
  let done = 0;
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const op of chunk) op(batch);
    await batch.commit();
    done += chunk.length;
    console.log(`  ${label}: ${done}/${ops.length}`);
  }
  return done;
}

async function main() {
  if (verify) {
    const s = await survey();
    report(s);
    const remaining = s.userTargets.length + s.siteTargets.length;
    if (remaining > 0) {
      console.error(`VERIFY FAILED - ${remaining} document(s) still carry a legacy field.`);
      process.exit(5);
    }
    console.log('VERIFY OK - no legacy membership fields remain.\n');
    return;
  }

  if (rollback) {
    const logPath = resolve(String(logFileArg));
    if (!existsSync(logPath)) {
      console.error(`log file not found: ${logPath}`);
      process.exit(1);
    }
    const log = JSON.parse(readFileSync(logPath, 'utf8'));
    if (log.projectId !== projectId) {
      console.error(`log is for project ${log.projectId}; refusing to restore into ${projectId}.`);
      process.exit(3);
    }
    const ops = [];
    for (const u of log.users ?? []) {
      ops.push((b) => b.update(db.collection('users').doc(u.uid), { sites: u.sites }));
    }
    for (const site of log.sites ?? []) {
      ops.push((b) => b.update(db.collection('sites').doc(site.siteId), { owner: site.owner }));
    }
    console.log(`\nrestoring ${ops.length} document(s) into ${projectId}\n`);
    await commitInChunks(ops, 'restored');
    console.log('\nrollback complete.\n');
    return;
  }

  const s = await survey();
  report(s);
  const blockers = s.orphanedUsers.length + s.ownerlessSites.length;

  if (reportOnly) {
    console.log(blockers === 0
      ? 'GATE OPEN - nothing would lose access. Re-run with --apply to strip.\n'
      : `GATE CLOSED - ${blockers} blocker(s). Backfill them before stripping.\n`);
    console.log('Also confirm Sentry shows no membership_fallback events over the observation window.\n');
    return;
  }

  if (blockers > 0) {
    console.error(`REFUSING - ${blockers} blocker(s) above would lose access. Fix them, then re-run.`);
    process.exit(3);
  }
  if (PROTECTED_PROJECT_IDS.has(projectId)) {
    const answer = await confirm(
      `\nThis DELETES fields in PRODUCTION (${projectId}). Type the project id to continue: `,
    );
    if (answer.trim() !== projectId) {
      console.error('aborted.');
      process.exit(3);
    }
  } else if (typeof confirmProject === 'string' && confirmProject !== projectId) {
    console.error(`--confirm-project=${confirmProject} does not match resolved project ${projectId}.`);
    process.exit(3);
  }

  // The log is written BEFORE any delete: Firestore has no undelete, so a crash
  // between the two must still leave a complete restore path on disk.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = logFileArg
    ? resolve(String(logFileArg))
    : join(__dirname, `strip-legacy-membership.${projectId}.${stamp}.log.json`);
  writeFileSync(logPath, JSON.stringify({
    script: 'strip-legacy-membership',
    projectId,
    startedAt: new Date().toISOString(),
    users: s.userTargets,
    sites: s.siteTargets,
  }, null, 2));
  console.log(`rollback log written: ${logPath}\n`);

  const ops = [];
  for (const u of s.userTargets) {
    ops.push((b) => b.update(db.collection('users').doc(u.uid), { sites: FieldValue.delete() }));
  }
  for (const site of s.siteTargets) {
    ops.push((b) => b.update(db.collection('sites').doc(site.siteId), { owner: FieldValue.delete() }));
  }

  try {
    await commitInChunks(ops, 'stripped');
  } catch (err) {
    console.error(`\nPARTIAL WRITE - ${err.message}`);
    console.error(`Restore with: --rollback --log-file=${logPath}`);
    process.exit(4);
  }
  console.log(`\nstripped ${ops.length} document(s). Rollback log: ${logPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
