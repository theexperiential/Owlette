#!/usr/bin/env node
/**
 * backfill-per-site-membership.mjs — Wave 3 tasks 3.2 and 3.3 of
 * dev/active/per-site-roles.
 *
 * Creates `sites/{siteId}/members/{uid}` for every membership that today exists
 * only in the legacy pair — `sites/{siteId}.owner` and `users/{uid}.sites[]`.
 * Purely additive: the legacy fields are never written, so they remain the
 * rollback anchor until Wave 6 strips them.
 *
 * Run `census-site-membership.mjs` first for the anomaly taxonomy. This script
 * re-derives its own classification (a census is a snapshot, not an input).
 *
 * ROLE DERIVATION
 *   `sites/{id}.owner === uid`            -> owner
 *   global role `admin`, site in sites[]  -> admin   (GATED, see below)
 *   site in sites[]                       -> member
 *
 * Owner wins over everything: ownership is a specific relationship, it is what
 * the Wave 2 dual-write records, and Wave 6.1 deletes the only other trace of it.
 * That includes superadmin-owned sites — a superadmin's OWNERSHIP is not a
 * consequence of their global role and must survive a demotion.
 *
 * A superadmin's non-owner `sites[]` entries are a different matter and are
 * DROPPED, not written: superadmins reach every site by global role
 * (`resolveSiteAccess` short-circuits before the membership term), so
 * materialising those rows leaves a demoted superadmin holding grants nobody
 * issued. Every dropped entry is printed.
 *
 * THE GLOBAL-ADMIN GATE (task 3.3). Wave 5.2's parser maps every non-superadmin
 * global role to `user`, so a global `admin` loses their powers there. Their
 * memberships must therefore become per-site `admin` or they are silently
 * demoted on their own sites — and per-site admin cannot be un-granted by
 * reversing a role value, which makes this the migration's only irreversible
 * privilege decision. The script REFUSES to write while any such conversion is
 * pending unless `--convert-global-admins` is passed, and prints each affected
 * user's full `sites[]` first.
 *
 * Admins are discovered from `users/{uid}.role` at run time, never matched on
 * email, and never pinned to uid constants — dev and prod are separate projects
 * with different uids for the same person.
 *
 * Idempotent. Rows are written with `create()`, so a row the runtime dual-write
 * already placed is never overwritten.
 *
 * Usage:
 *   node scripts/migrations/backfill-per-site-membership.mjs --env=dev --dry-run
 *   node scripts/migrations/backfill-per-site-membership.mjs --env=dev
 *   node scripts/migrations/backfill-per-site-membership.mjs --env=prod --convert-global-admins --confirm-project=owlette-prod-90a12
 *   node scripts/migrations/backfill-per-site-membership.mjs --env=prod --verify
 *   node scripts/migrations/backfill-per-site-membership.mjs --env=prod --rollback --log-file=<path>
 *
 * `--verify` checks both directions and exits non-zero on any mismatch, so it can
 * gate the Wave 4 rules deploy from CI.
 *
 * Credentials: FIREBASE_{PROJECT_ID,CLIENT_EMAIL,PRIVATE_KEY}_{DEV|PROD}, falling
 * back to the unsuffixed vars. dev and prod are SEPARATE Firebase projects —
 * verify the printed project id before a live run. `--env-file` points at an
 * .env.local outside the repo root, which a git worktree needs (it has none).
 *
 * Exit codes: 0 ok · 1 usage/credentials · 2 bad flags · 3 refused · 4 partial
 * write (see log) · 5 verify mismatch.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Modular entry points from web/node_modules — the installed root namespace
// exports neither `credential.cert` nor `firestore()`.
const require = createRequire(join(ROOT, 'web', 'package.json'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/** Marks rows this script wrote. Matches the `system:<name>` audit-actor
 *  convention (auditLog.server.ts) and is what makes rollback verifiable. */
const BACKFILL_ACTOR = 'system:membership_backfill';

const args = process.argv.slice(2);

function getFlag(name) {
  const match = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!match) return undefined;
  const eq = match.indexOf('=');
  return eq === -1 ? true : match.slice(eq + 1);
}

/** `getFlag` returns the string after `=`, so a bare `=== true` check would read
 *  `--dry-run=true` as OFF and take the live-write path. */
function getBooleanFlag(name) {
  const raw = getFlag(name);
  if (raw === undefined) return false;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  console.error(`❌ --${name} expects no value or true/false, got: ${raw}`);
  process.exit(2);
}

// A typo like `--dryrun` would otherwise parse as "no dry-run requested".
const KNOWN_FLAGS = new Set([
  'env', 'dry-run', 'verify', 'rollback', 'log-file',
  'confirm-project', 'env-file', 'convert-global-admins',
]);
for (const arg of args) {
  const name = arg.replace(/^--/, '').split('=')[0];
  if (!arg.startsWith('--') || !KNOWN_FLAGS.has(name)) {
    console.error(`❌ unknown argument: ${arg}`);
    console.error(`   known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(', ')}`);
    process.exit(2);
  }
}

const dryRun = getBooleanFlag('dry-run');
const verify = getBooleanFlag('verify');
const rollback = getBooleanFlag('rollback');
const convertGlobalAdmins = getBooleanFlag('convert-global-admins');
const env = getFlag('env');
const logFileArg = getFlag('log-file');
const confirmProject = getFlag('confirm-project');
const envFileArg = getFlag('env-file');

if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: backfill-per-site-membership.mjs --env=dev|prod [--dry-run] [--convert-global-admins]');
  console.error('       backfill-per-site-membership.mjs --env=dev|prod --verify');
  console.error('       backfill-per-site-membership.mjs --env=dev|prod --rollback --log-file=<path>');
  process.exit(1);
}
const modes = [dryRun, verify, rollback].filter(Boolean).length;
if (modes > 1) {
  console.error('❌ --dry-run, --verify and --rollback are mutually exclusive.');
  process.exit(2);
}
if (rollback && !logFileArg) {
  console.error('❌ --rollback requires --log-file=<path> from the original run.');
  process.exit(2);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

if (typeof envFileArg === 'string') {
  if (!existsSync(resolve(envFileArg))) {
    console.error(`❌ --env-file ${resolve(envFileArg)} does not exist`);
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
  console.error(`❌ Missing Firebase credentials for env=${env}.`);
  console.error(`   Set FIREBASE_PROJECT_ID${suffix}, FIREBASE_CLIENT_EMAIL${suffix},`);
  console.error(`   and FIREBASE_PRIVATE_KEY${suffix} (or the unsuffixed equivalents).`);
  process.exit(1);
}

const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

if (!process.env[`FIREBASE_PROJECT_ID${suffix}`]) {
  console.warn(`⚠️  No FIREBASE_PROJECT_ID${suffix} set — falling back to FIREBASE_PROJECT_ID (${projectId}).`);
  console.warn(`   Verify this matches the intended ${env} project before continuing.\n`);
}

/** Firestore caps a write batch at 500 operations. */
const BATCH_LIMIT = 400;

/** Typed confirmation regardless of --env — gate on the credentials actually
 *  resolved, not on an argument. */
const PROTECTED_PROJECT_IDS = new Set(['owlette-prod-90a12']);

const memberRef = (db, siteId, uid) => db.collection('sites').doc(siteId).collection('members').doc(uid);
const key = (siteId, uid) => `${siteId} ${uid}`;

/** In a git worktree `.git` is a FILE, not a directory. Worktree run logs are
 *  gitignored and `git worktree remove` destroys them — taking the only rollback
 *  anchor with them. */
function warnIfWorktree(logPath) {
  try {
    if (statSync(join(ROOT, '.git')).isFile() && !logFileArg) {
      console.warn('⚠️  This is a git worktree and the log is being written inside it:');
      console.warn(`     ${logPath}`);
      console.warn('   `git worktree remove` deletes it along with your only rollback anchor.');
      console.warn('   Pass --log-file=<absolute path outside the worktree> instead.\n');
    }
  } catch {
    /* no .git at all — not a worktree concern */
  }
}

function promptYesNo(question) {
  return new Promise((res) => {
    // Non-interactive confirm: the operator must name the exact project, so it
    // can't be inherited from stale shell history against the wrong environment.
    if (confirmProject !== undefined) {
      if (confirmProject === projectId) {
        console.log(`${question}y  (--confirm-project=${confirmProject})`);
        res(true);
      } else {
        console.error(`\n❌ --confirm-project=${confirmProject} does not match resolved project ${projectId}.`);
        res(false);
      }
      return;
    }
    if (!process.stdin.isTTY) {
      // readline's callback never fires on a non-TTY stdin, which would hang or
      // exit 0 having done nothing. Refuse explicitly instead.
      console.error(`\n❌ confirmation required but stdin is not a TTY.\n   Re-run interactively, or pass --confirm-project=${projectId}`);
      res(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      res(a === 'y' || a === 'yes');
    });
  });
}

/**
 * THE derivation. Backfill, dry-run and verify all read from this one function,
 * so `--verify` cannot drift from what the write path actually intends — a
 * verifier with its own second opinion agrees with itself, not with reality.
 */
async function classify(db) {
  const [sitesSnap, usersSnap] = await Promise.all([
    db.collection('sites').get(),
    db.collection('users').get(),
  ]);

  const users = new Map(usersSnap.docs.map((d) => [d.id, d.data() ?? {}]));
  const siteOwners = new Map(sitesSnap.docs.map((d) => [d.id, d.data()?.owner]));

  const skipped = {
    ownerless: [],
    owner_missing_user_doc: [],
    owner_soft_deleted: [],
    malformed_sites_field: [],
    member_of_missing_site: [],
    soft_deleted_holding_membership: [],
    site_owner_unresolved: [],
  };
  /** Superadmin non-owner grants — deliberately not materialised. */
  const droppedSuperadmin = [];
  /** Global-admin grants awaiting the task 3.3 confirmation. */
  const pendingAdminConversion = [];
  /** `${siteId} ${uid}` -> role. */
  const derived = new Map();

  for (const [siteId, owner] of siteOwners) {
    if (typeof owner !== 'string' || owner.length === 0) {
      skipped.ownerless.push({ siteId });
      continue;
    }
    const u = users.get(owner);
    if (u === undefined) {
      skipped.owner_missing_user_doc.push({ siteId, owner });
      continue;
    }
    if (typeof u.deletedAt === 'number') {
      skipped.owner_soft_deleted.push({ siteId, owner });
      continue;
    }
    // A malformed `sites` field means the user document is not in a state any
    // membership repair should reason about.
    if (u.sites !== undefined && !Array.isArray(u.sites)) {
      skipped.malformed_sites_field.push({ siteId, owner, actualType: typeof u.sites });
      continue;
    }
    derived.set(key(siteId, owner), 'owner');
  }

  for (const [uid, u] of users) {
    if (!Array.isArray(u.sites)) continue;
    for (const siteId of u.sites) {
      if (typeof siteId !== 'string') continue;
      if (!siteOwners.has(siteId)) {
        skipped.member_of_missing_site.push({ uid, siteId });
        continue;
      }
      if (typeof u.deletedAt === 'number') {
        skipped.soft_deleted_holding_membership.push({ uid, siteId });
        continue;
      }
      // Owner already recorded — never downgrade it to admin or member.
      if (derived.has(key(siteId, uid))) continue;
      // A site whose own owner was skipped above is not fit to gain rows.
      const ownerUid = siteOwners.get(siteId);
      if (typeof ownerUid !== 'string' || !derived.has(key(siteId, ownerUid))) {
        skipped.site_owner_unresolved.push({ uid, siteId });
        continue;
      }
      if (u.role === 'superadmin') {
        droppedSuperadmin.push({ uid, siteId, email: u.email ?? 'unknown' });
        continue;
      }
      if (u.role === 'admin') {
        pendingAdminConversion.push({ uid, siteId, email: u.email ?? 'unknown' });
        if (convertGlobalAdmins) derived.set(key(siteId, uid), 'admin');
        continue;
      }
      derived.set(key(siteId, uid), 'member');
    }
  }

  // Existing rows: one subcollection read per site. A collectionGroup query would
  // need an index that does not exist until Wave 4.
  const existing = new Map();
  for (const doc of sitesSnap.docs) {
    for (const m of (await doc.ref.collection('members').get()).docs) {
      existing.set(key(doc.id, m.id), m.data() ?? {});
    }
  }

  return {
    users, siteOwners, derived, existing,
    skipped, droppedSuperadmin, pendingAdminConversion,
    siteCount: sitesSnap.size, userCount: usersSnap.size,
  };
}

/** Print the classification. Shared by dry-run and the live path so the operator
 *  reads the same blast radius either way. */
function report(c) {
  const toCreate = [];
  let alreadyPresent = 0;
  for (const [k, role] of c.derived) {
    if (c.existing.has(k)) {
      alreadyPresent += 1;
      continue;
    }
    const [siteId, uid] = k.split(' ');
    toCreate.push({ siteId, uid, role });
  }

  const skipCount = Object.values(c.skipped).reduce((n, rows) => n + rows.length, 0);
  console.log('--- blast radius ---');
  console.log(`  sites scanned              : ${c.siteCount}`);
  console.log(`  users scanned              : ${c.userCount}`);
  console.log(`  memberships derived        : ${c.derived.size}`);
  console.log(`  already have a member doc  : ${alreadyPresent}`);
  console.log(`  TO CREATE                  : ${toCreate.length}`);
  for (const role of ['owner', 'admin', 'member']) {
    const n = toCreate.filter((r) => r.role === role).length;
    if (n > 0) console.log(`     ${role} rows`.padEnd(29) + `: ${n}`);
  }
  console.log(`  skipped (anomalies)        : ${skipCount}`);
  console.log(`  dropped (superadmin)       : ${c.droppedSuperadmin.length}`);
  console.log('');

  for (const [name, rows] of Object.entries(c.skipped)) {
    if (rows.length === 0) continue;
    console.log(`  skipped — ${name}: ${rows.length}`);
    for (const r of rows) console.log(`      ${JSON.stringify(r)}`);
  }
  if (skipCount > 0) console.log('');

  if (c.droppedSuperadmin.length > 0) {
    console.log('dropped — superadmin non-owner sites[] entries (access is global, not membership):');
    for (const d of c.droppedSuperadmin) console.log(`      ${d.siteId}  ${d.uid}  ${d.email}`);
    console.log('');
  }

  // Member rows with no legacy counterpart — the dual-write drifting.
  const orphanRows = [...c.existing.keys()].filter((k) => !c.derived.has(k));
  if (orphanRows.length > 0) {
    console.log(`⚠️  ${orphanRows.length} member document(s) with no legacy membership — dual-write drift:`);
    for (const k of orphanRows) {
      const [siteId, uid] = k.split(' ');
      console.log(`      sites/${siteId}/members/${uid}`);
    }
    console.log('');
  }

  if (toCreate.length > 0) {
    console.log('member documents to create:');
    for (const { siteId, uid, role } of toCreate) {
      const u = c.users.get(uid) ?? {};
      console.log(`  sites/${siteId}/members/${uid}  role=${role}  [global:${u.role ?? 'unknown'}] ${u.email ?? 'unknown'}`);
    }
    console.log('');
  }

  return { toCreate, orphanRows };
}

/**
 * Task 3.3. Returns false when the run must not proceed.
 *
 * Per-site admin cannot be un-granted by reversing a role value, so this is the
 * one decision the migration cannot walk back. It is refused by default.
 */
function globalAdminGate(c) {
  if (c.pendingAdminConversion.length === 0) return true;

  const byUid = new Map();
  for (const p of c.pendingAdminConversion) {
    if (!byUid.has(p.uid)) byUid.set(p.uid, []);
    byUid.get(p.uid).push(p.siteId);
  }

  console.log('⚠️  GLOBAL-ADMIN CONVERSION — irreversible privilege decision (task 3.3)');
  console.log('    Wave 5.2 maps every non-superadmin global role to `user`, so these');
  console.log('    users lose global admin. Writing per-site `admin` preserves their');
  console.log('    access; writing nothing silently demotes them on their own sites.\n');
  for (const [uid, sitesToConvert] of byUid) {
    const u = c.users.get(uid) ?? {};
    console.log(`    ${uid}  ${u.email ?? 'unknown'}  (global role=${u.role})`);
    console.log(`      full users/${uid}.sites[] : ${JSON.stringify(u.sites ?? [])}`);
    console.log(`      would become per-site admin on: ${JSON.stringify(sitesToConvert)}`);
  }
  console.log('');

  if (!convertGlobalAdmins) {
    console.log('⛔ refusing to write while this conversion is pending.');
    console.log('   Re-run with --convert-global-admins once the list above is approved,');
    console.log('   or resolve these users\' global roles first.\n');
    return false;
  }
  console.log('   --convert-global-admins passed — proceeding with the conversion.\n');
  return true;
}

/**
 * Two-way verification, exit 5 on mismatch so CI can gate the rules deploy.
 *
 * Direction A: every derived legacy membership has a member document with the
 * expected role. Direction B: every member document corresponds to a derived
 * membership. Deliberate exclusions (superadmin drops, anomaly skips) are not
 * failures — they come from the same `classify` the write path uses.
 */
async function runVerify(db) {
  const c = await classify(db);
  const problems = [];

  for (const [k, role] of c.derived) {
    const [siteId, uid] = k.split(' ');
    const doc = c.existing.get(k);
    if (!doc) {
      problems.push(`MISSING  sites/${siteId}/members/${uid} (expected role=${role})`);
    } else if (doc.role !== role) {
      problems.push(`ROLE     sites/${siteId}/members/${uid} is '${doc.role}', expected '${role}'`);
    } else if (doc.status !== 'active') {
      problems.push(`STATUS   sites/${siteId}/members/${uid} status='${doc.status}', expected 'active'`);
    }
  }

  for (const [k, doc] of c.existing) {
    const [siteId, uid] = k.split(' ');
    if (c.derived.has(k)) continue;
    // An owner row whose legacy `owner` field was cleared is drift worth naming
    // separately — it is the state Wave 6 would make permanent.
    const detail = doc.role === 'owner' ? ' (owner row with no legacy owner field)' : '';
    problems.push(`ORPHAN   sites/${siteId}/members/${uid} role=${doc.role}${detail}`);
  }

  console.log('--- verify ---');
  console.log(`  derived memberships : ${c.derived.size}`);
  console.log(`  member documents    : ${c.existing.size}`);
  console.log(`  superadmin drops    : ${c.droppedSuperadmin.length} (expected to have no member doc)`);
  console.log(`  pending admin conv. : ${c.pendingAdminConversion.length}`);
  console.log('');

  if (problems.length === 0) {
    console.log('✅ verify passed — both directions agree.\n');
    return 0;
  }
  console.log(`❌ ${problems.length} mismatch(es):`);
  for (const p of problems) console.log(`     ${p}`);
  if (c.pendingAdminConversion.length > 0) {
    console.log('\n   Note: --convert-global-admins was not passed, so global-admin grants are');
    console.log('   not expected to exist. Pass it to verify against the converted shape.');
  }
  console.log('');
  return 5;
}

/**
 * Reverse a run from its change log.
 *
 * Member documents are self-identifying, so the undo verifies before it deletes:
 * a row whose `addedBy` is no longer the backfill sentinel, or whose role has
 * changed, was touched by a real actor afterwards and is left alone. Blind
 * deletion would revoke a membership someone genuinely granted.
 */
async function runRollback(db) {
  const log = JSON.parse(readFileSync(logFileArg, 'utf8'));

  if (log.projectId !== projectId) {
    console.error(`❌ log was written against project ${log.projectId}, but this run targets ${projectId}.`);
    process.exit(2);
  }
  if (!Array.isArray(log.applied) || log.applied.length === 0) {
    console.error('❌ log contains no applied changes to reverse.');
    process.exit(2);
  }

  console.log(`\nROLLBACK — project=${projectId}, log=${logFileArg}`);
  console.log(`  written at : ${log.completedAt ?? 'INCOMPLETE RUN'}`);
  console.log(`  candidates : ${log.applied.length} member document(s)\n`);

  const toDelete = [];
  for (const entry of log.applied) {
    const snap = await memberRef(db, entry.siteId, entry.uid).get();
    if (!snap.exists) {
      console.log(`  absent sites/${entry.siteId}/members/${entry.uid}  — already deleted`);
      continue;
    }
    const data = snap.data() ?? {};
    if (data.addedBy !== BACKFILL_ACTOR || data.role !== entry.role) {
      console.log(`  KEEP   sites/${entry.siteId}/members/${entry.uid}  — modified since (role=${data.role}, addedBy=${data.addedBy})`);
      continue;
    }
    toDelete.push(entry);
    console.log(`  delete sites/${entry.siteId}/members/${entry.uid}  [${entry.role}]`);
  }
  console.log('');

  if (toDelete.length === 0) {
    console.log('✅ nothing to reverse.\n');
    return;
  }

  if (PROTECTED_PROJECT_IDS.has(projectId)) {
    const ok = await promptYesNo(`Delete ${toDelete.length} member document(s) in ${projectId}? [y/N] `);
    if (!ok) {
      console.log('aborted — no writes performed.\n');
      process.exit(3);
    }
  }

  let removed = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_LIMIT) {
    const chunk = toDelete.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const e of chunk) batch.delete(memberRef(db, e.siteId, e.uid));
    await batch.commit();
    removed += chunk.length;
    console.log(`  reversed ${removed}/${toDelete.length}`);
  }
  console.log(`\n✅ deleted ${removed} member document(s).\n`);
}

async function main() {
  const mode = verify ? '[VERIFY] ' : dryRun ? '[DRY RUN] ' : rollback ? '' : '';
  console.log(`\n${mode}Per-site membership backfill — env=${env}, project=${projectId}\n`);

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  const db = getFirestore();

  if (rollback) return runRollback(db);
  if (verify) process.exit(await runVerify(db));

  const c = await classify(db);
  const { toCreate } = report(c);

  if (!globalAdminGate(c)) process.exit(3);

  if (toCreate.length === 0) {
    console.log('✅ nothing to create.\n');
    return;
  }
  if (dryRun) {
    console.log('[DRY RUN] no writes performed.\n');
    return;
  }

  // Gate on the project actually resolved, not on the --env flag.
  if (PROTECTED_PROJECT_IDS.has(projectId)) {
    const ok = await promptYesNo(`Create ${toCreate.length} member document(s) in PRODUCTION (${projectId})? [y/N] `);
    if (!ok) {
      console.log('aborted — no writes performed.\n');
      process.exit(3);
    }
  }

  const logPath =
    (typeof logFileArg === 'string' && resolve(logFileArg)) ||
    join(ROOT, 'scripts', 'migrations', `backfill-per-site-membership.${projectId}.log.json`);
  warnIfWorktree(logPath);

  // Write the log BEFORE committing: if the process dies mid-run this is the
  // record of intent. Entries move to `applied` as batches land.
  const now = new Date();
  const log = {
    script: 'backfill-per-site-membership.mjs',
    projectId,
    env,
    startedAt: now.toISOString(),
    completedAt: null,
    addedBy: BACKFILL_ACTOR,
    convertedGlobalAdmins: convertGlobalAdmins ? c.pendingAdminConversion : [],
    planned: toCreate,
    applied: [],
  };
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`change log: ${logPath}\n`);

  let created = 0;
  for (let i = 0; i < toCreate.length; i += BATCH_LIMIT) {
    const chunk = toCreate.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { siteId, uid, role } of chunk) {
      // create(), never set(): a row the runtime dual-write placed between the
      // read above and this commit must abort the batch, not be overwritten.
      batch.create(memberRef(db, siteId, uid), {
        uid,
        role,
        status: 'active',
        addedAt: now,
        addedBy: BACKFILL_ACTOR,
      });
    }
    try {
      await batch.commit();
    } catch (err) {
      log.completedAt = new Date().toISOString();
      log.error = String(err?.message ?? err);
      writeFileSync(logPath, JSON.stringify(log, null, 2));
      console.error(`\n❌ batch failed after ${created} document(s): ${log.error}`);
      console.error('   Rows already written are in the log. Re-run — the script skips what exists.');
      process.exit(4);
    }
    log.applied.push(...chunk);
    created += chunk.length;
    writeFileSync(logPath, JSON.stringify(log, null, 2));
    console.log(`  created ${created}/${toCreate.length}`);
  }

  log.completedAt = new Date().toISOString();
  writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log(`\n✅ created ${created} member document(s).`);
  console.log(`\nVerify:\n  node scripts/migrations/backfill-per-site-membership.mjs --env=${env} --verify`);
  console.log(`\nTo reverse:\n  node scripts/migrations/backfill-per-site-membership.mjs --env=${env} --rollback --log-file=${logPath}\n`);
}

main().catch((err) => {
  console.error('\n❌ backfill failed:', err?.message ?? err);
  process.exit(1);
});
