import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export class Session {
    private id: string;
    private dir: string;

    constructor(baseDir: string) {
        // Generate ISO time and replace colons with dashes for filesystem compatibility
        const timestamp = new Date().toISOString().replace(/:/g, '-');

        this.id = `${timestamp}-${uuidv4()}`;
        this.dir = path.join(baseDir, this.id);
    }

    public getDirectory(): string {
        return this.dir;
    }

    public getAreasDirectory(): string {
        return path.join(this.dir, "areas");
    }

    public getPlanningDirectory(): string {
        return path.join(this.dir, "planning");
    }

    /**
     * Creates the session directory and the required sub-directories.
     */
    public initialize(): void {
        const subDirectories = ['areas', 'planning'];

        subDirectories.forEach((subDir) => {
            const targetPath = path.join(this.dir, subDir);

            // recursive: true ensures the parent session directory is created first
            fs.mkdirSync(targetPath, { recursive: true });
        });
    }
}