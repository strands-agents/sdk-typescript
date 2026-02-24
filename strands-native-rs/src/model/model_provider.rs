use std::pin::Pin;

use futures::Stream;

use crate::{
    message::{ContentBlock, Message, Role, StopReason, SystemPrompt},
    tool::ToolSpec,
};

/// Events emitted by a model during streaming response generation.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum StreamEvent {
    /// Response generation has started.
    MessageStart { role: Role },
    /// A text content block has started.
    TextStart { index: usize },
    /// Incremental text content.
    TextDelta { index: usize, delta: String },
    /// A tool use content block has started.
    ToolUseStart {
        index: usize,
        id: String,
        name: String,
    },
    /// Incremental tool input JSON.
    ToolInputDelta { index: usize, delta: String },
    /// A reasoning content block has started.
    ReasoningStart { index: usize },
    /// Incremental reasoning content.
    ReasoningDelta {
        index: usize,
        text: Option<String>,
        signature: Option<String>,
        redacted: Option<Vec<u8>>,
    },
    /// A content block has completed.
    ContentBlockComplete { index: usize, block: ContentBlock },
    /// Response generation has finished.
    MessageComplete {
        message: Message,
        stop_reason: StopReason,
    },
}

/// Error type for model operations.
pub type ModelProviderError = Box<dyn std::error::Error + Send + Sync>;

/// A stream of events from a model provider.
pub type ModelProviderStream =
    Pin<Box<dyn Stream<Item = Result<StreamEvent, ModelProviderError>> + Send>>;

#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum ToolPolicy {
    /// Let the model decide which tools to use.
    #[default]
    Auto,
    /// Do not allow tool use.
    None,
    /// Require tool use.
    Required,
    /// Use a specific tool.
    Specific { name: String },
}

/// Configuration for a streaming request.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub struct StreamArgs {
    pub system_prompt: Option<SystemPrompt>,
    pub tool_policy: Option<ToolPolicy>,
    pub tool_specs: Option<Vec<ToolSpec>>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub stop_sequences: Option<Vec<String>>,
}

pub trait ModelProvider: Send + Sync {
    fn stream(&self, messages: &[Message], args: &StreamArgs) -> ModelProviderStream;
}
