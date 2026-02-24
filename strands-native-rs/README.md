# Strands

An unofficial Rust implementation of an agentic SDK for building AI agents with Claude and MCP (Model Context Protocol) support.

## Features

- **Simple Agent API** - Create conversational AI agents with minimal boilerplate
- **Streaming Support** - Built on async streams for real-time response handling
- **MCP Integration** - Native support for Model Context Protocol clients and tools
- **Anthropic Claude** - First-class support for Claude models via the Anthropic API
- **Flexible Architecture** - Extensible model provider system

## Installation

Add Strands to your project using cargo:

```bash
cargo add strands
```

Or add it to your `Cargo.toml`:

```toml
[dependencies]
strands = "0.2.1"
```

### Optional Features

- `serde` - Enable serde serialization support

```bash
cargo add strands --features serde
```

## Quick Start

```rust
use anthropoki::{ApiVersion, Model};
use futures::StreamExt;
use strands::{
    agent::{Agent, AgentArgs},
    message::{Message, SystemPrompt},
    model::anthropic::AnthropicModelProvider,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let anthropic = AnthropicModelProvider::new(
        std::env::var("ANTHROPIC_API_KEY")?,
        ApiVersion::Latest,
        Model::ClaudeSonnet4_5,
    );

    let mut agent = Agent::new(
        anthropic,
        AgentArgs {
            system_prompt: Some(SystemPrompt::new("You are a helpful assistant.")),
            messages: vec![Message::new_user("Hello!")],
            ..Default::default()
        },
    );

    let mut stream = agent.turn();
    while let Some(event) = stream.next().await.transpose()? {
        println!("{:?}", event);
    }

    Ok(())
}
```

For more examples, including MCP tool integration, see the [examples](examples/) folder.

## Requirements

- Rust 2024 edition
- Tokio async runtime
- Anthropic API key (set as `ANTHROPIC_API_KEY` environment variable)

## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.
