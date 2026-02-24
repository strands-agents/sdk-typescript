use crate::{
    message::{
        ContentBlock, Message, Role, StopReason, SystemPrompt, SystemPromptBlock, TextBlock,
        ToolResultContent, ToolUseBlock,
    },
    model::model_provider::{
        ModelProvider, ModelProviderStream, StreamArgs, StreamEvent, ToolPolicy,
    },
    tool::ToolSpec,
};

pub use anthropik::ApiVersion;
pub use anthropik::Model;

use anthropik::{
    AnthropicClient, Content as AnthropicContent, ContentBlock as AnthropicContentBlock,
    ContentBlockDelta, InputMessage as AnthropicInputMessage, InputSchema, MessagesRequest,
    MessagesRequestBody, MessagesResponseEvent, Role as AnthropicRole,
    StopReason as AnthropicStopReason, Tool as AnthropicTool, ToolChoice as AnthropicToolChoice,
    ToolResultContentBlock as AnthropicToolResultContentBlock,
};

#[derive(Debug)]
pub struct AnthropicModelProvider {
    api_version: ApiVersion,
    api_key: String,
    model: Model,
    client: AnthropicClient,
}

impl AnthropicModelProvider {
    pub fn new(api_key: String, api_version: ApiVersion, model: Model) -> Self {
        let client = AnthropicClient::default();

        Self {
            api_version,
            api_key,
            model,
            client,
        }
    }

    fn build_request(&self, messages: &[Message], args: &StreamArgs) -> MessagesRequest<'static> {
        MessagesRequest {
            anthropic_beta: None,
            anthropic_version: self.api_version,
            x_api_key: self.api_key.clone().into(),
            body: MessagesRequestBody {
                model: self.model,
                messages: messages.iter().map(|m| m.into()).collect(),
                max_tokens: args.max_tokens.unwrap_or(4096),
                stream: true,
                system: args.system_prompt.as_ref().map(|s| String::from(s).into()),
                temperature: args.temperature,
                top_p: args.top_p,
                stop_sequences: args
                    .stop_sequences
                    .as_ref()
                    .map(|s| s.iter().map(|seq| String::from(seq).into()).collect()),
                tool_choice: args.tool_policy.as_ref().map(|p| p.into()),
                tools: args
                    .tool_specs
                    .as_ref()
                    .map(|specs| specs.iter().map(|s| s.into()).collect()),
                ..Default::default()
            },
            ..Default::default()
        }
    }
}

impl ModelProvider for AnthropicModelProvider {
    fn stream(&self, messages: &[Message], args: &StreamArgs) -> ModelProviderStream {
        let request = self.build_request(messages, args);
        let client = self.client.clone();

        Box::pin(async_stream::try_stream! {
            let mut stream = client.messages_stream(&request).await?;

            let mut current_role = Role::Assistant;
            let mut content_blocks: Vec<ContentBlock> = vec![];
            let mut current_block_text = String::new();
            let mut current_tool_id = String::new();
            let mut current_tool_name = String::new();
            let mut current_tool_input = String::new();
            let mut stop_reason = StopReason::EndTurn;

            while let Some(event) = stream.recv().await? {
                match event {
                    MessagesResponseEvent::Ping => {},
                    MessagesResponseEvent::MessageStart { message } => {
                        current_role = message.role.into();
                        yield StreamEvent::MessageStart { role: current_role.clone() };
                    },
                    MessagesResponseEvent::ContentBlockStart { index, content_block } => {
                        match content_block {
                            AnthropicContentBlock::Text { .. } => {
                                current_block_text.clear();
                                yield StreamEvent::TextStart { index };
                            }
                            AnthropicContentBlock::ToolUse { id, name, .. } => {
                                current_tool_id = id.clone();
                                current_tool_name = name.clone();
                                current_tool_input.clear();
                                yield StreamEvent::ToolUseStart { index, id, name };
                            }
                            _ => {}
                        }
                    },
                    MessagesResponseEvent::ContentBlockDelta { index, delta } => {
                        match delta {
                            ContentBlockDelta::TextDelta { text } => {
                                current_block_text.push_str(&text);
                                yield StreamEvent::TextDelta { index, delta: text };
                            }
                            ContentBlockDelta::InputJsonDelta { partial_json } => {
                                current_tool_input.push_str(&partial_json);
                                yield StreamEvent::ToolInputDelta { index, delta: partial_json };
                            }
                        }
                    },
                    MessagesResponseEvent::ContentBlockStop { index } => {
                        let block = if !current_tool_id.is_empty() {
                            let input: serde_json::Value = serde_json::from_str(&current_tool_input)
                                .unwrap_or(serde_json::Value::Null);
                            let block = ContentBlock::ToolUse(ToolUseBlock {
                                id: std::mem::take(&mut current_tool_id),
                                name: std::mem::take(&mut current_tool_name),
                                input,
                            });
                            current_tool_input.clear();
                            block
                        } else {
                            ContentBlock::Text(TextBlock(std::mem::take(&mut current_block_text)))
                        };

                        content_blocks.push(block.clone());

                        yield StreamEvent::ContentBlockComplete { index, block };
                    },
                    MessagesResponseEvent::MessageDelta { delta } => {
                        if let Some(reason) = delta.stop_reason {
                            stop_reason = reason.into();
                        }
                    },
                    MessagesResponseEvent::MessageStop => {
                        let message = Message {
                            role: current_role.clone(),
                            content: std::mem::take(&mut content_blocks),
                        };

                        yield StreamEvent::MessageComplete { message, stop_reason: stop_reason.clone() };
                    }
                }
            }
        })
    }
}

impl From<AnthropicRole> for Role {
    fn from(role: AnthropicRole) -> Self {
        match role {
            AnthropicRole::User => Role::User,
            AnthropicRole::Assistant => Role::Assistant,
        }
    }
}

impl From<&Role> for AnthropicRole {
    fn from(role: &Role) -> Self {
        match role {
            Role::User => AnthropicRole::User,
            Role::Assistant => AnthropicRole::Assistant,
        }
    }
}

impl From<AnthropicStopReason> for StopReason {
    fn from(reason: AnthropicStopReason) -> Self {
        match reason {
            AnthropicStopReason::EndTurn => StopReason::EndTurn,
            AnthropicStopReason::MaxTokens => StopReason::MaxTokens,
            AnthropicStopReason::StopSequence => StopReason::StopSequence,
            AnthropicStopReason::ToolUse => StopReason::ToolUse,
            AnthropicStopReason::PauseTurn => StopReason::EndTurn,
            AnthropicStopReason::Refusal => StopReason::ContentFiltered,
        }
    }
}

impl From<&ToolPolicy> for AnthropicToolChoice {
    fn from(policy: &ToolPolicy) -> Self {
        match policy {
            ToolPolicy::Auto => AnthropicToolChoice::Auto {
                disable_parallel_tool_use: false,
            },
            ToolPolicy::None => AnthropicToolChoice::Auto {
                disable_parallel_tool_use: false,
            },
            ToolPolicy::Required => AnthropicToolChoice::Any {
                disable_parallel_tool_use: false,
            },
            ToolPolicy::Specific { name } => AnthropicToolChoice::Tool {
                tool_name: name.clone(),
                disable_parallel_tool_use: false,
            },
        }
    }
}

impl From<&ToolSpec> for AnthropicTool<'static> {
    fn from(spec: &ToolSpec) -> Self {
        let input_schema = if let Some(properties) = &spec.input_schema {
            let mut props = serde_json::Map::new();
            let mut required = Vec::new();

            for prop in properties {
                let mut prop_schema = serde_json::Map::new();

                if let Some(prop_type) = &prop.property_type {
                    prop_schema.insert("type".to_string(), serde_json::json!(prop_type));
                }

                if let Some(desc) = &prop.description {
                    prop_schema.insert("description".to_string(), serde_json::json!(desc));
                }

                props.insert(prop.key.clone(), serde_json::Value::Object(prop_schema));

                if prop.required {
                    required.push(prop.key.clone());
                }
            }

            InputSchema {
                properties: Some(serde_json::Value::Object(props)),
                required: (!required.is_empty()).then_some(required),
                ..Default::default()
            }
        } else {
            InputSchema::default()
        };

        AnthropicTool {
            name: spec.name.clone().into(),
            description: spec.description.clone().map(|d| d.into()),
            input_schema,
            cache_control: None,
            _ne: (),
        }
    }
}

impl From<&ContentBlock> for Option<AnthropicContentBlock> {
    fn from(block: &ContentBlock) -> Self {
        match block {
            ContentBlock::Text(TextBlock(text)) => Some(AnthropicContentBlock::Text {
                text: text.clone(),
                cache_control: None,
                citations: None,
            }),
            ContentBlock::ToolUse(tool) => Some(AnthropicContentBlock::ToolUse {
                id: tool.id.clone(),
                name: tool.name.clone(),
                input: tool.input.clone(),
                cache_control: None,
            }),
            ContentBlock::ToolResult(result) => {
                let items = result.content.as_ref().unwrap_or_else(|e| e);

                let anthropic_content: Vec<AnthropicToolResultContentBlock> =
                    items.iter().map(|item| item.into()).collect();

                Some(AnthropicContentBlock::ToolResult {
                    tool_use_id: result.id.clone(),
                    content: Some(anthropic_content),
                    is_error: Some(result.content.is_err()),
                    cache_control: None,
                })
            }
            _ => None,
        }
    }
}

impl From<&ToolResultContent> for AnthropicToolResultContentBlock {
    fn from(item: &ToolResultContent) -> Self {
        match item {
            ToolResultContent::Text(TextBlock(text)) => {
                AnthropicToolResultContentBlock::Text { text: text.clone() }
            }
            ToolResultContent::Json(json) => AnthropicToolResultContentBlock::Text {
                text: json.0.to_string(),
            },
        }
    }
}

impl From<&Message> for AnthropicInputMessage {
    fn from(message: &Message) -> Self {
        AnthropicInputMessage {
            role: (&message.role).into(),
            content: AnthropicContent::Blocks(
                message.content.iter().filter_map(|b| b.into()).collect(),
            ),
            ..Default::default()
        }
    }
}

impl From<&SystemPrompt> for String {
    fn from(prompt: &SystemPrompt) -> Self {
        match prompt {
            SystemPrompt::Text(text) => text.clone(),
            SystemPrompt::Structured(blocks) => blocks
                .iter()
                .filter_map(|b| match b {
                    SystemPromptBlock::Text(TextBlock(text)) => Some(text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}
