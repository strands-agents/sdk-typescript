"""System prompt management tool for Strands Agent.

This module provides a tool to view and modify system prompts used by the agent.
It helps with dynamic adaptation of the agent's behavior and capabilities,
and can persist changes by updating GitHub repository variables.

Key Features:
1. View current system prompt from any environment variable
2. Update system prompt (in-memory and GitHub repository variable)
3. Add context information to system prompt
4. Reset system prompt to default
5. Support for custom variable names (SYSTEM_PROMPT, AGENT_BUILDER_SYSTEM_PROMPT, etc.)

Usage Examples:
```python
from strands import Agent
from strands_action import system_prompt

agent = Agent(tools=[system_prompt])

# View current system prompt (default SYSTEM_PROMPT variable)
result = agent.tool.system_prompt(action="view")

# Update system prompt for tool builder
result = agent.tool.system_prompt(
    action="update",
    prompt="You are a specialized tool builder agent...",
    repository="owner/repo",
    variable_name="AGENT_BUILDER_SYSTEM_PROMPT"
)

# Work with any custom variable name
result = agent.tool.system_prompt(
    action="view",
    variable_name="MY_CUSTOM_PROMPT"
)
```
"""

import os
from typing import Any

import requests
from strands import tool


def _get_github_token() -> str:
    """Get GitHub token from environment variable."""
    return os.environ.get("GITHUB_TOKEN", "")


def _get_github_repository_variable(repository: str, name: str, token: str) -> dict[str, Any]:
    """Fetch a GitHub repository variable.

    Args:
        repository: The repository in format "owner/repo"
        name: The variable name
        token: GitHub token

    Returns:
        Dictionary with success status, message, and value if successful
    """
    # GitHub API endpoint for repository variables
    url = f"https://api.github.com/repos/{repository}/actions/variables/{name}"

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)

        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "message": f"Variable {name} fetched successfully",
                "value": data.get("value", ""),
            }
        else:
            error_message = f"Failed to fetch variable: {response.status_code} - {response.text}"
            return {"success": False, "message": error_message, "value": ""}
    except Exception as e:
        return {
            "success": False,
            "message": f"Error fetching GitHub variable: {e!s}",
            "value": "",
        }


def _get_system_prompt(repository: str | None = None, variable_name: str = "SYSTEM_PROMPT") -> str:
    """Get the current system prompt.

    First checks the local environment variable.
    If empty and repository is provided, tries to fetch from GitHub repository variables.

    Args:
        repository: Optional GitHub repository in format "owner/repo"
        variable_name: Name of the environment/repository variable to use

    Returns:
        The system prompt string
    """
    # First check local environment
    local_prompt = os.environ.get(variable_name, "")
    if local_prompt:
        return local_prompt

    # If local is empty and repository is provided, try GitHub
    if repository and not local_prompt:
        token = _get_github_token()
        if token:
            result = _get_github_repository_variable(repository=repository, name=variable_name, token=token)

            if result["success"]:
                # Store in local environment for future use
                if result["value"]:
                    os.environ[variable_name] = result["value"]
                return str(result["value"])

    # Default to empty string if nothing found
    return ""


def _update_system_prompt(new_prompt: str, variable_name: str = "SYSTEM_PROMPT") -> None:
    """Update the system prompt in the environment variable."""
    os.environ[variable_name] = new_prompt


def _get_github_event_context() -> str:
    """Get GitHub event context information from environment variables."""
    event_context = []

    # GitHub repository information
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if repo:
        event_context.append(f"Repository: {repo}")

    # Event type
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    if event_name:
        event_context.append(f"Event Type: {event_name}")

    # Actor
    actor = os.environ.get("GITHUB_ACTOR", "")
    if actor:
        event_context.append(f"Actor: {actor}")

    # Add more GitHub context variables as needed
    return "\n".join(event_context)


def _update_github_repository_variable(repository: str, name: str, value: str, token: str) -> dict[str, Any]:
    """Update a GitHub repository variable.

    Args:
        repository: The repository in format "owner/repo"
        name: The variable name
        value: The variable value
        token: GitHub token

    Returns:
        Dictionary with status and message
    """
    # GitHub API endpoint for repository variables
    url = f"https://api.github.com/repos/{repository}/actions/variables/{name}"

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    data = {"name": name, "value": value}

    response = requests.patch(url, headers=headers, json=data, timeout=30)

    if response.status_code == 204:
        return {"success": True, "message": f"Variable {name} updated successfully"}
    else:
        error_message = f"Failed to update variable: {response.status_code} - {response.text}"
        return {"success": False, "message": error_message}


@tool
def system_prompt(
    action: str,
    prompt: str | None = None,
    context: str | None = None,
    repository: str | None = None,
    variable_name: str = "SYSTEM_PROMPT",
) -> dict[str, str | list[dict[str, str]]]:
    """Manage the agent's system prompt.

    This tool allows viewing and modifying the system prompt used by the agent.
    It can be used to adapt the agent's behavior dynamically during runtime
    and can update GitHub repository variables to persist changes.

    Args:
        action: The action to perform on the system prompt. One of:
            - "view": View the current system prompt
            - "update": Replace the current system prompt
            - "add_context": Add additional context to the system prompt
            - "reset": Reset to default (empty or environment-defined)
            - "get_github_context": Get GitHub event context
        prompt: New system prompt when using the "update" action
        context: Additional context to add when using the "add_context" action
        repository: GitHub repository in format "owner/repo" to update repository
                   variable (e.g., "strands-agents/agent-builder")
        variable_name: Name of the environment/repository variable to use
                      (default: "SYSTEM_PROMPT")

    Returns:
        A dictionary with the operation status and current system prompt

    Example:
        ```python
        # View current system prompt
        result = system_prompt(action="view")

        # Update system prompt in memory
        result = system_prompt(
            action="update",
            prompt="You are a specialized agent for task X..."
        )

        # Update GitHub repository variable
        result = system_prompt(
            action="update",
            prompt="You are a specialized agent for task X...",
            repository="owner/repo"
        )

        # Work with custom variable name
        result = system_prompt(
            action="update",
            prompt="You are a tool builder...",
            repository="owner/repo",
            variable_name="AGENT_BUILDER_SYSTEM_PROMPT"
        )
        ```
    """
    try:
        if action == "view":
            current_prompt = _get_system_prompt(repository, variable_name)
            source = "local environment"

            if not os.environ.get(variable_name) and repository:
                source = f"GitHub repository {repository}"

            return {
                "status": "success",
                "content": [
                    {"text": f"Current system prompt from {variable_name} (from {source}):\n\n{current_prompt}"}
                ],
            }

        elif action == "update":
            if not prompt:
                return {
                    "status": "error",
                    "content": [{"text": "Error: prompt parameter is required for the update action"}],
                }

            # Update in-memory environment variable
            _update_system_prompt(prompt, variable_name)

            # If repository is specified, also update GitHub repository variable
            if repository:
                token = _get_github_token()
                if not token:
                    return {
                        "status": "error",
                        "content": [{"text": "Error: GitHub token not available. Cannot update repository variable."}],
                    }

                result = _update_github_repository_variable(
                    repository=repository, name=variable_name, value=prompt, token=token
                )

                if result["success"]:
                    return {
                        "status": "success",
                        "content": [
                            {"text": f"System prompt updated successfully in memory ({variable_name})"},
                            {"text": f"GitHub repository variable updated: {result['message']}"},
                        ],
                    }
                else:
                    return {
                        "status": "error",
                        "content": [
                            {"text": f"System prompt updated successfully in memory ({variable_name})"},
                            {"text": f"GitHub repository variable update failed: {result['message']}"},
                        ],
                    }

            return {
                "status": "success",
                "content": [{"text": f"System prompt updated successfully in memory ({variable_name})"}],
            }

        elif action == "add_context":
            if not context:
                return {
                    "status": "error",
                    "content": [{"text": "Error: context parameter is required for the add_context action"}],
                }

            current_prompt = _get_system_prompt(repository, variable_name)
            new_prompt = f"{current_prompt}\n\n{context}" if current_prompt else context
            _update_system_prompt(new_prompt, variable_name)

            # If repository is specified, also update GitHub repository variable
            if repository:
                token = _get_github_token()
                if not token:
                    return {
                        "status": "error",
                        "content": [
                            {"text": f"Context added to system prompt successfully in memory ({variable_name})"},
                            {"text": "Error: GitHub token not available. Cannot update repository variable."},
                        ],
                    }

                result = _update_github_repository_variable(
                    repository=repository,
                    name=variable_name,
                    value=new_prompt,
                    token=token,
                )

                if result["success"]:
                    return {
                        "status": "success",
                        "content": [
                            {"text": f"Context added to system prompt successfully in memory ({variable_name})"},
                            {"text": f"GitHub repository variable updated: {result['message']}"},
                        ],
                    }
                else:
                    return {
                        "status": "error",
                        "content": [
                            {"text": f"Context added to system prompt successfully in memory ({variable_name})"},
                            {"text": f"GitHub repository variable update failed: {result['message']}"},
                        ],
                    }

            return {
                "status": "success",
                "content": [{"text": f"Context added to system prompt successfully ({variable_name})"}],
            }

        elif action == "reset":
            # Reset to empty or environment-defined default
            os.environ.pop(variable_name, None)

            # If repository is specified, reset GitHub repository variable
            if repository:
                token = _get_github_token()
                if not token:
                    return {
                        "status": "error",
                        "content": [
                            {"text": f"System prompt reset to default in memory ({variable_name})"},
                            {"text": "Error: GitHub token not available. Cannot update repository variable."},
                        ],
                    }

                result = _update_github_repository_variable(
                    repository=repository, name=variable_name, value="", token=token
                )

                if result["success"]:
                    return {
                        "status": "success",
                        "content": [
                            {"text": f"System prompt reset to default in memory ({variable_name})"},
                            {"text": f"GitHub repository variable reset: {result['message']}"},
                        ],
                    }
                else:
                    return {
                        "status": "error",
                        "content": [
                            {"text": f"System prompt reset to default in memory ({variable_name})"},
                            {"text": f"GitHub repository variable reset failed: {result['message']}"},
                        ],
                    }

            return {
                "status": "success",
                "content": [{"text": f"System prompt reset to default ({variable_name})"}],
            }

        elif action == "get_github_context":
            github_context = _get_github_event_context()
            return {
                "status": "success",
                "content": [{"text": f"GitHub Event Context:\n\n{github_context}"}],
            }

        else:
            return {
                "status": "error",
                "content": [
                    {
                        "text": f"Error: Unknown action '{action}'. Valid actions are view, update, "
                        "add_context, reset, get_github_context"
                    }
                ],
            }

    except Exception as e:
        return {"status": "error", "content": [{"text": f"Error: {e!s}"}]}
