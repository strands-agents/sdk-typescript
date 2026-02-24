# Strands Poly — polyglot agent SDK
#
# Build pipeline (each step feeds the next):
#
#   wit/agent.wit          Single WIT contract — the source of truth for all types
#        ↓
#   strands-ts/            TypeScript SDK. jco generates TS type declarations from WIT.
#        ↓                 The SDK itself is the upstream Strands TS agent framework.
#   strands-wasm/          WASM guest component. esbuild bundles the TS SDK, then
#        ↓                 componentize-js compiles it into a .wasm component.
#   strands-rs/            Rust host. wasmtime bindgen! generates Rust types/traits from
#        ↓                 WIT. At build time, the .wasm is AOT-compiled to .cwasm.
#   strands-py/            Python host. Pure Python wrapper (strands/__init__.py) around
#                          a Rust extension built with PyO3 + maturin. The Rust extension
#                          lives in strands-rs/src/python.rs behind a `pyo3` feature flag.
#
# ═══════════════════════════════════════════════════════════════════════
# Development workflows — pick the layer you're working on:
#
#   Editing the TS SDK (strands-ts/):
#     just build-ts          Compiles TS → JS. Fast (seconds).
#     just test-ts           Unit tests for the TS SDK.
#     No downstream rebuild needed unless you changed the TS SDK's
#     public API, which would require `just build-wasm` to re-bundle.
#
#   Editing the WASM guest (strands-wasm/entry.ts):
#     just build-wasm        Bundles TS SDK + entry.ts → .wasm component.
#                            Automatically rebuilds TS SDK first.
#                            Takes ~10-30s (componentize-js is not fast).
#     To test from Rust:     just build-wasm && just test-rs
#     To test from Python:   just build-wasm && just build-py && just test-py
#
#   Editing the WIT contract (wit/agent.wit):
#     just generate          Regenerates TS type declarations from WIT.
#     just build             Full rebuild — everything must be regenerated.
#     This is the most expensive change. Batch WIT edits.
#
#   Editing the Rust host (strands-rs/src/):
#     just check             Fast type-check (no linking, seconds).
#     just build-rs          Full build including .cwasm precompile.
#     just test-rs           Run Rust tests.
#     just example chat      Run a Rust example (chat, tools, multi_turn,
#                            anthropic, session).
#     No Python rebuild needed unless you changed the PyO3 bindings.
#
#   Editing the PyO3 bindings (strands-rs/src/python.rs):
#     just check-py          Fast type-check with pyo3 feature (~seconds).
#     just build-py          Recompiles the Rust extension and installs it
#                            into the Python venv via maturin develop.
#     just test-py           Run Python integration tests.
#
#   Editing pure Python (strands-py/strands/__init__.py):
#     No rebuild needed — it's installed as editable (`pip install -e`).
#     just test-py           Just run the tests directly.
#
#   Editing the derive macro (strands-derive/src/lib.rs):
#     just check             Recompiles the proc macro + all dependents.
#     Changes cascade to strands-rs (re-derives all WIT types).
# ═══════════════════════════════════════════════════════════════════════

export PYTHONPYCACHEPREFIX := ".pycache"

# ── Setup ────────────────────────────────────────────────────────────

# Install everything needed to build and test all layers
setup: setup-rust setup-node setup-python

# Rust stable toolchain + wasm32-wasip2 target (for cross-compiling the
# WASM component) + cargo tools (machete for finding unused deps,
# cargo-upgrade for bumping dep versions)
setup-rust:
    rustup update stable
    rustup target add wasm32-wasip2
    cargo install cargo-machete cargo-upgrade

# npm install at the repo root — installs dependencies for both the TS SDK
# (strands-ts) and the WASM component builder (strands-wasm) via npm workspaces
setup-node:
    npm install

# Creates a Python virtualenv in strands-py/.venv and installs maturin
# (the Rust→Python build tool) and ruff (formatter/linter). Does NOT build
# the extension yet — that happens in build-py. Test deps are installed
# there too via -E test.
setup-python:
    cd strands-py && python3 -m venv .venv
    cd strands-py && .venv/bin/pip install maturin ruff componentize-py

# ── Build ────────────────────────────────────────────────────────────

# Full pipeline: TS SDK → WASM component → Rust host → Python extension
build: build-ts build-wasm build-rs build-py

# Compile TypeScript SDK to JavaScript (tsc). Output lands in strands-ts/dist/.
build-ts:
    npm run build -w strands-ts

# Bundle TS SDK into a WASM component via esbuild + componentize-js.
# Output: strands-wasm/dist/agent.wasm. Rebuilds TS SDK first since
# the WASM guest imports @strands-agents/sdk.
build-wasm: build-ts
    npm run build -w strands-wasm

# Compile the Rust host library. During build.rs, the .wasm component
# is AOT-compiled to .cwasm (precompiled for the current CPU) so agent
# startup doesn't pay JIT cost at runtime.
build-rs:
    cargo build -p strands

# Compile the Rust extension module (with PyO3) and install it into the
# Python venv. maturin reads strands-rs/Cargo.toml with --features pyo3,
# builds a .so/.dylib, and places it at strands-py/strands/_strands.so.
# -E test installs optional test dependencies (pytest, pydantic, etc.)
build-py:
    cd strands-py && .venv/bin/maturin develop -E test

# Build a release wheel for the Python package (for distribution).
build-py-release:
    cd strands-py && .venv/bin/maturin build --release

# ── Test ─────────────────────────────────────────────────────────────

# Run Rust + Python tests
test: test-rs test-py

# Rust unit/integration tests for the host library
test-rs:
    cargo test -p strands

# Python integration tests — runs pytest against strands-py/tests_integ/
test-py:
    cd strands-py && .venv/bin/pytest

# Run a single Python test file (e.g., just test-py-file test_stream_agent.py)
test-py-file file:
    cd strands-py && .venv/bin/pytest tests_integ/{{file}} -v

# Run a specific Rust test (e.g., just test-rs-name my_test)
test-rs-name name:
    cargo test -p strands {{name}}

# TypeScript SDK unit tests (vitest)
test-ts:
    npm test -w strands-ts

# ── Examples ─────────────────────────────────────────────────────────

# Run a Rust example by name: just example chat
# Available: chat, tools, multi_turn, anthropic, session
example name:
    cargo run -p strands --example {{name}}

# Run a Python example by name: just example-py calculator
example-py name:
    cd strands-py && .venv/bin/python examples/{{name}}.py

# ── Type generation ──────────────────────────────────────────────────

# Regenerate all type declarations from wit/agent.wit.
# Outputs land in:
#   strands-ts/generated/   (TS SDK, via jco)
#   strands-wasm/generated/ (WASM guest, via jco)
#   strands-py/strands/generated/ (Python, via componentize-py)
# Rust types are regenerated automatically by wasmtime bindgen! on cargo build.
generate:
    npm run generate -w strands-ts
    npm run generate -w strands-wasm
    just _annotate-generated
    just generate-py

# Regenerate Python type bindings from wit/agent.wit using componentize-py.
# Copies all .py files except WASI runtime support (poll_loop, async_support)
# into strands-py/strands/generated/ with fixed import paths and @generated headers.
generate-py:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    cd strands-py
    .venv/bin/componentize-py -d ../wit -w agent bindings "$tmp"
    dest=strands/generated
    rm -rf "$dest/componentize_py_types.py" "$dest/wit_world"
    header='# @generated from wit/agent.wit -- do not edit'
    find "$tmp" -name '*.py' \
        -not -path '*/componentize_py_async_support/*' \
        -not -name 'poll_loop.py' \
    | while read -r src; do
        rel=${src#"$tmp/"}
        target="$dest/$rel"
        mkdir -p "$(dirname "$target")"
        {
            printf '%s\n' "$header"
            sed \
                -e 's/^from componentize_py_types /from strands.generated.componentize_py_types /' \
                -e 's/^from \.\.imports /from strands.generated.wit_world.imports /' \
                "$src"
        } > "$target"
    done
    echo "generated $dest/"

# Prepend @generated headers to generated .d.ts files so editors/linters
# know not to touch them. Runs automatically after `just generate`.
_annotate-generated:
    #!/usr/bin/env bash
    header='// @generated from wit/agent.wit — do not edit'
    for f in strands-wasm/generated/**/*.d.ts strands-wasm/generated/*.d.ts \
             strands-ts/generated/**/*.d.ts strands-ts/generated/*.d.ts; do
        [ -f "$f" ] || continue
        if ! head -1 "$f" | grep -qF '@generated'; then
            { printf '%s\n\n' "$header"; cat "$f"; } > "$f.tmp" && mv "$f.tmp" "$f"
        fi
    done

# ── Checks & maintenance ────────────────────────────────────────────

# Fast compile check — verifies all Rust code type-checks without linking.
# Much faster than a full build. Good for quick iteration on Rust changes.
check:
    cargo check --workspace

# Same as check but with the pyo3 feature enabled — verifies the Python
# bindings compile. Needed because pyo3 types are behind #[cfg(feature = "pyo3")]
# and won't be checked by a plain `cargo check`.
check-py:
    cargo check -p strands --features pyo3

# Format all code: Rust (cargo fmt) + TS/JS (prettier) + Python (ruff).
fmt:
    cargo fmt --all
    npx prettier --write 'strands-wasm/**/*.ts' 'strands-ts/**/*.ts' --ignore-path .gitignore
    cd strands-py && .venv/bin/ruff format strands/ tests_integ/

# Lint all code: Rust (clippy) + Python (ruff). Includes pyo3 feature so
# PyO3 bindings are checked too. -D warnings treats any warning as an error.
lint:
    cargo clippy --workspace -- -D warnings
    cargo clippy -p strands --features pyo3 -- -D warnings
    cd strands-py && .venv/bin/ruff check strands/ tests_integ/

# Verify generated files are up-to-date. Fails if `just generate` would
# produce a diff — useful in CI to catch forgotten regeneration.
generate-check:
    #!/usr/bin/env bash
    set -euo pipefail
    just generate
    if ! git diff --quiet -- strands-wasm/generated/ strands-ts/generated/ strands-py/strands/generated/; then
        echo "error: generated files are out of date -- run 'just generate' and commit" >&2
        git diff --stat -- strands-wasm/generated/ strands-ts/generated/ strands-py/strands/generated/
        exit 1
    fi

# Check formatting without writing — fails if any file would change.
# Use `just fmt` to auto-fix.
fmt-check:
    cargo fmt --all --check
    npx prettier --check 'strands-wasm/**/*.ts' 'strands-ts/**/*.ts' --ignore-path .gitignore
    cd strands-py && .venv/bin/ruff format --check strands/ tests_integ/

# Full CI pipeline: verify generated files, check formatting, lint, build, test.
# generate-check runs generate internally, so no separate generate dep needed.
ci: generate-check fmt-check lint build test

# Scan for unused Rust dependencies using cargo-machete.
# Useful after refactoring — catches deps you forgot to remove from Cargo.toml.
machete:
    cargo machete

# Bump all Rust dependencies to their latest semver-compatible versions.
# e.g., wasmtime = "41.0.0" → "41.2.1" but not "42.0.0".
upgrade:
    cargo upgrade

# Bump all Rust dependencies including semver-incompatible major versions.
# Review the diff carefully — breaking changes likely.
upgrade-incompatible:
    cargo upgrade --incompatible

# ── Clean ────────────────────────────────────────────────────────────

# Remove all build artifacts across all layers
clean:
    cargo clean
    npm run clean --workspaces 2>/dev/null || true
    rm -rf strands-py/target strands-py/.venv
