# Akela

Akela is an **agentic commander** for **Arma 3**: it closes an **Intel → Plan → Execution** loop using Gemini models (Google ADK), a **Bun** backend that bridges the game, and a **React** war-room UI for maps, timelines, and live events.

## What lives where

- **`backend/`** — Elysia HTTP server, Arma connector, agents, QuickJS plan sandbox, Langfuse tracing.
- **`frontend/`** — Vite + React client (map, session sidebar, event feed, commander console).
- **`python/`** — Terrain and map extraction (`uv`; Python 3.13+). Used by geography and plan visualization paths.
- **`@AkelaMod/`** — Game-side bridge (SQF/Python). See **`@AkelaMod/python/arma_docs.md`** before changing `.sqf`.

Runtime data (gitignored) defaults to **`.data/sessions/`** and **`.data/map_cache/`** at the repo root when you run the backend from **`backend/`**.

## Prerequisites

- **[Bun](https://bun.sh)** for the backend (and optionally for the frontend toolchain).
- **[Nix](https://nixos.org)** with flakes optional but recommended: `nix develop` gives **bun** and **uv** per **`flake.nix`**.
- **Python 3.13+** with **`uv`** if you run map scripts locally (the flake installs **uv**).

## Configuration

Create a **`.env`** (or export variables) for the backend working directory **`backend/`**. Commonly needed:

| Variable | Purpose |
|----------|---------|
| `SESSION_DB_URL` | ADK session persistence (SQLite URL used by the pipeline) |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | OpenTelemetry export to Langfuse |
| `PORT` | HTTP port (default `3000`) |

Google GenAI / ADK credentials should match how you run Gemini in your environment (see Google ADK / Vertex / API key docs).

Optional tuning: `PYTHON_EXEC`, `AREA_SCRIPT_DIR`, `AREA_SCRIPT_NAME`, `ARMA_REQUEST_TIMEOUT_MS`, `SESSION_USER_ID`, `EXECUTION_REPORT_BATCH_SECONDS`, `AKELA_DISABLE_AGENT_PIPELINE`, `AKELA_LOG_POLL_EMPTY` — search **`backend/src`** for exact behavior.

## Run the backend

From **`backend/`**:

```bash
nix develop -c bun run src/index.ts
```

Watch mode:

```bash
nix develop -c bun run --watch src/index.ts
```

If Bun is already on your PATH:

```bash
bun run src/index.ts
```

On **SIGINT**, the process shuts down Langfuse/OpenTelemetry gracefully (`sdk.shutdown()`).

## Run the frontend

From **`frontend/`**:

```bash
nix develop -c bun install   # first time
nix develop -c bun run dev
```

Point the UI at whatever host/port your backend uses (default backend **`PORT=3000`**).

## Python / map tooling

From **`python/`**, use **`uv`** to sync and run scripts (e.g. **`area.py`**) as referenced by **`AREA_SCRIPT_DIR`** / **`AREA_SCRIPT_NAME`** when overriding defaults.

## Docs for AI assistants

**`GEMINI.md`** is the canonical, repo-specific briefing for models (architecture, boundaries, env vars, and compatibility notes). Prefer updating it when behavior or layout changes significantly.

## License / status

This repository is under active development; APIs between the mod, backend, and frontend should be treated as **compatibility-sensitive** when you change routes or event payloads.
