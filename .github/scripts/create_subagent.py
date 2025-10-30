"""Sub-agent creation and management tool for Strands Agents.

This module provides a tool for creating and managing sub-agents by triggering GitHub Actions
workflows. It enables task delegation and parallel processing by handing off tasks to
specialized agents running in separate GitHub Actions workflows.

Key Features:
1. Create sub-agents by triggering GitHub Actions workflows
2. Pass context and tasks to sub-agents
3. Configure model selection (model ID, provider, max tokens) for granular control
4. Configure tool selection with comma-separated tool names
5. Prevent throttling by using different models for different sub-agents
6. Track sub-agent status and results
7. Set specific system prompts for sub-agents

Model Selection:
- Use us.anthropic.claude-sonnet-4-20250514-v1:0 for tasks
- Use us.anthropic.claude-opus-4-20250514-v1:0 for advanced reasoning tasks
- Specify provider (bedrock, anthropic, openai) and max_tokens for fine-tuned control

Tool Selection:
- Pass comma-separated tool names to control which tools the sub-agent has access to
- Available tools include: current_time,editor,environment,file_read,file_write,http_request,load_tool,
  python_repl,retrieve,shell,slack,think,use_agent,calculator,use_aws,generate_image,image_reader,memory,swarm,workflow
- Examples: "file_read,file_write,shell" or "python_repl,calculator,http_request"

Usage Examples:
```python
from strands import Agent
from strands_action import create_subagent

agent = Agent(tools=[create_subagent])

# Create a sub-agent with specific model and tools for data analysis
result = agent.tool.create_subagent(
    repository="owner/repo",
    workflow_id="agent.yml",
    task="Analyze this dataset and provide insights",
    model="us.anthropic.claude-3-5-haiku-20241022-v1:0",
    provider="bedrock",
    max_tokens=4096,
    tools="file_read,python_repl,calculator",
)

# Create a sub-agent with powerful model for complex reasoning with limited tools
result = agent.tool.create_subagent(
    repository="owner/repo",
    workflow_id="agent.yml",
    task="Complex multi-step analysis requiring deep reasoning",
    model="us.anthropic.claude-opus-4-20250514-v1:0",
    provider="bedrock",
    max_tokens=8192,
    tools="think,use_agent,retrieve",
)
```
"""

import os
import re
from typing import Any

import requests
from strands import tool


def _get_github_token() -> str:
    """Get GitHub token from environment variable."""
    return os.environ.get("GITHUB_TOKEN", "")


def _dispatch_workflow(
    repository: str,
    workflow_id: str,
    inputs: dict[str, str],
    token: str,
    branch: str = "main",
) -> dict[str, Any]:
    """Dispatch a GitHub Actions workflow with inputs.

    Args:
        repository: The repository in format "owner/repo"
        workflow_id: The workflow file name or ID
        inputs: Dictionary of input parameters to pass to the workflow
        token: GitHub token
        branch: The branch to run the workflow on (default: "main")

    Returns:
        Dictionary with success status and message
    """
    # GitHub API endpoint for workflow dispatch
    url = f"https://api.github.com/repos/{repository}/actions/workflows/{workflow_id}/dispatches"

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # Prepare payload
    data = {"ref": branch, "inputs": inputs}

    try:
        response = requests.post(url, headers=headers, json=data, timeout=30)

        if response.status_code == 204:
            return {
                "success": True,
                "message": f"Workflow {workflow_id} dispatched successfully",
            }
        else:
            error_message = f"Failed to dispatch workflow: {response.status_code} - {response.text}"
            return {"success": False, "message": error_message}
    except Exception as e:
        return {"success": False, "message": f"Error dispatching workflow: {e!s}"}


def _check_workflow_run_status(
    repository: str,
    run_id: str,
    token: str,
) -> dict[str, Any]:
    """Check the status of a specific workflow run.

    Args:
        repository: The repository in format "owner/repo"
        run_id: The run ID of the specific workflow execution
        token: GitHub token

    Returns:
        Dictionary with status information
    """
    # GitHub API endpoint for workflow run
    url = f"https://api.github.com/repos/{repository}/actions/runs/{run_id}"

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
                "status": data.get("status"),
                "conclusion": data.get("conclusion"),
                "html_url": data.get("html_url"),
                "name": data.get("name"),
                "workflow_id": data.get("workflow_id"),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            }
        else:
            error_message = f"Failed to check workflow run status: {response.status_code} - {response.text}"
            return {"success": False, "message": error_message}
    except Exception as e:
        return {"success": False, "message": f"Error checking workflow run: {e!s}"}


def _get_workflow_run_logs(
    repository: str,
    run_id: str,
    token: str,
) -> dict[str, Any]:
    """Get logs for a workflow run.

    Args:
        repository: The repository in format "owner/repo"
        run_id: The run ID of the specific workflow execution
        token: GitHub token

    Returns:
        Dictionary with logs information
    """
    # GitHub API endpoint for workflow run logs
    url = f"https://api.github.com/repos/{repository}/actions/runs/{run_id}/logs"

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    try:
        # This endpoint returns a redirect to download the logs
        response = requests.get(url, headers=headers, allow_redirects=False, timeout=30)

        if response.status_code == 302:
            download_url = response.headers.get("Location")
            if download_url:
                # Follow redirect to get logs
                log_response = requests.get(download_url, timeout=30)
                if log_response.status_code == 200:
                    return {"success": True, "logs": log_response.text}
                else:
                    return {
                        "success": False,
                        "message": f"Failed to download logs: {log_response.status_code}",
                    }
            else:
                return {
                    "success": False,
                    "message": "No download URL found in response",
                }
        else:
            error_message = f"Failed to get workflow run logs: {response.status_code} - {response.text}"
            return {"success": False, "message": error_message}
    except Exception as e:
        return {"success": False, "message": f"Error getting workflow run logs: {e!s}"}


def _parse_agent_responses_from_logs(logs: str) -> list[dict[str, str]]:
    """Parse agent responses from workflow logs.

    This function extracts the actual agent responses from the log output
    by looking for specially formatted output blocks.

    Args:
        logs: The raw workflow logs text

    Returns:
        List of dictionaries containing agent responses
    """
    responses = []

    # Look for patterns like "Event: <message>" and "python -c" command execution
    # This is a simplified pattern that may need adjustment based on actual log format
    pattern = r"Event:\s*(.*?)\n.*?python -c"
    message_matches = re.findall(pattern, logs, re.DOTALL)

    if message_matches:
        for message in message_matches:
            responses.append({"prompt": message.strip()})

    return responses


def _list_workflow_runs(
    repository: str,
    workflow_id: str,
    token: str,
    per_page: int = 5,
) -> dict[str, Any]:
    """List runs of a specific workflow.

    Args:
        repository: The repository in format "owner/repo"
        workflow_id: The workflow file name or ID
        token: GitHub token
        per_page: Number of runs to return (default: 5)

    Returns:
        Dictionary with list of workflow runs
    """
    # GitHub API endpoint for workflow runs
    url = f"https://api.github.com/repos/{repository}/actions/workflows/{workflow_id}/runs"

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    params = {"per_page": per_page}

    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)

        if response.status_code == 200:
            data = response.json()
            runs = []

            for run in data.get("workflow_runs", []):
                runs.append(
                    {
                        "id": run.get("id"),
                        "name": run.get("name"),
                        "status": run.get("status"),
                        "conclusion": run.get("conclusion"),
                        "created_at": run.get("created_at"),
                        "updated_at": run.get("updated_at"),
                        "html_url": run.get("html_url"),
                    }
                )

            return {
                "success": True,
                "runs": runs,
                "total_count": data.get("total_count", 0),
            }
        else:
            error_message = f"Failed to list workflow runs: {response.status_code} - {response.text}"
            return {"success": False, "message": error_message}
    except Exception as e:
        return {"success": False, "message": f"Error listing workflow runs: {e!s}"}


@tool
def create_subagent(
    repository: str,
    workflow_id: str,
    task: str | None = None,
    system_prompt: str | None = None,
    context: str | None = None,
    branch: str = "main",
    action: str = "create",
    run_id: str | None = None,
    model: str | None = None,
    provider: str | None = None,
    max_tokens: int | None = None,
    tools: str | None = None,
    agent_runner: str | None = None,
) -> dict[str, Any]:
    """Create and manage sub-agents via GitHub Actions workflows.

    This tool allows creating and managing sub-agents by triggering GitHub Actions
    workflows. It helps with task delegation and parallel processing by handing off
    tasks to specialized agents running in separate GitHub Actions workflows.

    Args:
        repository: GitHub repository in format "owner/repo" where the workflow lives
        workflow_id: The workflow file name (e.g., "agent.yml") or ID
        task: The task to delegate to the sub-agent (required only for "create" action)
        system_prompt: Optional system prompt to set for the sub-agent
        context: Optional context information to provide to the sub-agent
        branch: The branch to run the workflow on (default: "main")
        action: The action to perform. One of:
            - "create": Create a new sub-agent (trigger workflow)
            - "status": Check status of a sub-agent run
            - "list": List recent sub-agent runs
        run_id: The run ID when checking status of a specific run
        model: The model ID to use for the sub-agent. Available models:
            - "us.anthropic.claude-3-7-sonnet-20250219-v1:0" (max 32768 tokens) - 10000 ideal
            - "us.anthropic.claude-sonnet-4-20250514-v1:0" (max 65536 tokens) - 10000 ideal
        provider: The model provider to use (e.g., "bedrock" - only bedrock is enabled)
        max_tokens: Maximum number of tokens for the sub-agent model.
        tools: Comma-separated list of tools to enable for the sub-agent. Available tools:
            current_time,editor,environment,file_read,file_write,http_request,load_tool,
            python_repl,retrieve,shell,slack,think,use_llm,calculator,use_aws,generate_image,
            image_reader,memory,swarm,workflow. Example: "file_read,python_repl,calculator"
        agent_runner: Optional custom agent runner script URL to use for the sub-agent.
            Falls back to repository variable AGENT_RUNNER, then default gist if not provided.
            Example: "https://gist.githubusercontent.com/myuser/custom-agent.py"

    Returns:
        A dictionary with the operation status and information

    Example:
        ```python
        # Create a sub-agent with Claude Opus 4 for complex reasoning (smartest)
        result = create_subagent(
            repository="owner/repo",
            workflow_id="agent.yml",
            task="Complex multi-step analysis requiring deep reasoning",
            model="us.anthropic.claude-opus-4-20250514-v1:0",
            provider="bedrock",
            max_tokens=10000,
            tools="think,use_agent,retrieve,shell,retrieve",
        )

        # Create a sub-agent with Claude Sonnet 4 for balanced performance (suggested)
        result = create_subagent(
            repository="owner/repo",
            workflow_id="agent.yml",
            task="Analyze this dataset and provide comprehensive insights",
            model="us.anthropic.claude-sonnet-4-20250514-v1:0",
            provider="bedrock",
            max_tokens=10000,
            tools="file_read,python_repl,calculator,http_request,retrieve",
        )

        # Create a specialized development sub-agent
        result = create_subagent(
            repository="owner/repo",
            workflow_id="agent.yml",
            task="Review code and suggest improvements",
            tools="file_read,editor,python_repl,shell",
            system_prompt="You are a senior code reviewer focused on best practices",
        )


        # Create a sub-agent with custom agent runner
        result = create_subagent(
            repository="owner/repo",
            workflow_id="agent.yml",
            task="Use custom agent logic for this task",
            agent_runner="https://gist.githubusercontent.com/myuser/custom-agent.py",
            tools="file_read,python_repl",
        )
                # Check status of a specific run
        result = create_subagent(
            action="status",
            repository="owner/repo",
            workflow_id="agent.yml",
            run_id="12345678",
        )

        # List recent runs
        result = create_subagent(
            action="list",
            repository="owner/repo",
            workflow_id="agent.yml",
        )
        ```
    """
    try:
        token = _get_github_token()
        if not token:
            return {
                "status": "error",
                "content": [{"text": "Error: GitHub token not available. Cannot create or manage sub-agents."}],
            }

        if action == "create":
            # Validate that task is provided for create action
            if not task:
                return {
                    "status": "error",
                    "content": [{"text": "Error: 'task' parameter is required for the create action"}],
                }

            # Prepare inputs for the workflow - only include valid inputs based on workflow definition
            inputs = {}

            # Only add system_prompt if it's provided
            if system_prompt is not None:
                inputs["system_prompt"] = str(system_prompt)  # Explicitly convert to string

            # Add model configuration parameters if provided
            if model is not None:
                inputs["model"] = str(model)

            if provider is not None:
                inputs["provider"] = str(provider)

            if max_tokens is not None:
                inputs["max_tokens"] = str(max_tokens)  # Convert to string for GitHub Actions input

            # Add tools configuration if provided
            if tools is not None:
                inputs["tools"] = str(tools)  # Pass comma-separated tools string
            # Add agent_runner configuration if provided
            if agent_runner is not None:
                inputs["agent_runner"] = str(agent_runner)

            # Create task context combining task and context
            task_context = f"Task: {task}"
            if context is not None:
                task_context += f"\nContext: {context}"
            inputs["task"] = task_context

            # Dispatch the workflow
            result = _dispatch_workflow(
                repository=repository,
                workflow_id=workflow_id,
                inputs=inputs,
                token=token,
                branch=branch,
            )

            if result["success"]:
                content = [
                    {"text": f"Sub-agent created successfully: {result['message']}"},
                    {"text": f"Task delegated: {task}"},
                    {"text": f"Repository: {repository}"},
                    {"text": f"Workflow: {workflow_id}"},
                    {"text": f"Branch: {branch}"},
                ]

                # Add model configuration info if provided
                if model is not None:
                    content.append({"text": f"Model: {model}"})
                if provider is not None:
                    content.append({"text": f"Provider: {provider}"})
                if max_tokens is not None:
                    content.append({"text": f"Max Tokens: {max_tokens}"})
                if tools is not None:
                    content.append({"text": f"Tools: {tools}"})
                if agent_runner is not None:
                    content.append({"text": f"Agent Runner: {agent_runner}"})

                content.append(
                    {"text": "To check status, use the 'list' action to find the run ID, then use 'status' action."}
                )

                return {
                    "status": "success",
                    "content": content,
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"Failed to create sub-agent: {result['message']}"}],
                }

        elif action == "status":
            if not run_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: run_id parameter is required for the status action"}],
                }

            result = _check_workflow_run_status(repository=repository, run_id=run_id, token=token)

            if result["success"]:
                status_text = f"Status: {result.get('status')}"
                if result.get("conclusion"):
                    status_text += f", Conclusion: {result.get('conclusion')}"

                content = [
                    {"text": f"Sub-agent run status: {status_text}"},
                    {"text": f"Name: {result.get('name', 'N/A')}"},
                    {"text": f"Created: {result.get('created_at', 'N/A')}"},
                    {"text": f"Updated: {result.get('updated_at', 'N/A')}"},
                    {"text": f"Run URL: {result.get('html_url', 'N/A')}"},
                ]

                # If the run is complete, try to get logs and extract meaningful information
                if result.get("status") == "completed":
                    logs_result = _get_workflow_run_logs(repository=repository, run_id=run_id, token=token)

                    if logs_result["success"]:
                        logs = logs_result.get("logs", "")

                        # Try to extract agent responses from logs
                        agent_responses = _parse_agent_responses_from_logs(logs)

                        if agent_responses:
                            content.append({"text": "Agent Tasks:"})
                            for idx, response in enumerate(agent_responses, 1):
                                content.append({"text": f"Task {idx}: {response.get('prompt', 'N/A')}"})

                        # Extract event output message
                        event_pattern = r"Event:\s*(.*?)(?:\n|\r\n)"
                        event_match = re.search(event_pattern, logs)
                        if event_match:
                            content.append({"text": f"Event: {event_match.group(1).strip()}"})

                        # Also show a truncated version of the logs for debugging
                        if len(logs) > 1000:
                            logs_excerpt = logs[:1000] + "...\n[Logs truncated due to length]"
                        else:
                            logs_excerpt = logs

                        content.append({"text": f"Run Logs (excerpt):\n```\n{logs_excerpt}\n```"})

                return {"status": "success", "content": content}
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"Failed to check sub-agent status: {result.get('message')}"}],
                }

        elif action == "list":
            result = _list_workflow_runs(repository=repository, workflow_id=workflow_id, token=token)

            if result["success"]:
                runs = result.get("runs", [])
                total_count = result.get("total_count", 0)

                if not runs:
                    return {
                        "status": "success",
                        "content": [{"text": "No recent sub-agent runs found"}],
                    }

                content = [{"text": f"Recent sub-agent runs (showing {len(runs)} of {total_count}):"}]
                for run in runs:
                    run_info = (
                        f"Run ID: {run.get('id')}\n"
                        f"Name: {run.get('name', 'N/A')}\n"
                        f"Status: {run.get('status')}\n"
                        f"Conclusion: {run.get('conclusion', 'N/A')}\n"
                        f"Created: {run.get('created_at')}\n"
                        f"Updated: {run.get('updated_at', 'N/A')}\n"
                        f"URL: {run.get('html_url')}\n"
                    )
                    content.append({"text": run_info})

                content.append(
                    {
                        "text": "To check the status of a specific run, use: "
                        'create_subagent(action="status", repository="owner/repo", '
                        'workflow_id="workflow.yml", run_id="RUN_ID")'
                    }
                )

                return {"status": "success", "content": content}
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"Failed to list sub-agent runs: {result.get('message')}"}],
                }

        else:
            return {
                "status": "error",
                "content": [{"text": f"Error: Unknown action '{action}'. Valid actions are create, status, list"}],
            }

    except Exception as e:
        return {"status": "error", "content": [{"text": f"Error: {e!s}"}]}
