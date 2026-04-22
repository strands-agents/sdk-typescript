"""Model Context Protocol (MCP) integration."""

from datetime import timedelta
from typing import TypedDict

from .mcp_client import MCPClient, ToolFilters
from .mcp_types import MCPTransport


class TasksConfig(TypedDict, total=False):
    """Configuration for MCP Tasks (task-augmented tool execution)."""

    ttl: timedelta
    poll_timeout: timedelta


__all__ = ["MCPClient", "MCPTransport", "TasksConfig", "ToolFilters"]
