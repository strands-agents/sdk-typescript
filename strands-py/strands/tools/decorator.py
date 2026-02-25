from __future__ import annotations

import functools
import inspect
import json
import logging
import types as _types
from collections.abc import Callable
from typing import Any, TypeVar, overload

from strands.types.tools import ToolContext

log = logging.getLogger(__name__)

T = TypeVar("T", bound=Callable[..., Any])

_TYPE_MAP: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _json_schema_type(annotation: Any) -> dict[str, Any]:
    if annotation is inspect.Parameter.empty or annotation is Any:
        return {}
    origin = getattr(annotation, "__origin__", None)
    args = getattr(annotation, "__args__", None)
    if origin is _types.UnionType and args is not None:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _json_schema_type(non_none[0])
    if origin is list:
        schema: dict[str, Any] = {"type": "array"}
        if args:
            schema["items"] = _json_schema_type(args[0])
        return schema
    mapped = _TYPE_MAP.get(annotation)
    return {"type": mapped} if mapped else {}


def _build_input_schema(func: Callable[..., Any], skip: set[str]) -> dict[str, Any]:
    sig = inspect.signature(func)
    try:
        import docstring_parser

        param_docs = {
            p.arg_name: p.description or ""
            for p in docstring_parser.parse(inspect.getdoc(func) or "").params
        }
    except ImportError:
        param_docs = {}

    hints: dict[str, Any] = {}
    try:
        hints = inspect.get_annotations(func, eval_str=True)
    except Exception:
        log.debug("failed to evaluate type annotations for %s", func.__name__, exc_info=True)

    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, param in sig.parameters.items():
        if name in skip:
            continue
        prop = _json_schema_type(hints.get(name, param.annotation))
        desc = param_docs.get(name)
        if desc:
            prop["description"] = desc
        properties[name] = prop
        if param.default is inspect.Parameter.empty:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _extract_description(func: Callable[..., Any]) -> str:
    raw = inspect.getdoc(func)
    if not raw:
        return func.__name__
    try:
        import docstring_parser

        doc = docstring_parser.parse(raw)
        if doc.short_description:
            parts = [doc.short_description]
            if doc.long_description:
                parts.append(doc.long_description)
            return "\n\n".join(parts)
    except ImportError:
        pass
    lines = raw.strip().split("\n")
    result: list[str] = []
    for line in lines:
        if line.strip().lower().startswith(("args:", "arguments:", "parameters:")):
            break
        result.append(line)
    return "\n".join(result).strip() or func.__name__


class DecoratedTool:
    """A @tool-decorated function -- callable as normal, passable to Agent(tools=[...])."""

    def __init__(
        self,
        func: Callable[..., Any],
        name: str,
        description: str,
        input_schema: dict[str, Any],
        context_param: str | None = None,
    ):
        self.func = func
        self.context_param = context_param
        self._name = name
        self._description = description
        self._input_schema = input_schema
        functools.update_wrapper(self, func)

    @property
    def tool_name(self) -> str:
        return self._name

    @property
    def tool_spec(self) -> dict[str, Any]:
        return {
            "name": self._name,
            "description": self._description,
            "inputSchema": self._input_schema,
        }

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.func(*args, **kwargs)

    def make_handler(self, agent_ref: Any = None) -> Callable[[str, str], str]:
        func = self.func
        ctx_param = self.context_param

        def handler(input_json: str, tool_use_id: str = "") -> str:
            data = json.loads(input_json)
            if ctx_param:
                data[ctx_param] = ToolContext(
                    tool_use={"toolUseId": tool_use_id},
                    agent=agent_ref,
                )
            return _wrap_result(func(**data))

        return handler


def _wrap_result(result: Any) -> str:
    if isinstance(result, dict) and "status" in result and "content" in result:
        return json.dumps(result)
    if isinstance(result, str):
        return json.dumps({"status": "success", "content": [{"text": result}]})
    if isinstance(result, (int, float, bool)):
        return json.dumps({"status": "success", "content": [{"text": str(result)}]})
    try:
        return json.dumps(
            {"status": "success", "content": [{"text": json.dumps(result)}]},
        )
    except (TypeError, ValueError):
        return json.dumps({"status": "success", "content": [{"text": str(result)}]})


@overload
def tool(__func: T) -> T: ...
@overload
def tool(
    *,
    description: str | None = None,
    inputSchema: Any = None,
    name: str | None = None,
    context: bool | str = False,
) -> Callable[[T], T]: ...
def tool(  # type: ignore[misc]
    func: Callable[..., Any] | None = None,
    description: str | None = None,
    inputSchema: Any = None,
    name: str | None = None,
    context: bool | str = False,
) -> Any:
    """Decorator: transform a Python function into a Strands tool."""

    def decorator(f: Callable[..., Any]) -> DecoratedTool:
        ctx: str | None = None
        if isinstance(context, str) and context:
            ctx = context
        elif context:
            ctx = "tool_context"
        skip = {"self", "cls", "agent"}
        if ctx:
            skip.add(ctx)
        return DecoratedTool(
            f,
            name or f.__name__,
            description or _extract_description(f),
            inputSchema or _build_input_schema(f, skip),
            ctx,
        )

    return decorator(func) if func is not None else decorator
