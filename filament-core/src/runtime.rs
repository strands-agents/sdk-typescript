use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use dashmap::DashMap;
use tokio::sync::{Mutex, Notify};

use crate::bindings::Timeline;
use crate::loader::Loader;
use crate::pipeline::PipelineManifest;
use crate::plugin::{Plugin, Signal, WeaveArgs};
use crate::types::{FilamentError, GuestBoundEvent, TraceContext};

// UniFFI scaffolding setup
#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!("filament");

// Conditional imports for NAPI
#[cfg(feature = "napi")]
use napi::bindgen_prelude::*;
#[cfg(feature = "napi")]
use napi_derive::napi;

#[cfg_attr(feature = "napi", napi(js_name = "Runtime"))]
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct Runtime {
    pipelines: DashMap<u64, Arc<Pipeline>>,
    next_pid: AtomicU64,
    loaders: Vec<Arc<dyn Loader>>,
}

impl Runtime {
    /// Create a new Runtime with the given loaders.
    ///
    /// Loaders are tried in order when loading plugins from URIs.
    pub fn new(loaders: Vec<Arc<dyn Loader>>) -> Arc<Self> {
        Arc::new(Self {
            pipelines: DashMap::new(),
            next_pid: AtomicU64::new(1),
            loaders,
        })
    }

    pub async fn spawn(
        &self,
        manifest: PipelineManifest,
        timeline: Arc<dyn Timeline>,
    ) -> Result<PipelineHandle, FilamentError> {
        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);

        // Load all plugins from the pipeline manifest
        let mut plugins = Vec::new();
        let mut module_cache: std::collections::HashMap<String, Arc<dyn crate::module::Module>> =
            std::collections::HashMap::new();

        tracing::info!(count = manifest.pipeline.len(), "Loading plugins");
        for entry in &manifest.pipeline {
            match entry {
                crate::pipeline::PipelineEntry::Plugin(plugin_def) => {
                    // Check if we've already loaded this module
                    let module = if let Some(cached) = module_cache.get(&plugin_def.uri) {
                        tracing::debug!(uri = %plugin_def.uri, "Using cached module");
                        Arc::clone(cached)
                    } else {
                        // Find loader that supports this URI
                        tracing::info!(uri = %plugin_def.uri, "Looking for loader to support URI");
                        let mut loaded_module = None;
                        for loader in &self.loaders {
                            if loader.supports(&plugin_def.uri) {
                                tracing::info!("Loader found, loading module");
                                let module =
                                    loader.load_module(&plugin_def.uri).await.map_err(|e| {
                                        tracing::error!(error = ?e, "load_module failed");
                                        e
                                    })?;
                                tracing::info!("Module loaded successfully");
                                loaded_module = Some(module);
                                break;
                            }
                        }

                        let module = loaded_module.ok_or_else(|| {
                            tracing::error!(uri = %plugin_def.uri, "No loader supports this URI");
                            FilamentError::NotFound
                        })?;

                        // Cache the module (wrap Box in Arc)
                        let arc_module = Arc::from(module);
                        module_cache.insert(plugin_def.uri.clone(), Arc::clone(&arc_module));
                        arc_module
                    };

                    // Load the plugin from the module
                    let plugin = module
                        .load(crate::module::LoadArgs {
                            host_info: crate::module::HostInfo {
                                version: crate::module::Version {
                                    major: 0,
                                    minor: 1,
                                    patch: 0,
                                },
                                mem_max: 1024 * 1024 * 100,
                                time_limit: 1000,
                                bus_size: 1024,
                                cores: 1,
                                policy: crate::module::SchedulingPolicy::Shared,
                            },
                            entrypoint: plugin_def.entrypoint.clone(),
                            version: crate::module::Version {
                                major: 0,
                                minor: 1,
                                patch: 0,
                            },
                        })
                        .await?;

                    plugins.push(plugin);
                }
                crate::pipeline::PipelineEntry::Barrier => {
                    // TODO: Implement barrier synchronization
                    // For now, barriers are implicit - all plugins in a phase complete before moving to next
                }
            }
        }

        if plugins.is_empty() {
            return Err(FilamentError::NotFound);
        }

        let pipeline = Pipeline::new(pid, manifest, plugins, timeline);
        let pipeline_arc = Arc::new(pipeline);

        self.pipelines.insert(pid, pipeline_arc.clone());

        // Background Task (The "Pipeline Loop")
        let pipe_ref = pipeline_arc.clone();
        tokio::spawn(async move {
            pipe_ref.run_loop().await;
        });

        let handle = PipelineHandle {
            pid,
            inner: pipeline_arc,
        };

        // Send initial lifecycle/init event to start the plugins
        handle.send("sys/lifecycle/init".to_string(), vec![]).await;

        Ok(handle)
    }
}

pub struct Pipeline {
    id: u64,
    manifest: PipelineManifest,
    timeline: Arc<dyn Timeline>,
    plugins: Vec<Arc<Mutex<Box<dyn Plugin>>>>,
    running: AtomicBool,
    inbox: Mutex<Vec<GuestBoundEvent>>,
    wake: Notify,
}

impl Pipeline {
    fn new(
        id: u64,
        manifest: PipelineManifest,
        plugins: Vec<Box<dyn Plugin>>,
        timeline: Arc<dyn Timeline>,
    ) -> Self {
        Self {
            id,
            manifest,
            timeline,
            plugins: plugins
                .into_iter()
                .map(|p| Arc::new(Mutex::new(p)))
                .collect(),
            running: AtomicBool::new(true),
            inbox: Mutex::new(Vec::new()),
            wake: Notify::new(),
        }
    }

    async fn run_loop(&self) {
        tracing::info!("Pipeline run_loop started");
        while self.running.load(Ordering::Relaxed) {
            // Wait for signal (User input or Time tick)
            tracing::debug!("Waiting for wake notification");
            self.wake.notified().await;
            tracing::info!("Pipeline woken up!");

            let inputs = {
                let mut lock = self.inbox.lock().await;
                tracing::info!(event_count = lock.len(), "Checking inbox");
                if lock.is_empty() {
                    continue;
                }

                std::mem::take(&mut *lock)
            };

            tracing::info!(input_count = inputs.len(), "Processing events");
            let triggers = inputs;

            tracing::info!(trigger_count = triggers.len(), "Creating WeaveArgs");
            let weave_args = WeaveArgs {
                tick: 0,
                virtual_time: 0,
                physical_time: 0,
                delta_time: 0,
                trace: TraceContext {
                    trace_id_hi: 0,
                    trace_id_lo: 0,
                    span_id: 0,
                    parent_id: 0,
                    trace_flags: 0,
                },
                triggers,
                timers: vec![],
            };

            // Execute all plugins concurrently with tokio, each manages its own events
            tracing::info!(
                plugin_count = self.plugins.len(),
                "Spawning plugin weave tasks"
            );
            let mut tasks = Vec::new();

            for plugin_mutex in &self.plugins {
                let plugin_mutex = Arc::clone(plugin_mutex);
                let args = weave_args.clone();
                let timeline = Arc::clone(&self.timeline);

                let task = tokio::spawn(async move {
                    tracing::info!("==> Spawned task started");
                    let mut plugin = plugin_mutex.lock().await;
                    tracing::info!("==> Got plugin lock");
                    let mut event_buffer = Vec::new();

                    tracing::info!("About to call plugin.weave");
                    let result = plugin.weave(args, &mut event_buffer).await;
                    tracing::info!(result = ?result, events_produced = event_buffer.len(), "plugin.weave returned");

                    for evt in event_buffer {
                        let _ = timeline.append(evt).await;
                    }

                    result
                });

                tasks.push(task);
            }

            // Wait for all plugins to complete and handle their signals
            tracing::info!("Waiting for plugin tasks to complete");
            for (idx, task) in tasks.into_iter().enumerate() {
                match task.await {
                    Ok(Ok(Signal::Yield)) => {
                        tracing::debug!(plugin_idx = idx, "Plugin yielded");
                    }
                    Ok(Ok(Signal::Park)) => {
                        tracing::debug!(plugin_idx = idx, "Plugin parked");
                    }
                    Ok(Err(e)) => {
                        tracing::error!(plugin_idx = idx, error = ?e, "Plugin returned error");
                    }
                    Err(e) => {
                        tracing::error!(plugin_idx = idx, error = %e, "Plugin task failed");
                    }
                }
            }
            tracing::info!("All plugin tasks completed");
        }
    }
}

#[derive(Clone)]
#[cfg_attr(feature = "napi", napi)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct PipelineHandle {
    pub pid: u64,
    inner: Arc<Pipeline>,
}

impl PipelineHandle {
    pub async fn send(&self, topic: String, data: Vec<u8>) {
        tracing::info!(topic = %topic, "Sending event to pipeline");
        let event = GuestBoundEvent {
            topic,
            id: 0,        // TODO: Generate proper event IDs
            timestamp: 0, // TODO: Use actual timestamp
            source: "host".to_string(),
            data: if data.is_empty() { None } else { Some(data) },
            trace_context: crate::types::TraceContext {
                trace_id_hi: 0,
                trace_id_lo: 0,
                span_id: 0,
                parent_id: 0,
                trace_flags: 0,
            },
            trace_state: None,
        };

        {
            let mut inbox = self.inner.inbox.lock().await;
            inbox.push(event);
            tracing::info!(inbox_size = inbox.len(), "Event added to inbox");
        }

        tracing::info!("Notifying pipeline wake");
        self.inner.wake.notify_one();
    }

    pub fn kill(&self) {
        self.inner.running.store(false, Ordering::Relaxed);
        self.inner.wake.notify_one(); // Wake to exit
    }
}

// FFI Bindings for PipelineHandle
#[cfg_attr(feature = "napi", napi)]
#[cfg_attr(feature = "uniffi", uniffi::export)]
impl PipelineHandle {
    /// Send an event to the pipeline (NAPI async version)
    #[cfg(feature = "napi")]
    #[napi]
    pub async fn send_event(&self, topic: String, data: Buffer) {
        self.send(topic, data.into()).await;
    }

    /// Send an event to the pipeline (UniFFI async version)
    #[cfg(feature = "uniffi")]
    pub async fn send_event(&self, topic: String, data: Vec<u8>) {
        self.send(topic, data).await;
    }

    /// Terminate the pipeline
    #[cfg(any(feature = "napi", feature = "uniffi"))]
    pub fn terminate(&self) {
        self.kill();
    }

    /// Get the pipeline ID
    #[cfg(feature = "napi")]
    #[napi(getter)]
    pub fn id(&self) -> String {
        self.pid.to_string()
    }

    /// Get the pipeline ID (UniFFI version)
    #[cfg(feature = "uniffi")]
    pub fn get_id(&self) -> u64 {
        self.pid
    }
}
