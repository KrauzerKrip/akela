import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";

const sdk = new NodeSDK({
    spanProcessors: [
        new LangfuseSpanProcessor({
            shouldExportSpan: ({ otelSpan }) => isDefaultExportSpan(otelSpan)
        })
    ]
});

sdk.start();
export { sdk };
