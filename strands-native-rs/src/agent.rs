use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use futures::StreamExt;

use crate::{
    mcp_client::McpClient,
    message::{
        ContentBlock, Message, StopReason, SystemPrompt, TextBlock, ToolResultBlock,
        ToolResultContent,
    },
    model::model_provider::{ModelProvider, ModelProviderStream, StreamArgs, StreamEvent},
    state_provider::StateProvider,
    tool::Tool,
};

pub struct AgentArgs<E> {
    pub system_prompt: Option<SystemPrompt>,
    pub state_provider: Option<Box<dyn StateProvider>>,
    pub mcp_clients: Vec<McpClient>,
    pub messages: Vec<Message>,
    pub tools: Vec<Box<dyn Tool<E>>>,
}

impl<E> std::fmt::Debug for AgentArgs<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentArgs")
            .field("system_prompt", &self.system_prompt)
            .field("state_provider", &"StateProvider")
            .field("mcp_clients", &self.mcp_clients)
            .field("messages", &self.messages)
            .field("tools", &"Tools")
            .finish()
    }
}

impl Default for AgentArgs<()> {
    fn default() -> Self {
        Self {
            system_prompt: None,
            state_provider: None,
            mcp_clients: Vec::new(),
            messages: Vec::new(),
            tools: Vec::new(),
        }
    }
}

pub struct Agent<E> {
    model_provider: Arc<dyn ModelProvider>,
    system_prompt: SystemPrompt,
    state_provider: Box<dyn StateProvider>,
    mcp_clients: Arc<Vec<McpClient>>,
    messages: Arc<Mutex<Vec<Message>>>,
    tools: Vec<Box<dyn Tool<E>>>,
}

impl<E> Agent<E> {
    pub fn new(model_provider: impl ModelProvider + 'static, args: AgentArgs<E>) -> Self {
        Self {
            model_provider: Arc::new(model_provider),
            system_prompt: args
                .system_prompt
                .unwrap_or(SystemPrompt::Text(String::new())),
            state_provider: args
                .state_provider
                .unwrap_or_else(|| Box::new(HashMap::<String, serde_json::Value>::new())),
            mcp_clients: Arc::new(args.mcp_clients),
            messages: Arc::new(Mutex::new(args.messages)),
            tools: Vec::new(),
        }
    }

    pub fn turn(&mut self) -> ModelProviderStream {
        let mut tool_specs = Vec::with_capacity(self.tools.len());
        for tool in &self.tools {
            tool_specs.push(tool.spec());
        }

        for client in self.mcp_clients.iter() {
            tool_specs.extend_from_slice(client.tool_specs());
        }

        let args = StreamArgs {
            system_prompt: Some(self.system_prompt.clone()),
            tool_specs: (!tool_specs.is_empty()).then_some(tool_specs),
            max_tokens: Some(4096),
            ..Default::default()
        };

        let messages = Arc::clone(&self.messages);
        let model_provider = Arc::clone(&self.model_provider);
        let mcp_clients = Arc::clone(&self.mcp_clients);

        Box::pin(async_stream::try_stream! {
            loop {
                let current_messages = messages.lock().unwrap().clone();
                let mut stream = model_provider.stream(&current_messages, &args);
                let mut assistant_message: Option<Message> = None;

                while let Some(result) = stream.next().await {
                    let event = result?;

                    yield event.clone();

                    if let StreamEvent::MessageComplete { message, stop_reason } = event {
                        assistant_message = Some(message.clone());

                        match stop_reason {
                            StopReason::ToolUse => break,
                            _ => {
                                messages.lock().unwrap().push(message);
                                return
                            }
                        }
                    }
                }

                let Some(message) = assistant_message else {
                    // TODO: remove.
                    panic!("Stream ended without MessageComplete event");
                };

                messages.lock().unwrap().push(message.clone());

                let tool_results = execute_tools(&message, &mcp_clients).await?;
                if tool_results.is_empty() {
                    return;
                }

                messages.lock().unwrap().push(Message {
                    role: crate::message::Role::User,
                    content: tool_results,
                });
            }
        })
    }

    pub fn messages(&self) -> Vec<Message> {
        self.messages.lock().unwrap().clone()
    }
}

async fn execute_tools(
    message: &Message,
    _mcp_clients: &[McpClient],
) -> Result<Vec<ContentBlock>, Box<dyn std::error::Error + Send + Sync>> {
    let mut results = Vec::new();

    for block in &message.content {
        if let ContentBlock::ToolUse(tool_use) = block {
            // TODO: Actually execute the tool via MCP
            results.push(ContentBlock::ToolResult(ToolResultBlock {
                id: tool_use.id.clone(),
                content: Ok(vec![ToolResultContent::Text(TextBlock(format!(
                    "Tool {} executed with input: {}",
                    tool_use.name, tool_use.input
                )))]),
            }));
        }
    }

    Ok(results)
}
