import path from "path";
import type { Session } from "./session";

export interface InterventionCommand {
    message: string;
    targetAgent: string;
    sessionId: string;
}

type InterventionListener = (command: InterventionCommand) => void;

const DEFAULT_SESSIONS_DIR = path.join(process.cwd(), "..", ".data", "sessions");
const DEFAULT_MAP_CACHE_DIR = path.join(process.cwd(), "..", ".data", "map_cache");

class RuntimeState {
    private activeSession: Session | null = null;
    private sessionsDir: string = DEFAULT_SESSIONS_DIR;
    private mapCacheDir: string = DEFAULT_MAP_CACHE_DIR;
    private interventionListeners: InterventionListener[] = [];

    public setSessionsDir(dir: string): void {
        this.sessionsDir = dir;
    }

    public getSessionsDir(): string {
        return this.sessionsDir;
    }

    public setMapCacheDir(dir: string): void {
        this.mapCacheDir = dir;
    }

    public getMapCacheDir(): string {
        return this.mapCacheDir;
    }

    public setActiveSession(session: Session | null): void {
        this.activeSession = session;
    }

    public getActiveSession(): Session | null {
        return this.activeSession;
    }

    public subscribeInterventions(listener: InterventionListener): () => void {
        this.interventionListeners.push(listener);
        return () => {
            this.interventionListeners = this.interventionListeners.filter((l) => l !== listener);
        };
    }

    public dispatchIntervention(command: InterventionCommand): void {
        for (const listener of this.interventionListeners) {
            listener(command);
        }
    }
}

export const runtimeState = new RuntimeState();

