import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { IntelAgent, PlanAgent, ExecutionAgent, Intel, Image, PlanningResult, ExecutionEvent } from "../agent";
import { GameMapArea, GameMap } from "../geography";
import { deserializeArmy } from "./serialization";
import { ArmyCombatMonitor, GroupCombatMonitor } from "../combat";
import { createSitrep } from "../sitrep";
import { SimpleExecutionPromptFormatter, SimpleIntelPromptFormatter, SimplePlanPromptFormatter, YamlSitrepFormatter } from "../format";
import { DatabaseSessionService, Session as AdkSession } from "@google/adk";
import { PlanVisualization, PlanVisualizer } from "../plan/visualization";
import { PlanSandbox } from "../plan/sandbox";
import { Army } from "../army";
import { Session } from "../session";
import { createEmptyIntelMapOverlay, createStructuredIntelResult } from "../intel/models";
import { v4 as uuidv4 } from 'uuid';


async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: test_agent <init|run> ...");
        process.exit(1);
    }

    const command = args[0];

    if (command === "init") {
        // e.g. init 0 0 1000 1000 --army serialized_army_file.json
        const { values, positionals } = parseArgs({
            args: args.slice(1),
            options: {
                army: { type: "string" }
            },
            allowPositionals: true
        });

        if (positionals.length < 4 || !values.army) {
            console.error("Usage: test_agent init <x1> <y1> <x2> <y2> --army <file>");
            process.exit(1);
        }

        const [x1, y1, x2, y2] = positionals.map(Number);

        const sessionsDir = path.join(process.cwd(), ".data", "test", "sessions");
        if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

        let nextIndex = 1;
        const dirs = fs.readdirSync(sessionsDir);
        for (const d of dirs) {
            if (/^\d+$/.test(d)) {
                const idx = parseInt(d);
                if (idx >= nextIndex) nextIndex = idx + 1;
            }
        }

        const sessionPath = path.join(sessionsDir, nextIndex.toString());
        fs.mkdirSync(sessionPath, { recursive: true });

        const intelPath = path.join(sessionPath, "intel");
        fs.mkdirSync(intelPath, { recursive: true });

        const sessionConfig = {
            id: nextIndex.toString(),
            x1, y1, x2, y2,
            armyFile: "army.json",
            areaDir: "area"
        };
        fs.writeFileSync(path.join(sessionPath, "session.json"), JSON.stringify(sessionConfig, null, 2));

        const armySrc = path.resolve(values.army);
        fs.copyFileSync(armySrc, path.join(sessionPath, "army.json"));

        const mockSession = {
            getAreasDirectory: () => sessionPath
        } as Session;

        const gameMap = new GameMap(mockSession);
        console.log(`Extracting map area from (${x1}, ${y1}) to (${x2}, ${y2})...`);
        const area = await gameMap.extractArea({ x: x1, y: y1 }, { x: x2, y: y2 });

        // Update session config with the generated area directory
        sessionConfig.areaDir = path.basename((area as any).areaDir);
        fs.writeFileSync(path.join(sessionPath, "session.json"), JSON.stringify(sessionConfig, null, 2));

        console.log(`Session ${nextIndex} initialized at ${sessionPath}`);
        console.log(`Now you can add drone photos to ${intelPath}`);
    } else if (command === "run") {
        // e.g. run intel /path/to/session.json -o /path/to/output.json
        const { values, positionals } = parseArgs({
            args: args.slice(1),
            options: {
                o: { type: "string" }
            },
            allowPositionals: true
        });

        if (positionals.length < 2 || !values.o) {
            console.error("Usage: test_agent run <intel|plan|execution> <input_file.json> -o <output_file.json>");
            process.exit(1);
        }

        const agentType = positionals[0];
        const inputFile = path.resolve(positionals[1]);
        const outputFile = path.resolve(values.o as string);

        let sessionDir = path.dirname(inputFile);
        while (!fs.existsSync(path.join(sessionDir, "session.json")) && sessionDir !== path.parse(sessionDir).root) {
            sessionDir = path.dirname(sessionDir);
        }

        if (!fs.existsSync(path.join(sessionDir, "session.json"))) {
            console.error(`Could not find session.json up the tree from ${inputFile}.`);
            process.exit(1);
        }

        const sessionConfig = JSON.parse(fs.readFileSync(path.join(sessionDir, "session.json"), "utf8"));
        const armyData = JSON.parse(fs.readFileSync(path.join(sessionDir, "army.json"), "utf8"));
        const army = deserializeArmy(armyData);

        const areaDir = path.join(sessionDir, sessionConfig.areaDir);
        const gameMapArea = new GameMapArea(
            { x: sessionConfig.x1, y: sessionConfig.y1 },
            { x: sessionConfig.x2, y: sessionConfig.y2 },
            sessionConfig.areaDir,
            areaDir
        );

        const dbUrl = process.env.SESSION_DB_URL;
        if (!dbUrl) {
            console.error("SESSION_DB_URL environment variable is required.");
            process.exit(1);
        }
        const sessionService = new DatabaseSessionService(dbUrl);
        await sessionService.init();

        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const session = {
            getId: () => `test-${sessionConfig.id}-${timestamp}-${uuidv4()}`,
            getDirectory: () => sessionDir,
            getAreasDirectory: () => path.join(sessionDir, "areas"),
            getPlanningDirectory: () => path.join(sessionDir, "planning")
        } as Session;

        // Create output directory if it doesn't exist
        const outDir = path.dirname(outputFile);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        let inputData: any = {};
        if (fs.existsSync(inputFile)) {
            const inputContent = fs.readFileSync(inputFile, "utf8");
            try {
                inputData = JSON.parse(inputContent);
            } catch (e) {
                console.log(`Warning: Failed to parse input file ${inputFile} as JSON.`);
            }
        } else {
            console.log(`Warning: Input file ${inputFile} does not exist. Using empty data.`);
        }

        if (agentType === "intel") {
            const intelDir = path.join(sessionDir, "intel");
            let images: Image[] = [];
            if (fs.existsSync(intelDir)) {
                for (const f of fs.readdirSync(intelDir)) {
                    if (f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg")) {
                        images.push(new Image(path.join(intelDir, f)));
                    }
                }
            }

            const observations = Array.isArray(inputData.observations) ? inputData.observations : [];

            const agent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService, session);
            console.log("Running IntelAgent with", images.length, "images and", observations.length, "observations.");
            const result = await agent.analyze({ images, observations }, gameMapArea);

            fs.writeFileSync(outputFile, JSON.stringify({ result }, null, 2));
            console.log("Finished. Output saved to", outputFile);
            console.log("Result:\n" + JSON.stringify(result, null, 2));
        } else if (agentType === "plan") {
            // Plan agent expects Intel result
            const intelResult = typeof inputData.result === "string"
                ? createStructuredIntelResult(inputData.result, createEmptyIntelMapOverlay())
                : (inputData.result ?? createStructuredIntelResult("", createEmptyIntelMapOverlay()));

            const armyCombatMonitor = ArmyCombatMonitor.fromArmy(army);
            const sitreps = army.getGroups().map(g => {
                const monitor = armyCombatMonitor.getGroupMonitor(g.id);
                return createSitrep(g, monitor!);
            });

            const sandbox = await PlanSandbox.create();
            const visualizer = new PlanVisualizer(new Session(path.join(sessionDir, "viz")));

            const agent = new PlanAgent(
                new SimplePlanPromptFormatter(new YamlSitrepFormatter()),
                sessionService,
                session,
                sandbox,
                visualizer
            );

            console.log("Running PlanAgent...");
            const result = await agent.plan(army, sitreps, intelResult, gameMapArea);

            fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
            console.log("Finished. Output saved to", outputFile);
            console.log("Result:\n", JSON.stringify(result, null, 2));

        } else if (agentType === "execution") {
            const planningResult: PlanningResult = inputData;
            if (!planningResult || !planningResult.code || !planningResult.description) {
                console.error("Invalid planning result in input file.");
                process.exit(1);
            }

            const armyCombatMonitor = ArmyCombatMonitor.fromArmy(army);
            const sandbox = await PlanSandbox.create();

            const agent = new ExecutionAgent(
                new SimpleExecutionPromptFormatter(new YamlSitrepFormatter()),
                new YamlSitrepFormatter(),
                sessionService,
                session,
                sandbox
            );

            console.log("Running ExecutionAgent... (Press CTRL+C anytime to stop if it blocks waiting for reports)");
            const eventGenerator = agent.execute(army, armyCombatMonitor, planningResult);

            const events = [];

            try {
                for await (const event of { [Symbol.asyncIterator]() { return eventGenerator; } }) {
                    events.push(event);
                    console.log("\n=========================");
                    console.log("Execution Event yielded:", event.type);
                    if ((event as any).response) {
                        console.log("Response text:\n" + (event as any).response);
                    } else if ((event as any).code) {
                        console.log("New Plan Code:\n" + (event as any).code);
                    }
                    console.log("=========================\n");

                    fs.writeFileSync(outputFile, JSON.stringify({ events }, null, 2));
                }
            } catch (e) {
                console.error("Execution Agent encountered an error:", e);
            }

            console.log("Finished Execution Agent flow.");
        } else {
            console.error(`Unknown agent type: ${agentType}. Choose from intel, plan, execution.`);
            process.exit(1);
        }
    } else {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
}

main().catch(console.error);