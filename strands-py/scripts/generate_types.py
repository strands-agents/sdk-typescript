#!/usr/bin/env python3
"""Generate Python types from WIT contract using componentize-py.

Runs ``componentize-py bindings`` to produce raw Python bindings, then
extracts only the type definitions (dataclasses, enums, Union aliases)
and strips the componentize_py_types runtime dependency.

Usage:
    generate-types          # Write to strands-py/strands/_generated/types.py
    generate-types --check  # Verify file is up-to-date (for CI)
"""

from __future__ import annotations

import argparse
import ast
import difflib
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_WIT_DIR = Path("..") / "wit"
DEFAULT_OUTPUT = Path("strands") / "_generated" / "types.py"

FILE_HEADER = '''\
"""Auto-generated from wit/agent.wit using componentize-py.

Do not edit manually.
Regenerate with: generate-types
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Union
'''


def _extract_type_defs(source: str) -> str:
    """Extract class definitions and type-alias assignments from generated source.

    Strips import headers, module docstrings, and function stubs, keeping
    only ``class`` definitions (with decorators) and top-level ``Assign``
    nodes (``Union`` type aliases).
    """
    tree = ast.parse(source)
    lines = source.splitlines()
    segments: list[str] = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            start = (
                node.decorator_list[0].lineno if node.decorator_list else node.lineno
            )
            end = node.end_lineno
            assert end is not None
            segments.append("\n".join(lines[start - 1 : end]))

        elif isinstance(node, ast.Assign):
            end = node.end_lineno
            assert end is not None
            segments.append("\n".join(lines[node.lineno - 1 : end]))

    return "\n\n".join(segments)


def generate(wit_dir: Path = DEFAULT_WIT_DIR) -> str:
    """Run componentize-py and post-process into a single types module."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [
                "componentize-py",
                "-d",
                str(wit_dir),
                "-w",
                "agent",
                "bindings",
                tmp,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        types_src = (Path(tmp) / "wit_world" / "imports" / "types.py").read_text()
        host_log_src = (
            Path(tmp) / "wit_world" / "imports" / "host_log.py"
        ).read_text()

    types_defs = _extract_type_defs(types_src)
    host_log_defs = _extract_type_defs(host_log_src)

    parts = [
        FILE_HEADER,
        "# --- types interface ---\n",
        types_defs,
        "\n\n# --- host-log interface ---\n",
        host_log_defs,
        "\n",
    ]
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Python types from WIT using componentize-py"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify generated output matches existing file (for CI)",
    )
    parser.add_argument(
        "--wit", type=Path, default=DEFAULT_WIT_DIR, help="WIT directory"
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUTPUT, help="Output file path"
    )
    args = parser.parse_args()

    generated = generate(args.wit)

    if args.check:
        existing = args.out.read_text()
        if generated == existing:
            print("OK: generated types match existing file")
            sys.exit(0)
        diff = difflib.unified_diff(
            existing.splitlines(keepends=True),
            generated.splitlines(keepends=True),
            fromfile=str(args.out),
            tofile="<generated>",
        )
        sys.stderr.writelines(diff)
        print("MISMATCH: generated types differ from existing file", file=sys.stderr)
        sys.exit(1)

    args.out.write_text(generated)
    print(f"Generated {args.out}")


if __name__ == "__main__":
    main()
