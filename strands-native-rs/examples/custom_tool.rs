use futures::StreamExt;
use strands::{
    agent::{Agent, AgentArgs},
    message::{Message, SystemPrompt, TextBlock, ToolResult, ToolResultContent},
    model::anthropic::{AnthropicModelProvider, ApiVersion, Model},
    tool::{Tool, ToolContext, ToolSpec},
};

struct WeatherTool;

#[async_trait::async_trait]
impl Tool<()> for WeatherTool {
    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "weather_tool".to_string(),
            description: Some("Provides weather when invoked without args.".to_string()),
            ..Default::default()
        }
    }

    async fn invoke(
        &self,
        _input: &serde_json::Map<String, serde_json::Value>,
        _context: &ToolContext,
    ) -> Result<ToolResult, ()> {
        Ok(Ok(vec![ToolResultContent::Text(TextBlock(
            "The weather is sunny with a high of 75°F.".to_string(),
        ))]))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let anthropic = AnthropicModelProvider::new(
        std::env::var("ANTHROPIC_API_KEY").expect("ANTHROPIC_API_KEY must be set"),
        ApiVersion::Latest,
        Model::ClaudeSonnet4_5,
    );

    let mut my_agent = Agent::new(
        anthropic,
        AgentArgs {
            system_prompt: Some(SystemPrompt::new("You must call the weather_tool.")),
            messages: vec![Message::new_user("What is the weather in Dallas?")],
            tools: vec![WeatherTool.boxed()],
            ..Default::default()
        },
    );

    let mut stream = my_agent.turn();

    while let Some(event) = stream
        .next()
        .await
        .transpose()
        .map_err(anyhow::Error::msg)?
    {
        tracing::info!(event = ?event);
    }

    Ok(())
}
