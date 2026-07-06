import { registerTelemetry } from "ai";
import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PostHogTraceExporter } from "@posthog/ai/otel";

registerTelemetry(new LegacyOpenTelemetry());

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": "dac-web",
  }),
  traceExporter: new PostHogTraceExporter({
    projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!,
    host: "https://eu.i.posthog.com",
  }),
});

sdk.start();
