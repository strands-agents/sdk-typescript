"""Unit tests for hook-provider no-op stubs in _wasm_host.py."""

from strands._wasm_host import (
    _cancel_decision,
    _hook_get_capabilities,
    _hook_before_invocation,
    _hook_after_invocation,
    _hook_before_model_call,
    _hook_after_model_call,
    _hook_before_tools,
    _hook_after_tools,
    _hook_before_tool_call,
    _hook_after_tool_call,
    _HOOK_PROVIDER_FUNCS,
)


class TestCancelDecision:
    def test_produces_correct_record_shape(self):
        result = _cancel_decision()
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None


class TestHookBeforeToolCall:
    def test_returns_all_four_decision_fields(self):
        result = _hook_before_tool_call(None, "{}")
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None
        assert getattr(result, "tool-use") is None
        assert getattr(result, "selected-tool-name") is None


class TestHookAfterToolCall:
    def test_returns_retry_and_result_fields(self):
        result = _hook_after_tool_call(None, "{}", "{}", None)
        assert result.retry is False
        assert result.result is None


class TestHookAfterModelCall:
    def test_accepts_all_none_params(self):
        result = _hook_after_model_call(None, None, None, None)
        assert result.retry is False

    def test_accepts_string_params(self):
        result = _hook_after_model_call(
            None, "endTurn", '{"reason":"end-turn"}', "something failed"
        )
        assert result.retry is False


class TestHookProviderFuncsList:
    def test_completeness(self):
        assert len(_HOOK_PROVIDER_FUNCS) == 9

    def test_names(self):
        names = [name for name, _ in _HOOK_PROVIDER_FUNCS]
        assert names == [
            "get-capabilities",
            "before-invocation",
            "after-invocation",
            "before-model-call",
            "after-model-call",
            "before-tools",
            "after-tools",
            "before-tool-call",
            "after-tool-call",
        ]


class TestHookGetCapabilities:
    def test_returns_empty_list(self):
        result = _hook_get_capabilities(None)
        assert result == []


class TestHookBeforeInvocation:
    def test_returns_cancel_decision(self):
        result = _hook_before_invocation(None)
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None


class TestHookAfterInvocation:
    def test_returns_resume_none(self):
        result = _hook_after_invocation(None)
        assert result.resume is None


class TestHookBeforeModelCall:
    def test_returns_cancel_decision_with_none(self):
        result = _hook_before_model_call(None, None)
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None

    def test_returns_cancel_decision_with_int(self):
        result = _hook_before_model_call(None, 42)
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None


class TestHookBeforeTools:
    def test_returns_cancel_decision(self):
        result = _hook_before_tools(None, '{"role":"assistant","content":[]}')
        assert result.cancel is False
        assert getattr(result, "cancel-message") is None


class TestHookAfterTools:
    def test_returns_empty_record(self):
        result = _hook_after_tools(None)
        assert result.__dict__ == {}
