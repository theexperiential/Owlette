#!/usr/bin/env node
/**
 * Release-time refresh of the agent docs screenshots.
 *
 * WHY THIS EXISTS RATHER THAN JUST `npm run screenshots:desktop`: the capture
 * harness drives the app INSTALLED at C:\ProgramData\Owlette\app, not the one
 * you just built. Running the bare capture after a build silently photographs
 * the PREVIOUS version — the shots look fine, they are just wrong, and nobody
 * notices until a customer sees an old version string in the docs. That is how
 * the screenshots ended up three minor versions stale.
 *
 * So this does the whole thing in order:
 *   1. refuse unless the built desktop exe matches VERSION
 *   2. swap it into the install (needs the service stopped — it respawns the
 *      tray within seconds of it dying, which holds the exe lock)
 *   3. run the capture
 *   4. record what was photographed, so staleness is detectable later
 *      (`scripts/check-docs-screens-current.mjs`) instead of remembered
 *
 * Step 2 needs elevation and step 3 needs an interactive desktop session with
 * the owlette tray icon VISIBLE — not in the hidden-icons overflow, or the
 * tray-menu shot fails while the other eleven succeed.
 *
 * Usage:
 *   node scripts/refresh-docs-screens.mjs             full refresh
 *   node scripts/refresh-docs-screens.mjs --no-swap   capture only, exe as-is
 *   node scripts/refresh-docs-screens.mjs --check     report staleness, write nothing
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

const BUILT_EXE = join(ROOT, 'agent', 'build', 'installer_package', 'app', 'owlette-desktop.exe');
const INSTALLED_EXE = 'C:\\ProgramData\\Owlette\\app\\owlette-desktop.exe';
const MANIFEST = join(ROOT, 'web', 'public', 'docs-screens', 'captured.json');

const args = process.argv.slice(2);
const noSwap = args.includes('--no-swap');
const checkOnly = args.includes('--check');

/** File version of a Windows exe, or null if absent/unreadable. */
function exeVersion(path) {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `(Get-Item '${path}' -ErrorAction SilentlyContinue).VersionInfo.FileVersion`],
    { encoding: 'utf8' },
  );
  const v = (r.stdout ?? '').trim();
  return v || null;
}

if (checkOnly) {
  if (!existsSync(MANIFEST)) {
    console.error(`docs screenshots have no capture record (${MANIFEST} missing).`);
    console.error(`Run: node scripts/refresh-docs-screens.mjs`);
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (m.version !== VERSION) {
    console.error(`docs screenshots are STALE: captured against ${m.version}, VERSION is ${VERSION}.`);
    console.error(`Run: node scripts/refresh-docs-screens.mjs`);
    process.exit(1);
  }
  console.log(`docs screenshots are current (captured against ${m.version} on ${m.capturedAt}).`);
  if (m.missing?.length) {
    console.log(`note: ${m.missing.length} shot(s) failed in that run: ${m.missing.join(', ')}`);
  }
  process.exit(0);
}

// 1. The built exe must be the version we are releasing.
if (!noSwap) {
  if (!existsSync(BUILT_EXE)) {
    console.error(`no built desktop exe at ${BUILT_EXE}`);
    console.error('Build the installer first: agent/build_installer_full.bat');
    process.exit(1);
  }
  const built = exeVersion(BUILT_EXE);
  if (built !== VERSION) {
    console.error(`built desktop exe is ${built}, VERSION is ${VERSION} — refusing.`);
    console.error('Rebuild the installer so the capture photographs what ships.');
    process.exit(1);
  }
  console.log(`built desktop exe: ${built}`);

  // 2. Swap it in. Elevated, because the service must stop for the copy.
  const installed = exeVersion(INSTALLED_EXE);
  if (installed === VERSION) {
    console.log(`installed desktop exe already ${installed} — no swap needed.`);
  } else {
    console.log(`installed desktop exe is ${installed ?? 'absent'} — swapping in ${VERSION}...`);
    const cmd = [
      'net stop OwletteService',
      'taskkill /F /IM owlette-desktop.exe',
      'ping -n 4 127.0.0.1 > nul',
      `copy /Y "${BUILT_EXE}" "${INSTALLED_EXE}"`,
      'net start OwletteService',
    ].join(' & ');
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command',
       `Start-Process cmd -ArgumentList '/c ${cmd.replace(/'/g, "''")}' -Verb RunAs -Wait`],
      { encoding: 'utf8', stdio: 'inherit' },
    );
    if (r.status !== 0) {
      console.error('elevated swap failed — see the UAC prompt / console output above.');
      process.exit(1);
    }
    const now = exeVersion(INSTALLED_EXE);
    if (now !== VERSION) {
      console.error(`swap did not take: installed exe is ${now}, expected ${VERSION}.`);
      process.exit(1);
    }
    console.log(`installed desktop exe now ${now}.`);
    // The service respawns the tray on its next status check; the capture needs it.
    console.log('waiting for the service to respawn the tray...');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 20']);
  }
}

// 3. Capture.
console.log('\ncapturing...');
const cap = spawnSync('npm', ['run', 'screenshots:desktop'], {
  cwd: join(ROOT, 'web'),
  encoding: 'utf8',
  shell: true,
});
const out = `${cap.stdout ?? ''}${cap.stderr ?? ''}`;
process.stdout.write(out.slice(-4000));

// A partial capture is still worth recording: the tray-menu shot fails whenever
// the icon sits in the hidden-icons overflow, and the other eleven are fine.
const missing = [];
if (/the tray right-click menu/.test(out) && /\d+ failed/.test(out)) {
  missing.push('agent-right-click.png (tray menu — icon likely in the hidden-icons overflow)');
}
if (cap.status !== 0 && missing.length === 0) {
  console.error('\ncapture failed for reasons beyond the known tray-menu case — not recording.');
  process.exit(1);
}

// 4. Record what was photographed.
writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      version: VERSION,
      capturedAt: new Date().toISOString(),
      installedExe: exeVersion(INSTALLED_EXE),
      missing,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nrecorded ${MANIFEST} (version ${VERSION})`);
if (missing.length) {
  console.log(`NOTE: ${missing.length} shot(s) not refreshed:`);
  for (const m of missing) console.log(`  - ${m}`);
}
console.log('\nCheck what changed: git diff --stat web/public/docs-screens');
