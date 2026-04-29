import { Elysia, t } from "elysia";
import { ArmaConnector } from "./arma_connection";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec, execSync } from "child_process";
import { createHash } from "crypto";
import { eventHub } from "./event";
import { runtimeState } from "./runtime_state";
import { BaseEvent, GameDomainEvent, withEnvelope } from "./event";
import type {
  SessionInitializePayload,
  SessionInitializeResult,
} from "./session_initializer";

const execAsync = promisify(exec);

interface PendingRequest {
  id: string;
  commands: any[];
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();
const requestQueue: PendingRequest[] = [];
const ARMA_REQUEST_TIMEOUT_MS = Number(
  process.env.ARMA_REQUEST_TIMEOUT_MS ?? 20000,
);
const MAX_MAP_CROP_SPAN_METERS = 10_000;

function removeFromQueue(requestId: string): void {
  const queuedIndex = requestQueue.findIndex(
    (queued) => queued.id === requestId,
  );
  if (queuedIndex >= 0) {
    requestQueue.splice(queuedIndex, 1);
  }
}

export function sendArmaRequest(commands: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(id);
      removeFromQueue(id);
      pending.reject(
        new Error(
          `Arma request timed out after ${ARMA_REQUEST_TIMEOUT_MS}ms (id=${id}).`,
        ),
      );
    }, ARMA_REQUEST_TIMEOUT_MS);

    const req: PendingRequest = { id, commands, resolve, reject, timeout };
    pendingRequests.set(id, req);
    requestQueue.push(req);
  });
}

interface StartServerOptions {
  port?: number;
  initializeSession?: (
    payload: SessionInitializePayload,
  ) => Promise<SessionInitializeResult>;
}

export function startServer(
  armaConnector: ArmaConnector,
  options: StartServerOptions = {},
) {
  const port = options.port ?? 3000;
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

  const getSessionDirectory = (id: string) =>
    path.join(runtimeState.getSessionsDir(), id);

  const parseManifest = (sessionPath: string): Record<string, any> | null => {
    const manifestPath = path.join(sessionPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  };
  const parseEvents = (sessionPath: string): Record<string, any>[] => {
    const eventsPath = path.join(sessionPath, "events.jsonl");
    if (!fs.existsSync(eventsPath)) {
      return [];
    }
    const lines = fs
      .readFileSync(eventsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines
      .map((line) => JSON.parse(line))
      .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  };

  const pythonExecutable = (): string | null => {
    if (process.env.PYTHON_EXEC) {
      return process.env.PYTHON_EXEC;
    }

    try {
      execSync("command -v python3", { stdio: "ignore" });
      return "python3";
    } catch {
      // Fall back to python when python3 is not available.
    }

    try {
      execSync("command -v python", { stdio: "ignore" });
      return "python";
    } catch {
      return null;
    }
  };
  const scriptDir = () =>
    process.env.AREA_SCRIPT_DIR || path.join(process.cwd(), "..", "python");
  const scriptName = () => process.env.AREA_SCRIPT_NAME || "area.py";

  const app = new Elysia()
    .onBeforeHandle(({ request, set }) => {
      const origin = request.headers.get("origin");
      if (!origin) {
        return;
      }
      set.headers["access-control-allow-origin"] = origin;
      set.headers["vary"] = "Origin";
      set.headers["access-control-allow-credentials"] = "true";
      set.headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
      set.headers["access-control-allow-headers"] =
        "Content-Type,Authorization";
    })
    .options("*", ({ set }) => {
      set.status = 204;
      return null;
    })
    .get("/", () => "Hello Elysia")
    .ws("/api/events/live", {
      open(ws) {
        wsClients.add(ws);
      },
      close(ws) {
        wsClients.delete(ws);
      },
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
          clearTimeout(req.timeout);
          req.resolve(body.response);
        }
        return { status: "received" };
      },
      {
        body: t.Object({
          id: t.String(),
          response: t.Any(),
        }),
      },
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
      },
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
      },
    )
    .get("/api/sessions", () => {
      const sessionsDir = runtimeState.getSessionsDir();
      if (!fs.existsSync(sessionsDir)) {
        return [];
      }
      const directories = fs
        .readdirSync(sessionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));

      return directories.map((id) => {
        const sessionPath = path.join(sessionsDir, id);
        const manifest = parseManifest(sessionPath) || {};
        return {
          id,
          worldName:
            manifest.worldName ?? manifest.intelInput?.area?.world ?? null,
          missionName:
            manifest.missionName ?? manifest.intelInput?.missionName ?? null,
          startTime: manifest.startTime ?? id.split("-").slice(0, 3).join("-"),
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
        worldName:
          manifest.worldName ?? manifest.intelInput?.area?.world ?? null,
        missionName:
          manifest.missionName ?? manifest.intelInput?.missionName ?? null,
        startTime:
          manifest.startTime ??
          activeSession.getId().split("-").slice(0, 3).join("-"),
      };
    })
    .post(
      "/api/sessions/initialize",
      async ({ body, set }) => {
        if (!options.initializeSession) {
          set.status = 501;
          return {
            error: "Session initialization is not available in this process.",
          };
        }

        try {
          const session = await options.initializeSession(body);
          return {
            status: "initialized",
            session,
          };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "ACTIVE_SESSION_EXISTS"
          ) {
            set.status = 409;
            return {
              error: "An active session already exists in this process.",
            };
          }
          if (
            error instanceof Error &&
            error.message === "SESSION_INITIALIZATION_IN_PROGRESS"
          ) {
            set.status = 409;
            return {
              error: "A session initialization is already in progress.",
            };
          }
          set.status = 500;
          return { error: "Failed to initialize session." };
        }
      },
      {
        body: t.Object({
          intel: t.Object({
            photos: t.Optional(t.Array(t.String())),
            observations: t.Optional(t.Array(t.String())),
          }),
          area: t.Object({
            x1: t.Numeric(),
            y1: t.Numeric(),
            x2: t.Numeric(),
            y2: t.Numeric(),
            world: t.Optional(t.String()),
          }),
          missionName: t.Optional(t.String()),
          worldName: t.Optional(t.String()),
          side: t.Optional(t.String()),
        }),
      },
    )
    .get("/api/sessions/:id/events", ({ params, set }) => {
      const sessionPath = getSessionDirectory(params.id);
      if (!fs.existsSync(sessionPath)) {
        set.status = 404;
        return { error: `Session '${params.id}' not found.` };
      }
      try {
        return parseEvents(sessionPath);
      } catch (error) {
        set.status = 500;
        return { error: "Failed to read session events." };
      }
    })
    .get("/api/sessions/:id/manifest", ({ params, set }) => {
      const sessionPath = getSessionDirectory(params.id);
      if (!fs.existsSync(sessionPath)) {
        set.status = 404;
        return { error: `Session '${params.id}' not found.` };
      }
      const manifest = parseManifest(sessionPath);
      if (!manifest) {
        set.status = 404;
        return { error: "Session manifest not found." };
      }
      return manifest;
    })
    .get("/api/sessions/:id/dashboard", ({ params, set }) => {
      const sessionPath = getSessionDirectory(params.id);
      if (!fs.existsSync(sessionPath)) {
        set.status = 404;
        return { error: `Session '${params.id}' not found.` };
      }
      try {
        const manifest = parseManifest(sessionPath) || {};
        const events = parseEvents(sessionPath);
        const eventCounts: Record<string, number> = {};
        events.forEach((event) => {
          const eventType = String(event.type ?? "UNKNOWN");
          eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1;
        });

        return {
          sessionId: params.id,
          worldName:
            manifest.worldName ?? manifest.intelInput?.area?.world ?? null,
          missionName:
            manifest.missionName ?? manifest.intelInput?.missionName ?? null,
          workingArea: manifest.intelInput?.area ?? null,
          planningArtifactsDir: path.join(sessionPath, "planning"),
          eventCounts,
          totalEvents: events.length,
        };
      } catch (error) {
        set.status = 500;
        return { error: "Failed to build dashboard payload." };
      }
    })
    .get("/api/sessions/:id/traces", ({ params, set }) => {
      const sessionPath = getSessionDirectory(params.id);
      if (!fs.existsSync(sessionPath)) {
        set.status = 404;
        return { error: `Session '${params.id}' not found.` };
      }
      try {
        const events = parseEvents(sessionPath);
        const traces = events
          .filter(
            (event) =>
              event.type === "LLM_DECISION_START" ||
              event.type === "AGENT_RESPONSE" ||
              event.type === "NEW_PLAN",
          )
          .map((event, index) => ({
            id: `${params.id}-${index}`,
            t: Number(event.t ?? Date.now()),
            title: String(event.type ?? "TRACE"),
            detail: event.response
              ? String(event.response)
              : event.trigger
                ? String(event.trigger)
                : event.code
                  ? String(event.code).slice(0, 400)
                  : JSON.stringify(event),
          }));

        return {
          sessionId: params.id,
          source: "session-events-fallback",
          traces,
        };
      } catch (error) {
        set.status = 500;
        return { error: "Failed to load session traces." };
      }
    })
    .get("/api/map/crop", async ({ query, set }) => {
      console.log(
        `Cropping map for ${query.world}: ${query.x1} ${query.y1} ${query.x2} ${query.y2}`,
      );
      try {
        const world = String(query.world ?? "");
        const rawX1 = Number(query.x1);
        const rawY1 = Number(query.y1);
        const rawX2 = Number(query.x2);
        const rawY2 = Number(query.y2);

        if (
          !world ||
          [rawX1, rawY1, rawX2, rawY2].some((v) => !Number.isFinite(v))
        ) {
          set.status = 400;
          return { error: "Invalid map crop query params." };
        }
        const x1 = Math.min(rawX1, rawX2);
        const y1 = Math.min(rawY1, rawY2);
        const x2 = Math.max(rawX1, rawX2);
        const y2 = Math.max(rawY1, rawY2);
        const width = x2 - x1;
        const height = y2 - y1;

        if (width <= 0 || height <= 0) {
          set.status = 400;
          return { error: "Map crop bounds must have positive area." };
        }

        if (width > MAX_MAP_CROP_SPAN_METERS || height > MAX_MAP_CROP_SPAN_METERS) {
          set.status = 413;
          return {
            error: `Map crop exceeds max span of ${MAX_MAP_CROP_SPAN_METERS} meters.`,
          };
        }

        const cacheDir = runtimeState.getMapCacheDir();
        fs.mkdirSync(cacheDir, { recursive: true });
        const hash = createHash("md5")
          .update(JSON.stringify({ world, x1, y1, x2, y2 }))
          .digest("hex");
        const cachedImagePath = path.join(cacheDir, `${hash}.png`);

        if (!fs.existsSync(cachedImagePath)) {
          const pythonExec = pythonExecutable();
          if (!pythonExec) {
            set.status = 500;
            return {
              error:
                "Python runtime not found. Run backend in nix shell or set PYTHON_EXEC.",
            };
          }

          const execPrefix = pythonExec.includes(" ")
            ? pythonExec
            : `"${pythonExec}"`;
          const cmd = `cd "${scriptDir()}" && ${execPrefix} "${scriptName()}" extract ${x1} ${y1} ${x2} ${y2} --out "${cachedImagePath}" --frame --grid`;
          await execAsync(cmd);
          if (!fs.existsSync(cachedImagePath)) {
            set.status = 500;
            return { error: "Failed to generate map crop." };
          }
        }

        set.headers["content-type"] = "image/png";
        return Bun.file(cachedImagePath);
      } catch (error) {
        console.error("Map crop generation failed:", error);
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
          sessionId: params.id,
        });
        eventHub.publish(userCommandEvent as any);

        runtimeState.dispatchIntervention({
          message: body.message,
          targetAgent: body.targetAgent,
          sessionId: params.id,
        });

        return { status: "received" };
      },
      {
        body: t.Object({
          message: t.String(),
          targetAgent: t.String(),
        }),
      },
    )
    .post(
      "/new-event",
      async ({ body }) => {
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
      },
    );

  app.listen(port);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
  );
  process.on("SIGINT", () => {
    unsubscribeEventHub();
  });
  return app;
}
