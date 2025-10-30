#!/usr/bin/env python3
"""
Strands GitHub Agent Runner
A portable agent runner for use in GitHub Actions across different repositories.
"""

import datetime
import json
import logging
import os
import sys
from typing import Any

from strands import Agent
from strands.session import S3SessionManager
from strands_tools.utils.models.model import create_model

from strands_tools import http_request, shell

# Import local GitHub tools we need
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
)

# Import local tools we need
from handoff_to_user import handoff_to_user
from notebook import notebook
from str_replace_based_edit_tool import str_replace_based_edit_tool

os.environ["BYPASS_TOOL_CONSENT"] = "true"
os.environ["STRANDS_TOOL_CONSOLE_MODE"] = "enabled"


# Configure logging
if os.getenv("STRANDS_DEBUG") == "1":
    logging.getLogger("strands").setLevel(logging.DEBUG)
    logging.basicConfig(
        format="%(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler()],
    )

def _get_all_tools() -> dict[str, Any]:
    return {
        # File editing
        "str_replace_based_edit_tool": str_replace_based_edit_tool,
        
        # System tools
        "shell": shell,
        "http_request": http_request,
        
        # GitHub issue tools
        "create_issue": create_issue,
        "get_issue": get_issue,
        "update_issue": update_issue,
        "list_issues": list_issues,
        "add_issue_comment": add_issue_comment,
        "get_issue_comments": get_issue_comments,
        
        # GitHub PR tools
        "create_pull_request": create_pull_request,
        "get_pull_request": get_pull_request,
        "update_pull_request": update_pull_request,
        "list_pull_requests": list_pull_requests,
        "get_pr_review_and_comments": get_pr_review_and_comments,
        "reply_to_review_comment": reply_to_review_comment,
        
        # Agent tools
        "notebook": notebook,
        "handoff_to_user": handoff_to_user,
    }


def run_agent(query: str):
    """Run the agent with the provided query."""
    try:
        # Get tools and create model
        tools = _get_all_tools()
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
        agent = Agent(
            model=model,
            system_prompt=system_prompt,
            tools=list(tools.values()),
            session_manager=session_manager,
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
        raise e


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