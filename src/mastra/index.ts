import { Mastra } from "@mastra/core";
import { Observability, ConsoleExporter } from "@mastra/observability";
import { OtelExporter } from "@mastra/otel-exporter";
import {
  bloom,
  parserAgent,
  explainerAgent,
  medicationAgent,
  followupAgent,
  redflagAgent,
} from "./agents";
import { bloomToolsServer } from "./mcp-server";

/** OpenTelemetry tracing of every LLM call and agent handoff.
 * Exported to Cloud Trace via OTLP in production; console locally.
 * Gives an audit trail for clinical decisions, latency, and token cost. */
const exporters = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? [
      new OtelExporter({
        provider: {
          custom: {
            endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
            protocol: "http/protobuf" as const,
          },
        },
      }),
    ]
  : [new ConsoleExporter()];

export const mastra = new Mastra({
  agents: { bloom, parserAgent, explainerAgent, medicationAgent, followupAgent, redflagAgent },
  mcpServers: { bloomTools: bloomToolsServer },
  observability: new Observability({
    configs: { default: { serviceName: "bloom-core", exporters } },
  }),
});
