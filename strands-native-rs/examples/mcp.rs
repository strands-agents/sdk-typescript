use futures::StreamExt;
use strands::{
    agent::{Agent, AgentArgs},
    mcp_client::{McpClient, McpClientArgs, TransportArgs},
    message::{Message, SystemPrompt},
    model::anthropic::{AnthropicModelProvider, ApiVersion, Model},
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let anthropic = AnthropicModelProvider::new(
        std::env::var("ANTHROPIC_API_KEY").expect("ANTHROPIC_API_KEY must be set"),
        ApiVersion::Latest,
        Model::ClaudeSonnet4_5,
    );

    let devtools_client = McpClient::new(McpClientArgs {
        name: "strands-example".to_string(),
        version: std::env!("CARGO_PKG_VERSION").to_string(),
        transport: TransportArgs::Stdio {
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "chrome-devtools-mcp@latest".to_string()],
        },
    })
    .await?;

    if let Some(tool) = devtools_client.tool_specs().iter().next() {
        tracing::info!("First tool spec: {:#?}", tool);
    }

    let mut my_agent = Agent::new(
        anthropic,
        AgentArgs {
            system_prompt: Some(SystemPrompt::new(
                "You are an example agent that uses the Chrome DevTools MCP to demonstrate MCP capabilities. Perform one readonly action and end your turn.",
            )),
            mcp_clients: vec![devtools_client],
            messages: vec![Message::new_user("Hello Strands! What can you do?")],
            ..Default::default()
        },
    );

    let mut stream = my_agent.turn();

    while let Some(event) = stream.next().await.transpose().unwrap() {
        tracing::info!(event = ?event);
    }

    Ok(())
}
