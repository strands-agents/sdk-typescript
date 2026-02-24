use rmcp::ServiceExt;
use rmcp::service::RunningService;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::{RoleClient, transport::TokioChildProcess};
use tokio::process::Command;

use crate::error::Result;
use crate::tool::{Property, ToolSpec};

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error(transparent)]
    InitializeError(Box<rmcp::service::ClientInitializeError>),
    #[error(transparent)]
    ServiceError(Box<rmcp::service::ServiceError>),
}

impl From<rmcp::service::ClientInitializeError> for McpError {
    fn from(err: rmcp::service::ClientInitializeError) -> Self {
        Self::InitializeError(Box::new(err))
    }
}

impl From<rmcp::service::ServiceError> for McpError {
    fn from(err: rmcp::service::ServiceError) -> Self {
        Self::ServiceError(Box::new(err))
    }
}

pub enum TransportArgs {
    Stdio {
        command: String,
        args: Vec<String>,
    },
    StreamableHttp {
        url: String,
        api_key: Option<String>,
    },
}

pub struct McpClientArgs {
    pub name: String,
    pub version: String,
    pub transport: TransportArgs,
}

pub struct McpClient {
    name: String,
    version: String,
    service: RunningService<RoleClient, ()>,
    tool_specs: Vec<ToolSpec>,
}

impl McpClient {
    pub async fn new(args: McpClientArgs) -> Result<Self> {
        let service = match args.transport {
            TransportArgs::Stdio { command, args } => {
                let mut command = Command::new(command);
                command.args(args);
                ().serve(TokioChildProcess::new(command)?)
                    .await
                    .map_err(McpError::from)?
            }
            TransportArgs::StreamableHttp { url, api_key } => {
                let mut config = StreamableHttpClientTransportConfig::with_uri(url);

                if let Some(key) = api_key {
                    config = config.auth_header(key);
                }

                ().serve(StreamableHttpClientTransport::from_config(config))
                    .await
                    .map_err(McpError::from)?
            }
        };

        let tools = service.list_all_tools().await.map_err(McpError::from)?;
        let tool_specs = tools.into_iter().map(ToolSpec::from).collect::<Vec<_>>();

        Ok(Self {
            name: args.name,
            version: args.version,
            service,
            tool_specs,
        })
    }

    pub fn tool_specs(&self) -> &[ToolSpec] {
        &self.tool_specs
    }
}

impl std::fmt::Debug for McpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpClient")
            .field("name", &self.name)
            .field("version", &self.version)
            .field("service", &"<DynService>")
            .finish()
    }
}

impl From<rmcp::model::Tool> for ToolSpec {
    fn from(tool: rmcp::model::Tool) -> Self {
        let mut properties = vec![];

        let schema = &*tool.input_schema;

        let required_fields: Vec<String> = schema
            .get("required")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
            for (key, prop_value) in props.iter() {
                let description = prop_value
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let property_type = prop_value
                    .get("type")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let required = required_fields.contains(key);

                properties.push(Property {
                    key: key.clone(),
                    description,
                    property_type,
                    required,
                });
            }
        }

        ToolSpec {
            name: tool.name.into_owned(),
            display_name: tool.title,
            description: tool.description.map(|d| d.into_owned()),
            input_schema: if properties.is_empty() {
                None
            } else {
                Some(properties)
            },
        }
    }
}
