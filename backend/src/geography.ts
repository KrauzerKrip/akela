import * as fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';

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

export class GameMapArea {
    public readonly leftBottomCorner: Point;
    public readonly rightTopCorner: Point;
    private readonly id: string;

    public constructor(leftBottomCorner: Point, rightTopCorner: Point, id: string) {
        this.id = id;
        this.leftBottomCorner = leftBottomCorner;
        this.rightTopCorner = rightTopCorner;
    }

    public getBase64Image(sattelite_layer: boolean): string {
        const filePath = this.getPath(sattelite_layer);
        return fs.readFileSync(filePath).toString('base64');
    }

    private getPath(sattelite_layer: boolean): string {
        if (!process.env.BASE_AREA_DIR || !process.env.MAP_FILE_EXTENSION) {
            throw new Error("Environment variables BASE_AREA_DIR and MAP_FILE_EXTENSION must be defined");
        }
        return path.join(process.env.BASE_AREA_DIR, this.id +
            (sattelite_layer ? "_sat" : "") +
            "." +
            process.env.MAP_FILE_EXTENSION)
    }
}

export class GameMap {

    public async extractArea(leftBottomCorner: Point, rightTopCorner: Point): Promise<GameMapArea> {
        if (!process.env.BASE_AREA_DIR || !process.env.MAP_FILE_EXTENSION) {
            throw new Error("Environment variables BASE_AREA_DIR and MAP_FILE_EXTENSION must be defined");
        }

        const id = randomUUID();
        const ext = process.env.MAP_FILE_EXTENSION;
        const basePath = path.join(process.env.BASE_AREA_DIR, `${id}.${ext}`);
        const satPath = path.join(process.env.BASE_AREA_DIR, `${id}_sat.${ext}`);

        // Resolve absolute path to the Python script
        const scriptPath = path.resolve(__dirname, '../../python/extract_area.py');
        const pythonExecutable = process.env.PYTHON_EXEC;

        if (!pythonExecutable) {
            throw new Error("Environment variable PYTHON_EXEC must be defined")
        }

        const { x: x1, y: y1 } = leftBottomCorner;
        const { x: x2, y: y2 } = rightTopCorner;

        // Generate base map without satellite background
        const baseCmd = `${pythonExecutable} ${scriptPath} ${x1} ${y1} ${x2} ${y2} --out ${basePath} --no-sat`;

        // Generate satellite map with background
        const satCmd = `${pythonExecutable} ${scriptPath} ${x1} ${y1} ${x2} ${y2} --out ${satPath}`;

        await Promise.all([
            execAsync(baseCmd),
            execAsync(satCmd)
        ]);

        return new GameMapArea(leftBottomCorner, rightTopCorner, id);
    }
}