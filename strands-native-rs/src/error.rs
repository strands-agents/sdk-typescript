use crate::mcp_client::McpError;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Tool execution error: {0}")]
    ToolExecution(String),
    #[error("MCP error: {0}")]
    McpError(#[from] McpError),
}
