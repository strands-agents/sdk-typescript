# Strands

A multi-language AI agent SDK built on a WebAssembly component architecture. A single TypeScript agent runtime is compiled to a WASM component and hosted directly by Python via `wasmtime-py` — one implementation serving all languages through a shared binary.

See [docs](./docs) for the design proposal and ongoing team decisions.

## Getting started

### Prerequisites

- Node.js 22+
- Python 3.10+

### First-time setup

```bash
git clone https://github.com/strands-agents/strands.git
cd strands
npm install
npm run dev -- bootstrap
```

`bootstrap` installs toolchains, generates type bindings, builds all layers, and runs all tests. If this command doesn't enable development out of the box, file an issue.

## Architecture

### Build pipeline

Changes flow through a pipeline. Each layer compiles into the next:

```mermaid
graph TD
    WIT["wit/agent.wit"] -->|generate| TS_GEN["strands-ts/generated/"]
    WIT -->|generate| WASM_GEN["strands-wasm/generated/"]

    TS_GEN --> TS["strands-ts (npm build)"]
    TS -->|esbuild bundle| WASM_BUNDLE["strands-wasm (ESM bundle)"]
    WASM_GEN --> WASM_BUNDLE
    WASM_BUNDLE -->|componentize-js| WASM["agent.wasm (WASM component)"]
    WASM -->|wasmtime-py| PY["strands-py (Python package)"]
```

| Directory      | Language   | What it is                                                          |
| -------------- | ---------- | ------------------------------------------------------------------- |
| `wit/`         | WIT        | Interface contract between the WASM guest and host                  |
| `strands-ts/`  | TypeScript | Agent runtime: event loop, model providers, tools, hooks, streaming |
| `strands-wasm/` | TypeScript | Bridges the TS SDK to WIT exports, compiles to a WASM component    |
| `strands-py/`  | Python     | Python wrapper: Agent class, @tool decorator, direct WASM host      |
| `wasmtime-py`  | Python     | External dependency: forked wasmtime-py with async component model  |
| `strands-dev/` | TypeScript | Dev CLI that orchestrates build, test, lint, and CI                 |
| `docs/`        | Markdown   | Design proposal and team decisions                                  |

### Generated code

`npm run dev -- generate` produces type bindings from `wit/agent.wit` into:

- `strands-ts/generated/`
- `strands-wasm/generated/`

Generated files are checked in and marked with `// @generated`. Do not edit them by hand. CI runs `generate --check` and fails if they are stale.

Python types are auto-generated into `strands-py/strands/_generated/types.py` by `strands-py/scripts/generate_types.py`.

### Tests

| Layer          | Framework | Location                                                          |
| -------------- | --------- | ----------------------------------------------------------------- |
| TypeScript SDK | vitest    | `strands-ts/src/**/__tests__/` (unit), `strands-ts/test/` (integ) |
| Python wrapper | pytest    | `strands-py/tests_integ/`                                         |

Add tests alongside the code you change. Bug fixes should include a test that reproduces the original issue.

## Making changes

Each layer depends on the layers above it in the pipeline. The `validate` command rebuilds and tests exactly the layers your change affects.

| What you changed                      | Validate command                      |
| ------------------------------------- | ------------------------------------- |
| WIT contract (`wit/agent.wit`)        | `npm run dev -- validate wit`         |
| TS SDK internals                      | `npm run dev -- validate ts`          |
| TS SDK public API                     | `npm run dev -- validate ts-api`      |
| WASM bridge (`strands-wasm/entry.ts`) | `npm run dev -- validate wasm`        |
| Pure Python (`strands-py/`)           | `npm run dev -- validate py`          |

**TS internals vs. public API:** The WASM bridge (`strands-wasm/entry.ts`) imports specific types and functions from `strands-ts/`. If your change modifies something the bridge imports, it is a public API change — use `validate ts-api`. If the bridge does not import it, use `validate ts`.

**WIT contract changes** cascade to every layer. After running `validate wit`, fix any compile errors in `strands-wasm/entry.ts` and the language wrappers. The build will not succeed until every layer matches the new contract.

## Dev CLI

```bash
npm run dev -- <command> [options]
```

Most commands accept layer flags (`--ts`, `--wasm`, `--py`). No flags means all layers.

| Command            | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `bootstrap`        | First-time setup: install, generate, build, test                       |
| `setup`            | Install toolchains (`--node`, `--python`)                              |
| `generate`         | Regenerate type bindings from WIT (`--check`)                          |
| `build`            | Compile layers (`--ts`, `--wasm`, `--py`, `--release`)                 |
| `test`             | Run tests (`--py`, `--ts`, or a specific `[file]`)                     |
| `check`            | Lint and type-check (`--ts`, `--py`)                                   |
| `fmt`              | Format all code (`--check` to verify without writing)                  |
| `validate <layer>` | Rebuild and test the layers affected by a change                       |
| `ci`               | Full pipeline: generate, format, lint, build, test                     |
| `rebuild`          | Clean rebuild: clean, generate, build                                  |
| `report`           | Status report from `tasks.toml` (`--full` for task-level detail)       |
| `clean`            | Remove all build artifacts                                             |
| `example <name>`   | Run an example (`--py`, `--ts`)                                        |

## Code style

| Language   | Formatter     | Linter         |
| ---------- | ------------- | -------------- |
| TypeScript | `prettier`    | `tsc --noEmit` |
| Python     | `ruff format` | `ruff check`   |

```bash
npm run dev -- fmt       # format everything
npm run dev -- check     # lint everything
```

Comments are normative statements that describe what code does or why a decision was made. Avoid TODO's without associated issues, notes-to-self, and parenthetical asides.

## Submitting a PR

- Run `npm run dev -- ci` before pushing. This is the same pipeline CI runs.
- Keep PRs focused on a single change.
- Commit messages must be scoped: `[scope] message` (e.g., `[strands-py] Fix tool context injection`).
  Valid scopes: `mono`, `meta`, `strands-ts`, `strands-wasm`, `strands-py`, `strands-dev`, `strands-metrics`. Enforced by a husky commit-msg hook.
