from strands.agent.conversation_manager.sliding_window_conversation_manager import (
    SlidingWindowConversationManager,
)
from strands.agent.conversation_manager.summarizing_conversation_manager import (
    SummarizingConversationManager,
)
from strands.hooks import HookProvider


class NullConversationManager(HookProvider):
    """No-op conversation manager."""


__all__ = ["NullConversationManager", "SlidingWindowConversationManager", "SummarizingConversationManager"]
