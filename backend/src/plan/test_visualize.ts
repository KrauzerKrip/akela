import { PlanSandbox } from "./sandbox";
import { Army, Group, GameExecutor, Waypoint, Unit, Loadout } from "../army";
import * as fs from "fs";
import * as path from "path";
import { Canvas, createCanvas } from "@napi-rs/canvas";
import { PlanVisualizer } from "./visualization";
import { Session } from "../session";
import { GameMapArea, Point, Point3D } from "../geography";

class DummyExecutor implements GameExecutor {
    getGroupBuilders(side: string): Promise<Group[]> { throw new Error("Method not implemented."); }
    getGroupUnits(group: Group): Promise<Unit[]> { throw new Error("Method not implemented."); }
    getUnitLoadout(unit: Unit): Promise<Loadout> { throw new Error("Method not implemented."); }
    getWaypoints(group: Group): Promise<Waypoint[]> { throw new Error("Method not implemented."); }
    getGroupLeaderPosition(group: Group): Promise<Point3D | null> { return Promise.resolve({ x: group.id === "alpha-id" ? 50 : 80, y: group.id === "alpha-id" ? 50 : 80, z: 0 }); }
    addGroupEventHandlers(group: Group): Promise<void> { throw new Error("Method not implemented."); }
    async addWaypoint(group: Group, waypoint: Waypoint) { }
    async getGroupAssignedVehicles(group: Group) { return []; }
    async setCombatMode(group: Group, mode: string) { }
    async setCombatBehaviour(group: Group, behaviour: string) { }
    async setGroupId(group: Group, name: string) { }
    async setFormation(group: Group, formation: string) { }
}

async function test() {
    console.log("Setting up sandbox and army...");
    const sessionDir = path.join("/tmp", "akela-session-test");
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    const session = new Session(sessionDir);
    session.initialize();

    // Mock Game Map Area
    const dummyAreaDir = path.join(session.getAreasDirectory(), "dummy-area");
    if (!fs.existsSync(dummyAreaDir)) {
        fs.mkdirSync(dummyAreaDir, { recursive: true });
    }

    // Create dummy base images
    const canvas = createCanvas(1000, 1000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1000, 1000);

    fs.writeFileSync(path.join(dummyAreaDir, 'primitives.png'), canvas.toBuffer('image/png'));
    fs.writeFileSync(path.join(dummyAreaDir, 'satellite.png'), canvas.toBuffer('image/png'));

    class MockGameMapArea extends GameMapArea {
        public getImageResolution() {
            return { width: 1000, height: 1000 };
        }
    }

    const mapArea = new MockGameMapArea(
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        "dummy-area",
        dummyAreaDir
    );

    const executor = new DummyExecutor();
    const army = new Army("BLUFOR");
    const alpha = new Group("alpha-id", "Alpha", executor);
    const bravo = new Group("bravo-id", "Bravo", executor);

    army.addGroup(alpha);
    army.addGroup(bravo);
    await alpha.updateSituationalData();
    await bravo.updateSituationalData();

    const sandbox = await PlanSandbox.create();
    const code = fs.readFileSync(path.join(__dirname, "example_visualize.js"), 'utf-8');

    console.log("Compiling plan...");
    const plan = await sandbox.makePlan(army, code);

    console.log("Visualizing plan...");
    const visualizer = new PlanVisualizer(session);
    const visualization = await visualizer.visualize(mapArea, plan, army);

    console.log(`Plan visualized! You can check it at:\n - ${visualization.getImagePath('primitives')}\n - ${visualization.getImagePath('satellite')}`);
}

test().catch(console.error);
