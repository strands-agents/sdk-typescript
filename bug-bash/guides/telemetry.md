# Telemetry

Observability for agents using OpenTelemetry. Covers distributed tracing with span hierarchies, metrics collection for token usage and latency, and pluggable logging.

Docs:
- [Observability Overview](https://strandsagents.com/docs/user-guide/observability-evaluation/observability/)
- [Traces](https://strandsagents.com/docs/user-guide/observability-evaluation/traces/)
- [Metrics](https://strandsagents.com/docs/user-guide/observability-evaluation/metrics/)
- [Logs](https://strandsagents.com/docs/user-guide/observability-evaluation/logs/)

Templates: [telemetry.ts](../templates/telemetry.ts)

---

## Tracing

- Configure a `TracerProvider` and pass it to the agent
- Verify spans are created: agent span, agent loop span, model invoke span, tool call span
- Check span attributes (model ID, tool name, etc.)
- Verify parent-child span relationships
- Export spans to console or a collector, verify they're well-formed

Watch for: Are all expected spans created (no missing spans for tool calls or model invocations)? Do span attributes contain useful information? Are parent-child relationships correct?

## Metrics

- `Meter` for metrics accumulation (token usage, latency, tool success rates)
- `AgentMetrics`: access accumulated metrics after invocations
- Configurable meter providers
- Run multiple invocations, verify metrics accumulate correctly

Watch for: Are metrics accurate (token counts match what the model reports)? Do metrics reset between agents or accumulate globally?

## Logging

- `configureLogging()` with a custom logger (e.g., Pino or Winston)
- Verify SDK log output goes through the custom logger
- Default logger: verify console warn/error output
- Structured log format: verify logs follow `field=<value> | message` pattern

Watch for: Does `configureLogging()` fully redirect all SDK logging, or do some messages still go to console? Is the structured log format consistent across all SDK modules?
