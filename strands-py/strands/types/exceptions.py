class MaxTokensReachedException(Exception):
    pass


class ContextOverflowError(Exception):
    """Raised when the model context window is exceeded."""


# Aliases used by integration tests.
ContextWindowOverflowException = ContextOverflowError


class ModelThrottledException(Exception):
    """Raised when the model API rate-limits the request."""


class MCPClientInitializationError(Exception):
    """Raised when an MCP client fails to initialize."""


class ToolProviderException(Exception):
    """Raised when a tool provider fails to load or cleanup tools."""


class SessionException(Exception):
    """Raised when session operations fail."""

