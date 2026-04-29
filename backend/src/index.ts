import { ArmaConnector } from "./arma_connection";
import { startServer } from "./server";
import { runtimeState } from "./runtime_state";
import { sdk } from "./instrumentation";
import { configureRuntimeDirs, SessionInitializer } from "./session_initializer";

export const armaConnector = new ArmaConnector();
configureRuntimeDirs();
const sessionInitializer = new SessionInitializer(armaConnector);
startServer(armaConnector, {
    initializeSession: (payload) => sessionInitializer.initializeSession(payload)
});

process.on("SIGINT", async () => {
    console.log("Shutting down tracing...");
    runtimeState.setActiveSession(null);
    await sdk.shutdown();
    process.exit(0);
});
