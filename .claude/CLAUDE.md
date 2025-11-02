# Owlette - Cloud-Connected Process Management System

## Overview

Owlette is a cloud-connected Windows process management and remote deployment system designed for managing TouchDesigner installations, digital signage, kiosks, and media servers across multiple Windows machines. It consists of a Python-based Windows service (agent) and a Next.js web dashboard with Firebase/Firestore backend.

**Version**: 2.0.0
**License**: GNU General Public License v3.0
**Repository Type**: Monorepo (web + agent)

---

## Quick Reference

### Tech Stack

**Frontend (web/)**:
- Next.js 16.0.1 (App Router, React 19)
- TypeScript 5.x (strict mode)
- Tailwind CSS 4.x
- shadcn/ui components (Radix UI)
- Firebase Auth + Firestore
- React hooks for real-time data

**Backend (agent/)**:
- Python 3.9+ (Windows Service)
- Firebase Admin SDK
- psutil (process monitoring)
- pywin32 (Windows API)
- CustomTkinter (GUI)

**Database & Auth**:
- Cloud Firestore (real-time NoSQL)
- Firebase Authentication (Email/Password, Google OAuth)
- Bidirectional sync (agent ↔ Firestore ↔ web)

### Package Managers

- **Web**: npm (not pnpm or yarn)
- **Agent**: pip

---

## Build Commands

### Web Dashboard

```bash
# Install dependencies
cd web
npm install

# Development server (http://localhost:3000)
npm run dev

# Production build
npm run build

# Production server
npm start

# Lint
npm run lint
```

### Python Agent

```bash
# Install dependencies
cd agent
pip install -r requirements.txt

# Debug mode (requires admin)
cd src
python owlette_service.py debug

# Build executable
cd agent
build.bat

# Install as Windows service
install.bat

# Uninstall service
uninstall.bat
```

---

## Development Workflow

### Starting Large Tasks

When exiting plan mode with an accepted plan:

1. **Create Task Directory**:
   ```bash
   mkdir -p dev/active/[task-name]/
   ```

2. **Create Documents** (use `/create-dev-docs` command):
   - `[task-name]-plan.md` - The accepted plan with phases and timeline
   - `[task-name]-context.md` - Key files, architectural decisions, integration points
   - `[task-name]-tasks.md` - Detailed checklist of work items

3. **Update Regularly**: Mark tasks complete immediately as you finish them

4. **Before Compaction**: Run `/update-dev-docs` to capture progress and next steps

### Continuing Tasks

- Check `/dev/active/` for existing tasks before starting work
- Read all three files (plan, context, tasks) before proceeding
- Update "Last Updated" timestamps when modifying docs
- Move to `/dev/completed/` when task is fully done

### When to Use Dev Docs

✅ **Use for**:
- Multi-file features spanning web + agent
- Architecture changes or refactors
- Firebase integration work
- Complex bug fixes requiring investigation

❌ **Skip for**:
- Single-file tweaks
- Documentation updates
- Minor styling fixes
- Small bug fixes in one location

---

## Skills Auto-Activation System

### How It Works

This project uses **automatic skill activation** via the `user-prompt-submit` hook. Before Claude sees your message, the hook analyzes:

1. **Your prompt** for keywords and intent patterns
2. **Recently edited files** for path and content patterns
3. **Matching skills** from `skill-rules.json`

If matches are found, Claude receives a **skill activation reminder** before processing your request.

### Available Skills

| Skill | Auto-Activates When... | Purpose |
|-------|------------------------|---------|
| `frontend-dev-guidelines` | Working on `.tsx` files, React/Next.js keywords | Next.js App Router, React 19 patterns, TypeScript standards, shadcn/ui components |
| `backend-dev-guidelines` | Working on agent `.py` files, Python keywords | Windows service patterns, process monitoring, error handling, configuration |
| `firebase-integration` | Firebase imports, Firestore operations | Auth flows, Firestore CRUD, real-time listeners, security rules, offline resilience |
| `testing-guidelines` | Test files, "test" keyword | Jest/React Testing Library, pytest, integration testing, mocking strategies |
| `skill-developer` | Creating/updating skills | Meta-skill for writing new skills following Anthropic best practices |

### How to Reference Skills

You don't need to manually reference skills - they auto-activate! But if you want to explicitly invoke one:

```
Make sure to follow the patterns in frontend-dev-guidelines skill
```

---

## Automated Quality Checks

### Build Checker (Stop Hook)

After Claude finishes responding, the `stop` hook automatically:

1. Detects which files were edited
2. Determines affected repos (web vs agent)
3. Runs appropriate builds:
   - **Web**: `npm run build` (TypeScript + Next.js)
   - **Agent**: `python -m py_compile src/**/*.py`
4. Shows errors immediately (if < 5 errors) or recommends error-resolver agent (if ≥ 5)

**Result**: Zero TypeScript or Python errors left behind!

### Error Handling Reminder

If risky code patterns are detected (try-catch, async ops, database calls), Claude receives a gentle self-check reminder:

- Web: Error boundaries, toast notifications, retry logic
- Agent: Logging, Windows event log, graceful degradation
- Firebase: Offline handling, error callbacks

---

## Common Commands (Slash Commands)

### Planning & Documentation

- `/dev-docs` - Create comprehensive strategic plan (use in plan mode)
- `/create-dev-docs` - Convert approved plan into dev doc files
- `/update-dev-docs` - Update dev docs before context compaction

### Quality & Building

- `/code-review` - Launch code-architecture-reviewer agent
- `/build-and-fix` - Build both web + agent, fix all errors

Note: To run tests manually, use npm/pytest commands directly:
- Web tests: `cd web && npm test`
- Agent tests: `cd agent && pytest`

### Deployment

- `/deploy-web` - Deploy web dashboard to Railway

---

## Project Structure

```
Owlette/
├── .claude/                      # Claude Code configuration (YOU ARE HERE)
│   ├── skills/                   # Auto-activating skills
│   │   ├── frontend-dev-guidelines.md
│   │   ├── backend-dev-guidelines.md
│   │   ├── firebase-integration.md
│   │   ├── testing-guidelines.md
│   │   └── resources/            # Detailed skill resources
│   ├── hooks/                    # TypeScript hooks
│   │   ├── user-prompt-submit.ts # Skills auto-activation
│   │   ├── stop.ts               # Build checker + error reminder
│   │   └── skill-rules.json      # Skill activation rules
│   ├── commands/                 # Slash commands
│   ├── agents/                   # Specialized subagents
│   └── CLAUDE.md                 # This file
│
├── web/                          # Next.js Web Dashboard
│   ├── app/                      # App Router pages
│   │   ├── dashboard/            # Main dashboard
│   │   ├── deployments/          # Deployment management
│   │   ├── login/                # Auth pages
│   │   └── register/
│   ├── components/               # React components
│   │   └── ui/                   # shadcn/ui components
│   ├── contexts/                 # React contexts
│   │   └── AuthContext.tsx       # Firebase auth
│   ├── hooks/                    # Custom hooks
│   │   ├── useDeployments.ts
│   │   └── useFirestore.ts
│   ├── lib/                      # Utilities
│   │   ├── firebase.ts           # Firebase init
│   │   ├── errorHandler.ts
│   │   └── validators.ts
│   ├── .env.local                # Firebase config (gitignored)
│   ├── package.json
│   └── tsconfig.json
│
├── agent/                        # Python Windows Service
│   ├── src/                      # Python source
│   │   ├── owlette_service.py    # Main service
│   │   ├── firebase_client.py    # Firestore sync
│   │   ├── owlette_gui.py        # Config GUI
│   │   ├── owlette_tray.py       # System tray
│   │   └── shared_utils.py
│   ├── config/                   # Config (gitignored)
│   │   ├── config.json
│   │   └── firebase-credentials.json
│   ├── logs/                     # Log files (gitignored)
│   ├── build.bat                 # PyInstaller build
│   ├── install.bat               # Service installation
│   ├── requirements.txt
│   └── README.md
│
├── docs/                         # Documentation
│   ├── architecture-decisions.md # Architecture & strategy
│   ├── firebase-setup.md         # Firestore configuration
│   └── deployment.md             # Remote deployment
│
├── dev/                          # Development task tracking
│   ├── active/                   # Current tasks (dev docs)
│   └── completed/                # Archived tasks
│
├── README.md                     # Main project documentation
├── CHANGELOG.md                  # Version history
└── LICENSE                       # GPL v3.0
```

---

## Architecture Overview

### System Components

1. **Web Dashboard** (`web/`)
   - User interface for managing machines
   - Real-time Firestore listeners for live updates
   - Firebase Authentication
   - Deployed to Railway/Vercel

2. **Python Agent** (`agent/`)
   - Windows service running on each managed machine
   - Monitors and controls processes
   - Syncs status to Firestore every 30-60s
   - Listens for commands via Firestore
   - GUI for local configuration

3. **Firebase Backend**
   - Cloud Firestore: Real-time data sync
   - Firebase Auth: User authentication
   - No traditional server - fully serverless

### Data Flow

```
Agent (Machine A) → Firestore → Web Dashboard
                                      ↓
Agent (Machine B) ← Firestore ← Commands from Web
```

**Bidirectional Sync**: Changes propagate in ~1-2 seconds across all clients

---

## Key Architecture Documents

For deeper understanding, read these docs in order:

1. **[README.md](../README.md)** - Start here for project overview
2. **[docs/architecture-decisions.md](../docs/architecture-decisions.md)** - Design rationale, repo structure, development phases
3. **[docs/firebase-setup.md](../docs/firebase-setup.md)** - Firestore structure, security rules, setup guide
4. **[web/README.md](../web/README.md)** - Frontend setup and deployment
5. **[agent/README.md](../agent/README.md)** - Agent installation and configuration

---

## Firestore Data Structure

```
firestore/
├── sites/{siteId}/
│   ├── name: string
│   ├── createdAt: timestamp
│   └── machines/{machineId}/
│       ├── presence/              # Heartbeat every 30s
│       │   ├── online: boolean
│       │   └── lastHeartbeat: timestamp
│       ├── status/                # Metrics every 60s
│       │   ├── cpu: number
│       │   ├── memory: number
│       │   ├── disk: number
│       │   ├── gpu: number
│       │   └── processes: map
│       └── commands/              # Bidirectional commands
│           ├── pending/{commandId}/
│           └── completed/{commandId}/
├── config/{siteId}/
│   └── machines/{machineId}/
│       ├── version: string
│       └── processes: array
├── users/{userId}/
│   ├── email: string
│   ├── role: string
│   └── sites: array
└── deployments/{deploymentId}/
    ├── installerUrl: string
    ├── targetMachines: array
    └── status: string
```

---

## Environment Setup

### Web Dashboard

1. Copy environment template:
   ```bash
   cd web
   cp .env.example .env.local
   ```

2. Add Firebase config (from Firebase Console):
   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```

3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

### Python Agent

1. Copy config template:
   ```bash
   cd agent
   cp config.template.json config/config.json
   ```

2. Add Firebase service account credentials to `config/firebase-credentials.json` (download from Firebase Console → Project Settings → Service Accounts)

3. Edit `config/config.json` with your processes to monitor

4. Install and run:
   ```bash
   pip install -r requirements.txt
   cd src
   python owlette_service.py debug
   ```

---

## Testing Strategy

### Web Testing (Jest + React Testing Library)

**Location**: `web/__tests__/`

**Setup**: Test infrastructure is configured and ready
- Jest 29 with jsdom environment
- React Testing Library for component testing
- Firebase mocks for isolated unit tests
- Coverage reporting available

**Run tests**:
```bash
cd web
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

**Current Tests**:
- ✅ `__tests__/lib/errorHandler.test.ts` - Error handling utility tests (17 tests)
- ✅ `__tests__/lib/validateEnv.test.ts` - Environment validation tests (15 tests)
- 📝 Ready for expansion - Add hook and component tests as needed

**Test Structure**:
- Unit tests (`__tests__/lib/`) - Utilities and helpers
- Hook tests (`__tests__/hooks/`) - Custom React hooks (TODO)
- Component tests (`__tests__/components/`) - React components (TODO)
- Integration tests (`__tests__/integration/`) - End-to-end flows (TODO)

### Agent Testing (pytest)

**Location**: `agent/tests/`

**Setup**: Test infrastructure is configured and ready
- pytest 7.4 with coverage support
- pytest-mock for mocking
- Firebase mocks in conftest.py
- Platform-specific markers (@pytest.mark.windows)

**Install dev dependencies**:
```bash
cd agent
pip install -r requirements-dev.txt
```

**Run tests**:
```bash
cd agent
pytest                  # Run all tests
pytest -v              # Verbose
pytest --cov=src       # With coverage
pytest -m unit         # Run only unit tests
pytest -m "not windows"  # Skip Windows-specific tests
```

**Current Tests**:
- ✅ `tests/unit/test_shared_utils.py` - Configuration and system metrics tests
- ✅ `tests/conftest.py` - Shared fixtures and mocks
- 📝 Ready for expansion - Add firebase_client and service tests as needed

**Test Structure**:
- Unit tests (`tests/unit/`) - Individual function/class testing
- Integration tests (`tests/integration/`) - Component interaction testing (TODO)
- Fixtures (`tests/conftest.py`) - Shared test data and mocks

### Integration Testing (Firebase Emulator)

For safe testing without affecting production Firestore:

```bash
firebase emulators:start
# Run tests against emulator
```

---

## Common Development Scenarios

### Scenario 1: Adding a New Feature to Web Dashboard

1. Enter planning mode: Use `/dev-docs` to create strategic plan
2. Review plan and approve
3. Create dev docs: `/create-dev-docs`
4. Implement feature (frontend-dev-guidelines skill auto-activates)
5. Write tests alongside implementation
6. Build checker catches TypeScript errors automatically
7. Run `/code-review` before finalizing
8. Update dev docs: `/update-dev-docs`
9. Commit changes

### Scenario 2: Modifying Agent Behavior

1. Planning mode for complex changes
2. Edit Python files (backend-dev-guidelines skill auto-activates)
3. Test with `python owlette_service.py debug`
4. Build checker runs `py_compile` automatically
5. Write pytest tests
6. Build executable: `build.bat`
7. Test on development machine before deployment

### Scenario 3: Firebase Data Structure Change

1. Plan the change (consider migration path)
2. Update security rules in Firebase Console
3. Update both web and agent code (firebase-integration skill auto-activates)
4. Test with Firebase emulator
5. Deploy carefully with monitoring

### Scenario 4: Fixing a Bug

Small bug:
- Just fix it directly (no dev docs needed)
- Build checker ensures no new errors
- Write regression test

Large bug requiring investigation:
- Use `/dev-docs` to plan investigation
- Create dev docs to track findings
- Implement fix with tests
- Document root cause in dev docs

---

## Git Workflow

### Branch Strategy

**Two-Branch Model (Dev + Prod):**

- **`main`** - Production branch (deploys to owlette.app)
  - Always stable and deployable
  - Merged from `dev` after testing
  - Protected branch (requires review/approval)
  - Auto-deploys to Railway production service

- **`dev`** - Development branch (deploys to dev.owlette.app)
  - Primary development branch
  - All feature work happens here
  - Continuous integration and testing
  - Auto-deploys to Railway dev service

### Development Workflow

**For new features or changes:**

```bash
# 1. Start on dev branch
git checkout dev
git pull origin dev

# 2. Make changes and commit
git add .
git commit -m "feat: Add new feature"

# 3. Push to dev (auto-deploys to dev.owlette.app)
git push origin dev

# 4. Test on dev deployment
# Visit dev.owlette.app and verify changes

# 5. When ready for production, merge to main
git checkout main
git pull origin main
git merge dev --no-ff -m "chore: Merge dev for production release"

# 6. Push to main (auto-deploys to owlette.app)
git push origin main

# 7. Switch back to dev for next feature
git checkout dev
```

### Railway Auto-Deployment

**Production Service (owlette.app):**
- Watches: `main` branch
- Domain: `owlette.app`
- Firebase: Production project
- Auto-deploys on push to `main`

**Development Service (dev.owlette.app):**
- Watches: `dev` branch
- Domain: `dev.owlette.app` (to be configured)
- Firebase: Development project (to be created)
- Auto-deploys on push to `dev`

### Commit Messages

Follow conventional commits:
```
feat: Add deployment cancellation feature
fix: Resolve Firestore offline sync issue
docs: Update architecture decisions
refactor: Simplify useFirestore hook
test: Add integration tests for deployments
chore: Update dependencies
```

### Pull Requests

**For team collaboration:**

1. Create feature branch from `dev`: `git checkout -b feature/my-feature`
2. Make changes and push: `git push origin feature/my-feature`
3. Create PR from `feature/my-feature` to `dev`
4. Code review (use `/code-review` agent)
5. Merge after approval
6. Delete feature branch

**For production releases:**

1. Create PR from `dev` to `main`
2. Review all changes since last production release
3. Verify dev deployment is stable
4. Merge after approval
5. Monitor production deployment

---

## Troubleshooting

### Web Dashboard Issues

**Port already in use**:
```bash
# Find and kill process on port 3000
netstat -ano | findstr :3000
taskkill /PID [PID] /F
```

**Firebase auth errors**:
- Check `.env.local` has all required variables
- Verify Firebase project settings
- Check browser console for detailed errors

**Build errors**:
- Delete `.next` folder and rebuild: `rm -rf .next && npm run build`
- Check TypeScript errors: `npx tsc --noEmit`

### Agent Issues

**Service won't start**:
- Check logs in `agent/logs/`
- Verify config.json is valid JSON
- Ensure firebase-credentials.json exists and is valid
- Run in debug mode to see live errors: `python owlette_service.py debug`

**Firestore sync not working**:
- Check internet connection
- Verify firebase-credentials.json has correct permissions
- Check Firestore security rules
- Look for errors in logs

**Process monitoring not working**:
- Verify process names in config.json match exactly
- Check Windows permissions
- Ensure service is running as SYSTEM account

---

## Deployment

### Web Dashboard (Railway)

**Two separate Railway services for dev + prod:**

**Development Deployment (dev.owlette.app):**
1. Push to `dev` branch: `git push origin dev`
2. Railway auto-deploys dev service
3. Monitor deployment at Railway dashboard
4. Test changes at `dev.owlette.app`

**Production Deployment (owlette.app):**
1. Merge `dev` to `main`: `git checkout main && git merge dev`
2. Push to `main` branch: `git push origin main`
3. Railway auto-deploys production service
4. Monitor deployment at Railway dashboard
5. Verify at `owlette.app`

**Railway Configuration:**
- Uses `railway.toml` for build settings
- Environment variables set per service in Railway dashboard
- Automatic SSL certificate provisioning
- See [web/DEPLOYMENT-CHECKLIST.md](../web/DEPLOYMENT-CHECKLIST.md) for detailed setup

**Manual deployment** (for local testing):
```bash
cd web
npm run build
npm start
```

### Agent (Windows Machines)

**Via remote deployment** (from web dashboard):
1. Upload installer to accessible URL
2. Create deployment in web dashboard
3. Select target machines
4. Monitor deployment progress

**Manual installation**:
1. Build executable: `build.bat`
2. Run installer on target machine
3. Configure via GUI or config files
4. Service starts automatically

---

## Security Notes

### Secrets Management

**Never commit**:
- `web/.env.local` - Firebase config
- `agent/config/config.json` - Process config
- `agent/config/firebase-credentials.json` - Service account key

**All sensitive files are in `.gitignore`**

### Firebase Security

- Firestore security rules restrict access by user and site
- Agent uses service account with limited permissions
- Web uses Firebase Auth for user authentication
- All communication over HTTPS/TLS

---

## Performance Considerations

### Web Dashboard
- Server-side rendering for fast initial loads
- Real-time listeners only for active views
- Optimistic UI updates
- Image optimization via Next.js

### Agent
- Lightweight heartbeat (30s intervals)
- Metrics reporting (60s intervals)
- Offline resilience with local caching
- Minimal CPU/memory footprint

---

## Resources & Links

### Documentation
- [Firebase Documentation](https://firebase.google.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [React 19 Documentation](https://react.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com)

### Internal Docs
- [Architecture Decisions](../docs/architecture-decisions.md)
- [Firebase Setup Guide](../docs/firebase-setup.md)
- [Deployment Guide](../docs/deployment.md)

---

## Getting Help

### Issues & Errors

1. Check troubleshooting section above
2. Review relevant documentation
3. Check logs (web: browser console, agent: `logs/` directory)
4. Use `/code-review` to check for common issues

### Development Questions

1. Check this CLAUDE.md first
2. Review skill guidelines (auto-activate when working on code)
3. Check architecture docs in `docs/`
4. Ask Claude directly (skills will auto-activate with context)

---

## Version History

See [CHANGELOG.md](../CHANGELOG.md) for detailed version history.

**Current Version**: 2.0.0 (January 31, 2025)
- Complete Firebase integration
- Web dashboard for remote management
- Bidirectional real-time sync
- Remote deployment system

---

**Last Updated**: 2025-01-31
