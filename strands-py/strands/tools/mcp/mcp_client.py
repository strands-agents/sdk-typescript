"""Model Context Protocol (MCP) server connection management.

Provides MCPClient for connecting to MCP servers, discovering tools,
and invoking them. Based on the upstream strands SDK's MCPClient.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import threading
import uuid
from collections.abc import Callable
from concurrent import futures
from re import Pattern
from types import TracebackType
from typing import Any

try:
    from typing import Protocol, TypedDict
except ImportError:
    from typing_extensions import Protocol, TypedDict

from strands.types.exceptions import MCPClientInitializationError

logger = logging.getLogger(__name__)


class _ToolFilterCallback(Protocol):
    def __call__(self, tool: Any, **kwargs: Any) -> bool: ...


_ToolMatcher = str | Pattern[str] | _ToolFilterCallback


class ToolFilters(TypedDict, total=False):
    """Filters for controlling which MCP tools are loaded and available."""

    allowed: list[_ToolMatcher]
    rejected: list[_ToolMatcher]


class MCPClient:
    """Connection to a Model Context Protocol (MCP) server.

    Implements context manager pattern for connection lifecycle.
    Uses a background thread for the async MCP session.
    """

    def __init__(
        self,
        transport_callable: Callable[..., Any],
        *,
        startup_timeout: int = 30,
        tool_filters: ToolFilters | None = None,
        prefix: str | None = None,
        elicitation_callback: Any = None,
        tasks_config: Any = None,
    ) -> None:
        self._startup_timeout = startup_timeout
        self._tool_filters = tool_filters
        self._prefix = prefix
        self._elicitation_callback = elicitation_callback
        self._tasks_config = tasks_config
        self._transport_callable = transport_callable

        self._session_id = uuid.uuid4()
        self._init_future: futures.Future[None] = futures.Future()
        self._close_future: asyncio.futures.Future[None] | None = None
        self._close_exception: Exception | None = None
        self._background_thread: threading.Thread | None = None
        self._background_thread_session: Any = None
        self._background_thread_event_loop: asyncio.AbstractEventLoop | None = None
        self._loaded_tools: list[Any] | None = None
        self._tool_provider_started = False
        self._consumers: set[Any] = set()

        # Task support
        self._server_task_capable: bool | None = None
        self._tool_task_support_cache: dict[str, Any] = {}

    def _log_debug_with_thread(self, msg: str, *args: Any) -> None:
        logger.debug(f"[MCPClient:{self._session_id}] {msg}", *args)

    def _is_session_active(self) -> bool:
        return self._background_thread_session is not None and self._tool_provider_started

    def _is_tasks_enabled(self) -> bool:
        return self._tasks_config is not None

    # --- Context manager ---

    def __enter__(self) -> MCPClient:
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.stop(exc_type, exc_val, exc_tb)

    def start(self) -> MCPClient:
        """Start the background thread and wait for initialization."""
        if self._tool_provider_started:
            raise MCPClientInitializationError("the client session is currently running")

        # Reset state for re-entry (e.g., using context manager twice).
        self._init_future = futures.Future()
        self._close_future = None
        self._close_exception = None
        self._background_thread_session = None
        self._background_thread_event_loop = None
        self._loaded_tools = None

        self._background_thread = threading.Thread(target=self._run_background_loop, daemon=True)
        self._background_thread.start()

        try:
            self._init_future.result(timeout=self._startup_timeout)
        except futures.TimeoutError as exc:
            self.stop(None, None, None)
            raise MCPClientInitializationError(
                f"background thread did not start in {self._startup_timeout} seconds"
            ) from exc
        except Exception as exc:
            self.stop(None, None, None)
            raise MCPClientInitializationError(f"MCP server initialization failed: {exc}") from exc

        self._tool_provider_started = True
        return self

    def stop(
        self,
        exc_type: type[BaseException] | None = None,
        exc_val: BaseException | None = None,
        exc_tb: TracebackType | None = None,
    ) -> None:
        """Stop the background thread, clean up, and reset state for reuse."""
        # Signal close future if event loop exists
        if self._background_thread is not None and self._background_thread_event_loop is not None:
            async def _set_close_event() -> None:
                if self._close_future and not self._close_future.done():
                    self._close_future.set_result(None)

            try:
                if not self._background_thread_event_loop.is_closed():
                    asyncio.run_coroutine_threadsafe(
                        coro=_set_close_event(), loop=self._background_thread_event_loop,
                    )
            except RuntimeError:
                pass

        if self._background_thread:
            self._background_thread.join(timeout=10)

        if self._background_thread_event_loop is not None:
            try:
                if not self._background_thread_event_loop.is_closed():
                    self._background_thread_event_loop.close()
            except RuntimeError:
                pass

        # Reset all state for reuse
        self._init_future = futures.Future()
        self._background_thread = None
        self._background_thread_session = None
        self._background_thread_event_loop = None
        self._session_id = uuid.uuid4()
        self._loaded_tools = None
        self._tool_provider_started = False
        self._consumers = set()
        self._server_task_capable = None
        self._tool_task_support_cache = {}

        if self._close_exception:
            exception = self._close_exception
            self._close_exception = None
            raise RuntimeError("Connection to the MCP server was closed") from exception

    def _run_background_loop(self) -> None:
        """Background thread entry: create event loop, connect, wait for close."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._background_thread_event_loop = loop
        try:
            loop.run_until_complete(self._async_session_loop(loop))
        except Exception:
            logger.exception("MCP background loop failed")

    async def _handle_error_message(self, message: Exception | Any) -> None:
        """Handle error messages from the MCP session."""
        _NON_FATAL_ERROR_PATTERNS = ["unknown request id"]
        if isinstance(message, Exception):
            error_msg = str(message).lower()
            if any(pattern in error_msg for pattern in _NON_FATAL_ERROR_PATTERNS):
                self._log_debug_with_thread("ignoring non-fatal MCP session error: %s", message)
            else:
                raise message

    async def _async_session_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Connect to MCP server and hold the session open."""
        self._close_future = loop.create_future()

        try:
            from mcp import ClientSession

            transport_ctx = self._transport_callable()
            async with transport_ctx as streams:
                if len(streams) == 3:
                    read_stream, write_stream, _ = streams
                else:
                    read_stream, write_stream = streams

                async with ClientSession(
                    read_stream,
                    write_stream,
                    message_handler=self._handle_error_message,
                    elicitation_callback=self._elicitation_callback,
                ) as session:
                    await session.initialize()
                    self._background_thread_session = session

                    # Cache server task capability
                    caps = session.get_server_capabilities()
                    self._server_task_capable = (
                        caps is not None
                        and getattr(caps, "tasks", None) is not None
                        and getattr(caps.tasks, "requests", None) is not None
                        and getattr(caps.tasks.requests, "tools", None) is not None
                        and getattr(caps.tasks.requests.tools, "call", None) is not None
                    )

                    self._init_future.set_result(None)
                    await self._close_future
        except Exception as exc:
            if not self._init_future.done():
                self._init_future.set_exception(exc)
            else:
                self._close_exception = exc
                if self._close_future and not self._close_future.done():
                    self._close_future.set_result(None)

    # --- Tool operations ---

    def _run_in_background(self, coro: Any) -> Any:
        """Submit a coroutine to the background event loop and wait."""
        if not self._background_thread_event_loop or not self._tool_provider_started:
            raise MCPClientInitializationError("MCP client not started")
        loop = self._background_thread_event_loop
        if loop.is_closed():
            raise RuntimeError("Connection to the MCP server was closed")
        try:
            future = asyncio.run_coroutine_threadsafe(coro, loop)
            return future.result(timeout=self._startup_timeout)
        except RuntimeError as exc:
            if "closed" in str(exc).lower():
                raise RuntimeError("Connection to the MCP server was closed") from exc
            raise

    def list_tools_sync(self, pagination_token: str | None = None) -> list[Any]:
        """List available tools from the MCP server."""
        if self._loaded_tools is not None and pagination_token is None:
            return self._loaded_tools
        self._loaded_tools = self._run_in_background(self._list_tools_async())
        return self._loaded_tools

    async def _list_tools_async(self) -> list[Any]:
        session = self._background_thread_session
        if not session:
            return []

        result = await session.list_tools()
        tools = []
        for tool_info in result.tools:
            original_name = tool_info.name

            # Cache task support per tool
            if self._is_tasks_enabled():
                task_support = None
                if (
                    hasattr(tool_info, "execution") and tool_info.execution is not None
                    and hasattr(tool_info.execution, "taskSupport") and tool_info.execution.taskSupport is not None
                ):
                    task_support = tool_info.execution.taskSupport
                self._tool_task_support_cache[original_name] = task_support or "forbidden"

            if self._tool_filters:
                if not self._matches_filters(original_name, tool_info):
                    continue

            name = f"{self._prefix}_{original_name}" if self._prefix else original_name

            spec: dict[str, Any] = {
                "name": name,
                "description": tool_info.description or "",
                "inputSchema": tool_info.inputSchema or {},
            }
            if hasattr(tool_info, "outputSchema") and tool_info.outputSchema is not None:
                spec["outputSchema"] = {"json": tool_info.outputSchema}
            tools.append(_MCPTool(
                tool_name=name,
                tool_spec=spec,
                client=self,
                original_name=original_name,
            ))
        return tools

    def _matches_filters(self, name: str, tool_info: Any) -> bool:
        """Check if a tool matches the configured filters."""
        filters = self._tool_filters
        if not filters:
            return True

        allowed = filters.get("allowed")
        if allowed:
            if not any(self._matches(m, name) for m in allowed):
                return False

        rejected = filters.get("rejected")
        if rejected:
            if any(self._matches(m, name) for m in rejected):
                return False

        return True

    @staticmethod
    def _matches(matcher: _ToolMatcher, name: str) -> bool:
        if isinstance(matcher, str):
            return matcher == name
        if isinstance(matcher, Pattern):
            return bool(matcher.search(name))
        return matcher(type("_Tool", (), {"tool_name": name})())

    def call_tool_sync(self, tool_use_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a tool synchronously."""
        result = self._run_in_background(self._call_tool_async(name, arguments))
        result["toolUseId"] = tool_use_id
        return result

    async def call_tool_async(self, tool_use_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a tool asynchronously."""
        result = self._run_in_background(self._call_tool_async(name, arguments))
        result["toolUseId"] = tool_use_id
        return result

    async def _call_tool_async(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        from mcp.types import EmbeddedResource as MCPEmbeddedResource
        from mcp.types import ImageContent as MCPImageContent
        from mcp.types import TextContent as MCPTextContent

        session = self._background_thread_session
        if not session:
            return {"status": "error", "content": [{"text": "session not running"}]}

        result = await session.call_tool(name, arguments)
        content: list[dict[str, Any]] = []
        for item in result.content:
            mapped = self._map_content(item, MCPTextContent, MCPImageContent, MCPEmbeddedResource)
            if mapped is not None:
                content.append(mapped)

        status = "error" if result.isError else "success"
        tool_result: dict[str, Any] = {"status": status, "content": content}
        if hasattr(result, "structuredContent") and result.structuredContent:
            tool_result["structuredContent"] = result.structuredContent
        meta = getattr(result, "meta", None) or getattr(result, "_meta", None)
        if meta:
            tool_result["metadata"] = meta
        return tool_result

    @staticmethod
    def _map_content(
        item: Any, MCPTextContent: type, MCPImageContent: type, MCPEmbeddedResource: type,
    ) -> dict[str, Any] | None:
        from mcp.types import BlobResourceContents, TextResourceContents

        MIME_TO_FORMAT: dict[str, str] = {
            "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/png": "png",
            "image/gif": "gif", "image/webp": "webp",
        }

        if isinstance(item, MCPTextContent):
            return {"text": item.text}
        elif isinstance(item, MCPImageContent):
            fmt = MIME_TO_FORMAT.get(item.mimeType, "png")
            return {"image": {"format": fmt, "source": {"bytes": base64.b64decode(item.data)}}}
        elif isinstance(item, MCPEmbeddedResource):
            resource = item.resource
            if isinstance(resource, TextResourceContents):
                return {"text": resource.text}
            elif isinstance(resource, BlobResourceContents):
                try:
                    raw_bytes = base64.b64decode(resource.blob)
                except Exception:
                    return None
                mime = resource.mimeType or ""
                if mime.startswith("text/") or mime in (
                    "application/json", "application/xml", "application/javascript",
                    "application/yaml", "application/x-yaml",
                ) or mime.endswith(("+json", "+xml")):
                    try:
                        return {"text": raw_bytes.decode("utf-8", errors="replace")}
                    except Exception:
                        pass
                if mime in MIME_TO_FORMAT:
                    return {"image": {"format": MIME_TO_FORMAT[mime], "source": {"bytes": raw_bytes}}}
                return None
        return {"text": str(item)}

    # --- Prompt operations ---

    def list_prompts_sync(self, pagination_token: str | None = None) -> Any:
        return self._run_in_background(self._background_thread_session.list_prompts())

    def get_prompt_sync(self, name: str, arguments: dict[str, str] | None = None) -> Any:
        return self._run_in_background(self._background_thread_session.get_prompt(name, arguments))

    # --- Resource operations ---

    def list_resources_sync(self, pagination_token: str | None = None) -> Any:
        return self._run_in_background(self._background_thread_session.list_resources())

    def read_resource_sync(self, uri: Any) -> Any:
        return self._run_in_background(self._background_thread_session.read_resource(uri))

    def list_resource_templates_sync(self, pagination_token: str | None = None) -> Any:
        return self._run_in_background(self._background_thread_session.list_resource_templates())

    # --- Cleanup ---

    def cleanup(self) -> None:
        """Clean up resources."""
        self.stop()


class _MCPTool:
    """A tool discovered from an MCP server."""

    def __init__(
        self,
        tool_name: str,
        tool_spec: dict[str, Any],
        client: MCPClient,
        original_name: str,
    ) -> None:
        self.tool_name = tool_name
        self.tool_spec = tool_spec
        self._client = client
        self._original_name = original_name

    def __call__(self, **kwargs: Any) -> dict[str, Any]:
        return self._client.call_tool_sync("", self._original_name, kwargs)
