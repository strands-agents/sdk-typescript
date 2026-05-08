#!/usr/bin/env python3
"""Generate Python type stubs from WIT using componentize-py.

``componentize-py bindings`` emits stub modules intended for IDEs, type
checkers, and SDKs (per its own help text). We run it, then extract
only the pure type definitions — dataclasses, enums, and union aliases
— and concatenate them into a single module.

Runtime glue (``componentize_py_runtime``, ``componentize_py_async_support``,
``poll_loop``) is intentionally dropped: those modules only exist inside
a compiled WASM component.

Usage:
    generate-types          # regenerate strands/_generated.py
    generate-types --check  # verify the file is up-to-date (for CI)
"""

from __future__ import annotations

import argparse
import ast
import difflib
import subprocess
import sys
import tempfile
from pathlib import Path

# Paths are relative to the repo root so ``strandly`` can invoke this
# script from there without any cwd gymnastics.
DEFAULT_WIT_DIR = Path("wit")
DEFAULT_OUTPUT = Path("strands-py") / "src" / "strands" / "_generated.py"
DEFAULT_SDK_INIT = Path("strands-py") / "src" / "strands" / "__init__.py"
WORLD_NAME = "agent"

FILE_HEADER = '''\
"""Auto-generated from wit/*.wit. Do not edit.

Every type in this module is emitted from a WIT interface via
``componentize-py bindings``. Regenerate with: generate-types.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Union
'''


# Interface modules componentize-py emits alongside each other. The SDK
# flattens them into one file, so references like ``sessions.StorageError``
# have to collapse to plain ``StorageError`` or they're undefined at runtime.
_INTERFACE_MODULES = {
    "messages",
    "models",
    "tools",
    "streaming",
    "sessions",
    "conversation",
    "retry",
    "multi_agent",
    "multiagent",
    "mcp",
    "vended",
    "logging",
    "api",
    "edge_handler_registry",
    "elicitation_handler",
    "model_provider",
    "snapshot_storage",
    "snapshot_trigger_handler",
    "tool_provider",
    "host_log",
    # WASI modules transitively pulled in through `use wasi:*`.
    "wall_clock",
    "monotonic_clock",
    "poll",
}


# Resource/trait scaffolding classes we drop wholesale — componentize-py
# emits them for every WASI resource but they're never instantiated
# from Python and drag in `Self` / `TracebackType` imports we'd
# otherwise have to handle.
_SKIP_CLASSES = {"Pollable"}


def _flatten_module_prefixes(source: str) -> str:
    """Rewrite ``sessions.StorageError`` → ``StorageError`` and friends.

    This is the only post-pass we keep: it's a correctness fix, not a
    style fix. Without it, references emitted across interfaces are
    undefined at runtime. Everything else componentize-py emits is fine
    as-is since the generated file is excluded from ruff.
    """
    import re

    modules_pattern = "|".join(sorted(_INTERFACE_MODULES, key=len, reverse=True))
    return re.sub(rf"\b({modules_pattern})\.", "", source)


def _extract_definitions(source: str) -> str:
    """Return the dataclass / enum / union-alias definitions from ``source``.

    Skips imports, function stubs, and `Protocol` classes — the latter
    reference componentize-py's runtime types, which only exist inside a
    compiled component.
    """
    tree = ast.parse(source)
    lines = source.splitlines()
    segments: list[str] = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            if node.name in _SKIP_CLASSES:
                continue
            if any(
                (isinstance(b, ast.Name) and b.id == "Protocol")
                or (isinstance(b, ast.Attribute) and b.attr == "Protocol")
                for b in node.bases
            ):
                continue
            start = node.decorator_list[0].lineno if node.decorator_list else node.lineno
            end = node.end_lineno
            assert end is not None
            segments.append("\n".join(lines[start - 1 : end]))

        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id[:1].isupper():
                    end = node.end_lineno
                    assert end is not None
                    segments.append("\n".join(lines[node.lineno - 1 : end]))
                    break

    return "\n\n".join(segments)


def _collect_sdk_shadow_names(sdk_init: Path) -> set[str]:
    """Return names defined at the top level of the SDK ``__init__.py``.

    Anything the SDK declares as a top-level ``class`` or ``def`` is a
    name we must *not* re-export from ``_generated``, otherwise the
    star-import would bind the generated version and the SDK's own
    declaration would redeclare the same name with an incompatible
    type (pyright flags this loudly). Scanning the SDK's own file means
    no hand-maintained shadow list has to exist anywhere.

    Missing file → empty set (first-time generation).
    """
    if not sdk_init.exists():
        return set()
    tree = ast.parse(sdk_init.read_text())
    names: set[str] = set()
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)
    return names


def _build_variant_aliases(source: str, shadowed: set[str]) -> str:
    """Emit ``ParentArm = Parent_Arm`` aliases plus an ``__all__`` list.

    The WIT toolchain lowers variants into one class per arm named
    ``Parent_Arm`` (Python has no anonymous sums). Users shouldn't have
    to type the underscore form, so every arm gets an alias stripped of
    the underscore and any trailing ``_`` (from keyword escapes like
    ``None_``). ``__all__`` mirrors the full public surface so downstream
    modules can ``from strands._generated import *``.

    Names the SDK overrides (``shadowed``) are omitted from ``__all__``
    but the underlying classes still exist in this module — the SDK can
    still reach them via ``_generated.Name`` when needed.
    """
    tree = ast.parse(source)
    arm_aliases: list[tuple[str, str]] = []
    top_level: list[str] = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            name = node.name
            if "_" in name:
                parent, _, arm = name.partition("_")
                if parent and arm and parent[:1].isupper():
                    alias = f"{parent}{arm.rstrip('_')}"
                    if alias != name:
                        arm_aliases.append((alias, name))
                        top_level.append(alias)
                        continue
            top_level.append(name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id[:1].isupper():
                    top_level.append(target.id)
                    break

    arm_aliases.sort()
    exported = sorted({n for n in top_level if n not in shadowed})

    lines: list[str] = [f"{alias} = {original}" for alias, original in arm_aliases]
    lines.append("")
    lines.append("__all__ = [")
    lines.extend(f'    "{name}",' for name in exported)
    lines.append("]")
    return "\n".join(lines)


def generate(wit_dir: Path, sdk_init: Path) -> str:
    """Run ``componentize-py bindings`` and return the single-file module."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["componentize-py", "-d", str(wit_dir), "-w", WORLD_NAME, "bindings", tmp],
            check=True,
        )
        stage = Path(tmp) / "wit_world"
        parts = [FILE_HEADER]
        for sub in ("imports", "exports"):
            root = stage / sub
            if not root.exists():
                continue
            for src_path in sorted(root.glob("*.py")):
                if src_path.name == "__init__.py":
                    continue
                defs = _extract_definitions(src_path.read_text())
                if not defs.strip():
                    continue
                parts.append(defs)

    body = "\n".join(parts) + "\n"
    body = _flatten_module_prefixes(body)
    shadowed = _collect_sdk_shadow_names(sdk_init)
    aliases = _build_variant_aliases(body, shadowed)
    return body + "\n" + aliases + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Python type stubs from WIT using componentize-py")
    parser.add_argument("--check", action="store_true", help="Verify the file is up-to-date")
    parser.add_argument("--wit", type=Path, default=DEFAULT_WIT_DIR, help="WIT directory")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT, help="Output path")
    parser.add_argument(
        "--sdk-init",
        type=Path,
        default=DEFAULT_SDK_INIT,
        help="SDK __init__.py whose top-level names are excluded from _generated.__all__",
    )
    args = parser.parse_args()

    new_source = generate(args.wit, args.sdk_init)

    if args.check:
        existing = args.out.read_text() if args.out.exists() else ""
        if new_source == existing:
            print(f"OK: {args.out} matches wit/")
            sys.exit(0)
        sys.stderr.writelines(
            difflib.unified_diff(
                existing.splitlines(keepends=True),
                new_source.splitlines(keepends=True),
                fromfile=str(args.out),
                tofile="<generated>",
            )
        )
        print(f"MISMATCH: {args.out} differs from wit/", file=sys.stderr)
        sys.exit(1)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(new_source)
    print(f"Generated {args.out}")


if __name__ == "__main__":
    main()
