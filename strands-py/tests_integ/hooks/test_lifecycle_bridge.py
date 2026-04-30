import pytest

from strands import Agent
from strands.hooks import (
    AfterInvocationEvent,
    AfterModelCallEvent,
    AgentInitializedEvent,
    BeforeInvocationEvent,
    BeforeModelCallEvent,
    HookProvider,
    MessageAddedEvent,
)


@pytest.fixture
def callback_names():
    return []


@pytest.fixture
def hook_provider(callback_names):
    class LifecycleBridgeHook(HookProvider):
        def register_hooks(self, registry):
            registry.add_callback(
                AgentInitializedEvent,
                lambda _: callback_names.append("agent_initialized"),
            )
            registry.add_callback(
                BeforeInvocationEvent,
                lambda _: callback_names.append("before_invocation"),
            )
            registry.add_callback(
                AfterInvocationEvent,
                lambda _: callback_names.append("after_invocation"),
            )
            registry.add_callback(
                BeforeModelCallEvent,
                lambda _: callback_names.append("before_model_call"),
            )
            registry.add_callback(
                AfterModelCallEvent, lambda _: callback_names.append("after_model_call")
            )
            registry.add_callback(
                MessageAddedEvent, lambda _: callback_names.append("message_added")
            )

    return LifecycleBridgeHook()


@pytest.fixture
def agent(hook_provider):
    return Agent(hooks=[hook_provider])


def test_lifecycle_bridge_delivers_events(agent, callback_names):
    agent("Say hello in one word")

    assert "agent_initialized" in callback_names
    assert "before_invocation" in callback_names
    assert "before_model_call" in callback_names
    assert "after_model_call" in callback_names
    assert "after_invocation" in callback_names
    assert callback_names.count("message_added") >= 2
