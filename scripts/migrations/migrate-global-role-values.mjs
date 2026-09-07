#!/usr/bin/env node
/**
 * migrate-global-role-values.mjs — Wave 5.2 of dev/active/per-site-roles.
 *
 * Rewrites `users/{uid}.role` so the only meaningful global value left is
 * `superadmin`. Everything else becomes `user`.
 *
 * WHY IT IS SAFE TO RUN AT ALL. Every parser already maps unrecognised values
 * onto the same tier as `member` — no global privilege — so a document reading
 * `user` is interpreted identically to one reading `member` before this runs.
 * The rewrite removes an ambiguity; it does not change any decision.
 *
 * WHY IT IS NOT SAFE TO RUN EARLY. Two ways it can hurt:
 *
 *   1. An open tab holding a session parsed under the OLD client. Wave 4.3
 *      widened that parser to accept `user`, but a browser that loaded the page
 *      before that shipped has the narrow one, and flipping the value under it
 *      strips every site-admin control with no reload. Run only once sessions
 *      have cycled onto the membership-aware client.
 *
 *   2. A global `admin` who never got per-site admin rows. Demoting them to
 *      `user` takes away authority they still rely on. Task 3.3 converts them;
 *      this script REFUSES to demote any global admin holding no `owner`/`admin`
 *      membership anywhere, and names them.
 *
 * Fully reversible: the change log records each document's previous value, so
 * `--rollback` restores exactly what was there — unlike the additive backfill,
 * where the anchor is the untouched legacy field.
 *
 * Usage:
 *   node scripts/migrations/migrate-global-role-values.mjs --env=dev --dry-run
 *   node scripts/migrations/migrate-global-role-values.mjs --env=dev --sessions-have-cycled
 *   node scripts/migrations/migrate-global-role-values.mjs --env=prod --sessions-have-cycled --confirm-project=owlette-prod-90a12
 *   node scripts/migrations/migrate-global-role-values.mjs --env=prod --rollback --log-file=<path>
 *
 * Exit codes: 0 ok · 1 usage/credentials · 2 bad flags · 3 refused · 4 partial
 * write (see log).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(join(ROOT, 'web', 'package.json'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/** The value every non-superadmin global role collapses to. */
const TARGET = 'user';
/** Values this script will rewrite. Anything else is left alone and reported. */
const REWRITABLE = new Set(['member', 'admin']);

const args = process.argv.slice(2);
const KNOWN = new Set([
  'env', 'dry-run', 'rollback', 'log-file', 'confirm-project', 'env-file',
  'sessions-have-cycled', 'allow-unconverted-admins',
]);
for (const arg of args) {
  const name = arg.replace(/^--/, '').split('=')[0];
  if (!arg.startsWith('--') || !KNOWN.has(name)) {
    console.error(`❌ unknown argument: ${arg}`);
    console.error(`   known flags: ${[...KNOWN].map((f) => `--${f}`).join(', ')}`);
    process.exit(2);
  }
}
function getFlag(name) {
  const match = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!match) return undefined;
  const eq = match.indexOf('=');
  return eq === -1 ? true : match.slice(eq + 1);
}
function getBooleanFlag(name) {
  const raw = getFlag(name);
  if (raw === undefined) return false;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  console.error(`❌ --${name} expects no value or true/false, got: ${raw}`);
  process.exit(2);
}

const dryRun = getBooleanFlag('dry-run');
const rollback = getBooleanFlag('rollback');
const sessionsHaveCycled = getBooleanFlag('sessions-have-cycled');
const allowUnconverted = getBooleanFlag('allow-unconverted-admins');
const env = getFlag('env');
const logFileArg = getFlag('log-file');
const confirmProject = getFlag('confirm-project');
const envFileArg = getFlag('env-file');

if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: migrate-global-role-values.mjs --env=dev|prod [--dry-run] [--sessions-have-cycled]');
  console.error('       migrate-global-role-values.mjs --env=dev|prod --rollback --log-file=<path>');
  process.exit(1);
}
if (rollback && dryRun) {
  console.error('❌ --rollback and --dry-run are mutually exclusive.');
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

const suffix = env === 'prod' ? '_PROD' : '_DEV';
const projectId = process.env[`FIREBASE_PROJECT_ID${suffix}`] || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env[`FIREBASE_CLIENT_EMAIL${suffix}`] || process.env.FIREBASE_CLIENT_EMAIL;
const rawKey = process.env[`FIREBASE_PRIVATE_KEY${suffix}`] || process.env.FIREBASE_PRIVATE_KEY;
if (!projectId || !clientEmail || !rawKey) {
  console.error(`❌ Missing Firebase credentials for env=${env}.`);
  process.exit(1);
}
if (!process.env[`FIREBASE_PROJECT_ID${suffix}`]) {
  console.warn(`⚠️  No FIREBASE_PROJECT_ID${suffix} set — falling back to FIREBASE_PROJECT_ID (${projectId}).`);
  console.warn(`   Verify this matches the intended ${env} project before continuing.\n`);
}

const BATCH_LIMIT = 400;
const PROTECTED_PROJECT_IDS = new Set(['owlette-prod-90a12']);

function warnIfWorktree(logPath) {
  try {
    if (statSync(join(ROOT, '.git')).isFile() && !logFileArg) {
      console.warn('⚠️  This is a git worktree and the log is being written inside it:');
      console.warn(`     ${logPath}`);
      console.warn('   `git worktree remove` deletes it along with your only rollback anchor.');
      console.warn('   Pass --log-file=<absolute path outside the worktree> instead.\n');
    }
  } catch {
    /* not a worktree */
  }
}

function promptYesNo(question) {
  return new Promise((res) => {
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
  const toRestore = [];
  for (const entry of log.applied) {
    const snap = await db.collection('users').doc(entry.uid).get();
    if (!snap.exists) {
      console.log(`  absent users/${entry.uid} — deleted since`);
      continue;
    }
    const now = snap.data()?.role;
    if (now !== TARGET) {
      console.log(`  KEEP   users/${entry.uid} — role is '${now}', not '${TARGET}'; changed since the run`);
      continue;
    }
    toRestore.push(entry);
    console.log(`  restore users/${entry.uid}  '${TARGET}' -> '${entry.from}'`);
  }
  console.log('');
  if (toRestore.length === 0) {
    console.log('✅ nothing to reverse.\n');
    return;
  }
  if (PROTECTED_PROJECT_IDS.has(projectId)) {
    const ok = await promptYesNo(`Restore ${toRestore.length} role value(s) in ${projectId}? [y/N] `);
    if (!ok) {
      console.log('aborted — no writes performed.\n');
      process.exit(3);
    }
  }
  let done = 0;
  for (let i = 0; i < toRestore.length; i += BATCH_LIMIT) {
    const chunk = toRestore.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const e of chunk) batch.update(db.collection('users').doc(e.uid), { role: e.from });
    await batch.commit();
    done += chunk.length;
    console.log(`  restored ${done}/${toRestore.length}`);
  }
  console.log(`\n✅ restored ${done} role value(s).\n`);
}

async function main() {
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Global role value migration — env=${env}, project=${projectId}\n`);

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey: rawKey.replace(/\\n/g, '\n') }), projectId });
  const db = getFirestore();

  if (rollback) return runRollback(db);

  const [usersSnap, sitesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('sites').get(),
  ]);

  /** uid -> highest per-site standing held anywhere. */
  const standing = new Map();
  for (const site of sitesSnap.docs) {
    for (const m of (await site.ref.collection('members').get()).docs) {
      const data = m.data() ?? {};
      if (data.status !== 'active') continue;
      if (data.role === 'owner' || data.role === 'admin') standing.set(m.id, data.role);
      else if (!standing.has(m.id)) standing.set(m.id, 'member');
    }
  }

  const toRewrite = [];
  const alreadyDone = [];
  const superadmins = [];
  const unexpected = [];
  /** Global admins with no owner/admin membership — demoting them removes real authority. */
  const unconverted = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data() ?? {};
    const role = data.role;
    if (role === 'superadmin') {
      superadmins.push(doc.id);
      continue;
    }
    if (role === TARGET) {
      alreadyDone.push(doc.id);
      continue;
    }
    if (typeof role !== 'string' || !REWRITABLE.has(role)) {
      unexpected.push({ uid: doc.id, role: role === undefined ? '(absent)' : String(role) });
      continue;
    }
    if (role === 'admin') {
      const held = standing.get(doc.id);
      if (held !== 'owner' && held !== 'admin') {
        unconverted.push({ uid: doc.id, email: data.email ?? 'unknown', heldStanding: held ?? 'none' });
      }
    }
    toRewrite.push({ uid: doc.id, from: role, email: data.email ?? 'unknown' });
  }

  console.log('--- blast radius ---');
  console.log(`  users scanned            : ${usersSnap.size}`);
  console.log(`  superadmins (untouched)  : ${superadmins.length}`);
  console.log(`  already '${TARGET}'          : ${alreadyDone.length}`);
  console.log(`  TO REWRITE               : ${toRewrite.length}`);
  for (const from of [...REWRITABLE]) {
    const n = toRewrite.filter((r) => r.from === from).length;
    if (n > 0) console.log(`     from '${from}'`.padEnd(29) + `: ${n}`);
  }
  if (unexpected.length > 0) {
    console.log(`  unrecognised (skipped)   : ${unexpected.length}`);
    for (const u of unexpected) console.log(`      ${u.uid}  role=${u.role}`);
  }
  console.log('');

  if (toRewrite.length > 0) {
    for (const r of toRewrite) {
      console.log(`  users/${r.uid}  '${r.from}' -> '${TARGET}'  ${r.email}`);
    }
    console.log('');
  }

  if (unconverted.length > 0) {
    console.log('⛔ global admins holding NO owner/admin membership anywhere:');
    for (const u of unconverted) {
      console.log(`      ${u.uid}  ${u.email}  (highest standing: ${u.heldStanding})`);
    }
    console.log('   Demoting these removes authority they still rely on. Run the wave 3.3');
    console.log('   conversion first (backfill-per-site-membership.mjs --convert-global-admins),');
    console.log('   or pass --allow-unconverted-admins if the demotion is intended.\n');
    if (!allowUnconverted) {
      console.log('⛔ refusing.\n');
      process.exit(3);
    }
  }

  if (toRewrite.length === 0) {
    console.log('✅ nothing to rewrite.\n');
    return;
  }
  if (dryRun) {
    console.log('[DRY RUN] no writes performed.\n');
    return;
  }

  if (!sessionsHaveCycled) {
    console.log('⛔ refusing without --sessions-have-cycled.');
    console.log('   A tab holding a session parsed by the pre-wave-4.3 client has the narrow');
    console.log('   role parser, and flipping the value under it strips every site-admin');
    console.log('   control with no reload. Confirm sessions have cycled onto the');
    console.log('   membership-aware client, then re-run with the flag.\n');
    process.exit(3);
  }

  if (PROTECTED_PROJECT_IDS.has(projectId)) {
    const ok = await promptYesNo(`Rewrite ${toRewrite.length} role value(s) in PRODUCTION (${projectId})? [y/N] `);
    if (!ok) {
      console.log('aborted — no writes performed.\n');
      process.exit(3);
    }
  }

  const logPath =
    (typeof logFileArg === 'string' && resolve(logFileArg)) ||
    join(ROOT, 'scripts', 'migrations', `migrate-global-role-values.${projectId}.log.json`);
  warnIfWorktree(logPath);

  const log = {
    script: 'migrate-global-role-values.mjs',
    projectId,
    env,
    startedAt: new Date().toISOString(),
    completedAt: null,
    target: TARGET,
    planned: toRewrite,
    applied: [],
  };
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`change log: ${logPath}\n`);

  let done = 0;
  for (let i = 0; i < toRewrite.length; i += BATCH_LIMIT) {
    const chunk = toRewrite.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const r of chunk) batch.update(db.collection('users').doc(r.uid), { role: TARGET });
    try {
      await batch.commit();
    } catch (err) {
      log.completedAt = new Date().toISOString();
      log.error = String(err?.message ?? err);
      writeFileSync(logPath, JSON.stringify(log, null, 2));
      console.error(`\n❌ batch failed after ${done} document(s): ${log.error}`);
      process.exit(4);
    }
    log.applied.push(...chunk);
    done += chunk.length;
    writeFileSync(logPath, JSON.stringify(log, null, 2));
    console.log(`  rewritten ${done}/${toRewrite.length}`);
  }

  log.completedAt = new Date().toISOString();
  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`\n✅ rewrote ${done} role value(s).`);
  console.log(`\nTo reverse:\n  node scripts/migrations/migrate-global-role-values.mjs --env=${env} --rollback --log-file=${logPath}\n`);
}

main().catch((err) => {
  console.error('\n❌ migration failed:', err?.message ?? err);
  process.exit(1);
});
