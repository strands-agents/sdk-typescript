class MaxTokensReachedException(Exception):
    pass


class ContextOverflowError(Exception):
    """Raised when the model context window is exceeded."""

