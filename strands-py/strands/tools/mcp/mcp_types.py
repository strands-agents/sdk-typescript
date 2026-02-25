"""Type definitions for MCP integration."""

from __future__ import annotations

from typing import Any


# MCPTransport is an async context manager that yields read/write streams.
# Using Any here since the actual mcp package types are complex generics.
MCPTransport = Any
