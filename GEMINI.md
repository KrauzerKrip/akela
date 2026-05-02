# Akela — Arma 3 agentic commander

Concise orientation for models and contributors working in this repository.

## What this project is

Akela is an LLM-driven **Intel → Plan → Execution** pipeline that connects to **Arma 3** through an HTTP bridge and optional **@AkelaMod** SQF/Python glue. It reasons over tactical state (armies, groups, tasks, combat events), runs **sandboxed plan code** against domain APIs, and streams structured events to a **React “war room”** UI.

Implementation stack:

- **Agents**: Google ADK (`@google/adk`) + Gemini models via `@google/genai` (model IDs are set in agent code, e.g. `IntelAgent`).
- **Backend**: **Bun**, **Elysia** (`backend/src/server.ts`), typed domain layer (`army.ts`, `combat.ts`), **Langfuse** OpenTelemetry export (`instrumentation.ts`).
- **Plan execution**: **QuickJS** sandbox (`plan/sandbox.ts`, `plan/bootstrap.js`) with plan translation and transport validation.
- **Terrain / maps**: **Python** (`python/area.py` and related scripts) invoked from `geography.ts` / visualization; outputs feed multimodal prompts and caching under `.data/map_cache`.

## Repository layout

| Area | Role |
|------|------|
| `backend/` | Elysia server, pipeline, agents, session lifecycle, Arma connector |
| `frontend/` | Vite + React war room (map, timeline, live WebSocket feed, commander console) |
| `python/` | Map/terrain extraction (`uv` project, Python ≥ 3.13) |
| `@AkelaMod/` | Arma-side bridge (SQF/Python); see `@AkelaMod/python/arma_docs.md` before editing `.sqf` |
| `.data/sessions/<id>/` | Per-session artifacts including `manifest.json` (plan events, inputs, intel summaries) |
| `.data/map_cache/` | Cached map layers |

## Core runtime flow

1. **`backend/src/index.ts`** wires `ArmaConnector`, calls `configureRuntimeDirs()`, constructs **`SessionInitializer`** with a **pipeline factory**, and **`startServer`**.
2. **`SessionInitializer`** (`session_initializer.ts`) builds **`Army`**, **`Group[]`**, **`ArmyCombatMonitor`**, registers **`eventHub`** listeners, and starts periodic **STATE_TICK** style updates for connected clients.
3. **`FullPipeline`** (`pipeline.ts`) orchestrates **IntelAgent → PlanAgent → ExecutionAgent**, persists ADK sessions via **`DatabaseSessionService`** when `SESSION_DB_URL` is set, and surfaces **`NewPlanEvent`**, **`AgentResponseEvent`**, **`LLmDecisionStartEvent`**, etc., through **`eventHub`** (also pushed over WebSockets from the server).
4. **`PremadeIntelPipeline`** (same file) skips **`IntelAgent`** and injects fixed intel text — swap the factory in `index.ts` when debugging planning without vision.

Do **not** break the **Intel → Plan → Execution** contract or blur responsibilities between **`IntelAgent`**, **`PlanAgent`**, and **`ExecutionAgent`** (`agent.ts`).

## Arma bridge (compatibility-sensitive)

- **`arma_connection.ts`** + **`server.ts`**: game polls **`/poll`**; events/responses use **`/respond`**, **`/log`**, **`/new-event`** (and related HTTP routes). Treat payloads as a stable protocol for the mod/extension.
- Geography: preserve bounding-box and terrain-layer extraction semantics in **`geography.ts`** and **`python/area.py`**.

## Observability and sessions

- **Langfuse**: tracing via **`instrumentation.ts`**; requires **`LANGFUSE_PUBLIC_KEY`**, **`LANGFUSE_SECRET_KEY`**, **`LANGFUSE_HOST`**. **`sdk.shutdown()`** must run on graceful shutdown (see **`index.ts`** SIGINT handler) so spans flush.
- Preserve **`.data/sessions/<id>`** layout and **`manifest.json`** shape expected by tooling and the frontend.

## What a model should know before editing code

1. **Run the backend with Bun** from `backend/`: `bun run src/index.ts` (or `bun run --watch …`). **Do not use `bun run tsc`.** Prefer **`nix develop -c bun …`** when Bun is not on PATH (`flake.nix` provides **bun** and **uv**).
2. **Environment**
   - **`SESSION_DB_URL`**: ADK **`DatabaseSessionService`** (SQLite URL as used by the pipeline).
   - **Langfuse**: keys/host above.
   - **`PORT`**: HTTP server (default **3000**).
   - **Python helpers**: **`PYTHON_EXEC`**, **`AREA_SCRIPT_DIR`**, **`AREA_SCRIPT_NAME`** (defaults assume repo-relative `../python` and `area.py`).
   - **Optional**: **`ARMA_REQUEST_TIMEOUT_MS`**, **`SESSION_USER_ID`**, **`EXECUTION_REPORT_BATCH_SECONDS`**, **`AKELA_DISABLE_AGENT_PIPELINE`**, **`AKELA_LOG_POLL_EMPTY`** (see usages in `backend/src`).
   - Google GenAI / ADK: configure credentials the way your deployment expects (ADK picks up standard Google auth / env conventions for your environment).
3. **SQF changes**: read **`@AkelaMod/python/arma_docs.md`** first.
4. **Tools and typing**: agent tools and schemas stay strict (**`zod`**); plan code runs only inside **`PlanSandbox`** (QuickJS), not arbitrary Node.
5. **Frontend**: lives under **`frontend/`**; connects to backend APIs/WebSocket for live **`eventHub`** traffic — keep event types compatible with **`backend/src/event.ts`** when changing contracts.

For human-oriented setup and commands, see the repository **`README.md`**.
