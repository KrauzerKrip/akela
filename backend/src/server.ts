import { Elysia, t } from "elysia";
import { ArmaConnector } from "./arma_connection";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { createHash } from "crypto";
import { eventHub } from "./event";
import { runtimeState } from "./runtime_state";
import { BaseEvent, GameDomainEvent, withEnvelope } from "./event";

const execAsync = promisify(exec);

interface PendingRequest {
    id: string;
    commands: any[];
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
const requestQueue: PendingRequest[] = [];

export function sendArmaRequest(commands: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const req: PendingRequest = { id, commands, resolve, reject };
        pendingRequests.set(id, req);
        requestQueue.push(req);
    });
}

export function startServer(armaConnector: ArmaConnector, port = 3000) {
    const wsClients = new Set<any>();

    const unsubscribeEventHub = eventHub.subscribe((event: BaseEvent) => {
        const payload = JSON.stringify(event);
        for (const client of wsClients) {
            try {
                client.send(payload);
            } catch (error) {
                console.error("Failed to send event to websocket client:", error);
            }
        }
    });

    const getSessionDirectory = (id: string) => path.join(runtimeState.getSessionsDir(), id);

    const parseManifest = (sessionPath: string): Record<string, any> | null => {
        const manifestPath = path.join(sessionPath, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    };

    const pythonExecutable = () => process.env.PYTHON_EXEC || "python";
    const scriptDir = () => process.env.AREA_SCRIPT_DIR || path.join(process.cwd(), "..", "python");
    const scriptName = () => process.env.AREA_SCRIPT_NAME || "area.py";

    const app = new Elysia()
        .get("/", () => "Hello Elysia")
        .ws("/api/events/live", {
            open(ws) {
                wsClients.add(ws);
            },
            close(ws) {
                wsClients.delete(ws);
            }
        })
        .get("/poll", () => {
            const req = requestQueue.shift();
            if (req) {
                return { id: req.id, commands: req.commands };
            }
            return "";
        })
        .post(
            "/respond",
            ({ body }) => {
                const req = pendingRequests.get(body.id);
                if (req) {
                    pendingRequests.delete(body.id);
                    req.resolve(body.response);
                }
                return { status: "received" };
            },
            {
                body: t.Object({
                    id: t.String(),
                    response: t.Any(),
                }),
            }
        )
        .post(
            "/log",
            ({ body }) => {
                console.log("[Python Log]:", body.message);
                return { status: "received" };
            },
            {
                body: t.Object({
                    message: t.String(),
                }),
            }
        )
        .post(
            "/add-request",
            async ({ body }) => {
                try {
                    const result = await sendArmaRequest(body.commands);
                    return { success: true, result };
                } catch (e) {
                    return { success: false, error: String(e) };
                }
            },
            {
                body: t.Object({
                    commands: t.Array(t.Any()),
                }),
            }
        )
        .get("/api/sessions", () => {
            const sessionsDir = runtimeState.getSessionsDir();
            if (!fs.existsSync(sessionsDir)) {
                return [];
            }
            const directories = fs.readdirSync(sessionsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a));

            return directories.map((id) => {
                const sessionPath = path.join(sessionsDir, id);
                const manifest = parseManifest(sessionPath) || {};
                return {
                    id,
                    worldName: manifest.worldName ?? manifest.intelInput?.area?.world ?? null,
                    missionName: manifest.missionName ?? manifest.intelInput?.missionName ?? null,
                    startTime: manifest.startTime ?? id.split("-").slice(0, 3).join("-")
                };
            });
        })
        .get("/api/sessions/active", () => {
            const activeSession = runtimeState.getActiveSession();
            if (!activeSession) {
                return null;
            }
            const manifest = parseManifest(activeSession.getDirectory()) || {};
            return {
                id: activeSession.getId(),
                worldName: manifest.worldName ?? manifest.intelInput?.area?.world ?? null,
                missionName: manifest.missionName ?? manifest.intelInput?.missionName ?? null,
                startTime: manifest.startTime ?? activeSession.getId().split("-").slice(0, 3).join("-")
            };
        })
        .get("/api/sessions/:id/events", ({ params, set }) => {
            const sessionPath = getSessionDirectory(params.id);
            if (!fs.existsSync(sessionPath)) {
                set.status = 404;
                return { error: `Session '${params.id}' not found.` };
            }
            const eventsPath = path.join(sessionPath, "events.jsonl");
            if (!fs.existsSync(eventsPath)) {
                return [];
            }
            try {
                const lines = fs.readFileSync(eventsPath, "utf8")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                const events = lines.map((line) => JSON.parse(line))
                    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
                return events;
            } catch (error) {
                set.status = 500;
                return { error: "Failed to read session events." };
            }
        })
        .get("/api/map/crop", async ({ query, set }) => {
            try {
                const world = String(query.world ?? "");
                const x1 = Number(query.x1);
                const y1 = Number(query.y1);
                const x2 = Number(query.x2);
                const y2 = Number(query.y2);

                if (!world || [x1, y1, x2, y2].some((v) => Number.isNaN(v))) {
                    set.status = 500;
                    return { error: "Invalid map crop query params." };
                }

                const cacheDir = runtimeState.getMapCacheDir();
                fs.mkdirSync(cacheDir, { recursive: true });
                const hash = createHash("md5").update(JSON.stringify({ world, x1, y1, x2, y2 })).digest("hex");
                const cachedImagePath = path.join(cacheDir, `${hash}.png`);

                if (!fs.existsSync(cachedImagePath)) {
                    const cmd = `cd "${scriptDir()}" && "${pythonExecutable()}" "${scriptName()}" extract ${x1} ${y1} ${x2} ${y2} --out "${cachedImagePath}" --frame --grid`;
                    await execAsync(cmd);
                    if (!fs.existsSync(cachedImagePath)) {
                        set.status = 500;
                        return { error: "Failed to generate map crop." };
                    }
                }

                set.headers["content-type"] = "image/png";
                return Bun.file(cachedImagePath);
            } catch (error) {
                set.status = 500;
                return { error: "Map crop generation failed." };
            }
        })
        .post(
            "/api/sessions/:id/intervene",
            ({ params, body, set }) => {
                const sessionPath = getSessionDirectory(params.id);
                if (!fs.existsSync(sessionPath)) {
                    set.status = 404;
                    return { error: `Session '${params.id}' not found.` };
                }
                const activeSession = runtimeState.getActiveSession();
                if (!activeSession || activeSession.getId() !== params.id) {
                    set.status = 404;
                    return { error: "Session is not active in this process." };
                }

                const userCommandEvent = withEnvelope({
                    source: "USER",
                    type: "USER_COMMAND",
                    targetAgent: body.targetAgent,
                    message: body.message,
                    sessionId: params.id
                });
                eventHub.publish(userCommandEvent as any);

                runtimeState.dispatchIntervention({
                    message: body.message,
                    targetAgent: body.targetAgent,
                    sessionId: params.id
                });

                return { status: "received" };
            },
            {
                body: t.Object({
                    message: t.String(),
                    targetAgent: t.String()
                })
            }
        )
        .post("/new-event", async ({ body }) => {
            armaConnector.processRawEvent(body.event, body.params);
            // eventHub.publish(withEnvelope<GameDomainEvent>({
            //     source: "GAME",
            //     type: body.event,
            //     payload: body.params
            // }) as any);
            // return { status: "received" };
        },
            {
                body: t.Object({
                    event: t.String(),
                    params: t.Any(),
                }),
            });

    app.listen(port);
    console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
    process.on("SIGINT", () => {
        unsubscribeEventHub();
    });
    return app;
}
