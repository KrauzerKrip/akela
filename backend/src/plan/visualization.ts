import { GameMapArea, Point } from "../geography";
import { Session } from "../session";
import { Plan } from "./models";
import { Canvas, createCanvas, loadImage, SKRSContext2D } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";

export type VisualizedPlanLayerType = 'frame_primitives' | 'frame_satellite' | 'primitives' | 'satellite';

export class PlanVisualization {
    private readonly id: string;

    constructor(id: string) {
        this.id = id;
    }

    public getImagePath(layer: VisualizedPlanLayerType): string {

    }
}

export class PlanVisualizer {
    private session: Session;

    constructor(session: Session) {
        this.session = session;
    }

    public async visualize(gameMapArea: GameMapArea, plan: Plan): PlanVisualization {

    }

    /**
     * Draws outline, that is basically shapes overlayed on the map, on both primitives and satellite version of the map
     * @param gameMapArea
     * @param plan 
     * @returns absolute path to the new map image file, now with overlays
     */
    private async makeOutline(gameMapArea: GameMapArea, plan: Plan): string {

    }
}

class Outline {
    private gameMapArea: GameMapArea;
    private canvas: Canvas;
    private ctx: SKRSContext2D;

    constructor(gameMapArea: GameMapArea) {
        this.gameMapArea = gameMapArea;
        const res = gameMapArea.getImageResolution();
        this.canvas = createCanvas(res.width, res.height);
        this.ctx = this.canvas.getContext('2d')
    }

    /**
     * Converts Arma 3 coordinates to Image pixel coordinates
     */
    private toImageCoords(point: Point): { x: number, y: number } {
        const { width, height } = this.gameMapArea.getImageResolution();
        const rx = (point.x - this.gameMapArea.leftBottomCorner.x) / (this.gameMapArea.rightTopCorner.x - this.gameMapArea.leftBottomCorner.x);
        // Arma 3 Y increases northwards, image Y increases downwards
        const ry = (this.gameMapArea.rightTopCorner.y - point.y) / (this.gameMapArea.rightTopCorner.y - this.gameMapArea.leftBottomCorner.y);
        return {
            x: rx * width,
            y: ry * height
        };
    }

    /**
     * Draws move arrow of specified color
     * @param point1 
     * @param point2 
     * @param color 
     */
    public drawMoveArrow(point1: Point, point2: Point, color: string) {
        const p1 = this.toImageCoords(point1);
        const p2 = this.toImageCoords(point2);

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 5;
        this.ctx.stroke();

        // draw arrowhead
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headlen = 20;
        this.ctx.beginPath();
        this.ctx.moveTo(p2.x, p2.y);
        this.ctx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    /**
     * Draws attack arrow (an arrow with a cross above its end) of specified color
     * @param point1 
     * @param point2 
     * @param color 
     */
    public drawAttackArrow(point1: Point, point2: Point, color: string) {
        const p1 = this.toImageCoords(point1);
        const p2 = this.toImageCoords(point2);

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 6;
        this.ctx.stroke();

        // draw arrowhead
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headlen = 25;
        this.ctx.beginPath();
        this.ctx.moveTo(p2.x, p2.y);
        this.ctx.lineTo(p2.x - headlen * Math.cos(angle - Math.PI / 6), p2.y - headlen * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(p2.x - headlen * Math.cos(angle + Math.PI / 6), p2.y - headlen * Math.sin(angle + Math.PI / 6));
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.fillStyle = color;
        this.ctx.fill();

        // cross above its end
        const crossOffset = 30; // distance from end
        const crossRadius = 10;
        const cx = p2.x - crossOffset * Math.cos(angle);
        const cy = p2.y - crossOffset * Math.sin(angle);

        this.ctx.beginPath();
        this.ctx.moveTo(cx - crossRadius, cy - crossRadius);
        this.ctx.lineTo(cx + crossRadius, cy + crossRadius);
        this.ctx.moveTo(cx + crossRadius, cy - crossRadius);
        this.ctx.lineTo(cx - crossRadius, cy + crossRadius);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 4;
        this.ctx.stroke();
    }

    public drawPhaseLine(point1: Point, point2: Point, color: string) {
        const p1 = this.toImageCoords(point1);
        const p2 = this.toImageCoords(point2);

        this.ctx.beginPath();
        this.ctx.setLineDash([15, 15]);
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 4;
        this.ctx.stroke();
        this.ctx.setLineDash([]); // reset
    }

    /**
     * exports overlays of both satellite and primitives version of the map
     * @param exportDir
     */
    public async export(exportDir: string) {
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const primitivesLayerPath = this.gameMapArea.getPath('primitives');
        const satelliteLayerPath = this.gameMapArea.getPath('satellite');

        // Loads original map layers
        const primImage = await loadImage(primitivesLayerPath);
        const satImage = await loadImage(satelliteLayerPath);

        const res = this.gameMapArea.getImageResolution();

        // Retrieve drawn shapes from transparent canvas
        const outlineBuffer = this.canvas.toBuffer('image/png');
        const outlineImage = await loadImage(outlineBuffer);

        // Draw onto primitives copy
        const primCanvas = createCanvas(res.width, res.height);
        const primCtx = primCanvas.getContext('2d');
        primCtx.drawImage(primImage, 0, 0);
        primCtx.drawImage(outlineImage, 0, 0);
        fs.writeFileSync(path.join(exportDir, 'primitives_outline.png'), primCanvas.toBuffer('image/png'));

        // Draw onto satellite copy
        const satCanvas = createCanvas(res.width, res.height);
        const satCtx = satCanvas.getContext('2d');
        satCtx.drawImage(satImage, 0, 0);
        satCtx.drawImage(outlineImage, 0, 0);
        fs.writeFileSync(path.join(exportDir, 'satellite_outline.png'), satCanvas.toBuffer('image/png'));
    }
}