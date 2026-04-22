# strands-py

Python host for the Strands Agent WASM component.

## Setup

Requires Python 3.10+.

```bash
cd strands-py
pip install -e .
```

For development (includes test dependencies):

```bash
pip install -e ".[test]"
```

## Scripts

### generate-types

Generates Python type definitions from the WIT contract using `componentize-py`. Must be run from the repository root.

```bash
# Generate types (writes to strands-py/strands/_generated/types.py)
generate-types

# Verify generated types are up-to-date (for CI)
generate-types --check

# Custom paths
generate-types --wit path/to/wit --out path/to/output.py
```

Requires `componentize-py` to be installed.
