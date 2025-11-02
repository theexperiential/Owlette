# Development Task Tracking

This directory contains development task documentation following the dev docs workflow pattern.

## Structure

```
dev/
├── active/           # Current tasks being worked on
│   └── [task-name]/
│       ├── [task-name]-plan.md      # Strategic plan
│       ├── [task-name]-context.md   # Key files & decisions
│       └── [task-name]-tasks.md     # Checklist
│
└── completed/        # Archived completed tasks
    └── [task-name]/  # (same structure as active)
```

## Workflow

### 1. Starting a Large Task

When beginning a significant feature or refactor:

1. **Enter Plan Mode** - Let Claude research and create a strategic plan
2. **Review Plan** - Carefully review the plan before approving
3. **Run `/create-dev-docs`** - Creates the three documentation files:
   - `[task-name]-plan.md` - The approved implementation plan
   - `[task-name]-context.md` - Key files, architectural decisions, integration points
   - `[task-name]-tasks.md` - Detailed checklist of tasks

4. **Start Implementation** - Work through tasks systematically

### 2. During Implementation

- **Mark tasks complete** immediately as you finish them (update `tasks.md`)
- **Update context** when you make architectural decisions (update `context.md`)
- **Track next steps** if you get interrupted

### 3. Before Context Compaction

When approaching context limits:

1. **Run `/update-dev-docs`** - Claude will:
   - Mark completed tasks
   - Update context with new decisions/findings
   - Add "Next Steps" section
   - Update timestamps

2. **Compact conversation** - Start fresh session

3. **Continue** - In new session, reference dev docs to continue where you left off

### 4. Completing a Task

When the task is fully complete:

1. **Final update** to dev docs
2. **Move to completed/** - `mv dev/active/[task-name] dev/completed/`
3. **Archive for future reference**

## When to Use Dev Docs

✅ **Use for**:
- Multi-file features spanning web + agent
- Architecture changes or refactors
- Firebase integration work
- Complex bug fixes requiring investigation
- Features taking multiple sessions

❌ **Skip for**:
- Single-file tweaks
- Documentation updates
- Minor styling fixes
- Small bug fixes in one location

## Example Task Structure

```
dev/active/remote-deployment-feature/
├── remote-deployment-feature-plan.md
│   ├── Executive Summary
│   ├── Context & Background
│   ├── Proposed Solution
│   ├── Implementation Phases
│   ├── Detailed Tasks
│   ├── Files to Modify/Create
│   ├── Risks & Mitigations
│   ├── Success Criteria
│   ├── Testing Strategy
│   └── Timeline
│
├── remote-deployment-feature-context.md
│   ├── Key Files
│   ├── Architectural Decisions
│   ├── Integration Points
│   ├── Dependencies
│   └── Next Steps
│
└── remote-deployment-feature-tasks.md
    ├── [ ] Task 1
    ├── [x] Task 2 (completed)
    ├── [ ] Task 3
    └── ...
```

## Benefits

1. **Prevents "losing the plot"** - Always know what you're building and why
2. **Survives context compaction** - Pick up exactly where you left off
3. **Documents decisions** - Future you will thank past you
4. **Tracks progress** - Clear visibility into what's done and what's left
5. **Enables reviews** - Stakeholders can review plans before implementation

## Related Commands

- `/dev-docs` - Create strategic plan (use in plan mode)
- `/create-dev-docs` - Convert approved plan to dev doc files
- `/update-dev-docs` - Update dev docs before context compaction

---

**Last Updated**: 2025-01-31
