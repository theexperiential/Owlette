#!/usr/bin/env node
/**
 * Version Sync Script for Owlette Monorepo
 *
 * Keeps component versions in sync with product version.
 *
 * Usage:
 *   node scripts/sync-versions.js [new-version]
 *
 * Examples:
 *   node scripts/sync-versions.js         # Show current versions
 *   node scripts/sync-versions.js 2.1.0   # Bump all to 2.1.0
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Version file paths
const VERSION_FILES = {
  product: path.join(ROOT, 'VERSION'),
  agent: path.join(ROOT, 'agent', 'VERSION'),
  web: path.join(ROOT, 'web', 'package.json'),
};

// Read version from file
function readVersion(file) {
  if (file.endsWith('.json')) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return pkg.version;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

// Write version to file
function writeVersion(file, version) {
  if (file.endsWith('.json')) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } else {
    fs.writeFileSync(file, version + '\n', 'utf8');
  }
}

// Show current versions
function showVersions() {
  console.log('\n📦 Current Versions:\n');
  console.log(`  Product:  ${readVersion(VERSION_FILES.product)}`);
  console.log(`  Agent:    ${readVersion(VERSION_FILES.agent)}`);
  console.log(`  Web:      ${readVersion(VERSION_FILES.web)}`);
  console.log('\n  Note: Firestore rules version is independent (tracks schema changes)\n');
}

// Sync all versions
function syncVersions(newVersion) {
  if (!newVersion.match(/^\d+\.\d+\.\d+$/)) {
    console.error(`❌ Invalid version format: ${newVersion}`);
    console.error('   Expected format: X.Y.Z (e.g., 2.1.0)');
    process.exit(1);
  }

  console.log(`\n🔄 Syncing all versions to ${newVersion}...\n`);

  writeVersion(VERSION_FILES.product, newVersion);
  console.log(`  ✅ Updated /VERSION → ${newVersion}`);

  writeVersion(VERSION_FILES.agent, newVersion);
  console.log(`  ✅ Updated agent/VERSION → ${newVersion}`);

  writeVersion(VERSION_FILES.web, newVersion);
  console.log(`  ✅ Updated web/package.json → ${newVersion}`);

  console.log('\n✨ All versions synced!\n');
  console.log('⚠️  Remember to:');
  console.log('   1. Update CHANGELOG.md with release notes');
  console.log('   2. Commit changes: git commit -am "chore: Bump version to ' + newVersion + '"');
  console.log('   3. Create tag: git tag v' + newVersion);
  console.log('   4. Push with tags: git push origin main --tags\n');
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  showVersions();
} else if (args.length === 1) {
  syncVersions(args[0]);
} else {
  console.error('Usage: node scripts/sync-versions.js [new-version]');
  process.exit(1);
}
