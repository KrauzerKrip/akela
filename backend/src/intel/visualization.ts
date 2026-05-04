import { GameMapArea, Point } from "../geography";
import { Session } from "../session";
import { IntelMapOverlay } from "./models";
import { ensureIntelMapFontsRegistered, intelMapFontCss } from "./map_canvas_fonts";
import { Canvas, createCanvas, loadImage, SKRSContext2D, Image } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** Pixel width/height used when drawing a unit icon on the map overlay (anchor: center on world position). */
const UNIT_ICON_SIZE_PX = 56;

/** Pixels between icon bottom edge and label top (center-anchored icon). */
const LABEL_GAP_BELOW_ICON = 6;

const AREA_FILL = "rgba(255, 190, 60, 0.28)";
const AREA_STROKE = "rgba(180, 90, 0, 0.95)";
const AREA_STROKE_WIDTH = 3;

export type VisualizedIntelLayerType = "primitives" | "satellite";

export class IntelVisualization {
    private readonly id: string;
    private readonly dir: string;

    constructor(id: string, dir: string) {
        this.id = id;
        this.dir = dir;
    }

    public getImagePath(layer: VisualizedIntelLayerType): string {
        if (layer === "primitives") {
            return path.join(this.dir, "primitives_outline.png");
        }
        return path.join(this.dir, "satellite_outline.png");
    }
}

export class IntelVisualizer {
    private session: Session;

    constructor(session: Session) {
        this.session = session;
    }

    public async visualize(gameMapArea: GameMapArea, overlay: IntelMapOverlay): Promise<IntelVisualization> {
        ensureIntelMapFontsRegistered();
        const exportDir = await this.makeOverlay(gameMapArea, overlay);
        const id = path.basename(exportDir);
        console.log(`Visualized intel overlay and exported to ${exportDir}`);
        return new IntelVisualization(id, exportDir);
    }

    private async makeOverlay(gameMapArea: GameMapArea, overlay: IntelMapOverlay): Promise<string> {
        const id = uuidv4();
        const exportDir = path.join(this.session.getIntelDirectory(), id);
        const outline = new IntelOutline(gameMapArea);

        const iconsDir = path.join(import.meta.dir, "../../resources/icons");
        const imageCache = new Map<string, Promise<Image>>();

        const loadIcon = (unitType: string): Promise<Image> => {
            const tryPath = (p: string) => {
                const cached = imageCache.get(p);
                if (cached) return cached;
                const promise = loadImage(p);
                imageCache.set(p, promise);
                return promise;
            };

            const primary = path.join(iconsDir, `${unitType}.svg`);
            if (fs.existsSync(primary)) {
                return tryPath(primary);
            }
            const fallback = path.join(iconsDir, "unknown.svg");
            return tryPath(fallback);
        };

        for (const area of overlay.areas) {
            if (area.vertices.length >= 3) {
                outline.drawHighlightedArea(area.vertices, area.label);
            }
        }

        for (const unit of overlay.units) {
            const img = await loadIcon(unit.type);
            outline.drawUnitIcon(img, unit.position, unit.label);
        }

        await outline.export(exportDir);
        return exportDir;
    }
}

class IntelOutline {
    private gameMapArea: GameMapArea;
    private canvas: Canvas;
    private ctx: SKRSContext2D;

    constructor(gameMapArea: GameMapArea) {
        this.gameMapArea = gameMapArea;
        const res = gameMapArea.getImageResolution();
        this.canvas = createCanvas(res.width, res.height);
        this.ctx = this.canvas.getContext("2d");
    }

    /**
     * Converts Arma 3 coordinates to image pixel coordinates (Y axis: north-up world → down-screen image).
     */
    private toImageCoords(point: Point): { x: number; y: number } {
        const { width, height } = this.gameMapArea.getImageResolution();
        const rx =
            (point.x - this.gameMapArea.leftBottomCorner.x) /
            (this.gameMapArea.rightTopCorner.x - this.gameMapArea.leftBottomCorner.x);
        const ry =
            (this.gameMapArea.rightTopCorner.y - point.y) /
            (this.gameMapArea.rightTopCorner.y - this.gameMapArea.leftBottomCorner.y);
        return {
            x: rx * width,
            y: ry * height,
        };
    }

    /**
     * Icon anchor: center of the sprite is placed on the world position.
     */
    public drawUnitIcon(img: Image, position: Point, label?: string) {
        const p = this.toImageCoords(position);
        const w = UNIT_ICON_SIZE_PX;
        const h = UNIT_ICON_SIZE_PX;
        this.ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);

        if (label && label.length > 0) {
            const fontSize = 14;
            this.ctx.font = intelMapFontCss(fontSize, "bold");
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "top";
            const tx = p.x;
            const ty = p.y + h / 2 + LABEL_GAP_BELOW_ICON;
            this.ctx.strokeStyle = "rgba(0,0,0,0.85)";
            this.ctx.lineWidth = 4;
            this.ctx.strokeText(label, tx, ty);
            this.ctx.fillStyle = "rgba(255,255,255,0.95)";
            this.ctx.fillText(label, tx, ty);
        }
    }

    public drawHighlightedArea(vertices: Point[], label?: string) {
        const pts = vertices.map((v) => this.toImageCoords(v));
        if (pts.length < 3) return;

        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            this.ctx.lineTo(pts[i].x, pts[i].y);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = AREA_FILL;
        this.ctx.fill();
        this.ctx.strokeStyle = AREA_STROKE;
        this.ctx.lineWidth = AREA_STROKE_WIDTH;
        this.ctx.stroke();

        if (label && label.length > 0) {
            let cx = 0;
            let cy = 0;
            for (const q of pts) {
                cx += q.x;
                cy += q.y;
            }
            cx /= pts.length;
            cy /= pts.length;

            const fontSize = 15;
            this.ctx.font = intelMapFontCss(fontSize, "bold");
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.strokeStyle = "rgba(0,0,0,0.85)";
            this.ctx.lineWidth = 4;
            this.ctx.strokeText(label, cx, cy);
            this.ctx.fillStyle = "rgba(255,248,220,0.98)";
            this.ctx.fillText(label, cx, cy);
        }
    }

    public async export(exportDir: string) {
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const primitivesLayerPath = this.gameMapArea.getPath("primitives");
        const satelliteLayerPath = this.gameMapArea.getPath("satellite");

        const primImage = await loadImage(primitivesLayerPath);
        const satImage = await loadImage(satelliteLayerPath);

        const res = this.gameMapArea.getImageResolution();

        const outlineBuffer = this.canvas.toBuffer("image/png");
        const outlineImage = await loadImage(outlineBuffer);

        const primCanvas = createCanvas(res.width, res.height);
        const primCtx = primCanvas.getContext("2d");
        primCtx.drawImage(primImage, 0, 0);
        primCtx.drawImage(outlineImage, 0, 0);
        const primPath = path.join(exportDir, "primitives_outline.png");
        fs.writeFileSync(primPath, primCanvas.toBuffer("image/png"));

        const satCanvas = createCanvas(res.width, res.height);
        const satCtx = satCanvas.getContext("2d");
        satCtx.drawImage(satImage, 0, 0);
        satCtx.drawImage(outlineImage, 0, 0);
        const satPath = path.join(exportDir, "satellite_outline.png");
        fs.writeFileSync(satPath, satCanvas.toBuffer("image/png"));

        const pythonExecutable = process.env.PYTHON_EXEC;
        if (!pythonExecutable) {
            throw new Error("Environment variable PYTHON_EXEC must be defined");
        }

        const scriptDir = process.env.AREA_SCRIPT_DIR;
        const scriptName = process.env.AREA_SCRIPT_NAME;
        const { x: x1, y: y1 } = this.gameMapArea.leftBottomCorner;
        const { x: x2, y: y2 } = this.gameMapArea.rightTopCorner;

        const buildCmd = (imagePath: string) => {
            return `cd "${scriptDir}" && ${pythonExecutable} ${scriptName} frame "${imagePath}" ${x1} ${y1} ${x2} ${y2} --out "${imagePath}" --frame --grid`;
        };

        try {
            await Promise.all([execAsync(buildCmd(primPath)), execAsync(buildCmd(satPath))]);
        } catch (error) {
            console.error("Error adding frame to intel map visualization:", error);
            throw error;
        }
    }
}
