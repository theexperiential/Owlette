#!/usr/bin/env node
/**
 * Security preflight: no unaddressed vulnerability alert on this checkout.
 *
 * Owlette's problem is not that GitHub is quiet — it is that GitHub is loud in
 * the wrong place. Dependabot raises *security* alerts and PRs against the
 * default branch (`main`), which trails `dev` by hundreds of commits, and
 * `target-branch` in `.github/dependabot.yml` does not apply to them. So the
 * alert list is a mix of three things that look identical in the UI:
 *
 *   1. genuinely vulnerable code that is still shipping           -> BLOCK
 *   2. already fixed on `dev`, still open because `main` is stale -> warn
 *   3. filed against a manifest this branch no longer has         -> warn
 *
 * In September 2026 that mix reached 39 open alerts, of which 5 were real and
 * two were an unauthenticated RCE in Next.js. Nobody could tell, so nobody
 * looked. This script tells them apart by resolving every open alert against
 * the lockfiles *in this working tree* rather than trusting the alert's state.
 *
 * Fails CLOSED: a check that cannot run is itself a blocker, so a throttled
 * API call never reads as "nothing open".
 *
 * Usage:
 *   node scripts/check-security-alerts.mjs [--ack KEY[,KEY...]] [--json]
 *                                          [--repo OWNER/NAME] [--stale-days N]
 *   node scripts/check-security-alerts.mjs --test      # self-test, no network
 *
 * Exit: 0 = clear (or every blocker acknowledged), 1 = blocked.
 * Needs: an authenticated `gh` CLI, run from anywhere inside the checkout.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 120_000;

/** A Dependabot PR left open longer than this is itself a blocker. */
const DEFAULT_STALE_DAYS = 30;

/** Alert severities that block even when only reachable in a dev dependency. */
const BLOCKING_SEVERITIES = new Set(['critical', 'high', 'medium', 'moderate', 'low']);

class CheckError extends Error {}

// ---------------------------------------------------------------------------
// version ranges
//
// GitHub's `vulnerable_version_range` is a deliberately small grammar: a
// comma-separated list of `<op> <version>` comparators, ANDed together
// (e.g. ">= 16.0.0, < 16.3.3", "<= 1.7.0", "< 0.35.4", "= 1.2.3"). It is not
// npm range syntax — no carets, no `||`. Parsing it directly keeps this script
// dependency-free, which is what lets the CI job run on a bare checkout.
// ---------------------------------------------------------------------------

/** Split a version into numeric release parts plus a prerelease tag. */
function parseVersion(raw) {
  const text = String(raw).trim().replace(/^[=vV]+/, '');
  const [core, prerelease = ''] = text.split('-', 2);
  const parts = core.split('.').map((n) => {
    const v = Number.parseInt(n, 10);
    return Number.isNaN(v) ? 0 : v;
  });
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease: prerelease.split('+')[0] };
}

/** Compare two versions: -1, 0, or 1. A prerelease sorts below its release. */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.parts.length, vb.parts.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (va.prerelease === vb.prerelease) return 0;
  if (va.prerelease === '') return 1; // 1.0.0 > 1.0.0-rc.1
  if (vb.prerelease === '') return -1;
  return va.prerelease < vb.prerelease ? -1 : 1;
}

/** Does `version` satisfy every comparator in a GitHub vulnerable range? */
export function inVulnerableRange(version, range) {
  if (!range || !String(range).trim()) return false;
  const clauses = String(range).split(',').map((c) => c.trim()).filter(Boolean);
  if (clauses.length === 0) return false;
  for (const clause of clauses) {
    const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(clause);
    if (!match) throw new CheckError(`unparseable version clause: "${clause}"`);
    const op = match[1] ?? '=';
    const cmp = compareVersions(version, match[2].trim());
    const ok =
      (op === '>=' && cmp >= 0) ||
      (op === '<=' && cmp <= 0) ||
      (op === '>' && cmp > 0) ||
      (op === '<' && cmp < 0) ||
      (op === '=' && cmp === 0);
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// resolving an alert against THIS checkout
// ---------------------------------------------------------------------------

/** Every version of `pkg` pinned by an npm lockfile (v2/v3 `packages` map). */
function npmVersions(text, pkg) {
  const lock = JSON.parse(text);
  const suffix = `node_modules/${pkg}`;
  const found = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if ((path === suffix || path.endsWith(`/${suffix}`)) && entry?.version) {
      found.push(entry.version);
    }
  }
  // A workspace root can also declare the package as its own name/version.
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (entry?.name === pkg && entry?.version && !path.includes('node_modules')) {
      found.push(entry.version);
    }
  }
  return [...new Set(found)];
}

/** Every version of `crate` pinned by a Cargo.lock. */
function cargoVersions(text, crate) {
  const found = [];
  const blocks = text.split(/\[\[package\]\]/);
  for (const block of blocks) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block);
    if (name && version && name[1] === crate) found.push(version[1]);
  }
  return [...new Set(found)];
}

/**
 * Versions of `pkg` pinned by a pip requirements file. Only `==` pins are a
 * known version; a `>=` floor is reported as unknown so it never reads as
 * safe on a guess.
 */
function pipVersions(text, pkg) {
  const found = [];
  let loose = false;
  const normalize = (s) => s.toLowerCase().replace(/[-_.]+/g, '-');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!match || normalize(match[1]) !== normalize(pkg)) continue;
    const pinned = /==\s*([A-Za-z0-9][A-Za-z0-9.!+*-]*)/.exec(match[3]);
    if (pinned) found.push(pinned[1]);
    else loose = true;
  }
  return { versions: [...new Set(found)], loose };
}

/**
 * Resolve one alert against the working tree.
 * Returns { state, versions } where state is one of:
 *   'live'      - a pinned version falls inside the vulnerable range
 *   'fixed'     - the manifest is here and no pinned version is vulnerable
 *   'gone'      - the manifest is here but no longer pins the package at all
 *   'orphaned'  - the manifest does not exist on this branch
 *   'unknown'   - present but unpinned, or an ecosystem we cannot resolve
 */
export function resolveAlert(alert, { root = REPO_ROOT, readFile = readFileSync, exists = existsSync } = {}) {
  const dep = alert?.dependency ?? {};
  const manifest = dep.manifest_path;
  const pkg = dep.package?.name;
  const ecosystem = (dep.package?.ecosystem ?? '').toLowerCase();
  const range = alert?.security_vulnerability?.vulnerable_version_range;

  if (!manifest || !pkg) throw new CheckError('alert is missing a package or manifest path');

  const full = join(root, manifest);
  if (!exists(full)) return { state: 'orphaned', versions: [] };

  const text = readFile(full, 'utf8');
  let versions = [];
  let loose = false;

  if (ecosystem === 'npm') {
    versions = npmVersions(text, pkg);
  } else if (ecosystem === 'rust' || ecosystem === 'cargo') {
    versions = cargoVersions(text, pkg);
  } else if (ecosystem === 'pip') {
    ({ versions, loose } = pipVersions(text, pkg));
  } else {
    // github-actions and anything new: we cannot resolve it, so we do not get
    // to call it safe.
    return { state: 'unknown', versions: [] };
  }

  if (versions.length === 0) return { state: loose ? 'unknown' : 'gone', versions: [] };

  const vulnerable = versions.filter((v) => inVulnerableRange(v, range));
  if (vulnerable.length > 0) return { state: 'live', versions: vulnerable };
  if (loose) return { state: 'unknown', versions };
  return { state: 'fixed', versions };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim().split('\n')[0];
    throw new CheckError(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${detail.slice(0, 300)}`);
  }
}

function ghJson(args) {
  const out = run('gh', args);
  if (!out.trim()) return null;
  try {
    return JSON.parse(out);
  } catch (err) {
    throw new CheckError(`gh ${args.slice(0, 2).join(' ')}: unparseable output (${err.message})`);
  }
}

const finding = (level, key, text) => ({ level, key, text });

function checkDependabotAlerts(repo, findings, alertedPackages) {
  let alerts;
  try {
    alerts = ghJson(['api', '--paginate', `repos/${repo}/dependabot/alerts?state=open&per_page=100`]);
  } catch (err) {
    findings.push(finding('block', 'verify:dependabot', `could not read Dependabot alerts: ${err.message}`));
    return;
  }
  if (!Array.isArray(alerts)) {
    findings.push(finding('block', 'verify:dependabot', 'unexpected Dependabot alerts response'));
    return;
  }
  for (const alert of alerts) {
    const number = alert?.number;
    const advisory = alert?.security_advisory ?? {};
    const severity = (advisory.severity ?? '?').toLowerCase();
    const pkg = alert?.dependency?.package?.name ?? '?';
    const manifest = alert?.dependency?.manifest_path ?? '?';
    const fixedIn = alert?.security_vulnerability?.first_patched_version?.identifier ?? 'no patched release';
    const key = `alert:dependabot:${number}`;

    let resolved;
    try {
      resolved = resolveAlert(alert);
    } catch (err) {
      findings.push(finding('block', key, `could not resolve alert #${number} (${pkg}): ${err.message}`));
      continue;
    }

    const where = `${pkg} in ${manifest}`;
    const what = `[${severity}] ${where} -> fix ${fixedIn}: ${advisory.summary ?? ''}`;
    // Only an alert that is still live HERE makes a pending PR for that package
    // urgent. An alert left open because `main` is stale does not.
    if ((resolved.state === 'live' || resolved.state === 'unknown') && pkg !== '?') alertedPackages.add(pkg);

    if (resolved.state === 'live' && BLOCKING_SEVERITIES.has(severity)) {
      findings.push(finding('block', key, `LIVE on this branch (${resolved.versions.join(', ')}) ${what}`));
    } else if (resolved.state === 'unknown') {
      findings.push(finding('block', key, `UNRESOLVED — cannot prove this branch is safe. ${what}`));
    } else if (resolved.state === 'fixed') {
      findings.push(finding('warn', key, `fixed here (${resolved.versions.join(', ')}), still open on the default branch — clears when dev reaches main. ${what}`));
    } else if (resolved.state === 'gone') {
      findings.push(finding('warn', key, `package no longer in ${manifest} on this branch. ${what}`));
    } else {
      findings.push(finding('warn', key, `${manifest} does not exist on this branch. ${what}`));
    }
  }
}

function checkScanningAlerts(repo, findings, branch) {
  for (const kind of ['code-scanning', 'secret-scanning']) {
    let alerts;
    try {
      alerts = ghJson(['api', '--paginate', `repos/${repo}/${kind}/alerts?state=open&per_page=100`]);
    } catch (err) {
      // A repo with the feature switched off answers 404; that is not a finding.
      if (/404|not enabled|disabled/i.test(err.message)) continue;
      findings.push(finding('block', `verify:${kind}`, `could not read ${kind} alerts: ${err.message}`));
      continue;
    }
    if (!Array.isArray(alerts)) continue;
    for (const alert of alerts) {
      const label =
        kind === 'code-scanning'
          ? `${alert?.rule?.id ?? '?'} in ${alert?.most_recent_instance?.location?.path ?? '?'}`
          : (alert?.secret_type_display_name ?? alert?.secret_type ?? '?');
      // Code scanning is per-ref, and it has exactly the same staleness trap as
      // Dependabot: zizmor only scanned `main` for a long time, so every alert
      // described `main`'s workflows while `dev` had moved on. Only an alert
      // whose latest instance is on THIS branch is evidence about this branch.
      const ref = alert?.most_recent_instance?.ref;
      const onThisBranch = !ref || !branch || ref === `refs/heads/${branch}`;
      const level = kind === 'secret-scanning' || onThisBranch ? 'block' : 'warn';
      const where = onThisBranch ? '' : ` [last seen on ${String(ref).replace('refs/heads/', '')}, not ${branch}]`;
      findings.push(finding(level, `alert:${kind}:${alert?.number}`,
        `open ${kind} alert: ${label}${where} ${alert?.html_url ?? ''}`));
    }
  }
}

function checkAdvisories(repo, findings) {
  for (const state of ['triage', 'draft']) {
    let items;
    try {
      items = ghJson(['api', '--paginate', `repos/${repo}/security-advisories?state=${state}&per_page=100`]);
    } catch (err) {
      if (/404/i.test(err.message)) continue;
      // Repository advisories are the one feed the Actions GITHUB_TOKEN cannot
      // read (there is no permission key for them), so a 403 in CI is a token
      // limit, not a hidden advisory. Surface it as a warning to be checked by
      // hand rather than wedging the job permanently red.
      const level = /403|not accessible/i.test(err.message) ? 'warn' : 'block';
      findings.push(finding(level, `verify:advisory-${state}`,
        `could not read ${state} advisories (check github.com by hand): ${err.message}`));
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const adv of items) {
      findings.push(finding('block', `advisory:${adv?.ghsa_id}`, `${state} security advisory ${adv?.ghsa_id}: ${adv?.summary ?? ''} ${adv?.html_url ?? ''}`));
    }
  }
}

const DEPENDABOT_LOGINS = new Set(['app/dependabot', 'dependabot', 'dependabot[bot]']);

/**
 * @param alertedPackages packages that currently have an open Dependabot alert.
 *
 * Owlette's Dependabot PRs target `main` and land on `dev` by hand, so an open
 * one is normal and a backlog of major-version bumps (eslint 10, @types/node
 * 26) is a deliberate, reviewed queue — not a security problem. Blocking on
 * those would keep this gate permanently red, which is precisely how a gate
 * stops being read.
 *
 * So the rule is narrower and means something: a stale PR blocks only when it
 * carries a fix for a package that still has an OPEN security alert. That is a
 * real fix rotting in a queue. Everything else ages as a warning.
 */
function checkDependabotPrs(repo, findings, staleDays, alertedPackages) {
  let prs;
  try {
    prs = ghJson(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200',
      '--json', 'number,title,author,url,createdAt']);
  } catch (err) {
    findings.push(finding('block', 'verify:prs', `could not list pull requests: ${err.message}`));
    return;
  }
  const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  for (const pr of prs ?? []) {
    if (!DEPENDABOT_LOGINS.has(pr?.author?.login ?? '')) continue;
    const opened = Date.parse(pr.createdAt);
    const age = Number.isNaN(opened) ? 0 : Math.floor((Date.now() - opened) / 86_400_000);
    const label = `#${pr.number} ${pr.title} (open ${age}d) ${pr.url}`;
    const stale = !Number.isNaN(opened) && opened < cutoff;
    const carriesFix = [...alertedPackages].find((pkg) =>
      new RegExp(`(^|[\\s"'\`])${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"'\`]|$)`, 'i').test(pr.title));

    if (stale && carriesFix) {
      findings.push(finding('block', `pr:${pr.number}`,
        `SECURITY PR stale >${staleDays}d — ${carriesFix} still has an open alert. Land it on dev or close it: ${label}`));
    } else if (stale) {
      findings.push(finding('warn', `pr:${pr.number}`, `Dependabot PR stale >${staleDays}d (no open alert for it) ${label}`));
    } else {
      findings.push(finding('warn', `pr:${pr.number}`, `open Dependabot PR ${label}`));
    }
  }
}

// ---------------------------------------------------------------------------
// self-test — a checker that cannot fail is worth nothing
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
  };

  // Range matching, both directions.
  check('next 16.3.2 is vulnerable', inVulnerableRange('16.3.2', '>= 16.0.0, < 16.3.3'), true);
  check('next 16.3.4 is NOT vulnerable', inVulnerableRange('16.3.4', '>= 16.0.0, < 16.3.3'), false);
  check('next 15.9.9 is below the range', inVulnerableRange('15.9.9', '>= 16.0.0, < 16.3.3'), false);
  check('sharp 0.35.3 is vulnerable', inVulnerableRange('0.35.3', '< 0.35.4'), true);
  check('sharp 0.35.4 is NOT vulnerable', inVulnerableRange('0.35.4', '< 0.35.4'), false);
  check('smol-toml 1.7.0 is vulnerable (<=)', inVulnerableRange('1.7.0', '<= 1.7.0'), true);
  check('smol-toml 1.8.0 is NOT vulnerable', inVulnerableRange('1.8.0', '<= 1.7.0'), false);
  check('prerelease sorts below its release', inVulnerableRange('4.0.0-beta.10', '>= 4.0.0-beta.10, < 4.0.33'), true);
  check('short version pads to zero', inVulnerableRange('0.18', '< 0.20.0'), true);

  // Lockfile parsing, including a nested (non-hoisted) copy.
  const npmLock = JSON.stringify({
    packages: {
      '': { name: 'root', version: '1.0.0' },
      'node_modules/next': { version: '16.3.4' },
      'cli/node_modules/smol-toml': { version: '1.6.1' },
      'node_modules/unrelated': { version: '9.9.9' },
    },
  });
  check('hoisted npm version', npmVersions(npmLock, 'next'), ['16.3.4']);
  check('nested npm version', npmVersions(npmLock, 'smol-toml'), ['1.6.1']);
  check('absent npm package', npmVersions(npmLock, 'sharp'), []);
  // A package whose name is a suffix of another must not match.
  check('suffix names do not collide', npmVersions(JSON.stringify({
    packages: { 'node_modules/@scope/next': { version: '1.0.0' } },
  }), 'next'), []);

  const cargoLock = '[[package]]\nname = "glib"\nversion = "0.18.5"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n';
  check('cargo version', cargoVersions(cargoLock, 'glib'), ['0.18.5']);
  check('absent crate', cargoVersions(cargoLock, 'tokio'), []);

  check('pip pin', pipVersions('pytest==9.0.3\nblack==24.3.0\n', 'pytest'), { versions: ['9.0.3'], loose: false });
  check('pip loose floor is not a pin', pipVersions('pytest>=7.0\n', 'pytest'), { versions: [], loose: true });
  check('pip name normalization', pipVersions('pytest_asyncio==1.4.0\n', 'pytest-asyncio'), { versions: ['1.4.0'], loose: false });
  check('pip comment ignored', pipVersions('# pytest==1.0.0\npytest==9.0.3\n', 'pytest'), { versions: ['9.0.3'], loose: false });

  // End-to-end classification against a synthetic tree — the negative control
  // is the same alert resolving to 'fixed' once the lockfile is patched.
  const alert = {
    dependency: { manifest_path: 'web/package-lock.json', package: { name: 'next', ecosystem: 'npm' } },
    security_vulnerability: { vulnerable_version_range: '>= 16.0.0, < 16.3.3' },
  };
  const fakeTree = (version) => ({
    root: '/fake',
    exists: () => true,
    readFile: () => JSON.stringify({ packages: { 'node_modules/next': { version } } }),
  });
  check('vulnerable lockfile is LIVE', resolveAlert(alert, fakeTree('16.3.2')).state, 'live');
  check('patched lockfile is FIXED', resolveAlert(alert, fakeTree('16.3.4')).state, 'fixed');
  check('missing manifest is ORPHANED',
    resolveAlert(alert, { root: '/fake', exists: () => false, readFile: () => '' }).state, 'orphaned');
  check('removed package is GONE', resolveAlert(alert, {
    root: '/fake', exists: () => true, readFile: () => JSON.stringify({ packages: {} }),
  }).state, 'gone');
  check('unresolvable ecosystem is UNKNOWN', resolveAlert({
    ...alert, dependency: { ...alert.dependency, package: { name: 'actions/checkout', ecosystem: 'github-actions' } },
  }, fakeTree('16.3.2')).state, 'unknown');

  if (failures.length > 0) {
    console.error(`self-test FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('self-test passed (24 assertions)');
  return 0;
}

// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--test')) return selfTest();

  const asJson = args.includes('--json');
  const valueOf = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const staleDays = Number.parseInt(valueOf('--stale-days', String(DEFAULT_STALE_DAYS)), 10);
  const acks = new Set(
    args.flatMap((a, i) => (args[i - 1] === '--ack' ? a.split(',') : [])).map((k) => k.trim()).filter(Boolean),
  );

  let repo = valueOf('--repo', null);
  if (!repo) {
    try {
      repo = ghJson(['repo', 'view', '--json', 'nameWithOwner'])?.nameWithOwner;
    } catch (err) {
      console.error(`RESULT: BLOCKED — cannot resolve the repo (${err.message}); pass --repo OWNER/NAME`);
      return 1;
    }
  }

  // Resolve the branch first: code-scanning findings are graded against it.
  // In Actions a PR checkout is detached, so prefer the ref the workflow gives us.
  let branch = process.env.GITHUB_REF_NAME ?? '';
  if (!branch) {
    try {
      branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    } catch { /* a detached or absent git is not itself a security finding */ }
  }
  if (!branch || branch === 'HEAD') branch = '';

  const findings = [];
  const alertedPackages = new Set();
  checkDependabotAlerts(repo, findings, alertedPackages);
  checkScanningAlerts(repo, findings, branch);
  checkAdvisories(repo, findings);
  checkDependabotPrs(repo, findings, staleDays, alertedPackages);

  const blockers = findings.filter((f) => f.level === 'block');
  const openBlockers = blockers.filter((f) => !acks.has(f.key));
  const warnings = findings.filter((f) => f.level === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ repo, blockers, warnings, acked: [...acks], blocked: openBlockers.length > 0 }, null, 2));
    return openBlockers.length > 0 ? 1 : 0;
  }

  console.log(`owlette security preflight: ${repo} (resolved against ${branch || 'this checkout'})`);
  for (const [title, items] of [['BLOCKING', blockers], ['WARNING', warnings]]) {
    console.log(`${title} (${items.length})`);
    for (const f of items) console.log(`  ${acks.has(f.key) ? 'ACKED ' : ''}[${f.key}] ${f.text}`);
  }
  for (const key of [...acks].filter((k) => !findings.some((f) => f.key === k)).sort()) {
    console.log(`NOTE: --ack ${key} matched nothing; check the key`);
  }

  if (openBlockers.length > 0) {
    console.log(`RESULT: BLOCKED by ${openBlockers.length} item(s). Fix each one, dismiss it on GitHub with a ` +
      'reason, or re-run with --ack "<key>" for items the user explicitly accepted. Report every warning too.');
    return 1;
  }
  console.log(`RESULT: CLEAR (${blockers.length} acknowledged blocker(s), ${warnings.length} warning(s) to report)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-security-alerts.mjs')) {
  process.exit(main(process.argv));
}
