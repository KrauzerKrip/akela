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
const session = new Session(sessionDir);
session.initialize();
console.log(`Session initialized at ${session.getDirectory()}`);

const manifest: any = {
    intelInput: paramsInputData
};
session.saveManifest(manifest);

const groups = army.getGroups();
await Promise.all(groups.map(g => g.updateSituationalData()));

const gameMap = new GameMap(session);
console.log(`Extracting map area from (${x1}, ${y1}) to (${x2}, ${y2})`);
const gameMapArea = await gameMap.extractArea(
    { x: x1, y: y1 },
    { x: x2, y: y2 }
);

// Main Pipeline execution wrapped in Trace
await propagateAttributes({
    traceName: "AgenticPipeline",
    sessionId: session.getId(),
    tags: ["initial"]
}, async () => {
    // Intel
    const intelAgent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService);
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
            if (plan.queuedTasks[group.id]) {
                plan.queuedTasks[group.id].forEach((task) => {
                    group.addTaskToQueue(task);
                });
            }
            if (plan.immediateTasks[group.id]) {
                immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
            }

            if (plan.clearGroupTasks[group.id]) {
                group.clearTasks();
            }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    const executionAgent = new ExecutionAgent(
        new SimpleExecutionPromptFormatter(new YamlSitrepFormatter()),
        new YamlSitrepFormatter(),
        sessionService,
        sandbox
    );

    console.log("Running ExecutionAgent... (streaming events)");
    const executionGenerator = executionAgent.execute(army, armyCombatMonitor, planningResult);
    manifest.executionEvents = [];

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
console.log("Shutting down tracing gracefully...");
await sdk.shutdown();
process.on("SIGINT", async () => {
    console.log("Shutting down tracing...");
    await sdk.shutdown();
    process.exit(0);
});
