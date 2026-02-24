use futures::StreamExt;
use strands::{
    agent::{Agent, AgentArgs},
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

    let mut my_agent = Agent::new(
        anthropic,
        AgentArgs {
            system_prompt: Some(SystemPrompt::new("Your name is Strands. Greet the user.")),
            messages: vec![Message::new_user("Hello Strands!")],
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
