//! Multi-stream test — calls generate() twice on the same agent to reproduce
//! WASM traps from use-after-free in componentize-js's cabi_realloc.
//!
//! Usage:
//!   RUST_LOG=debug cargo run --example multi_stream

use anyhow::Result;
use strands::{Agent, StreamEvent};
use tokio_stream::StreamExt;

async fn consume_stream(agent: &mut Agent, input: &str) -> Result<String> {
    let stream = agent.stream(input).await?;
    tokio::pin!(stream);

    let mut text = String::new();
    while let Some(result) = stream.next().await {
        match result? {
            StreamEvent::TextDelta(t) => text.push_str(&t),
            StreamEvent::Stop(data) => {
                eprintln!("[stop: {:?}]", data.reason);
            }
            StreamEvent::Error(err) => eprintln!("[error: {err}]"),
            _ => {}
        }
    }
    Ok(text)
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let mut agent = Agent::builder()
        .use_jit()
        .system_prompt("Be concise. Answer in one sentence.")
        .tool(
            "echo",
            "Echo the input back",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" }
                },
                "required": ["text"]
            }),
            |input: &str| -> Result<String, String> {
                Ok(input.to_string())
            },
        )
        .build()
        .await?;

    eprintln!("--- Stream 1 ---");
    let text1 = consume_stream(&mut agent, "Use the echo tool with text 'hello'").await?;
    eprintln!("Response 1: {text1}");

    eprintln!("--- Stream 2 ---");
    let text2 = consume_stream(&mut agent, "Use the echo tool with text 'world'").await?;
    eprintln!("Response 2: {text2}");

    eprintln!("--- Stream 3 ---");
    let text3 = consume_stream(&mut agent, "What did you echo before?").await?;
    eprintln!("Response 3: {text3}");

    Ok(())
}
