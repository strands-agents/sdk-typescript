//! PyO3 extension module — gated behind `#[cfg(feature = "pyo3")]`.
//!
//! Architecture: all wasmtime operations are async, exposed to Python as
//! coroutines via `pyo3_async_runtimes::tokio::future_into_py`. Python
//! drives them with `asyncio.run()` (sync) or `await` (async).
//!
//! No `block_on` for streaming/close — the tokio runtime managed by
//! pyo3-async-runtimes handles everything. `block_on` is only used for
//! fast non-HTTP operations (get_messages, set_messages, construction).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{ResourceAny, StreamEvent_};
use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;

use pyo3_async_runtimes::tokio::future_into_py;

fn get_rt() -> &'static tokio::runtime::Runtime {
    pyo3_async_runtimes::tokio::get_runtime()
}

struct Shared {
    agent: Mutex<crate::Agent>,
    // std::sync, not tokio: never held across an await point.
    handlers: Arc<std::sync::Mutex<HashMap<String, Py<PyAny>>>>,
}

#[pyclass(frozen)]
pub struct StreamHandle {
    handle: ResourceAny,
}

fn extract_model_params(obj: &Bound<'_, PyAny>) -> PyResult<crate::ModelParams> {
    crate::ModelParams::from_py_dict(obj)
}

fn extract_tool_spec(py: Python<'_>, item: &Bound<'_, PyAny>) -> PyResult<crate::ToolSpec> {
    let json_mod = py.import("json")?;
    let name: String = item.get_item("name")?.extract()?;
    let description: String = item.get_item("description")?.extract()?;
    let input_schema_obj = item.get_item("inputSchema")?;
    let input_schema: String = json_mod
        .call_method1("dumps", (input_schema_obj,))?
        .extract()?;
    Ok(crate::ToolSpec {
        name,
        description,
        input_schema,
    })
}

fn extract_tool_specs(py: Python<'_>, tools: &Bound<'_, PyAny>) -> PyResult<Vec<crate::ToolSpec>> {
    let mut specs = Vec::new();
    for item in tools.try_iter()? {
        specs.push(extract_tool_spec(py, &item?)?);
    }
    Ok(specs)
}

fn build_model_config(obj: &Bound<'_, PyAny>) -> PyResult<crate::ModelConfig> {
    let provider: String = obj.get_item("provider")?.extract()?;
    match provider.as_str() {
        "anthropic" => Ok(crate::ModelConfig::Anthropic(
            crate::AnthropicConfig::from_py_dict(obj)?,
        )),
        "bedrock" => Ok(crate::ModelConfig::Bedrock(
            crate::BedrockConfig::from_py_dict(obj)?,
        )),
        other => Err(PyRuntimeError::new_err(format!(
            "unknown model provider: {other}"
        ))),
    }
}

#[pyclass]
pub struct Agent {
    shared: Arc<Shared>,
}

#[pymethods]
impl Agent {
    #[new]
    #[pyo3(signature = (*, model=None, system_prompt=None, system_prompt_blocks=None, tools=None))]
    fn new(
        py: Python<'_>,
        model: Option<Py<PyAny>>,
        system_prompt: Option<String>,
        system_prompt_blocks: Option<Py<PyAny>>,
        tools: Option<Vec<Py<PyAny>>>,
    ) -> PyResult<Self> {
        let (model_config, model_params) = if let Some(model_obj) = model {
            let obj = model_obj.bind(py);
            let config = build_model_config(obj)?;
            let params = extract_model_params(obj)?;
            (Some(config), Some(params))
        } else {
            (None, None)
        };

        let system_prompt_blocks_json = if let Some(blocks) = system_prompt_blocks {
            let json_mod = py.import("json")?;
            let json_str: String = json_mod.call_method1("dumps", (blocks,))?.extract()?;
            Some(json_str)
        } else {
            None
        };

        let shared_handlers: Arc<std::sync::Mutex<HashMap<String, Py<PyAny>>>> =
            Arc::new(std::sync::Mutex::new(HashMap::new()));

        let wit_tools = if let Some(tools) = tools {
            let mut wit_specs: Vec<crate::ToolSpec> = Vec::new();
            {
                let mut handlers = shared_handlers
                    .lock()
                    .map_err(|e| PyRuntimeError::new_err(format!("lock poisoned: {e}")))?;
                for tool_obj in &tools {
                    let tool = tool_obj.bind(py);
                    let spec = extract_tool_spec(py, tool)?;
                    let handler: Py<PyAny> = tool.get_item("handler")?.unbind();
                    handlers.insert(spec.name.clone(), handler);
                    wit_specs.push(spec);
                }
            }
            Some(wit_specs)
        } else {
            None
        };

        let h = Arc::clone(&shared_handlers);
        let tool_dispatch =
            move |name: &str, input: &str, tool_use_id: &str| -> Result<String, String> {
                let tid = tool_use_id.to_string();
                Python::try_attach(|py| {
                    let handlers = h.lock().map_err(|e| format!("lock: {e}"))?;
                    match handlers.get(name) {
                        Some(handler) => match handler.call1(py, (input, &tid)) {
                            Ok(result) => match result.extract::<String>(py) {
                                Ok(s) => Ok(s),
                                Err(e) => Err(format!("{e}")),
                            },
                            Err(e) => Err(format!("{e}")),
                        },
                        None => Err(format!("unknown tool: {name}")),
                    }
                })
                .unwrap_or_else(|| Err("failed to acquire Python GIL".into()))
            };

        let log_handler = move |level: &str, message: &str, context: Option<&str>| {
            let lvl = level.to_string();
            let msg = match context {
                Some(ctx) => format!("{message} | {ctx}"),
                None => message.to_string(),
            };
            let _ = Python::try_attach(|py| -> PyResult<()> {
                let logging = py.import("logging")?;
                let logger = logging.call_method1("getLogger", ("strands.wasm",))?;
                let py_level: i32 = match lvl.as_str() {
                    "error" => 40,
                    "warn" => 30,
                    "info" => 20,
                    "debug" | "trace" => 10,
                    _ => 20,
                };
                logger.call_method1("log", (py_level, &msg))?;
                Ok(())
            });
        };

        // Construction uses block_on — no HTTP involved, fast.
        let agent = {
            let mut builder = crate::Agent::builder();
            if let Some(m) = model_config {
                builder = builder.model(m);
            }
            if let Some(mp) = model_params {
                builder = builder.model_params(mp);
            }
            if let Some(p) = system_prompt {
                builder = builder.system_prompt(p);
            }
            if let Some(b) = system_prompt_blocks_json {
                builder = builder.system_prompt_blocks(b);
            }
            if let Some(t) = wit_tools {
                builder = builder.tools(t);
            }
            builder = builder.tool_dispatch_fn(tool_dispatch);
            builder = builder.log_handler(log_handler);
            get_rt().block_on(builder.build())
        }
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(Self {
            shared: Arc::new(Shared {
                agent: Mutex::new(agent),
                handlers: shared_handlers,
            }),
        })
    }

    fn _register_handler(&self, name: String, handler: Py<PyAny>) -> PyResult<()> {
        let mut handlers = self
            .shared
            .handlers
            .lock()
            .map_err(|e| PyRuntimeError::new_err(format!("lock poisoned: {e}")))?;
        handlers.insert(name, handler);
        Ok(())
    }

    fn _unregister_handler(&self, name: String) -> PyResult<()> {
        let mut handlers = self
            .shared
            .handlers
            .lock()
            .map_err(|e| PyRuntimeError::new_err(format!("lock poisoned: {e}")))?;
        handlers.remove(&name);
        Ok(())
    }

    /// Start a stream — returns a coroutine resolving to StreamHandle.
    #[pyo3(signature = (input, tools=None, tool_choice=None))]
    fn start_stream<'py>(
        &self,
        py: Python<'py>,
        input: &str,
        tools: Option<Py<PyAny>>,
        tool_choice: Option<String>,
    ) -> PyResult<Bound<'py, PyAny>> {
        let wit_tools = if let Some(tools_obj) = tools {
            Some(extract_tool_specs(py, tools_obj.bind(py))?)
        } else {
            None
        };

        let shared = Arc::clone(&self.shared);
        let input = input.to_string();
        future_into_py(py, async move {
            let mut agent = shared.agent.lock().await;
            let handle = agent
                .start_stream_with_options(&input, wit_tools, tool_choice)
                .await
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            Ok(StreamHandle { handle })
        })
    }

    /// Pull next events — returns a coroutine resolving to list[StreamEvent_] or None.
    fn next_events<'py>(
        &self,
        py: Python<'py>,
        stream: &StreamHandle,
    ) -> PyResult<Bound<'py, PyAny>> {
        let shared = Arc::clone(&self.shared);
        let handle = stream.handle;
        future_into_py(py, async move {
            let mut agent = shared.agent.lock().await;
            match agent.next_events(handle).await {
                Ok(Some(events)) => Ok(Some(
                    events
                        .into_iter()
                        .map(StreamEvent_::from)
                        .collect::<Vec<_>>(),
                )),
                Ok(None) => Ok(None),
                Err(e) => Err(PyRuntimeError::new_err(e.to_string())),
            }
        })
    }

    /// Close a stream — returns a coroutine. Drops the WASM resource and
    /// yields to let tokio reap HTTP background threads.
    fn close_stream<'py>(
        &self,
        py: Python<'py>,
        stream: &StreamHandle,
    ) -> PyResult<Bound<'py, PyAny>> {
        let shared = Arc::clone(&self.shared);
        let handle = stream.handle;
        future_into_py(py, async move {
            let mut agent = shared.agent.lock().await;
            match handle.resource_drop_async(&mut agent.store).await {
                Ok(()) => {
                    tokio::task::yield_now().await;
                    tokio::task::yield_now().await;
                }
                Err(e) => tracing::warn!("close_stream: resource_drop skipped: {e}"),
            }
            Ok(())
        })
    }

    /// Get messages — sync (fast, no HTTP).
    fn get_messages(&self) -> PyResult<String> {
        get_rt()
            .block_on(async {
                let mut agent = self.shared.agent.lock().await;
                agent.get_messages().await
            })
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Set messages — sync (fast, no HTTP).
    fn set_messages(&self, json: &str) -> PyResult<()> {
        let json = json.to_string();
        get_rt()
            .block_on(async {
                let mut agent = self.shared.agent.lock().await;
                agent.set_messages(&json).await
            })
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }
}

#[pymodule(name = "_strands")]
pub mod _strands {
    use super::*;

    #[pymodule_export]
    use super::Agent;
    #[pymodule_export]
    use super::StreamHandle;
    #[pymodule_export]
    use crate::MetadataEvent_;
    #[pymodule_export]
    use crate::Metrics_;
    #[pymodule_export]
    use crate::StopData_;
    #[pymodule_export]
    use crate::StopReason_;
    #[pymodule_export]
    use crate::StreamEvent_;
    #[pymodule_export]
    use crate::ToolResultEvent_;
    #[pymodule_export]
    use crate::ToolUseEvent_;
    #[pymodule_export]
    use crate::Usage_;

    #[pymodule_init]
    fn init(_m: &Bound<'_, PyModule>) -> PyResult<()> {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .with_target(true)
            .try_init();
        Ok(())
    }
}
