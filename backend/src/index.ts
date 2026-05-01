import { ArmaConnector } from "./arma_connection";
import { startServer } from "./server";
import { runtimeState } from "./runtime_state";
import { sdk } from "./instrumentation";
import { FullPipeline } from "./pipeline";
import { configureRuntimeDirs, SessionInitializer } from "./session_initializer";

export const armaConnector = new ArmaConnector();
configureRuntimeDirs();

// Pipeline selection: edit the factory below to swap pipelines in source code.
// Available subclasses:
//   - FullPipeline                                  : Intel -> Plan -> Execution (default)
//   - new PremadeIntelPipeline(deps, "<<<text>>>")  : skip IntelAgent, feed PlanAgent a fixed report
const sessionInitializer = new SessionInitializer(
    armaConnector,
    (deps) => new FullPipeline(deps)
);

const portRaw = Number(process.env.PORT ?? 3000);
const port = Number.isFinite(portRaw) ? portRaw : 3000;
startServer(armaConnector, {
    initializeSession: (payload) => sessionInitializer.initializeSession(payload),
    port,
});

process.on("SIGINT", async () => {
    console.log("Shutting down tracing...");
    runtimeState.setActiveSession(null);
    await sdk.shutdown();
    process.exit(0);
});
