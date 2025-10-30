"""GitHub Gist management tool for Strands Agents.

This module provides comprehensive gist operations including create, read, update,
delete, list, fork, star, and comment management. Supports both public and private
gists with full GitHub API integration.

Key Features:
1. Create public/private gists with multiple files
2. List user gists, starred gists, public gists
3. Get detailed gist information including content
4. Update gist content, description, and files
5. Delete gists with confirmation
6. Fork existing gists
7. Star/unstar gists for bookmarking
8. Comment management (list, add, edit, delete)
9. Search gists by description or filename

Usage Examples:
```python
from strands import Agent
from tools.gist import gist

agent = Agent(tools=[gist])

# Create a new private gist
result = agent.tool.gist(
    action="create",
    description="My awesome code snippet",
    files={"main.py": "print('Hello World!')", "README.md": "# My Project"},
    public=False
)

# List all my gists
result = agent.tool.gist(action="list", gist_type="user")

# Get gist details
result = agent.tool.gist(action="get", gist_id="abc123...")

# Update gist content
result = agent.tool.gist(
    action="update",
    gist_id="abc123...",
    files={"main.py": "print('Updated!')"}
)
```
"""

import os
from typing import Any, Dict, List, Optional, Union

import requests
from strands import tool


def _get_github_token() -> str:
    """Get GitHub token from environment variable."""
    return os.environ.get("PAT_TOKEN", os.environ.get("GITHUB_TOKEN", ""))


def _make_github_request(
    method: str,
    endpoint: str,
    data: Optional[Dict] = None,
    params: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Make authenticated GitHub API request.

    Args:
        method: HTTP method (GET, POST, PATCH, DELETE)
        endpoint: API endpoint (e.g., '/gists')
        data: Request body data
        params: Query parameters

    Returns:
        Dictionary with success status, status_code, and response data
    """
    token = _get_github_token()
    if not token:
        return {
            "success": False,
            "error": "GitHub token not available",
            "status_code": 401,
        }

    url = f"https://api.github.com{endpoint}"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "strands-agent-gist-tool",
    }

    try:
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=data,
            params=params,
            timeout=30,
        )

        response_data = {}
        if response.headers.get("content-type", "").startswith("application/json"):
            try:
                response_data = response.json()
            except ValueError:
                pass

        return {
            "success": response.status_code < 400,
            "status_code": response.status_code,
            "data": response_data,
            "error": (response_data.get("message", "") if response.status_code >= 400 else ""),
        }
    except Exception as e:
        return {"success": False, "error": str(e), "status_code": 0}


def _format_gist_info(gist: Dict[str, Any], include_content: bool = False) -> str:
    """Format gist information for display.

    Args:
        gist: Gist data from API
        include_content: Whether to include file contents

    Returns:
        Formatted gist information string
    """
    info = []
    info.append(f"**ID:** {gist.get('id', 'N/A')}")
    info.append(f"**URL:** {gist.get('html_url', 'N/A')}")
    info.append(f"**Description:** {gist.get('description', 'No description')}")
    info.append(f"**Public:** {'Yes' if gist.get('public', False) else 'No'}")
    info.append(f"**Created:** {gist.get('created_at', 'N/A')}")
    info.append(f"**Updated:** {gist.get('updated_at', 'N/A')}")
    info.append(f"**Comments:** {gist.get('comments', 0)}")

    files = gist.get("files", {})
    if files:
        info.append(f"**Files:** {len(files)}")
        for filename, file_data in files.items():
            size = file_data.get("size", 0)
            lang = file_data.get("language") or "Text"
            info.append(f"  - `{filename}` ({lang}, {size} bytes)")

            if include_content and file_data.get("content"):
                content = file_data["content"]
                if len(content) > 50000:
                    content = content[:50000] + "..."
                info.append(f"    ```{lang.lower()}")
                info.append(content)
                info.append("    ```")

    return "\n".join(info)


@tool
def gist(
    action: str,
    gist_id: Optional[str] = None,
    description: Optional[str] = None,
    files: Optional[Dict[str, str]] = None,
    public: bool = True,
    gist_type: str = "user",
    username: Optional[str] = None,
    per_page: int = 30,
    page: int = 1,
    comment_id: Optional[str] = None,
    comment_text: Optional[str] = None,
    search_query: Optional[str] = None,
    include_content: bool = False,
) -> Dict[str, Union[str, List[Dict[str, str]]]]:
    """Comprehensive GitHub Gist management tool.

    Provides full gist lifecycle management including creation, reading, updating,
    deletion, listing, forking, starring, and comment management.

    Args:
        action: The action to perform. One of:
            - "create": Create a new gist
            - "list": List gists (user, starred, public)
            - "get": Get detailed gist information
            - "update": Update existing gist
            - "delete": Delete a gist
            - "fork": Fork an existing gist
            - "star": Star a gist
            - "unstar": Unstar a gist
            - "is_starred": Check if gist is starred
            - "comments": List gist comments
            - "add_comment": Add comment to gist
            - "edit_comment": Edit existing comment
            - "delete_comment": Delete comment
        gist_id: Gist ID (required for get, update, delete, fork, star operations)
        description: Gist description (for create/update)
        files: Dictionary of filename -> content (for create/update)
        public: Whether gist should be public (for create, default: True)
        gist_type: Type of gists to list ("user", "starred", "public", default: "user")
        username: Username for listing public gists (optional)
        per_page: Number of results per page (1-100, default: 30)
        page: Page number for pagination (default: 1)
        comment_id: Comment ID (for edit/delete comment operations)
        comment_text: Comment text content (for add/edit comment)
        search_query: Search query for filtering gists
        include_content: Include file contents in results (default: False)

    Returns:
        A dictionary with operation status and results

    Examples:
        ```python
        # Create a simple gist
        result = gist(
            action="create",
            description="Hello World Example",
            files={"hello.py": "print('Hello, World!')"},
            public=False
        )

        # List my gists
        result = gist(action="list", gist_type="user")

        # Get specific gist with content
        result = gist(action="get", gist_id="abc123", include_content=True)

        # Update gist files
        result = gist(
            action="update",
            gist_id="abc123",
            files={"hello.py": "print('Updated!')"}
        )

        # Add comment to gist
        result = gist(
            action="add_comment",
            gist_id="abc123",
            comment_text="Great work!"
        )

        # Star a gist
        result = gist(action="star", gist_id="abc123")
        ```
    """
    try:
        if action == "create":
            if not files:
                return {
                    "status": "error",
                    "content": [{"text": "Error: files parameter is required for create action"}],
                }

            # Convert files dict to GitHub API format
            gist_files = {}
            for filename, file_content in files.items():
                gist_files[filename] = {"content": file_content}

            data = {
                "description": description or "",
                "public": public,
                "files": gist_files,
            }

            result = _make_github_request("POST", "/gists", data=data)

            if result["success"]:
                gist_info = _format_gist_info(result["data"])
                return {
                    "status": "success",
                    "content": [
                        {"text": "✅ Gist created successfully!"},
                        {"text": gist_info},
                    ],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to create gist: {result['error']}"}],
                }

        elif action == "list":
            endpoint = "/gists"
            params = {"per_page": per_page, "page": page}

            if gist_type == "starred":
                endpoint = "/gists/starred"
            elif gist_type == "public":
                endpoint = "/gists/public"
                if username:
                    endpoint = f"/users/{username}/gists"

            result = _make_github_request("GET", endpoint, params=params)

            if result["success"]:
                gists: List[Dict[str, Any]] = result["data"]
                if not gists:
                    return {
                        "status": "success",
                        "content": [{"text": f"No {gist_type} gists found"}],
                    }

                # Filter by search query if provided
                if search_query:
                    filtered_gists: List[Dict[str, Any]] = []
                    query_lower = search_query.lower()
                    for gist in gists:
                        description = (gist.get("description") or "").lower()
                        files_dict = gist.get("files", {})
                        if files_dict:
                            files_list = list(files_dict.keys())
                            if query_lower in description or any(
                                query_lower in filename.lower() for filename in files_list
                            ):
                                filtered_gists.append(gist)
                        elif query_lower in description:
                            filtered_gists.append(gist)
                    gists = filtered_gists

                content: List[Dict[str, str]] = [{"text": f"📋 Found {len(gists)} {gist_type} gist(s):"}]

                for gist in gists:
                    gist_info = _format_gist_info(gist, include_content)
                    content.append({"text": f"\n{gist_info}\n" + "─" * 50})

                return {"status": "success", "content": content}
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to list gists: {result['error']}"}],
                }

        elif action == "get":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for get action"}],
                }

            result = _make_github_request("GET", f"/gists/{gist_id}")

            if result["success"]:
                gist_info = _format_gist_info(result["data"], include_content)
                return {
                    "status": "success",
                    "content": [{"text": "📄 Gist Details:"}, {"text": gist_info}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to get gist: {result['error']}"}],
                }

        elif action == "update":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for update action"}],
                }

            data = {}
            if description is not None:
                data["description"] = description

            if files:
                gist_files = {}
                for filename, file_content in files.items():
                    if file_content is None:
                        # Delete file by setting content to null
                        gist_files[filename] = None  # type: ignore[unreachable]
                    else:
                        gist_files[filename] = {"content": file_content}
                data["files"] = gist_files

            if not data:
                return {
                    "status": "error",
                    "content": [{"text": "Error: Either description or files must be provided for update"}],
                }

            result = _make_github_request("PATCH", f"/gists/{gist_id}", data=data)

            if result["success"]:
                gist_info = _format_gist_info(result["data"])
                return {
                    "status": "success",
                    "content": [
                        {"text": "✅ Gist updated successfully!"},
                        {"text": gist_info},
                    ],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to update gist: {result['error']}"}],
                }

        elif action == "delete":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for delete action"}],
                }

            result = _make_github_request("DELETE", f"/gists/{gist_id}")

            if result["success"]:
                return {
                    "status": "success",
                    "content": [{"text": f"✅ Gist {gist_id} deleted successfully!"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to delete gist: {result['error']}"}],
                }

        elif action == "fork":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for fork action"}],
                }

            result = _make_github_request("POST", f"/gists/{gist_id}/forks")

            if result["success"]:
                gist_info = _format_gist_info(result["data"])
                return {
                    "status": "success",
                    "content": [
                        {"text": "✅ Gist forked successfully!"},
                        {"text": gist_info},
                    ],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to fork gist: {result['error']}"}],
                }

        elif action == "star":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for star action"}],
                }

            result = _make_github_request("PUT", f"/gists/{gist_id}/star")

            if result["success"]:
                return {
                    "status": "success",
                    "content": [{"text": f"⭐ Gist {gist_id} starred successfully!"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to star gist: {result['error']}"}],
                }

        elif action == "unstar":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for unstar action"}],
                }

            result = _make_github_request("DELETE", f"/gists/{gist_id}/star")

            if result["success"]:
                return {
                    "status": "success",
                    "content": [{"text": f"✨ Gist {gist_id} unstarred successfully!"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to unstar gist: {result['error']}"}],
                }

        elif action == "is_starred":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for is_starred action"}],
                }

            result = _make_github_request("GET", f"/gists/{gist_id}/star")

            if result["status_code"] == 204:
                return {
                    "status": "success",
                    "content": [{"text": f"⭐ Gist {gist_id} is starred"}],
                }
            elif result["status_code"] == 404:
                return {
                    "status": "success",
                    "content": [{"text": f"✨ Gist {gist_id} is not starred"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to check star status: {result['error']}"}],
                }

        elif action == "comments":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for comments action"}],
                }

            params = {"per_page": per_page, "page": page}
            result = _make_github_request("GET", f"/gists/{gist_id}/comments", params=params)

            if result["success"]:
                comments: List[Dict[str, Any]] = result["data"]
                if not comments:
                    return {
                        "status": "success",
                        "content": [{"text": "💬 No comments found for this gist"}],
                    }

                response_content: List[Dict[str, str]] = [{"text": f"💬 Found {len(comments)} comment(s):"}]

                for comment in comments:
                    comment_info: List[str] = []
                    comment_info.append(f"**ID:** {comment.get('id')}")
                    comment_info.append(f"**User:** {comment.get('user', {}).get('login', 'Unknown')}")
                    comment_info.append(f"**Created:** {comment.get('created_at')}")
                    comment_info.append(f"**Body:** {comment.get('body', '')[:200]}...")

                    response_content.append({"text": f"\n{chr(10).join(comment_info)}\n" + "─" * 30})

                return {"status": "success", "content": response_content}
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to get comments: {result['error']}"}],
                }

        elif action == "add_comment":
            if not gist_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: gist_id is required for add_comment action"}],
                }
            if not comment_text:
                return {
                    "status": "error",
                    "content": [{"text": "Error: comment_text is required for add_comment action"}],
                }

            data = {"body": comment_text}
            result = _make_github_request("POST", f"/gists/{gist_id}/comments", data=data)

            if result["success"]:
                comment = result["data"]
                return {
                    "status": "success",
                    "content": [
                        {"text": "✅ Comment added successfully!"},
                        {"text": f"Comment ID: {comment.get('id')}"},
                    ],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to add comment: {result['error']}"}],
                }

        elif action == "edit_comment":
            if not comment_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: comment_id is required for edit_comment action"}],
                }
            if not comment_text:
                return {
                    "status": "error",
                    "content": [{"text": "Error: comment_text is required for edit_comment action"}],
                }

            data = {"body": comment_text}
            result = _make_github_request("PATCH", f"/gists/comments/{comment_id}", data=data)

            if result["success"]:
                return {
                    "status": "success",
                    "content": [{"text": f"✅ Comment {comment_id} updated successfully!"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to edit comment: {result['error']}"}],
                }

        elif action == "delete_comment":
            if not comment_id:
                return {
                    "status": "error",
                    "content": [{"text": "Error: comment_id is required for delete_comment action"}],
                }

            result = _make_github_request("DELETE", f"/gists/comments/{comment_id}")

            if result["success"]:
                return {
                    "status": "success",
                    "content": [{"text": f"✅ Comment {comment_id} deleted successfully!"}],
                }
            else:
                return {
                    "status": "error",
                    "content": [{"text": f"❌ Failed to delete comment: {result['error']}"}],
                }

        else:
            valid_actions = [
                "create",
                "list",
                "get",
                "update",
                "delete",
                "fork",
                "star",
                "unstar",
                "is_starred",
                "comments",
                "add_comment",
                "edit_comment",
                "delete_comment",
            ]
            return {
                "status": "error",
                "content": [{"text": f"❌ Unknown action '{action}'. Valid actions are: {', '.join(valid_actions)}"}],
            }

    except Exception as e:
        return {"status": "error", "content": [{"text": f"❌ Error: {str(e)}"}]}
