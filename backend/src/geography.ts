import * as fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { Session } from './session';
import sizeOf from 'image-size'; // Import to read image dimensions

const execAsync = promisify(exec);

export interface Point {
    x: number;
    y: number;
}

export interface Point3D {
    x: number;
    y: number;
    z: number;
}

// Defined types for the requested image variants
export type MapLayerType = 'frame_primitives' | 'frame_satellite' | 'primitives' | 'satellite';

export class GameMapArea {
    public readonly leftBottomCorner: Point;
    public readonly rightTopCorner: Point;
    private readonly id: string;
    private readonly areaDir: string;

    public constructor(leftBottomCorner: Point, rightTopCorner: Point, id: string, areaDir: string) {
        this.id = id;
        this.areaDir = areaDir; // Path to <session_areas>/<area_id>/
        this.leftBottomCorner = leftBottomCorner;
        this.rightTopCorner = rightTopCorner;
    }

    /**
     * Reads the specific PNG layer and returns it as a base64 string.
     */
    public getBase64Image(layer: MapLayerType): string {
        const filePath = this.getPath(layer);
        return fs.readFileSync(filePath).toString('base64');
    }

    /**
     * 1. Returns the resolution (width and height in pixels) 
     * of the images without a frame.
     */
    public getImageResolution(): { width: number; height: number } {
        // We use 'satellite' as the reference since you mentioned primitives 
        // and satellite share the same resolution.
        const filePath = this.getPath('satellite');
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const dimensions = sizeOf(fileBuffer); // Works with Uint8Array/Buffer
        if (!dimensions.width || !dimensions.height) {
            throw new Error("Could not determine image dimensions.");
        }

        return {
            width: dimensions.width,
            height: dimensions.height
        };
    }

    /**
     * 2. Returns the map resolution (meters per pixel).
     * This calculates how many Arma 3 meters are represented by a single pixel.
     */
    public getMetersPerPixel(): { x: number; y: number } {
        const { width, height } = this.getImageResolution();

        // Calculate the real-world distance in meters
        const deltaX = Math.abs(this.rightTopCorner.x - this.leftBottomCorner.x);
        const deltaY = Math.abs(this.rightTopCorner.y - this.leftBottomCorner.y);

        return {
            x: deltaX / width,
            y: deltaY / height
        };
    }

    /**
     * Constructs the path to one of the 4 generated files.
     */
    public getPath(layer: MapLayerType): string {
        return path.join(this.areaDir, `${layer}.png`);
    }
}

export class GameMap {
    private session: Session;

    constructor(session: Session) {
        this.session = session;
    }

    public async extractArea(leftBottomCorner: Point, rightTopCorner: Point): Promise<GameMapArea> {
        const pythonExecutable = process.env.PYTHON_EXEC;
        if (!pythonExecutable) {
            throw new Error("Environment variable PYTHON_EXEC must be defined");
        }

        const id = randomUUID();
        // Create the specific directory for this area
        const areaDir = path.join(this.session.getAreasDirectory(), id);

        if (!fs.existsSync(areaDir)) {
            fs.mkdirSync(areaDir, { recursive: true });
        }

        const scriptPath = process.env.AREA_SCRIPT_PATH;
        const { x: x1, y: y1 } = leftBottomCorner;
        const { x: x2, y: y2 } = rightTopCorner;

        // Helper to build the command string
        const buildCmd = (fileName: string, extraArgs: string = "") => {
            const outPath = path.join(areaDir, `${fileName}.png`);
            return `${pythonExecutable} ${scriptPath} extract ${x1} ${y1} ${x2} ${y2} --out ${outPath} ${extraArgs}`;
        };

        // Define the 4 specific generation tasks
        const tasks = [
            // 1. frame_primitives: No satellite, has frame and grid
            execAsync(buildCmd('frame_primitives', '--no-sat --frame --grid')),

            // 2. frame_satellite: Has satellite, has frame and grid
            execAsync(buildCmd('frame_satellite', '--frame --grid')),

            // 3. primitives: No satellite, no frame
            execAsync(buildCmd('primitives', '--no-sat')),

            // 4. satellite: Has satellite, no frame
            execAsync(buildCmd('satellite', ''))
        ];

        try {
            await Promise.all(tasks);
        } catch (error) {
            console.error("Error generating map layers:", error);
            throw error;
        }

        return new GameMapArea(leftBottomCorner, rightTopCorner, id, areaDir);
    }
}