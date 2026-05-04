/**
 * Smoke test: draws every `INTEL_UNIT_TYPE` on a grid → PNGs under <session>/intel/<uuid>/.
 * Map labels are 1-based indices; the console prints index → type before export.
 * Requires: PYTHON_EXEC, AREA_SCRIPT_DIR, AREA_SCRIPT_NAME (same as plan visualization).
 * Example: `cd backend && set -a && [ -f .env ] && . ./.env && set +a && bun run src/intel/test_visualize.ts`
 */
import * as fs from "fs";
import * as path from "path";
import { Session } from "../session";
import { GameMapArea, Point } from "../geography";
import { IntelVisualizer } from "./visualization";
import { INTEL_UNIT_TYPES, IntelMapOverlay } from "./models";
import { createCanvas } from "@napi-rs/canvas";

const GRID_COLS = 6;

function buildAllIconOverlay(
    worldMax: number,
    margin: number,
    step: number,
): IntelMapOverlay {
    const units = INTEL_UNIT_TYPES.map((type, i) => {
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        return {
            id: `all-icons-${i}`,
            type,
            position: {
                x: margin + col * step,
                y: margin + row * step,
            },
            label: String(i + 1),
        };
    });
    return { units, areas: [] };
}

async function test() {
    const sessionDir = path.join("/tmp", "akela-intel-viz-test");
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    const session = new Session(sessionDir);
    session.initialize();

    const dummyAreaDir = path.join(session.getAreasDirectory(), "dummy-area");
    if (!fs.existsSync(dummyAreaDir)) {
        fs.mkdirSync(dummyAreaDir, { recursive: true });
    }

    const px = 2000;
    const canvas = createCanvas(px, px);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, px, px);

    fs.writeFileSync(path.join(dummyAreaDir, "primitives.png"), canvas.toBuffer("image/png"));
    fs.writeFileSync(path.join(dummyAreaDir, "satellite.png"), canvas.toBuffer("image/png"));

    class MockGameMapArea extends GameMapArea {
        public getImageResolution() {
            return { width: px, height: px };
        }
    }

    const world = 200;
    const leftBottom: Point = { x: 0, y: 0 };
    const rightTop: Point = { x: world, y: world };
    const mapArea = new MockGameMapArea(leftBottom, rightTop, "dummy-area", dummyAreaDir);

    const margin = 14;
    const step = 30;
    const overlay = buildAllIconOverlay(world, margin, step);

    console.log("Icon index → INTEL_UNIT_TYPE (labels on map are 1-based indices):\n");
    INTEL_UNIT_TYPES.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}  ${t}`));
    console.log("");

    const visualizer = new IntelVisualizer(session);
    const visualization = await visualizer.visualize(mapArea, overlay);

    console.log("Intel overlay written:");
    console.log(`  ${visualization.getImagePath("primitives")}`);
    console.log(`  ${visualization.getImagePath("satellite")}`);
}

test().catch((e) => {
    console.error(e);
    process.exit(1);
});
