#!/usr/bin/env python3
"""
Strands GitHub Agent Runner
A portable agent runner for use in GitHub Actions across different repositories.
"""

import datetime
import json
import logging
import os
import platform
import sys
from typing import Any

from strands import Agent
from strands.session import S3SessionManager
from strands_tools.utils.models.model import create_model

os.environ["BYPASS_TOOL_CONSENT"] = "true"
os.environ["STRANDS_TOOL_CONSOLE_MODE"] = "enabled"


# Configure logging
if os.getenv("STRANDS_DEBUG") == "1":
    logging.getLogger("strands").setLevel(logging.DEBUG)
    logging.basicConfig(
        format="%(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler()],
    )


def get_tools() -> dict[str, Any]:
    """Returns the filtered collection of available agent tools for strands.

    This function first gets all available tools, then filters them based on
    the STRANDS_TOOLS environment variable if it exists.

    Returns:
        Dict[str, Any]: Dictionary mapping tool names to tool functions
    """
    # First get all tools
    tools = _get_all_tools()

    # Then apply filtering based on environment variable
    return _filter_tools(tools)


def _get_all_tools() -> dict[str, Any]:
    """Returns all available tools without filtering.

    Returns:
        Dict[str, Any]: Dictionary mapping tool names to tool functions
    """
    tools = {}

    try:
        # Strands tools
        from strands_tools import (
            calculator,
            current_time,
            editor,
            environment,
            file_read,
            file_write,
            generate_image,
            graph,
            http_request,
            image_reader,
            load_tool,
            mcp_client,
            memory,
            nova_reels,
            python_repl,
            retrieve,
            slack,
            stop,
            swarm,
            think,
            use_agent,
            use_aws,
            workflow,
        )

        # Import local GitHub tools
        import github_tools
        from github_tools import (
            add_issue_comment,
            create_issue,
            create_pull_request,
            get_issue,
            get_issue_comments,
            get_pull_request,
            get_pr_review_and_comments,
            list_issues,
            list_pull_requests,
            reply_to_review_comment,
            update_issue,
            update_pull_request,
            use_github,
        )

        # Import local tools
        from create_subagent import create_subagent
        from fetch_github_tool import fetch_github_tool
        from gist import gist
        from handoff_to_user import handoff_to_user
        from notebook import notebook
        from store_in_kb import store_in_kb
        from str_replace_based_edit_tool import str_replace_based_edit_tool
        from system_prompt import system_prompt
        from use_github import use_github

        tools = {
            "create_subagent": create_subagent,
            "fetch_github_tool": fetch_github_tool,
            "gist": gist,
            "system_prompt": system_prompt,
            "str_replace_based_edit_tool": str_replace_based_edit_tool,
            "use_github": use_github,
            "store_in_kb": store_in_kb,
            "list_pull_requests": list_pull_requests,
            "list_issues": list_issues,
            "add_issue_comment": add_issue_comment,
            "create_issue": create_issue,
            "get_issue": get_issue,
            "create_pull_request": create_pull_request,
            "get_pull_request": get_pull_request,
            "update_pull_request": update_pull_request,
            "update_issue": update_issue,
            "get_issue_comments": get_issue_comments,
            "get_pr_review_and_comments": get_pr_review_and_comments,
            "reply_to_review_comment": reply_to_review_comment,
            "handoff_to_user": handoff_to_user,
            "notebook": notebook,
            "use_agent": use_agent,
            "environment": environment,
            "python_repl": python_repl,
            "calculator": calculator,
            "current_time": current_time,
            "editor": editor,
            "file_read": file_read,
            "file_write": file_write,
            "generate_image": generate_image,
            "http_request": http_request,
            "image_reader": image_reader,
            "load_tool": load_tool,
            "memory": memory,
            "nova_reels": nova_reels,
            "retrieve": retrieve,
            "slack": slack,
            "stop": stop,
            "swarm": swarm,
            "graph": graph,
            "think": think,
            "use_aws": use_aws,
            "workflow": workflow,
            "mcp_client": mcp_client,
        }

        # Some tools don't currently work on Windows and even fail to import
        if platform.system() != "Windows":
            try:
                from strands_tools import (
                    python_repl,
                    shell,
                )

                tools.update(
                    {
                        "python_repl": python_repl,
                        "shell": shell,
                    }
                )
            except ImportError:
                pass

    except ImportError as e:
        print(f"Warning: Could not import all tools: {e!s}")

    return tools


def _filter_tools(all_tools: dict[str, Any]) -> dict[str, Any]:
    """Filter tools based on STRANDS_TOOLS environment variable.

    Supports both comma-separated strings and JSON arrays for flexibility.

    Args:
        all_tools: Dictionary of all available tools

    Returns:
        Dict[str, Any]: Filtered dictionary of tools
    """
    # Get tool filter from environment variable
    tool_filter_str = os.getenv("STRANDS_TOOLS")

    # If env var not set or set to 'ALL', return all tools
    if not tool_filter_str or tool_filter_str == "ALL":
        return all_tools

    tool_filter = None

    # First try to parse as JSON array
    try:
        tool_filter = json.loads(tool_filter_str)
        if not isinstance(tool_filter, list):
            tool_filter = None
    except json.JSONDecodeError:
        # If JSON parsing fails, try comma-separated string
        pass

    # If JSON parsing failed or didn't produce a list, try comma-separated
    if tool_filter is None:
        # Handle comma-separated string format
        tool_filter = [tool.strip() for tool in tool_filter_str.split(",") if tool.strip()]

        # If we still don't have a valid list, return all tools
        if not tool_filter:
            print(
                "Warning: STRANDS_TOOLS env var is not a valid JSON array or comma-separated string. Using all tools."
            )
            return all_tools

    # Filter the tools
    filtered_tools = {}
    for tool_name in tool_filter:
        if tool_name in all_tools:
            filtered_tools[tool_name] = all_tools[tool_name]
        else:
            print(f"Warning: Tool '{tool_name}' specified in STRANDS_TOOLS env var not found.")

    return filtered_tools


def run_agent(query: str):
    """Run the agent with the provided query."""
    try:
        # Get tools and create model
        tools = get_tools()
        model = create_model()
        system_prompt = os.getenv("INPUT_SYSTEM_PROMPT", "You are an autonomous GitHub agent powered by Strands Agents SDK.")
        session_manager = None
        session_id = os.getenv("SESSION_ID")
        s3_bucket = os.getenv("S3_SESSION_BUCKET")
        if s3_bucket and session_id:
            print(f"🤖 Using session manager with session ID: {session_id}")
            session_manager = S3SessionManager(
                session_id=session_id,
                bucket=s3_bucket,
                prefix=os.getenv("S3_SESSION_PREFIX", ""),
            )
        
        if (session_id and not s3_bucket) or (s3_bucket and not session_id):
            raise ValueError("Both SESSION_ID and S3_SESSION_BUCKET must be set if using session manager.")

        # Create agent
        load_tools_directory = os.getenv("STRANDS_TOOLS_DIRECTORY", "false").lower() == "true"
        agent = Agent(
            model=model,
            system_prompt=system_prompt,
            tools=list(tools.values()),
            session_manager=session_manager,
            load_tools_from_directory=load_tools_directory,
        )

        # Check for knowledge base integration
        knowledge_base_id = os.getenv("STRANDS_KNOWLEDGE_BASE_ID")
        if "retrieve" in tools and knowledge_base_id:
            try:
                agent.tool.retrieve(text=query, knowledgeBaseId=knowledge_base_id)
            except Exception as e:
                print(f"Warning: Could not retrieve from knowledge base: {e}")

        # Check if the latest message is a handoff_to_user tool use
        latest_message = agent.messages[-1] if len(agent.messages) > 0 else None

        if latest_message and len(latest_message["content"]) == 1 \
            and "toolUse" in latest_message["content"][0] \
            and latest_message["content"][0]["toolUse"]["name"] == "handoff_to_user":
                agent._append_message({
                    "role": "user",
                    "content": [{"toolResult": {
                        "toolUseId": latest_message["content"][0]["toolUse"]["toolUseId"],
                        "content": [{"text": query}],
                        "status": "success"
                    }}]
                })
                print("Resuming agent after handoff...")
                result = agent()
        else:
            print("Processing user query...")
            result = agent(query)

        if "store_in_kb" in agent.tool_names and knowledge_base_id:
            try:
                # Create conversation content by combining user input and agent result
                conversation_content = f"Input: {query}, Result: {result!s}"
                # Create title with Strands prefix, current date, and user query
                conversation_title = f"Strands GitHub Agent: {datetime.datetime.now().strftime('%Y-%m-%d')} | {query}"
                agent.tool.store_in_kb(
                    content=conversation_content,
                    title=conversation_title,
                    knowledge_base_id=knowledge_base_id,
                )
            except Exception as e:
                print(f"Warning: Could not store in knowledge base: {e}")

        print(f"\n\nAgent Result 🤖\nStop Reason: {result.stop_reason}\nMessage: {json.dumps(result.message, indent=2)}")
    except Exception as e:
        error_msg = f"❌ Agent execution failed: {e}"
        print(error_msg)


def main() -> None:
    """Main entry point for the agent runner."""
    try:
        # Read task from command line arguments
        if len(sys.argv) < 2:
            raise ValueError("Task argument is required")

        task = " ".join(sys.argv[1:])
        if not task.strip():
            raise ValueError("Task cannot be empty")
        print(f"🤖 Running agent with task: {task}")

        run_agent(task)

    except Exception as e:
        error_msg = f"Fatal error: {e}"
        print(error_msg)

        sys.exit(1)


if __name__ == "__main__":
    main()