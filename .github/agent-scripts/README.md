# Agent-Driven Development System

This directory contains agent scripts that automate the software development workflow using GitHub Actions and Amazon Q Developer agents.

## System Overview

The agent system implements a three-stage development workflow:

```
Project Manager → Task Reviewer → Task Implementer
      ↓               ↓               ↓
   Plan Tasks    Review & Clarify   Implement Code
```

## Agents

### 1. Project Manager Agent (`project-manager.script.md`)
**Purpose**: Reviews project state, tracks progress, and creates GitHub issues for ready tasks

**Triggers**: 
- Push events
- Manual workflow dispatch

### 2. Task Reviewer Agent (`task-reviewer.script.md`)
**Purpose**: Reviews feature requests, ask questions then iterates on user feedback, and prepares them for implementation

**Triggers**:
- `run-review` label added to issue
- Manual workflow dispatch

### 3. Task Implementer Agent (`task-implementer.script.md`)
**Purpose**: Implements tasks using test-driven development. Iterates on user feedback and implements proposed changes

**Triggers**:
- `run-implement` label added to issue or pull request
- Manual workflow dispatch

## Project Structure

The system expects this project structure:

```
.project/
├── project-overview.md    # Project goals and description
├── task-registry.md       # Task list with dependencies
└── tasks/                 # Individual task files
    ├── completed/         # Completed tasks
    └── [task-files]       # Pending tasks
```

## GitHub Integration

Each agent has a corresponding GitHub Actions workflow, as well as a agent script system prompt:
- Project Manager
  - `project-manager-agent.yml`
  - `project-manager.script.md`
- Task Reviewer
  - `task-reviewer-agent.yml` 
  - `task-reviewer.script.md` 
- Task Reviewer
  - `task-implementer-agent.yml` 
  - `task-implementer.script.md` 

## Getting Started

1. Create `.project/` directory with required files
2. Define project overview and initial tasks
3. Push changes to trigger Project Manager
4. Monitor GitHub issues for agent-created tasks
5. Review and refine as agents provide feedback
