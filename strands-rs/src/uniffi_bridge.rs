//! UniFFI bridge — exposes the Agent to Kotlin/Swift via proc-macro exports.
//! Async streaming methods map to `suspend fun` in Kotlin.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{ResourceAny, StreamEvent_, ToolSpec};

/// Relays closures from wasmtime's async fiber to a dedicated OS thread
/// where JNA can attach to the JVM. One thread per Agent lifetime.
struct JvmCallbackRelay {
    tx: std::sync::mpsc::Sender<Box<dyn FnOnce() + Send>>,
}

impl JvmCallbackRelay {
    fn new() -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<Box<dyn FnOnce() + Send>>();
        std::thread::Builder::new()
            .name("strands-jvm-relay".into())
            .spawn(move || {
                while let Ok(f) = rx.recv() {
                    f();
                }
            })
            .expect("failed to spawn JVM callback relay thread");
        Self { tx }
    }

    fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, String> {
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        self.tx
            .send(Box::new(move || {
                let _ = result_tx.send(f());
            }))
            .map_err(|_send_err| "callback relay thread gone".to_string())?;
        result_rx
            .recv()
            .map_err(|_recv_err| "callback relay response lost".to_string())
    }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum AgentError {
    #[error("{reason}")]
    Runtime {
        reason: String,
        detail: Option<String>,
    },
}

impl From<String> for AgentError {
    fn from(reason: String) -> Self {
        Self::Runtime {
            reason,
            detail: None,
        }
    }
}

impl From<anyhow::Error> for AgentError {
    fn from(e: anyhow::Error) -> Self {
        let full = e.to_string();
        let reason = e
            .chain()
            .last()
            .map_or_else(|| full.clone(), |c| c.to_string());
        let detail = if reason != full { Some(full) } else { None };
        Self::Runtime { reason, detail }
    }
}

#[uniffi::export(with_foreign)]
pub trait ToolDispatcher: Send + Sync {
    fn call_tool(
        &self,
        name: String,
        input: String,
        tool_use_id: String,
    ) -> Result<String, AgentError>;
}

#[uniffi::export(with_foreign)]
pub trait LogHandler: Send + Sync {
    fn log(&self, level: String, message: String, context: Option<String>);
}

#[derive(uniffi::Record, Clone)]
pub struct ModelConfigInput {
    pub provider: String,
    pub model_id: Option<String>,
    pub api_key: Option<String>,
    pub region: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub session_token: Option<String>,
    pub additional_config: Option<String>,
}

#[derive(uniffi::Record, Clone)]
pub struct ToolSpecConfig {
    pub name: String,
    pub description: String,
    pub input_schema: String,
}

#[derive(uniffi::Object)]
pub struct StreamHandle {
    handle: ResourceAny,
}

#[derive(uniffi::Object)]
pub struct Agent {
    inner: Arc<Mutex<crate::Agent>>,
}

#[uniffi::export]
impl Agent {
    /// Construction is synchronous (block_on) — the UniFFI async runtime
    /// (`async_compat`) provides the tokio context needed by wasmtime.
    #[uniffi::constructor]
    pub fn new(
        model: Option<ModelConfigInput>,
        system_prompt: Option<String>,
        system_prompt_blocks: Option<String>,
        tools: Option<Vec<ToolSpecConfig>>,
        tool_dispatcher: Option<Arc<dyn ToolDispatcher>>,
        log_handler: Option<Arc<dyn LogHandler>>,
        use_callback_relay: bool,
    ) -> Result<Arc<Self>, AgentError> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| AgentError::Runtime {
                reason: format!("failed to create tokio runtime: {e}"),
                detail: None,
            })?;

        let mut builder = crate::Agent::builder();

        if let Some(m) = model {
            builder = builder.model(build_model_config(&m)?);
        }

        if let Some(sp) = system_prompt {
            builder = builder.system_prompt(sp);
        }

        if let Some(blocks) = system_prompt_blocks {
            builder = builder.system_prompt_blocks(blocks);
        }

        if let Some(ref tool_specs) = tools {
            let specs: Vec<ToolSpec> = tool_specs
                .iter()
                .map(|t| ToolSpec {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    input_schema: t.input_schema.clone(),
                })
                .collect();
            builder = builder.tools(specs);
        }

        // JNA can't attach to wasmtime's async fiber stack, so Kotlin
        // callers need a dedicated relay thread for callbacks. Python
        // (ctypes) can call directly on the fiber — no relay needed.
        let relay = if use_callback_relay {
            Some(Arc::new(JvmCallbackRelay::new()))
        } else {
            None
        };

        if let Some(dispatcher) = tool_dispatcher {
            if let Some(ref r) = relay {
                let r = Arc::clone(r);
                builder = builder.tool_dispatch_fn(
                    move |name: &str, input: &str, tool_use_id: &str| -> Result<String, String> {
                        let d = Arc::clone(&dispatcher);
                        let n = name.to_string();
                        let i = input.to_string();
                        let t = tool_use_id.to_string();
                        r.call(move || d.call_tool(n, i, t).map_err(|e| e.to_string()))
                            .map_err(|e| format!("callback relay: {e}"))?
                    },
                );
            } else {
                builder = builder.tool_dispatch_fn(
                    move |name: &str, input: &str, tool_use_id: &str| -> Result<String, String> {
                        dispatcher
                            .call_tool(name.to_string(), input.to_string(), tool_use_id.to_string())
                            .map_err(|e| e.to_string())
                    },
                );
            }
        }

        if let Some(handler) = log_handler {
            if let Some(ref r) = relay {
                let r = Arc::clone(r);
                builder = builder.log_handler(
                    move |level: &str, message: &str, context: Option<&str>| {
                        let h = Arc::clone(&handler);
                        let l = level.to_string();
                        let m = message.to_string();
                        let c = context.map(|s| s.to_string());
                        let _ = r.call(move || {
                            h.log(l, m, c);
                            Ok::<_, String>(())
                        });
                    },
                );
            } else {
                builder = builder.log_handler(
                    move |level: &str, message: &str, context: Option<&str>| {
                        handler.log(
                            level.to_string(),
                            message.to_string(),
                            context.map(|s| s.to_string()),
                        );
                    },
                );
            }
        }

        let agent = rt.block_on(builder.build())?;

        Ok(Arc::new(Self {
            inner: Arc::new(Mutex::new(agent)),
        }))
    }

    pub fn get_messages(self: Arc<Self>) -> Result<String, AgentError> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let mut agent = self.inner.lock().await;
                agent.get_messages().await
            })
            .map_err(AgentError::from)
    }

    pub fn set_messages(self: Arc<Self>, json: String) -> Result<(), AgentError> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let mut agent = self.inner.lock().await;
                agent.set_messages(&json).await
            })
            .map_err(AgentError::from)
    }
}

/// Async methods run on the UniFFI/async_compat executor which is JVM-attached,
/// so tool dispatch callbacks can safely call back into Kotlin via JNA.
#[uniffi::export(async_runtime = "tokio")]
impl Agent {
    pub async fn start_stream(
        self: Arc<Self>,
        input: String,
    ) -> Result<Arc<StreamHandle>, AgentError> {
        let mut agent = self.inner.lock().await;
        let handle = agent.start_stream(&input).await?;
        Ok(Arc::new(StreamHandle { handle }))
    }

    pub async fn start_stream_with_options(
        self: Arc<Self>,
        input: String,
        tools: Option<Vec<ToolSpecConfig>>,
        tool_choice: Option<String>,
    ) -> Result<Arc<StreamHandle>, AgentError> {
        let wit_tools = tools.map(|ts| {
            ts.into_iter()
                .map(|t| ToolSpec {
                    name: t.name,
                    description: t.description,
                    input_schema: t.input_schema,
                })
                .collect()
        });

        let mut agent = self.inner.lock().await;
        let handle = agent
            .start_stream_with_options(&input, wit_tools, tool_choice)
            .await?;
        Ok(Arc::new(StreamHandle { handle }))
    }

    pub async fn next_events(
        self: Arc<Self>,
        stream: &StreamHandle,
    ) -> Result<Option<Vec<StreamEvent_>>, AgentError> {
        let mut agent = self.inner.lock().await;
        match agent.next_events(stream.handle).await {
            Ok(Some(events)) => Ok(Some(
                events.into_iter().map(StreamEvent_::from).collect(),
            )),
            Ok(None) => Ok(None),
            Err(e) => Err(AgentError::from(e)),
        }
    }

    pub async fn close_stream(
        self: Arc<Self>,
        stream: &StreamHandle,
    ) -> Result<(), AgentError> {
        let mut agent = self.inner.lock().await;
        match agent.drop_stream(stream.handle).await {
            Ok(()) => {
                tokio::task::yield_now().await;
                tokio::task::yield_now().await;
            }
            Err(e) => tracing::warn!("close_stream: resource_drop skipped: {e}"),
        }
        Ok(())
    }
}

fn build_model_config(input: &ModelConfigInput) -> Result<crate::ModelConfig, AgentError> {
    match input.provider.as_str() {
        "anthropic" => Ok(crate::ModelConfig::Anthropic(crate::AnthropicConfig {
            model_id: input.model_id.clone(),
            api_key: input.api_key.clone(),
            additional_config: input.additional_config.clone(),
        })),
        "bedrock" => Ok(crate::ModelConfig::Bedrock(crate::BedrockConfig {
            model_id: input.model_id.clone().unwrap_or_default(),
            region: input.region.clone(),
            access_key_id: input.access_key_id.clone(),
            secret_access_key: input.secret_access_key.clone(),
            session_token: input.session_token.clone(),
            additional_config: input.additional_config.clone(),
        })),
        "openai" => Ok(crate::ModelConfig::Openai(crate::OpenaiConfig {
            model_id: input.model_id.clone(),
            api_key: input.api_key.clone(),
            additional_config: input.additional_config.clone(),
        })),
        "gemini" => Ok(crate::ModelConfig::Gemini(crate::GeminiConfig {
            model_id: input.model_id.clone(),
            api_key: input.api_key.clone(),
            additional_config: input.additional_config.clone(),
        })),
        other => Err(AgentError::Runtime {
            reason: format!("unknown model provider: {other}"),
            detail: None,
        }),
    }
}
