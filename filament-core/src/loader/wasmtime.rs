use async_trait::async_trait;
use tracing::error;
use wasmtime::component::{Component, HasSelf, Linker, Resource, ResourceAny, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};
use wasmtime_wasi_http::{WasiHttpCtx, WasiHttpView};

use crate::loader::Loader;
use crate::module::{LoadArgs, Module, ModuleManifest, SchedulingPolicy};
use crate::plugin::{Plugin, Signal, WeaveArgs};
use crate::types::{FilamentError, GuestBoundEvent};

mod sys {
    wasmtime::component::bindgen!({
        path: "../filament-wit/filament.wit",
        imports: {
            default: async | trappable
        },
        exports: {
            default: async
        }
    });
}

impl From<wasmtime::Error> for FilamentError {
    fn from(err: wasmtime::Error) -> Self {
        FilamentError::Custom(err.into_boxed_dyn_error())
    }
}

impl From<std::str::Utf8Error> for FilamentError {
    fn from(err: std::str::Utf8Error) -> Self {
        FilamentError::Custom(Box::new(err))
    }
}

impl From<toml::de::Error> for FilamentError {
    fn from(err: toml::de::Error) -> Self {
        FilamentError::Custom(Box::new(err))
    }
}

impl From<std::io::Error> for FilamentError {
    fn from(err: std::io::Error) -> Self {
        FilamentError::Custom(Box::new(err))
    }
}

impl From<wasmparser::BinaryReaderError> for FilamentError {
    fn from(err: wasmparser::BinaryReaderError) -> Self {
        FilamentError::Custom(Box::new(err))
    }
}

struct WasmHostState {
    table: ResourceTable,
    wasi: WasiCtx,
    http: WasiHttpCtx,
}

impl WasiView for WasmHostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl WasiHttpView for WasmHostState {
    fn ctx(&mut self) -> &mut WasiHttpCtx {
        &mut self.http
    }

    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

impl sys::filament::core::logger::Host for WasmHostState {
    async fn log(
        &mut self,
        level: sys::filament::core::logger::Level,
        msg: String,
    ) -> Result<(), wasmtime::Error> {
        match level {
            sys::filament::core::logger::Level::Debug => {
                tracing::debug!(target: "wasm_guest", "{}", msg);
            }
            sys::filament::core::logger::Level::Info => {
                tracing::info!(target: "wasm_guest", "{}", msg);
            }
            sys::filament::core::logger::Level::Warn => {
                tracing::warn!(target: "wasm_guest", "{}", msg);
            }
            sys::filament::core::logger::Level::Error => {
                tracing::error!(target: "wasm_guest", "{}", msg);
            }
        }

        Ok(())
    }
}

impl sys::filament::core::blob_store::Host for WasmHostState {
    async fn open_write(
        &mut self,
    ) -> Result<
        Result<
            Resource<sys::filament::core::blob_store::Writer>,
            sys::filament::core::types::Error,
        >,
        wasmtime::Error,
    > {
        // TODO: Implement writer resource
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn open_read(
        &mut self,
        _handle: u64,
    ) -> Result<
        Result<
            Resource<sys::filament::core::blob_store::Reader>,
            sys::filament::core::types::Error,
        >,
        wasmtime::Error,
    > {
        // TODO: Implement reader resource
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn exists(
        &mut self,
        _handle: u64,
    ) -> Result<Result<bool, sys::filament::core::types::Error>, wasmtime::Error> {
        Ok(Ok(false))
    }
}

impl sys::filament::core::blob_store::HostWriter for WasmHostState {
    async fn write(
        &mut self,
        _self_: Resource<sys::filament::core::blob_store::Writer>,
        _chunk: Vec<u8>,
    ) -> Result<Result<(), sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn commit(
        &mut self,
        _self_: Resource<sys::filament::core::blob_store::Writer>,
    ) -> Result<Result<u64, sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn abort(
        &mut self,
        _self_: Resource<sys::filament::core::blob_store::Writer>,
    ) -> Result<(), wasmtime::Error> {
        // TODO: Implement
        Ok(())
    }

    async fn drop(
        &mut self,
        _rep: Resource<sys::filament::core::blob_store::Writer>,
    ) -> Result<(), wasmtime::Error> {
        Ok(())
    }
}

impl sys::filament::core::blob_store::HostReader for WasmHostState {
    async fn read(
        &mut self,
        _self_: Resource<sys::filament::core::blob_store::Reader>,
        _len: u64,
    ) -> Result<Result<Vec<u8>, sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn drop(
        &mut self,
        _rep: Resource<sys::filament::core::blob_store::Reader>,
    ) -> Result<(), wasmtime::Error> {
        Ok(())
    }
}

impl sys::filament::core::types::Host for WasmHostState {}

impl sys::filament::core::channel::Host for WasmHostState {
    async fn open(
        &mut self,
        _args: sys::filament::core::channel::OpenArgs,
    ) -> Result<
        Result<
            (
                Resource<sys::filament::core::channel::Sender>,
                Resource<sys::filament::core::channel::Receiver>,
            ),
            sys::filament::core::types::Error,
        >,
        wasmtime::Error,
    > {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn open_reader(
        &mut self,
        _args: sys::filament::core::channel::OpenArgs,
    ) -> Result<
        Result<Resource<sys::filament::core::channel::Receiver>, sys::filament::core::types::Error>,
        wasmtime::Error,
    > {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }

    async fn open_writer(
        &mut self,
        _args: sys::filament::core::channel::OpenArgs,
    ) -> Result<
        Result<Resource<sys::filament::core::channel::Sender>, sys::filament::core::types::Error>,
        wasmtime::Error,
    > {
        // TODO: Implement
        Ok(Err(sys::filament::core::types::Error::NotFound))
    }
}

impl sys::filament::core::channel::HostSender for WasmHostState {
    async fn send(
        &mut self,
        _self_: Resource<sys::filament::core::channel::Sender>,
        _evt: sys::filament::core::types::HostBoundEvent,
    ) -> Result<Result<u64, sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Ok(0))
    }

    async fn drop(
        &mut self,
        _rep: Resource<sys::filament::core::channel::Sender>,
    ) -> Result<(), wasmtime::Error> {
        Ok(())
    }
}

impl sys::filament::core::channel::HostReceiver for WasmHostState {
    async fn recv(
        &mut self,
        _self_: Resource<sys::filament::core::channel::Receiver>,
        _count: u32,
    ) -> Result<
        Result<Vec<sys::filament::core::types::GuestBoundEvent>, sys::filament::core::types::Error>,
        wasmtime::Error,
    > {
        // TODO: Implement
        Ok(Ok(vec![]))
    }

    async fn drop(
        &mut self,
        _rep: Resource<sys::filament::core::channel::Receiver>,
    ) -> Result<(), wasmtime::Error> {
        Ok(())
    }
}

impl sys::filament::core::timer::Host for WasmHostState {
    async fn arm(
        &mut self,
        _args: sys::filament::core::timer::ArmArgs,
    ) -> Result<Result<u64, sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Ok(0))
    }

    async fn disarm(
        &mut self,
        _args: sys::filament::core::timer::DisarmArgs,
    ) -> Result<Result<(), sys::filament::core::types::Error>, wasmtime::Error> {
        // TODO: Implement
        Ok(Ok(()))
    }
}

impl sys::filament::core::config::Host for WasmHostState {
    async fn get_string(
        &mut self,
        _path: String,
    ) -> Result<Result<String, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_int(
        &mut self,
        _path: String,
    ) -> Result<Result<i64, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_float(
        &mut self,
        _path: String,
    ) -> Result<Result<f64, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_bool(
        &mut self,
        _path: String,
    ) -> Result<Result<bool, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_offset_date_time(
        &mut self,
        _path: String,
    ) -> Result<
        Result<
            sys::filament::core::config::OffsetDateTime,
            sys::filament::core::config::ConfigError,
        >,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_date_time(
        &mut self,
        _path: String,
    ) -> Result<
        Result<
            sys::filament::core::config::LocalDateTime,
            sys::filament::core::config::ConfigError,
        >,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_date(
        &mut self,
        _path: String,
    ) -> Result<
        Result<sys::filament::core::config::Date, sys::filament::core::config::ConfigError>,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_time(
        &mut self,
        _path: String,
    ) -> Result<
        Result<sys::filament::core::config::Time, sys::filament::core::config::ConfigError>,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_string_array(
        &mut self,
        _path: String,
    ) -> Result<Result<Vec<String>, sys::filament::core::config::ConfigError>, wasmtime::Error>
    {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_int_array(
        &mut self,
        _path: String,
    ) -> Result<Result<Vec<i64>, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_float_array(
        &mut self,
        _path: String,
    ) -> Result<Result<Vec<f64>, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_bool_array(
        &mut self,
        _path: String,
    ) -> Result<Result<Vec<bool>, sys::filament::core::config::ConfigError>, wasmtime::Error> {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_offset_date_time_array(
        &mut self,
        _path: String,
    ) -> Result<
        Result<
            Vec<sys::filament::core::config::OffsetDateTime>,
            sys::filament::core::config::ConfigError,
        >,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_date_time_array(
        &mut self,
        _path: String,
    ) -> Result<
        Result<
            Vec<sys::filament::core::config::LocalDateTime>,
            sys::filament::core::config::ConfigError,
        >,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_date_array(
        &mut self,
        _path: String,
    ) -> Result<
        Result<Vec<sys::filament::core::config::Date>, sys::filament::core::config::ConfigError>,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn get_local_time_array(
        &mut self,
        _path: String,
    ) -> Result<
        Result<Vec<sys::filament::core::config::Time>, sys::filament::core::config::ConfigError>,
        wasmtime::Error,
    > {
        Ok(Err(sys::filament::core::config::ConfigError::NotFound))
    }

    async fn keys(
        &mut self,
        _path: Option<String>,
    ) -> Result<Result<Vec<String>, sys::filament::core::config::ConfigError>, wasmtime::Error>
    {
        Ok(Ok(vec![]))
    }
}

// No stub implementations needed since plugin is exported by the guest, not imported by the host

struct WasmPlugin {
    store: Store<WasmHostState>,
    module: sys::Module,
    plugin: ResourceAny,
}

#[async_trait]
impl crate::plugin::Plugin for WasmPlugin {
    async fn weave(
        &mut self,
        args: WeaveArgs,
        events: &mut Vec<GuestBoundEvent>,
    ) -> Result<Signal, FilamentError> {
        // Convert WeaveArgs to WASM types (using exports namespace)
        let wasm_args = sys::exports::filament::core::plugin::WeaveArgs {
            tick: args.tick,
            virtual_time: args.virtual_time,
            physical_time: args.physical_time,
            delta_time: args.delta_time,
            trace: sys::filament::core::types::TraceContext {
                trace_id_hi: args.trace.trace_id_hi,
                trace_id_lo: args.trace.trace_id_lo,
                span_id: args.trace.span_id,
                parent_id: Some(args.trace.parent_id),
                trace_flags: args.trace.trace_flags,
            },
            triggers: args
                .triggers
                .into_iter()
                .map(|t| sys::filament::core::types::GuestBoundEvent {
                    topic: t.topic,
                    id: t.id,
                    timestamp: t.timestamp,
                    source: t.source,
                    data: t.data,
                    trace_context: sys::filament::core::types::TraceContext {
                        trace_id_hi: t.trace_context.trace_id_hi,
                        trace_id_lo: t.trace_context.trace_id_lo,
                        span_id: t.trace_context.span_id,
                        parent_id: Some(t.trace_context.parent_id),
                        trace_flags: t.trace_context.trace_flags,
                    },
                    trace_state: t.trace_state.map(|ts| ts.0),
                })
                .collect(),
            timers: vec![], // TODO: Map timers
        };

        // Call weave through the exported plugin interface
        tracing::info!(
            triggers = wasm_args.triggers.len(),
            "Calling WASM plugin.weave"
        );
        let wasm_signal = self
            .module
            .filament_core_plugin()
            .plugin()
            .call_weave(&mut self.store, self.plugin, &wasm_args)
            .await
            .map_err(FilamentError::from)?;
        tracing::info!("WASM plugin.weave returned");

        // Map Signal
        let signal = match wasm_signal {
            Ok(sys::exports::filament::core::plugin::Signal::Park) => Signal::Park,
            Ok(sys::exports::filament::core::plugin::Signal::Yield) => Signal::Yield,
            Err(_) => Signal::Park,
        };

        // TODO: Collect events from channel/output and push into events vec

        Ok(signal)
    }
}

pub struct WasmModule {
    engine: Engine,
    uri: String,
    manifest: ModuleManifest,
    component: Component,
}

#[async_trait]
impl Module for WasmModule {
    async fn manifest(&self) -> Result<ModuleManifest, FilamentError> {
        Ok(self.manifest.clone())
    }

    async fn load(&self, args: LoadArgs) -> Result<Box<dyn Plugin>, FilamentError> {
        let mut linker = Linker::<WasmHostState>::new(&self.engine);
        linker.allow_shadowing(true);

        wasmtime_wasi::p2::add_to_linker_async(&mut linker).map_err(|_| FilamentError::NotFound)?;
        wasmtime_wasi_http::add_to_linker_async(&mut linker)
            .map_err(|_| FilamentError::NotFound)?;

        sys::Module::add_to_linker::<_, HasSelf<_>>(&mut linker, |s| s)
            .map_err(|_| FilamentError::NotFound)?;

        let mut store = Store::new(
            &self.engine,
            WasmHostState {
                table: ResourceTable::new(),
                wasi: WasiCtxBuilder::new().inherit_stdio().build(),
                http: WasiHttpCtx::new(),
            },
        );

        // Use the pre-loaded component instead of loading from file again
        let module = sys::Module::instantiate_async(&mut store, &self.component, &linker)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to instantiate component");
                FilamentError::NotFound
            })?;

        // Convert LoadArgs to WIT format
        use sys::exports::filament::core::plugin::{
            HostInfo, LoadArgs, SchedulingPolicy as WasmSchedulingPolicy, Version,
        };

        let wasm_args = LoadArgs {
            host_info: HostInfo {
                version: Version {
                    major: args.host_info.version.major,
                    minor: args.host_info.version.minor,
                    patch: args.host_info.version.patch,
                },
                mem_max: args.host_info.mem_max,
                time_limit: args.host_info.time_limit,
                bus_size: args.host_info.bus_size,
                cores: args.host_info.cores,
                policy: match args.host_info.policy {
                    SchedulingPolicy::Shared => WasmSchedulingPolicy::Shared,
                    SchedulingPolicy::Dedicated => WasmSchedulingPolicy::Dedicated,
                },
            },
            entrypoint: args.entrypoint,
            version: Version {
                major: args.version.major,
                minor: args.version.minor,
                patch: args.version.patch,
            },
        };

        let plugin = module
            .filament_core_plugin()
            .plugin()
            .call_load(&mut store, &wasm_args)
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to call load (wasmtime)");
                FilamentError::NotFound
            })?
            .map_err(|e| {
                error!(error = ?e, "load returned error");
                FilamentError::NotFound
            })?;

        Ok(Box::new(WasmPlugin {
            store,
            module,
            plugin,
        }))
    }
}

pub struct WasmtimeLoader {
    engine: Engine,
}

impl WasmtimeLoader {
    pub fn new() -> Result<Self, FilamentError> {
        let mut config = Config::new();
        config.wasm_component_model(true);
        config.async_support(true);
        Ok(Self {
            engine: Engine::new(&config)?,
        })
    }
}

#[async_trait]
impl Loader for WasmtimeLoader {
    fn supports(&self, uri: &str) -> bool {
        uri.starts_with("file://") && uri.ends_with(".wasm")
    }

    async fn load_module(&self, uri: &str) -> Result<Box<dyn Module>, FilamentError> {
        tracing::info!(uri = %uri, "Loading module from URI");
        let path = uri.trim_start_matches("file://");
        tracing::info!(path = %path, "Reading WASM file");
        let wasm_bytes = std::fs::read(path).map_err(|e| {
            tracing::error!(error = %e, path = %path, "Failed to read WASM file");
            FilamentError::NotFound
        })?;

        // Parse WASM component to find custom section "filament/manifest"
        tracing::info!("Parsing WASM for manifest");
        let parser = wasmparser::Parser::new(0);
        let mut manifest_toml: Option<Vec<u8>> = None;

        for (idx, payload) in parser.parse_all(&wasm_bytes).enumerate() {
            let payload = match payload {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(error = %e, index = idx, "Parse error encountered, continuing search");
                    continue;
                }
            };

            if let wasmparser::Payload::CustomSection(section) = &payload
                && section.name() == "filament/manifest"
            {
                tracing::info!("Found filament/manifest custom section");
                manifest_toml = Some(section.data().to_vec());
                break;
            }
        }

        let manifest_bytes = manifest_toml.ok_or_else(|| {
            tracing::error!("Manifest not found in WASM file");
            FilamentError::NotFound
        })?;

        let manifest_str = std::str::from_utf8(&manifest_bytes)?;
        let manifest: ModuleManifest = toml::from_str(manifest_str)?;

        // Load the component once here instead of on every plugin instantiation
        tracing::info!("Loading WASM component");
        let component = Component::from_file(&self.engine, path).map_err(|e| {
            tracing::error!(error = %e, "Failed to load component");
            FilamentError::NotFound
        })?;

        Ok(Box::new(WasmModule {
            engine: self.engine.clone(),
            uri: uri.to_string(),
            manifest,
            component,
        }))
    }
}
