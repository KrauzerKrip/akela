import { sdk } from "./instrumentation";
import { propagateAttributes } from "@langfuse/tracing";
import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { ArmaConnector } from "./arma_connection";
import { PlanSandbox } from "./plan/sandbox";
import { Army, ArmyComposer } from "./army";
import { Plan } from "./plan/models";
import { startServer } from "./server";
import { Session } from "./session";
import { GameMap, GameMapArea } from "./geography";
import { DatabaseSessionService } from "@google/adk";
import { IntelAgent, PlanAgent, ExecutionAgent, Image } from "./agent";
import { SimpleIntelPromptFormatter, SimplePlanPromptFormatter, SimpleExecutionPromptFormatter, YamlSitrepFormatter } from "./format";
import { ArmyCombatMonitor } from "./combat";
import { createSitrep } from "./sitrep";
import { PlanVisualizer } from "./plan/visualization";
import { eventHub } from "./event_hub";
import { runtimeState } from "./runtime_state";
import { withEnvelope } from "./events";

const args = process.argv.slice(2);
const { values } = parseArgs({
    args,
    options: {
        params: { type: "string" }
    },
    allowPositionals: true
});

/**
 * params example:
 * {
  "area": {
    "x1": 0,
    "y1": 0,
    "x2": 1000,
    "y2": 1000
  },
  "intel": {
    "photos": ["/path/1.png"],
    "observations": ["Some intel"]
  }
}
 */
if (!values.params) {
    console.error("Usage: bun run src/index.ts --params <path_to_params.json>");
    process.exit(1);
}

const paramsPath = path.resolve(values.params);
if (!fs.existsSync(paramsPath)) {
    console.error(`Intel file not found: ${paramsPath}`);
    process.exit(1);
}

const paramsInputData = JSON.parse(fs.readFileSync(paramsPath, "utf8"));
if (!paramsInputData.intel || !paramsInputData.area) {
    console.error("Invalid params JSON format. Needs 'intel' and 'area' root keys.");
    process.exit(1);
}
const { x1, y1, x2, y2 } = paramsInputData.area;

const images = paramsInputData.intel.photos ? paramsInputData.intel.photos.map((p: string) => new Image(path.resolve(p))) : [];
const observations = paramsInputData.intel.observations || [];
const intel = { images, observations };

export const armaConnector = new ArmaConnector();
startServer(armaConnector);

const dbUrl = process.env.SESSION_DB_URL
if (!dbUrl) {
    throw Error("Env. var SESSION_DB_URL is not defined.")
}
const sessionService = new DatabaseSessionService(dbUrl);
await sessionService.init();

const armyComposer = new ArmyComposer(armaConnector, armaConnector);
console.log("Trying to compose...");
const army = await armyComposer.composeArmyOfSide("BLUFOR");
console.log("Composed army with", army.getGroups().length, "groups!");

const armyCombatMonitor = ArmyCombatMonitor.fromArmy(army);

// Initialize Session
const sessionDir = path.join(process.cwd(), "..", ".data", "sessions");
runtimeState.setSessionsDir(sessionDir);
runtimeState.setMapCacheDir(path.join(process.cwd(), "..", ".data", "map_cache"));
const session = new Session(sessionDir);
session.initialize();
runtimeState.setActiveSession(session);
console.log(`Session initialized at ${session.getDirectory()}`);

const manifest: any = {
    intelInput: paramsInputData
};
session.saveManifest(manifest);

const groups = army.getGroups();
for (const g of groups) {
    await g.updateSituationalData();
}

// Subscriptions for JSONL logging
const appendAndBroadcast = (event: Record<string, any>) => {
    session.appendEventLog(event);
    eventHub.publish(withEnvelope({
        source: event.type === "USER_COMMAND" ? "USER" : event.type === "AGENT_RESPONSE" || event.type === "NEW_PLAN" || event.type === "LLM_DECISION_START" ? "AI" : "GAME",
        ...(event as any),
        sessionId: session.getId()
    }));
};

armyCombatMonitor.subscribe(event => {
    appendAndBroadcast(event as any);
});

groups.forEach(g => {
    g.subscribe(event => {
        appendAndBroadcast(event as any);
    });
});

let isTicking = false;
const stateTickInterval = setInterval(async () => {
    if (isTicking) return;
    isTicking = true;
    try {
        for (const g of groups) {
            await g.updateSituationalData();
        }

        let allKnownEnemies: any[] = [];
        groups.forEach(g => {
            const monitor = armyCombatMonitor.getGroupMonitor(g.id);
            if (monitor) {
                allKnownEnemies = allKnownEnemies.concat(monitor.getKnownEnemies());
            }
        });

        const stateSnapshot = {
            type: "STATE_TICK",
            groups: groups.map(g => ({
                id: g.id,
                groupId: g.id,
                name: g.getName(),
                position: [g.getPosition().x, g.getPosition().y],
                task: g.getCurrentTask(),
            })),
            knownEnemies: allKnownEnemies.map(enemy => ({
                position: [enemy.position.x, enemy.position.y, enemy.position.z],
                kind: enemy.kind
            }))
        };
        appendAndBroadcast(stateSnapshot);
    } catch (e) {
        console.error("Failed to execute state tick:", e);
    } finally {
        isTicking = false;
    }
}, 1000); // Ticking every 1 second

const gameMap = new GameMap(session);
console.log(`Extracting map area from (${x1}, ${y1}) to (${x2}, ${y2})`);
const gameMapArea = await gameMap.extractArea(
    { x: x1, y: y1 },
    { x: x2, y: y2 }
);

// Main Pipeline execution wrapped in Trace
try {
    await propagateAttributes({
        traceName: "AgenticPipeline",
        sessionId: session.getId(),
        tags: ["initial"]
    }, async () => {
        // Intel
        const intelAgent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService, session);
        console.log("Running IntelAgent...");
        const intelResult = await intelAgent.analyze(intel, gameMapArea);
        manifest.intelResult = intelResult;
        session.saveManifest(manifest);
        console.log("Intel finished.");

        // Plan
        const sitreps = groups.map(g => {
            const monitor = armyCombatMonitor.getGroupMonitor(g.id);
            return createSitrep(g, monitor!);
        });

        const sandbox = await PlanSandbox.create();
        const visualizer = new PlanVisualizer(session);
        const planAgent = new PlanAgent(
            new SimplePlanPromptFormatter(new YamlSitrepFormatter()),
            sessionService,
            session,
            sandbox,
            visualizer
        );

        console.log("Running PlanAgent...");
        const planningResult = await planAgent.plan(army, sitreps, intelResult, gameMapArea);
        manifest.planningResult = planningResult;
        session.saveManifest(manifest);
        console.log("Plan finished.");

        // Execute
        async function actAccordingToPlan(plan: Plan, army: Army) {
            const groups = army.getGroups();
            const immediateTaskPromises = [];
            for (const group of groups) {
                if (plan.queuedTasks && plan.queuedTasks[group.id]) {
                    plan.queuedTasks[group.id].forEach((task) => {
                        group.addTaskToQueue(task);
                    });
                }
                if (plan.immediateTasks && plan.immediateTasks[group.id]) {
                    immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
                }

                if (plan.clearGroupTasks && plan.clearGroupTasks[group.id]) {
                    group.clearTasks();
                }
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const executionAgent = new ExecutionAgent(
            new SimpleExecutionPromptFormatter(new YamlSitrepFormatter()),
            new YamlSitrepFormatter(),
            sessionService,
            session,
            sandbox
        );

        manifest.executionEvents = manifest.executionEvents || [];

        // Connect events to Sandbox
        armyCombatMonitor.subscribe(async (event: any) => {
            const group = army.getGroupById(event.groupId);
            if (group) {
                let planEvent: any = null;
                if (event.type === "ENEMY_CONTACT") {
                    planEvent = {
                        type: "ENEMY_CONTACT",
                        count: event.contactCount,
                        kind: event.kind
                    };
                } else if (event.type === "KIA" || event.type === "ENGAGED_IN_COMBAT" || event.type === "COMBAT_ENDED" || event.type === "TIMEOUT") {
                    planEvent = { type: event.type };
                }

                if (planEvent) {
                    const newPlan = sandbox.handlePlanEvent(group, planEvent);
                    if (newPlan) {
                        try {
                            const safePlan = { ...newPlan };
                            manifest.executionEvents.push({ type: "NEW_PLAN", plan: safePlan });
                            session.saveManifest(manifest);
                        } catch (e) {
                            console.log("Failed to save event to manifest:", e);
                        }
                        await actAccordingToPlan(newPlan, army);
                    }
                }
            }
        });

        army.getGroups().forEach(g => {
            g.subscribe(async (event: any) => {
                if (event.type === "TASK_COMPLETED") {
                    const taskName = event.task.name;
                    const planEvent = { type: "TASK_COMPLETE", taskName };
                    const newPlan = sandbox.handlePlanEvent(g, planEvent);
                    if (newPlan) {
                        try {
                            const safePlan = { ...newPlan };
                            manifest.executionEvents.push({ type: "NEW_PLAN", plan: safePlan });
                            session.saveManifest(manifest);
                        } catch (e) {
                            console.log("Failed to save event to manifest:", e);
                        }
                        await actAccordingToPlan(newPlan, army);
                    }
                }
            }); 
        });

        console.log("Running ExecutionAgent... (streaming events)");
        const executionGenerator = executionAgent.execute(army, armyCombatMonitor, planningResult);

        for await (const event of { [Symbol.asyncIterator]() { return executionGenerator; } }) {
            console.log("Execution Event generated:", event.type);
            try {
                const safeEvent = { ...event };
                if (safeEvent.type === "NEW_PLAN") {
                    delete (safeEvent as any).plan;
                }
                manifest.executionEvents.push(safeEvent);
                session.saveManifest(manifest);
            } catch (e) {
                console.log("Failed to save event to manifest:", e);
            }

            if (event.type === "NEW_PLAN") {
                const plan = (event as any).plan;
                await actAccordingToPlan(plan, army);
            }
        }
        console.log("Execution closed.");
    });
} catch (error) {
    console.error("Pipeline crashed with error:", error);
} finally {
    console.log("Shutting down tracing gracefully...");
    runtimeState.setActiveSession(null);
    await sdk.shutdown();
    clearInterval(stateTickInterval);
}

process.on("SIGINT", async () => {
    console.log("Shutting down tracing...");
    runtimeState.setActiveSession(null);
    await sdk.shutdown();
    clearInterval(stateTickInterval);
    process.exit(0);
});
