# Owlette Scripts

Utility scripts for managing the Owlette monorepo.

## Version Sync

Keep component versions synchronized across the monorepo.

### Usage

**Check current versions:**
```bash
node sync-versions.js
# or
python sync_versions.py
```

**Output:**
```
📦 Current Versions:

  Product:  2.0.4
  Agent:    2.0.4
  Web:      2.0.4

  Note: Firestore rules version is independent (tracks schema changes)
```

**Bump to new version:**
```bash
node sync-versions.js 2.1.0
# or
python sync_versions.py 2.1.0
```

This updates:
- `/VERSION` - Product release version
- `agent/VERSION` - Agent binary version
- `web/package.json` - Web app version

**The script will remind you to:**
1. Update CHANGELOG.md with release notes
2. Commit changes: `git commit -am "chore: Bump version to X.Y.Z"`
3. Create tag: `git tag vX.Y.Z`
4. Push with tags: `git push origin main --tags`

### Files Updated

| File | Component | Read By |
|------|-----------|---------|
| `/VERSION` | Product release | Documentation, releases |
| `agent/VERSION` | Agent binary | `agent/src/shared_utils.py` |
| `web/package.json` | Web app | npm, Next.js build |

### Firestore Rules Version

**NOT** automatically updated by this script.

Firestore rules track security schema changes independently:
- Current: 2.2.0 - Multi-User Site Access Control
- Update manually in `firestore.rules` header
- Only bump when authentication model or data structure changes

### Examples

**Normal release (sync all components):**
```bash
node sync-versions.js 2.1.0
# Update CHANGELOG.md
git add VERSION agent/VERSION web/package.json CHANGELOG.md
git commit -m "chore: Bump version to 2.1.0"
git tag v2.1.0
git push origin main --tags
```

**Pre-release version:**
```bash
node sync-versions.js 2.1.0-rc.1
```

**Check versions only:**
```bash
node sync-versions.js
```

## Related Documentation

- [docs/version-management.md](../docs/version-management.md) - Complete version management guide
- [.claude/CLAUDE.md](../.claude/CLAUDE.md#version-management) - Developer workflow
- [CHANGELOG.md](../CHANGELOG.md) - Release history

---

**Last Updated:** 2025-11-05
