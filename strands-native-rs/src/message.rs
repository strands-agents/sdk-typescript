use std::fmt::Display;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive] // Play it safe unless someone complains.
pub enum Role {
    User,
    Assistant,
}

impl Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::User => write!(f, "user"),
            Role::Assistant => write!(f, "assistant"),
        }
    }
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct TextBlock(pub String);

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct JsonBlock(pub serde_json::Value);

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ToolUseBlock {
    /// Unique identifier for this tool use instance.
    pub id: String,
    /// The name of the tool to execute.
    pub name: String,
    /// The input parameters for the tool.
    pub input: serde_json::Value,
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum ToolResultContent {
    Text(TextBlock),
    Json(JsonBlock),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ToolResultBlock {
    /// The id of the tool use this result corresponds to.
    pub id: String,
    /// The content returned by the tool.
    pub content: Result<Vec<ToolResultContent>, Vec<ToolResultContent>>,
}

pub type ToolResult = Result<Vec<ToolResultContent>, Vec<ToolResultContent>>;

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ReasoningBlock {
    /// The text content of the reasoning process.
    pub text: String,
    /// A cryptographic signature for verification purposes.
    pub signature: String,
    /// The redacted content of the reasoning process.
    pub redacted: Vec<u8>,
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum CachePointBlock {
    Default,
}

/// Image format for image content blocks.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
}

/// Source of image data.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum ImageSource {
    Bytes(Vec<u8>),
    Url(String),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ImageBlock {
    /// The format of the image.
    pub format: ImageFormat,
    /// The source of the image data.
    pub source: ImageSource,
}

/// Video format for video content blocks.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum VideoFormat {
    Mkv,
    Mov,
    Mp4,
    Webm,
    Flv,
    Mpeg,
    Wmv,
    Tgp, // 3gp
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum VideoSource {
    Bytes(Vec<u8>),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct VideoBlock {
    /// The format of the video.
    pub format: VideoFormat,
    /// The source of the video data.
    pub source: VideoSource,
}

/// Document format for document content blocks.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum DocumentFormat {
    Pdf,
    Csv,
    Doc,
    Docx,
    Xls,
    Xlsx,
    Html,
    Txt,
    Md,
    Json,
    Xml,
}

/// Source of document data.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum DocumentSource {
    Bytes(Vec<u8>),
    Text(String),
    Structured(Vec<TextBlock>), // TODO: This looks like poor data modeling.
    Url(String),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct DocumentBlock {
    /// The name of the document.
    pub name: String,
    /// The format of the document.
    pub format: DocumentFormat,
    /// The source of the document data.
    pub source: DocumentSource,
    /// Whether to include citations when using the document.
    ///
    /// Subject to change.
    pub citations: bool,
    /// Context information for the document.
    pub context: Option<String>,
}

/// Qualifier for guard content blocks.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum GuardQualifier {
    GroundingSource,
    Query,
    GuardContent,
}

/// Text content evaluated by guardrails.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct GuardText {
    /// Qualifiers that specify how this content is evaluated.
    pub qualifiers: Vec<GuardQualifier>,
    /// The text content evaluated.
    pub text: String,
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum GuardImageFormat {
    Png,
    Jpeg,
}

/// Image content evaluated by guardrails.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct GuardImage {
    /// The format of the image.
    pub format: GuardImageFormat,
    /// The image source.
    pub source: Vec<u8>,
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum GuardBlock {
    Text(GuardText),
    Image(GuardImage),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum ContentBlock {
    Text(TextBlock),
    ToolUse(ToolUseBlock),
    ToolResult(ToolResultBlock),
    Reasoning(ReasoningBlock),
    CachePoint(CachePointBlock),
    Image(ImageBlock),
    Video(VideoBlock),
    Document(DocumentBlock),
    Guard(GuardBlock),
}

/// Reason for stopping generation.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum StopReason {
    /// Content was filtered by safety mechanisms.
    ContentFiltered,
    /// The model ended its turn.
    EndTurn,
    /// A guardrail policy stopped generation.
    GuardrailIntervened,
    /// The maximum token limit was reached.
    MaxTokens,
    /// A custom stop sequence was encountered.
    StopSequence,
    /// A tool was requested by the model.
    ToolUse,
    /// The number of tokens exceeded the context window.
    ContextWindowExceeded,
}

/// Content block for system prompts.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum SystemPromptBlock {
    Text(TextBlock),
    CachePoint(CachePointBlock),
    Guard(GuardBlock),
}

/// The system prompt supplied to the model provider.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[non_exhaustive]
pub enum SystemPrompt {
    Text(String),
    Structured(Vec<SystemPromptBlock>),
}

impl SystemPrompt {
    pub fn new(text: impl Into<String>) -> Self {
        SystemPrompt::Text(text.into())
    }
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct Message {
    /// The role of the message sender.
    pub role: Role,
    /// The message content as a sequence of content blocks.
    pub content: Vec<ContentBlock>,
}

impl Message {
    pub fn new_user(text: impl Into<String>) -> Self {
        Message {
            role: Role::User,
            content: vec![ContentBlock::Text(TextBlock(text.into()))],
        }
    }
}
